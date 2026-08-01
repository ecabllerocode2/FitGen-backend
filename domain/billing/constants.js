/** Athlete B2C subscription (independent / direct athletes only). */

export const ATHLETE_SUBSCRIPTION_PLAN = 'athlete_monthly';
export const ATHLETE_SUBSCRIPTION_AMOUNT_MXN = 249;
export const ATHLETE_TRIAL_DAYS = 14;
export const ATHLETE_SUBSCRIPTION_CURRENCY = 'MXN';
export const ATHLETE_SUBSCRIPTION_REASON = 'FitGen Atleta — suscripción mensual';

/** @typedef {'trialing' | 'pending_checkout' | 'active' | 'past_due' | 'canceled' | 'expired'} SubscriptionStatus */

export const SUBSCRIPTION_STATUS = {
  TRIALING: 'trialing',
  PENDING_CHECKOUT: 'pending_checkout',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
};
