/** Coach platform constants — single source for limits and plan flags. */

export const COACH_PLANS = {
  FREE: 'free',
  PREMIUM: 'premium',
};

export const SEAT_LIMITS = {
  [COACH_PLANS.FREE]: 3,
  [COACH_PLANS.PREMIUM]: 50,
};

export const INVITE_DEFAULT_EXPIRY_DAYS = 30;
export const INVITE_MAX_USES_DEFAULT = 1;

/** Failed invite: <7 days active, 0 sessions → recyclable after 60 days. */
export const FAILED_INVITE_MAX_DAYS = 7;
export const FAILED_INVITE_MAX_SESSIONS = 0;
export const SEAT_RECYCLE_AFTER_DAYS = 60;

export const CLIENT_STATUSES = {
  INVITED: 'invited',
  ONBOARDING_CLIENT: 'onboarding_client',
  ONBOARDING_COACH: 'onboarding_coach',
  ACTIVE: 'active',
  PAUSED: 'paused',
  RELEASED: 'released',
  BANNED_REUSE: 'banned_reuse',
};

export const INVITE_STATUSES = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXHAUSTED: 'exhausted',
  EXPIRED: 'expired',
};

export const ACCOUNT_TYPES = {
  ATHLETE: 'athlete',
  COACH: 'coach',
};

export const ATHLETE_ORIGINS = {
  DIRECT: 'direct',
  COACHED: 'coached',
};

export function getSeatLimit(plan) {
  return SEAT_LIMITS[plan] ?? SEAT_LIMITS[COACH_PLANS.FREE];
}

export function isPremiumPlan(plan) {
  return plan === COACH_PLANS.PREMIUM;
}
