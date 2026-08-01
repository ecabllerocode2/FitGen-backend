import {
  billingEventId,
  buildAuthorizedPaymentPatch,
  buildPreapprovalPatch,
  resolveSubscriptionTransition,
} from './statusTransitions.js';
import { evaluateAthleteBillingAccess } from './athleteAccess.js';

/**
 * Apply a fetched Mercado Pago preapproval to a user document, with transition guards.
 */
export async function applyPreapprovalSync({
  users,
  auth = null,
  user,
  userId,
  preapproval,
  now = new Date(),
}) {
  if (!userId || !user) {
    return { ok: false, reason: 'user_not_found' };
  }

  const incomingPatch = buildPreapprovalPatch(preapproval, now);

  // Ignore cancel/expire/pending from a different (stale) preapproval while another is active.
  if (
    user.subscriptionStatus === 'active' &&
    user.mpPreapprovalId &&
    preapproval?.id &&
    user.mpPreapprovalId !== preapproval.id &&
    ['canceled', 'expired', 'pending_checkout'].includes(incomingPatch.subscriptionStatus)
  ) {
    return {
      ok: true,
      userId,
      subscriptionStatus: user.subscriptionStatus,
      skipped: true,
      reason: 'stale_preapproval',
    };
  }

  const transition = resolveSubscriptionTransition(
    user.subscriptionStatus,
    incomingPatch.subscriptionStatus,
  );

  if (!transition.apply) {
    return {
      ok: true,
      userId,
      subscriptionStatus: transition.next,
      skipped: true,
      reason: transition.reason,
    };
  }

  const patch = {
    ...incomingPatch,
    subscriptionStatus: transition.next,
  };

  await users.saveUser(userId, patch);

  if (auth) {
    try {
      const refreshed = { ...user, ...patch };
      const access = evaluateAthleteBillingAccess(refreshed, now);
      const existing = await auth.getUser(userId);
      const claims = { ...(existing.customClaims || {}) };
      claims.access = access.allowed;
      claims.subscriptionStatus = patch.subscriptionStatus;
      await auth.setCustomUserClaims(userId, claims);
    } catch (claimsErr) {
      console.error('billing sync claims warning:', claimsErr);
    }
  }

  return {
    ok: true,
    userId,
    subscriptionStatus: patch.subscriptionStatus,
    skipped: false,
    reason: transition.reason,
  };
}

/**
 * Apply authorized payment invoice on top of preapproval sync.
 */
export async function applyAuthorizedPaymentSync({
  users,
  auth = null,
  user,
  userId,
  preapproval,
  invoice,
  authorizedPaymentId,
  now = new Date(),
}) {
  const base = await applyPreapprovalSync({
    users,
    auth,
    user,
    userId,
    preapproval,
    now,
  });
  if (!base.ok) return base;

  const paymentPatch = buildAuthorizedPaymentPatch(invoice, authorizedPaymentId, now);
  if (!paymentPatch) {
    return { ...base, paymentApplied: false, reason: 'payment_status_ignored' };
  }

  // Rejected/recycling invoices: store metadata only (do not downgrade another active sub).
  if (!paymentPatch.subscriptionStatus) {
    await users.saveUser(userId, paymentPatch);
    return {
      ...base,
      paymentApplied: true,
      reason: 'payment_metadata_only',
      subscriptionStatus: base.subscriptionStatus ?? user.subscriptionStatus,
    };
  }

  // Reload conceptual state after preapproval apply
  const currentStatus = base.subscriptionStatus ?? user.subscriptionStatus;
  const transition = resolveSubscriptionTransition(currentStatus, paymentPatch.subscriptionStatus);
  if (!transition.apply && transition.reason === 'idempotent') {
    // Still persist payment metadata if new payment id
    if (
      paymentPatch.lastAuthorizedPaymentId &&
      paymentPatch.lastAuthorizedPaymentId !== user.lastAuthorizedPaymentId
    ) {
      await users.saveUser(userId, {
        lastPaymentAt: paymentPatch.lastPaymentAt,
        lastAuthorizedPaymentId: paymentPatch.lastAuthorizedPaymentId,
        billingUpdatedAt: paymentPatch.billingUpdatedAt,
      });
      return {
        ...base,
        paymentApplied: true,
        reason: 'payment_metadata_only',
        subscriptionStatus: currentStatus,
      };
    }
    return { ...base, paymentApplied: false, reason: 'idempotent_payment' };
  }

  if (!transition.apply) {
    return { ...base, paymentApplied: false, reason: transition.reason };
  }

  const patch = { ...paymentPatch, subscriptionStatus: transition.next };
  await users.saveUser(userId, patch);

  if (auth) {
    try {
      const refreshed = { ...user, subscriptionStatus: transition.next };
      const access = evaluateAthleteBillingAccess(refreshed, now);
      const existing = await auth.getUser(userId);
      const claims = { ...(existing.customClaims || {}) };
      claims.access = access.allowed;
      claims.subscriptionStatus = transition.next;
      await auth.setCustomUserClaims(userId, claims);
    } catch (claimsErr) {
      console.error('billing payment claims warning:', claimsErr);
    }
  }

  return {
    ok: true,
    userId,
    subscriptionStatus: transition.next,
    paymentApplied: true,
    reason: transition.reason,
  };
}

export function isPreapprovalTopic(type) {
  const t = String(type || '').toLowerCase();
  return t === 'subscription_preapproval' || t === 'preapproval';
}

export function isAuthorizedPaymentTopic(type) {
  const t = String(type || '').toLowerCase();
  return t === 'subscription_authorized_payment' || t === 'authorized_payment';
}

/**
 * Process a webhook notification with idempotent event claim.
 */
export async function processBillingNotification({
  eventStore,
  type,
  dataId,
  fetchPreapproval,
  fetchAuthorizedPayment,
  resolveUser,
  users,
  auth = null,
  now = new Date(),
}) {
  const eventId = billingEventId({ type, dataId });
  const claim = await eventStore.tryClaim(eventId, { type, dataId });
  if (!claim.claimed) {
    return {
      ok: true,
      duplicate: true,
      reason: claim.reason || 'duplicate',
      eventId,
    };
  }

  if (isPreapprovalTopic(type)) {
    const preapproval = await fetchPreapproval(dataId);
    const resolved = await resolveUser(preapproval);
    const result = await applyPreapprovalSync({
      users,
      auth,
      user: resolved?.user,
      userId: resolved?.userId,
      preapproval,
      now,
    });
    return { ...result, eventId, duplicate: false };
  }

  if (isAuthorizedPaymentTopic(type)) {
    const invoice = await fetchAuthorizedPayment(dataId);
    const preapprovalId = invoice.preapproval_id || invoice.preapprovalId;
    if (!preapprovalId) {
      return { ok: false, reason: 'no_preapproval', eventId };
    }
    const preapproval = await fetchPreapproval(preapprovalId);
    const resolved = await resolveUser(preapproval);
    const result = await applyAuthorizedPaymentSync({
      users,
      auth,
      user: resolved?.user,
      userId: resolved?.userId,
      preapproval,
      invoice,
      authorizedPaymentId: dataId,
      now,
    });
    return { ...result, eventId, duplicate: false };
  }

  return {
    ok: true,
    ignored: true,
    type: String(type || '').toLowerCase(),
    eventId,
  };
}
