import { auth } from './firebaseAdmin.js';
import { COACH_PLANS, ACCOUNT_TYPES } from '../domain/coach/constants.js';

/**
 * Sync Firebase custom claims for coach accounts.
 */
export async function syncCoachClaims(coachId, { plan = COACH_PLANS.FREE } = {}) {
  const existing = await auth.getUser(coachId).catch(() => null);
  const prev = existing?.customClaims ?? {};
  await auth.setCustomUserClaims(coachId, {
    ...prev,
    accountType: ACCOUNT_TYPES.COACH,
    coachPlan: plan,
    access: true,
    role: 'approved',
  });
}

/**
 * Sync claims for coached athlete.
 */
export async function syncCoachedAthleteClaims(athleteId, coachId) {
  const existing = await auth.getUser(athleteId).catch(() => null);
  const prev = existing?.customClaims ?? {};
  await auth.setCustomUserClaims(athleteId, {
    ...prev,
    accountType: ACCOUNT_TYPES.ATHLETE,
    athleteOrigin: 'coached',
    coachId,
    access: true,
    role: 'approved',
  });
}

/**
 * Release coached athlete to direct — keeps training data.
 */
export async function syncDirectAthleteClaims(athleteId) {
  const existing = await auth.getUser(athleteId).catch(() => null);
  const prev = existing?.customClaims ?? {};
  await auth.setCustomUserClaims(athleteId, {
    ...prev,
    accountType: ACCOUNT_TYPES.ATHLETE,
    athleteOrigin: 'direct',
    coachId: null,
    access: true,
    role: 'approved',
  });
}
