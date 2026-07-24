/**
 * Shared coach domain operations — used by API handlers.
 */
import { db } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { createCoachRepository } from '../../infrastructure/firebase/coachRepository.js';
import { normalizeProfileInput } from '../../lib/profileNormalizer.js';
import { buildProfileCompleteness } from './profileCompleteness.js';
import { generateMesocycle } from '../periodization/mesocycleGenerator.js';
import { applyProfileAdaptation } from '../athlete/applyProfileAdaptation.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
  canConsumeSeat,
  buildSeatLedgerEntry,
  releaseSeatLedgerEntry,
} from './seatLedger.js';
import { hashEmail, emailsAreEquivalent } from './tokenUtils.js';
import { syncCoachedAthleteClaims, syncDirectAthleteClaims } from '../../lib/coachClaims.js';
import { assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import {
  CLIENT_STATUSES,
  ACCOUNT_TYPES,
  ATHLETE_ORIGINS,
} from './constants.js';

const users = createUserRepository(db);
const coaches = createCoachRepository(db);

export async function mergeAthleteProfile(athleteId, partialProfile, { merge = true } = {}) {
  const existing = await users.getUser(athleteId);
  const merged = merge
    ? { ...(existing?.profileData ?? {}), ...partialProfile }
    : partialProfile;
  const profileData = normalizeProfileInput(merged);
  const profileCompleteness = buildProfileCompleteness(profileData);
  await users.saveUser(athleteId, { profileData, profileCompleteness });
  return { profileData, profileCompleteness };
}

export async function generateMesocycleForAthlete(athleteId, referenceDate = new Date()) {
  const user = await users.getUser(athleteId);
  if (!user?.profileData) {
    throw Object.assign(new Error('Perfil incompleto'), { status: 400 });
  }
  const completeness = buildProfileCompleteness(user.profileData);
  if (!completeness.readyForMesocycle) {
    throw Object.assign(new Error('Perfil técnico incompleto'), { status: 400 });
  }

  const mesocycle = generateMesocycle(user.profileData, referenceDate);
  const wrapped = {
    ...mesocycle,
    mesocyclePlan: {
      durationWeeks: mesocycle.durationWeeks,
      mesocycleGoal: mesocycle.goal,
      splitType: mesocycle.splitType,
      microcycles: mesocycle.microcycles,
    },
    status: 'activo',
    progress: 0,
  };

  await users.saveMesocycle(athleteId, wrapped);
  await users.saveUser(athleteId, {
    planStatus: 'active',
    lastMesocycleGeneration: referenceDate.toISOString(),
    currentSession: null,
    status: 'approved',
  });

  return wrapped;
}

export async function updateTrainingProfileForClient(coachId, athleteId, rawTrainingPatch) {
  const { athlete } = await assertClientOwnership(coachId, athleteId);

  const existingProfile = athlete.profileData ?? {};
  const merged = { ...existingProfile, ...rawTrainingPatch };
  const { profileData, profileCompleteness } = await mergeAthleteProfile(athleteId, merged);

  const hasMesocycle = Boolean(athlete.currentMesocycle);
  const { profileChange, userPatch } = await applyProfileAdaptation({
    users,
    userId: athleteId,
    existingUser: athlete,
    existingProfile,
    profileData,
    applyPlanChanges: hasMesocycle,
  });

  await users.saveUser(athleteId, {
    profileData,
    profileCompleteness,
    ...userPatch,
  });

  const relationPatch = {
    status: profileCompleteness.readyForMesocycle
      ? CLIENT_STATUSES.ACTIVE
      : CLIENT_STATUSES.ONBOARDING_COACH,
    coachCompletedAt: profileCompleteness.training ? new Date().toISOString() : null,
  };
  await coaches.saveClientRelation(coachId, athleteId, relationPatch);

  return { profileData, profileCompleteness, profileChange, planStatus: userPatch.planStatus };
}

export async function activateCoachedClient({
  coachId,
  athleteId,
  athleteEmail,
  inviteId,
}) {
  const coach = await coaches.getCoach(coachId);
  const ledgerEntries = await coaches.getSeatLedgerEntries(coachId);
  const emailHash = athleteEmail ? hashEmail(athleteEmail) : null;

  const seatCheck = canConsumeSeat({
    plan: coach.plan,
    ledgerEntries,
    emailHash,
  });
  if (!seatCheck.allowed) {
    const err = Object.assign(
      new Error(
        seatCheck.reason === 'seat_limit_reached'
          ? 'Límite de clientes alcanzado. Pasa a Premium para agregar más.'
          : 'Este email ya consumió un asiento en tu plan.',
      ),
      { status: 402, code: seatCheck.reason, requiresPremium: seatCheck.requiresPremium },
    );
    throw err;
  }

  if (coachId === athleteId) {
    throw Object.assign(new Error('Un coach no puede ser su propio cliente'), { status: 400 });
  }

  if (emailsAreEquivalent(coach?.email, athleteEmail)) {
    throw Object.assign(
      new Error('No puedes agregarte como cliente con el mismo correo (incluye alias como +tag o puntos en Gmail).'),
      { status: 400, code: 'self_client_email' },
    );
  }

  const ledgerEntry = buildSeatLedgerEntry({ athleteId, emailHash });
  const savedLedger = await coaches.addSeatLedgerEntry(coachId, ledgerEntry);

  await users.saveUser(athleteId, {
    accountType: ACCOUNT_TYPES.ATHLETE,
    athleteOrigin: ATHLETE_ORIGINS.COACHED,
    coachId,
    status: 'approved',
    plan: 'free',
    planStatus: 'active',
  });

  await coaches.saveClientRelation(coachId, athleteId, {
    status: CLIENT_STATUSES.ONBOARDING_CLIENT,
    seatLedgerEntryId: savedLedger.id,
    activatedAt: new Date().toISOString(),
    clientCompletedAt: null,
    coachCompletedAt: null,
    notes: [],
    inviteId: inviteId ?? null,
  });

  await syncCoachedAthleteClaims(athleteId, coachId);
  return { seatLedgerEntryId: savedLedger.id };
}

export async function releaseClient(coachId, athleteId, { reason = 'coach_release' } = {}) {
  const { relation, athlete } = await assertClientOwnership(coachId, athleteId);

  const sessions = await users.getRecentSessions(athleteId, 50);
  const sessionCount = sessions.filter((s) => s.completed).length;

  if (relation.seatLedgerEntryId) {
    const entry = await coaches.findSeatEntryByAthlete(coachId, athleteId);
    if (entry) {
      const released = releaseSeatLedgerEntry(entry, sessionCount);
      await coaches.updateSeatLedgerEntry(coachId, entry.id, released);
    }
  }

  await coaches.saveClientRelation(coachId, athleteId, {
    status: CLIENT_STATUSES.RELEASED,
    releasedAt: new Date().toISOString(),
    releaseReason: reason,
  });

  await users.saveUser(athleteId, {
    athleteOrigin: ATHLETE_ORIGINS.DIRECT,
    coachId: FieldValue.delete(),
  });
  await syncDirectAthleteClaims(athleteId);

  return { success: true };
}

export { users, coaches };
