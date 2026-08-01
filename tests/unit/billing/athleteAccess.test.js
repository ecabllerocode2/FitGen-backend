import { describe, expect, it } from 'vitest';
import {
  buildTrialFields,
  evaluateAthleteBillingAccess,
  isBillingExempt,
  mapMpPreapprovalStatus,
} from '../../../domain/billing/athleteAccess.js';
import { SUBSCRIPTION_STATUS } from '../../../domain/billing/constants.js';

describe('athlete billing access', () => {
  it('exempts coaches and coached athletes', () => {
    expect(isBillingExempt({ accountType: 'coach' })).toBe(true);
    expect(isBillingExempt({ athleteOrigin: 'coached' })).toBe(true);
    expect(isBillingExempt({ accountType: 'athlete', athleteOrigin: 'direct' })).toBe(false);
  });

  it('allows active trial and active subscription', () => {
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
  });

  it('blocks expired trial', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const result = evaluateAthleteBillingAccess({
      athleteOrigin: 'direct',
      subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
      trialEndsAt: past,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('trial_expired');
  });

  it('builds 14-day trial fields', () => {
    const fields = buildTrialFields('2026-08-01T00:00:00.000Z');
    expect(fields.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.TRIALING);
    expect(fields.trialEndsAt).toBe('2026-08-15T00:00:00.000Z');
    expect(fields.subscriptionAmountMxn).toBe(249);
  });

  it('maps Mercado Pago preapproval statuses', () => {
    expect(mapMpPreapprovalStatus('authorized')).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    expect(mapMpPreapprovalStatus('pending')).toBe(SUBSCRIPTION_STATUS.PENDING_CHECKOUT);
    expect(mapMpPreapprovalStatus('cancelled')).toBe(SUBSCRIPTION_STATUS.CANCELED);
  });
});
