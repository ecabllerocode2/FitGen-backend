import crypto from 'crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  buildTrialFields,
  ensureDirectAthleteBilling,
  evaluateAthleteBillingAccess,
  isBillingExempt,
  isTrialActive,
  mapMpPreapprovalStatus,
} from '../../../domain/billing/athleteAccess.js';
import { assertAthleteBillingAccess } from '../../../domain/billing/assertAccess.js';
import {
  ATHLETE_TRIAL_DAYS,
  SUBSCRIPTION_STATUS,
} from '../../../domain/billing/constants.js';
import { verifyWebhookSignature } from '../../../domain/billing/mercadoPagoClient.js';
import {
  billingEventId,
  buildAuthorizedPaymentPatch,
  buildPreapprovalPatch,
  resolveSubscriptionTransition,
} from '../../../domain/billing/statusTransitions.js';
import { createMemoryBillingEventStore } from '../../../domain/billing/eventStore.js';
import {
  applyPreapprovalSync,
  isAuthorizedPaymentTopic,
  isPreapprovalTopic,
  processBillingNotification,
} from '../../../domain/billing/webhookSync.js';

function createMemoryUsers(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async getUser(id) {
      const row = store.get(id);
      return row ? { id, ...row } : null;
    },
    async saveUser(id, data) {
      const prev = store.get(id) || {};
      const next = { ...prev, ...data };
      store.set(id, next);
      return { id, ...next };
    },
  };
}

