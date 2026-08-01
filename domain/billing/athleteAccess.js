import { ACCOUNT_TYPES, ATHLETE_ORIGINS } from '../coach/constants.js';
import {
  ATHLETE_SUBSCRIPTION_AMOUNT_MXN,
  ATHLETE_SUBSCRIPTION_PLAN,
  ATHLETE_TRIAL_DAYS,
  SUBSCRIPTION_STATUS,
} from './constants.js';

/**
 * Direct (independent) athletes need a trial or paid subscription.
 * Coaches and coached athletes are exempt (coach seat model).
 */
export function isBillingExempt(user) {
  if (!user) return false;
  if (user.accountType === ACCOUNT_TYPES.COACH) return true;
  if (user.athleteOrigin === ATHLETE_ORIGINS.COACHED) return true;
  return false;
}

export function addDaysIso(isoOrDate, days) {
  const d = new Date(isoOrDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function isTrialActive(user, now = new Date()) {
  if (!user?.trialEndsAt) return false;
  return new Date(user.trialEndsAt).getTime() > now.getTime();
}

/**
 * Whether a direct athlete may use training features.
 * @returns {{ allowed: boolean, reason: string, subscriptionStatus: string|null }}
 */
export function evaluateAthleteBillingAccess(user, now = new Date()) {
  if (!user) {
    return { allowed: false, reason: 'no_user', subscriptionStatus: null };
  }
  if (isBillingExempt(user)) {
    return {
      allowed: true,
      reason: 'exempt',
      subscriptionStatus: user.subscriptionStatus ?? null,
    };
  }

  const status = user.subscriptionStatus ?? null;

  if (status === SUBSCRIPTION_STATUS.ACTIVE) {
    return { allowed: true, reason: 'active', subscriptionStatus: status };
  }

  if (status === SUBSCRIPTION_STATUS.TRIALING && isTrialActive(user, now)) {
    return { allowed: true, reason: 'trialing', subscriptionStatus: status };
  }

  if (status === SUBSCRIPTION_STATUS.TRIALING && !isTrialActive(user, now)) {
    return { allowed: false, reason: 'trial_expired', subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED };
  }

  if (status === SUBSCRIPTION_STATUS.PAST_DUE) {
    // Soft grace: still allow until webhook marks canceled/expired after retries.
    return { allowed: true, reason: 'past_due_grace', subscriptionStatus: status };
  }

  if (
    status === SUBSCRIPTION_STATUS.PENDING_CHECKOUT ||
    status === SUBSCRIPTION_STATUS.CANCELED ||
    status === SUBSCRIPTION_STATUS.EXPIRED
  ) {
    return { allowed: false, reason: status, subscriptionStatus: status };
  }

  // Missing billing fields → treat as needing trial bootstrap (caller should ensure).
  if (!status) {
    return { allowed: false, reason: 'billing_uninitialized', subscriptionStatus: null };
  }

  return { allowed: false, reason: 'unknown_status', subscriptionStatus: status };
}

/**
 * Build initial trial fields for a new or migrating direct athlete.
 */
export function buildTrialFields(trialStartedAt = new Date().toISOString()) {
  return {
    createdAt: trialStartedAt,
    trialStartedAt,
    trialEndsAt: addDaysIso(trialStartedAt, ATHLETE_TRIAL_DAYS),
    subscriptionStatus: SUBSCRIPTION_STATUS.TRIALING,
    subscriptionPlan: ATHLETE_SUBSCRIPTION_PLAN,
    subscriptionAmountMxn: ATHLETE_SUBSCRIPTION_AMOUNT_MXN,
  };
}

/**
 * Ensure direct athletes have trial/billing fields. Idempotent.
 * Uses Auth creationTime when available so existing users keep a fair clock.
 */
export async function ensureDirectAthleteBilling({ users, auth, userId, user }) {
  if (!user || isBillingExempt(user)) return user;
  if (user.subscriptionStatus && user.trialEndsAt) {
    // Expire stale trials in Firestore so UI/webhooks stay consistent.
    if (
      user.subscriptionStatus === SUBSCRIPTION_STATUS.TRIALING &&
      !isTrialActive(user)
    ) {
      const patch = {
        subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED,
        billingUpdatedAt: new Date().toISOString(),
      };
      await users.saveUser(userId, patch);
      return { ...user, ...patch };
    }
    return user;
  }

  let trialStartedAt =
    user.createdAt || user.trialStartedAt || user.lastProfileUpdate || null;

  if (!trialStartedAt && auth) {
    try {
      const authUser = await auth.getUser(userId);
      trialStartedAt = authUser.metadata?.creationTime
        ? new Date(authUser.metadata.creationTime).toISOString()
        : null;
    } catch {
      // ignore — fall through to now
    }
  }

  if (!trialStartedAt) {
    trialStartedAt = new Date().toISOString();
  }

  const fields = buildTrialFields(trialStartedAt);
  if (
    fields.subscriptionStatus === SUBSCRIPTION_STATUS.TRIALING &&
    !isTrialActive(fields)
  ) {
    fields.subscriptionStatus = SUBSCRIPTION_STATUS.EXPIRED;
  }

  fields.billingUpdatedAt = new Date().toISOString();
  await users.saveUser(userId, fields);
  return { ...user, ...fields };
}

export function mapMpPreapprovalStatus(mpStatus) {
  switch (String(mpStatus || '').toLowerCase()) {
    case 'authorized':
      return SUBSCRIPTION_STATUS.ACTIVE;
    case 'pending':
      return SUBSCRIPTION_STATUS.PENDING_CHECKOUT;
    case 'paused':
      return SUBSCRIPTION_STATUS.PAST_DUE;
    case 'cancelled':
    case 'canceled':
      return SUBSCRIPTION_STATUS.CANCELED;
    default:
      return SUBSCRIPTION_STATUS.EXPIRED;
  }
}
