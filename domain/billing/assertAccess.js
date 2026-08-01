import {
  ensureDirectAthleteBilling,
  evaluateAthleteBillingAccess,
} from './athleteAccess.js';

/**
 * Assert direct athlete has trial or active subscription.
 * Callers must pass `auth` (or `null` in unit tests).
 * @throws {{ status: number, code: string, message: string }}
 */
export async function assertAthleteBillingAccess({ users, userId, user, auth = null }) {
  const ensured = await ensureDirectAthleteBilling({
    users,
    auth,
    userId,
    user,
  });
  const access = evaluateAthleteBillingAccess(ensured);
  if (access.allowed) {
    return { user: ensured, access };
  }

  const err = new Error(
    access.reason === 'trial_expired' || access.subscriptionStatus === 'expired'
      ? 'Tu prueba gratis terminó. Suscríbete para continuar entrenando.'
      : 'Se requiere una suscripción activa para continuar.',
  );
  err.status = 402;
  err.code = 'subscription_required';
  err.billing = {
    reason: access.reason,
    subscriptionStatus: ensured.subscriptionStatus ?? access.subscriptionStatus,
    trialEndsAt: ensured.trialEndsAt ?? null,
  };
  throw err;
}