function signWebhook({ dataId, requestId, ts, secret }) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('athlete billing access matrix', () => {
  it('exempts coaches, coached athletes and lifetimeAccess grants', () => {
    expect(isBillingExempt({ accountType: 'coach' })).toBe(true);
    expect(isBillingExempt({ athleteOrigin: 'coached' })).toBe(true);
    expect(isBillingExempt({ lifetimeAccess: true, athleteOrigin: 'direct' })).toBe(true);
    expect(isBillingExempt({ accountType: 'athlete', athleteOrigin: 'direct' })).toBe(false);
  });

  it('allows active trial and active/past_due subscriptions', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(
      evaluateAthleteBillingAccess({
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
        trialEndsAt: future,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAthleteBillingAccess({
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAthleteBillingAccess({
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
      }).reason,
    ).toBe('past_due_grace');
  });

  it('blocks expired trial, pending checkout, canceled and expired', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(
      evaluateAthleteBillingAccess({
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
        trialEndsAt: past,
      }).reason,
    ).toBe('trial_expired');
    for (const status of [
      SUBSCRIPTION_STATUS.PENDING_CHECKOUT,
      SUBSCRIPTION_STATUS.CANCELED,
      SUBSCRIPTION_STATUS.EXPIRED,
    ]) {
      expect(
        evaluateAthleteBillingAccess({
          athleteOrigin: 'direct',
          subscriptionStatus: status,
        }).allowed,
      ).toBe(false);
    }
  });

  it('builds exactly 14-day trial fields', () => {
    const fields = buildTrialFields('2026-08-01T00:00:00.000Z');
    expect(fields.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.TRIALING);
    expect(fields.trialEndsAt).toBe('2026-08-15T00:00:00.000Z');
    expect(ATHLETE_TRIAL_DAYS).toBe(14);
    expect(isTrialActive(fields, new Date('2026-08-14T23:00:00.000Z'))).toBe(true);
    expect(isTrialActive(fields, new Date('2026-08-15T00:00:01.000Z'))).toBe(false);
  });

  it('maps Mercado Pago statuses', () => {
    expect(mapMpPreapprovalStatus('authorized')).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapMpPreapprovalStatus('pending')).toBe(SUBSCRIPTION_STATUS.PENDING_CHECKOUT);
    expect(mapMpPreapprovalStatus('paused')).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
    expect(mapMpPreapprovalStatus('cancelled')).toBe(SUBSCRIPTION_STATUS.CANCELED);
  });
});

describe('ensureDirectAthleteBilling idempotency', () => {
  it('initializes trial once and is stable on repeat', async () => {
    const users = createMemoryUsers({
      u1: { accountType: 'athlete', athleteOrigin: 'direct' },
    });
    const first = await ensureDirectAthleteBilling({
      users,
      auth: null,
      userId: 'u1',
      user: await users.getUser('u1'),
    });
    const second = await ensureDirectAthleteBilling({
      users,
      auth: null,
      userId: 'u1',
      user: await users.getUser('u1'),
    });
    expect(first.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.TRIALING);
    expect(second.trialStartedAt).toBe(first.trialStartedAt);
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
    expect(users.store.get('u1').subscriptionStatus).toBe(SUBSCRIPTION_STATUS.TRIALING);
  });

  it('expires stale trialing without rewriting trial window', async () => {
    const users = createMemoryUsers({
      u1: {
        accountType: 'athlete',
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
        trialStartedAt: '2026-01-01T00:00:00.000Z',
        trialEndsAt: '2026-01-15T00:00:00.000Z',
      },
    });
    const out = await ensureDirectAthleteBilling({
      users,
      auth: null,
      userId: 'u1',
      user: await users.getUser('u1'),
    });
    expect(out.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.EXPIRED);
    expect(out.trialEndsAt).toBe('2026-01-15T00:00:00.000Z');
  });

  it('race: concurrent ensure calls do not create divergent trials from same seed', async () => {
    const users = createMemoryUsers({
      u1: {
        accountType: 'athlete',
        athleteOrigin: 'direct',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    });
    const user = await users.getUser('u1');
    const results = await Promise.all([
      ensureDirectAthleteBilling({ users, auth: null, userId: 'u1', user }),
      ensureDirectAthleteBilling({ users, auth: null, userId: 'u1', user }),
      ensureDirectAthleteBilling({ users, auth: null, userId: 'u1', user }),
    ]);
    const ends = new Set(results.map((r) => r.trialEndsAt));
    expect(ends.size).toBe(1);
    expect([...ends][0]).toBe('2026-08-15T00:00:00.000Z');
  });
});

describe('assertAthleteBillingAccess', () => {
  it('throws 402 when trial expired', async () => {
    const users = createMemoryUsers({
      u1: {
        accountType: 'athlete',
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED,
        trialEndsAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await expect(
      assertAthleteBillingAccess({
        users,
        userId: 'u1',
        user: await users.getUser('u1'),
        auth: null,
      }),
    ).rejects.toMatchObject({ status: 402, code: 'subscription_required' });
  });

  it('allows active subscribers', async () => {
    const users = createMemoryUsers({
      u1: {
        accountType: 'athlete',
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      },
    });
    const out = await assertAthleteBillingAccess({
      users,
      userId: 'u1',
      user: await users.getUser('u1'),
      auth: null,
    });
    expect(out.access.allowed).toBe(true);
  });
});

describe('webhook signature security', () => {
  const secret = 'test-secret-abc';
  const dataId = 'pre_123';
  const requestId = 'req_456';
  const ts = '1700000000';

  it('accepts valid HMAC signature', () => {
    const xSignature = signWebhook({ dataId, requestId, ts, secret });
    expect(
      verifyWebhookSignature({
        xSignature,
        xRequestId: requestId,
        dataId,
        secret,
        nodeEnv: 'production',
      }),
    ).toBe(true);
  });

  it('rejects tampered signature', () => {
    expect(
      verifyWebhookSignature({
        xSignature: signWebhook({ dataId, requestId, ts, secret: 'other' }),
        xRequestId: requestId,
        dataId,
        secret,
        nodeEnv: 'production',
      }),
    ).toBe(false);
  });

  it('rejects missing fields when secret is configured', () => {
    expect(
      verifyWebhookSignature({
        xSignature: null,
        xRequestId: requestId,
        dataId,
        secret,
      }),
    ).toBe(false);
  });

  it('rejects missing secret in production', () => {
    expect(
      verifyWebhookSignature({
        xSignature: 'ts=1,v1=abc',
        xRequestId: requestId,
        dataId,
        secret: '',
        nodeEnv: 'production',
      }),
    ).toBe(false);
  });

  it('allows missing secret outside production (local)', () => {
    expect(
      verifyWebhookSignature({
        xSignature: null,
        xRequestId: null,
        dataId: null,
        secret: '',
        nodeEnv: 'development',
      }),
    ).toBe(true);
  });
});

describe('subscription transitions (race guards)', () => {
  it('is idempotent for same status', () => {
    expect(
      resolveSubscriptionTransition(SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.ACTIVE),
    ).toEqual({ apply: false, next: SUBSCRIPTION_STATUS.ACTIVE, reason: 'idempotent' });
  });

  it('rejects active → pending_checkout regression', () => {
    const r = resolveSubscriptionTransition(
      SUBSCRIPTION_STATUS.ACTIVE,
      SUBSCRIPTION_STATUS.PENDING_CHECKOUT,
    );
    expect(r.apply).toBe(false);
    expect(r.reason).toBe('reject_regression');
  });

  it('allows pending → active and active → canceled', () => {
    expect(
      resolveSubscriptionTransition(
        SUBSCRIPTION_STATUS.PENDING_CHECKOUT,
        SUBSCRIPTION_STATUS.ACTIVE,
      ).apply,
    ).toBe(true);
    expect(
      resolveSubscriptionTransition(SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.CANCELED).apply,
    ).toBe(true);
  });

  it('builds preapproval and payment patches', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(buildPreapprovalPatch({ id: 'p1', status: 'authorized' }, now).subscriptionStatus).toBe(
      SUBSCRIPTION_STATUS.ACTIVE,
    );
    expect(
      buildAuthorizedPaymentPatch({ status: 'approved' }, 'ap_1', now).subscriptionStatus,
    ).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(
      buildAuthorizedPaymentPatch({ status: 'rejected' }, 'ap_1', now).subscriptionStatus,
    ).toBeUndefined();
    expect(
      buildAuthorizedPaymentPatch({ status: 'rejected' }, 'ap_1', now).lastPaymentRejectedAt,
    ).toBeTruthy();
    expect(
      resolveSubscriptionTransition(SUBSCRIPTION_STATUS.CANCELED, SUBSCRIPTION_STATUS.ACTIVE).apply,
    ).toBe(true);
  });
});

describe('webhook topic classifiers', () => {
  it('recognizes exact preapproval and authorized payment topics', () => {
    expect(isPreapprovalTopic('preapproval')).toBe(true);
    expect(isPreapprovalTopic('subscription_preapproval')).toBe(true);
    expect(isPreapprovalTopic('subscription_preapproval_plan')).toBe(false);
    expect(isAuthorizedPaymentTopic('authorized_payment')).toBe(true);
    expect(isAuthorizedPaymentTopic('subscription_authorized_payment')).toBe(true);
    expect(isAuthorizedPaymentTopic('payment')).toBe(false);
  });
});

describe('webhook idempotency + races', () => {
  let users;
  let eventStore;

  beforeEach(() => {
    users = createMemoryUsers({
      athlete1: {
        accountType: 'athlete',
        athleteOrigin: 'direct',
        subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED,
        email: 'a@test.com',
      },
    });
    eventStore = createMemoryBillingEventStore();
  });

  it('dedupes duplicate webhook deliveries', async () => {
    const preapproval = {
      id: 'pre_1',
      status: 'authorized',
      external_reference: 'athlete1',
    };
    const fetchPreapproval = async () => preapproval;
    const resolveUser = async () => ({
      userId: 'athlete1',
      user: await users.getUser('athlete1'),
    });

    const first = await processBillingNotification({
      eventStore,
      type: 'subscription_preapproval',
      dataId: 'pre_1',
      fetchPreapproval,
      fetchAuthorizedPayment: async () => ({}),
      resolveUser,
      users,
      auth: null,
    });
    const second = await processBillingNotification({
      eventStore,
      type: 'subscription_preapproval',
      dataId: 'pre_1',
      fetchPreapproval,
      fetchAuthorizedPayment: async () => ({}),
      resolveUser,
      users,
      auth: null,
    });

    expect(first.duplicate).toBe(false);
    expect(first.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(second.duplicate).toBe(true);
    expect(eventStore.size()).toBe(1);
    expect(billingEventId({ type: 'subscription_preapproval', dataId: 'pre_1' })).toBe(
      'subscription_preapproval:pre_1',
    );
  });

  it('race: concurrent identical notifications claim once', async () => {
    let fetches = 0;
    const preapproval = {
      id: 'pre_race',
      status: 'authorized',
      external_reference: 'athlete1',
    };
    const fetchPreapproval = async () => {
      fetches += 1;
      return preapproval;
    };
    const resolveUser = async () => ({
      userId: 'athlete1',
      user: await users.getUser('athlete1'),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        processBillingNotification({
          eventStore,
          type: 'subscription_preapproval',
          dataId: 'pre_race',
          fetchPreapproval,
          fetchAuthorizedPayment: async () => ({}),
          resolveUser,
          users,
          auth: null,
        }),
      ),
    );

    const applied = results.filter((r) => !r.duplicate);
    const dupes = results.filter((r) => r.duplicate);
    expect(applied).toHaveLength(1);
    expect(dupes).toHaveLength(7);
    expect(fetches).toBe(1);
    expect((await users.getUser('athlete1')).subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
  });

  it('race: out-of-order pending after active does not regress', async () => {
    await applyPreapprovalSync({
      users,
      userId: 'athlete1',
      user: await users.getUser('athlete1'),
      preapproval: { id: 'pre_1', status: 'authorized', external_reference: 'athlete1' },
    });
    expect((await users.getUser('athlete1')).subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);

    const skipped = await applyPreapprovalSync({
      users,
      userId: 'athlete1',
      user: await users.getUser('athlete1'),
      preapproval: { id: 'pre_1', status: 'pending', external_reference: 'athlete1' },
    });
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe('reject_regression');
    expect((await users.getUser('athlete1')).subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
  });

  it('authorized payment approved activates subscription', async () => {
    const result = await processBillingNotification({
      eventStore,
      type: 'subscription_authorized_payment',
      dataId: 'ap_ok',
      fetchPreapproval: async () => ({
        id: 'pre_ok',
        status: 'pending',
        external_reference: 'athlete1',
      }),
      fetchAuthorizedPayment: async () => ({
        preapproval_id: 'pre_ok',
        status: 'approved',
      }),
      resolveUser: async () => ({
        userId: 'athlete1',
        user: await users.getUser('athlete1'),
      }),
      users,
      auth: null,
    });
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.paymentApplied).toBe(true);
    expect((await users.getUser('athlete1')).subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect((await users.getUser('athlete1')).lastAuthorizedPaymentId).toBe('ap_ok');
  });

  it('authorized payment without preapproval id fails closed', async () => {
    const result = await processBillingNotification({
      eventStore,
      type: 'subscription_authorized_payment',
      dataId: 'ap_missing',
      fetchPreapproval: async () => {
        throw new Error('should not fetch preapproval');
      },
      fetchAuthorizedPayment: async () => ({ status: 'approved' }),
      resolveUser: async () => ({ userId: 'athlete1', user: await users.getUser('athlete1') }),
      users,
      auth: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_preapproval');
  });

  it('ignores unrelated notification types', async () => {
    const result = await processBillingNotification({
      eventStore,
      type: 'payment',
      dataId: 'pay_1',
      fetchPreapproval: async () => {
        throw new Error('unused');
      },
      fetchAuthorizedPayment: async () => {
        throw new Error('unused');
      },
      resolveUser: async () => ({ userId: 'athlete1', user: await users.getUser('athlete1') }),
      users,
      auth: null,
    });
    expect(result.ignored).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('returns user_not_found when resolveUser is empty', async () => {
    const result = await processBillingNotification({
      eventStore,
      type: 'subscription_preapproval',
      dataId: 'pre_orphan',
      fetchPreapproval: async () => ({ id: 'pre_orphan', status: 'authorized' }),
      fetchAuthorizedPayment: async () => ({}),
      resolveUser: async () => ({ userId: null, user: null }),
      users,
      auth: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('user_not_found');
  });

  it('handles topic alias preapproval', async () => {
    const result = await processBillingNotification({
      eventStore,
      type: 'preapproval',
      dataId: 'pre_alias',
      fetchPreapproval: async () => ({
        id: 'pre_alias',
        status: 'authorized',
        external_reference: 'athlete1',
      }),
      fetchAuthorizedPayment: async () => ({}),
      resolveUser: async () => ({
        userId: 'athlete1',
        user: await users.getUser('athlete1'),
      }),
      users,
      auth: null,
    });
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
  });

  it('eventStore get returns claimed payload', async () => {
    await eventStore.tryClaim('evt_1', { hello: true });
    expect(await eventStore.get('evt_1')).toMatchObject({ hello: true, eventId: 'evt_1' });
    expect(await eventStore.get('missing')).toBeNull();
    expect((await eventStore.tryClaim(null)).claimed).toBe(false);
  });
});

describe('createAthletePreapproval (mocked MP API)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.MP_ACCESS_TOKEN = 'TEST-token';
    process.env.FRONTEND_URL = 'https://app.test';
    process.env.BACKEND_PUBLIC_URL = 'https://api.test';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MP_ACCESS_TOKEN;
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_PUBLIC_URL;
  });

  it('posts pending preapproval and returns init_point', async () => {
    const { createAthletePreapproval } = await import(
      '../../../domain/billing/mercadoPagoClient.js'
    );
    globalThis.fetch = async (url, opts) => {
      expect(String(url)).toContain('/preapproval');
      const body = JSON.parse(opts.body);
      expect(body.status).toBe('pending');
      expect(body.external_reference).toBe('uid-1');
      expect(body.notification_url).toContain('/api/billing/mp/webhook');
      return {
        ok: true,
        json: async () => ({
          id: 'pre_mock',
          status: 'pending',
          init_point: 'https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=pre_mock',
          sandbox_init_point: 'https://sandbox.mercadopago.com/checkout',
        }),
      };
    };

    const out = await createAthletePreapproval({
      userId: 'uid-1',
      payerEmail: 'buyer@test.com',
      amountMxn: 249,
    });
    expect(out.id).toBe('pre_mock');
    expect(out.initPoint).toContain('mercadopago');
  });

  it('requires payer email', async () => {
    const { createAthletePreapproval } = await import(
      '../../../domain/billing/mercadoPagoClient.js'
    );
    await expect(
      createAthletePreapproval({ userId: 'uid-1', payerEmail: '' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
