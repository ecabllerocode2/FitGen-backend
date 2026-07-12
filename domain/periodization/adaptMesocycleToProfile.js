import { differenceInCalendarWeeks } from 'date-fns';
import { SPLIT_SESSIONS } from '../constants.js';
import { buildSafetyProfile } from '../athlete/safetyProfile.js';
import { normalizeTrainingDays } from './splitSelector.js';
import {
  generateMesocycle,
  assignSessionsToSchedule,
} from './mesocycleGenerator.js';

function getMicrocycles(mesocycle) {
  return mesocycle?.mesocyclePlan?.microcycles ?? mesocycle?.microcycles ?? [];
}

function withMicrocycles(mesocycle, microcycles) {
  const next = { ...mesocycle, microcycles };
  if (mesocycle.mesocyclePlan) {
    next.mesocyclePlan = {
      ...mesocycle.mesocyclePlan,
      microcycles,
    };
  }
  return next;
}

/**
 * Resolve 1-based current week from mesocycle start (Monday-based).
 */
export function resolveCurrentWeek(mesocycle, referenceDate = new Date()) {
  if (mesocycle?.currentWeek && mesocycle.currentWeek > 0) {
    return mesocycle.currentWeek;
  }
  const startRaw = mesocycle?.startDate;
  if (!startRaw) return 1;
  const startString = String(startRaw).split('T')[0];
  const start = new Date(`${startString}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const weeksDiff = differenceInCalendarWeeks(referenceDate, start, { weekStartsOn: 1 });
  const duration = mesocycle.durationWeeks ?? mesocycle.mesocyclePlan?.durationWeeks ?? 4;
  return Math.min(Math.max(weeksDiff + 1, 1), duration);
}

/**
 * Re-map session days on the same split (DDS §8.2 paso 5).
 */
export function remapMesocycleSchedule(mesocycle, newProfile) {
  const splitType = mesocycle.splitType ?? mesocycle.mesocyclePlan?.splitType;
  const splitSessions = SPLIT_SESSIONS[splitType] ?? SPLIT_SESSIONS.Full_Body;
  const trainingDays = normalizeTrainingDays(newProfile.trainingDaysPerWeek ?? effectiveDays(newProfile));

  const microcycles = getMicrocycles(mesocycle).map((micro) => ({
    ...micro,
    sessions: assignSessionsToSchedule(
      newProfile.weeklyScheduleContext ?? [],
      splitSessions,
      trainingDays,
      { weekNumber: micro.week ?? 1 },
    ),
  }));

  return withMicrocycles(
    {
      ...mesocycle,
      safetyProfile: buildSafetyProfile(newProfile),
    },
    microcycles,
  );
}

function effectiveDays(profile) {
  return (profile.weeklyScheduleContext ?? []).filter((d) => d.canTrain !== false).length || 3;
}

/**
 * Update injury / focus safety profile without touching periodization.
 */
export function updateMesocycleSafety(mesocycle, newProfile) {
  return {
    ...mesocycle,
    safetyProfile: buildSafetyProfile(newProfile),
  };
}

/**
 * Regenerate remaining microcycles when split type must change.
 * Preserves completed weeks and volume landmarks (MAV_actual).
 */
export function regenerateRemainingMicrocycles(mesocycle, newProfile, referenceDate = new Date()) {
  const currentWeek = resolveCurrentWeek(mesocycle, referenceDate);
  const fresh = generateMesocycle(newProfile, referenceDate);
  const oldMicro = getMicrocycles(mesocycle);
  const newMicro = getMicrocycles(fresh);

  const preservedCount = Math.max(0, currentWeek - 1);
  const merged = [
    ...oldMicro.slice(0, preservedCount),
    ...newMicro.slice(preservedCount),
  ].map((micro, index) => ({ ...micro, week: index + 1 }));

  const volumeLandmarks = { ...(fresh.volumeLandmarks ?? {}) };
  for (const [muscle, landmarks] of Object.entries(mesocycle.volumeLandmarks ?? {})) {
    if (volumeLandmarks[muscle] && landmarks.MAV_actual != null) {
      volumeLandmarks[muscle] = {
        ...volumeLandmarks[muscle],
        MAV_actual: landmarks.MAV_actual,
      };
    }
  }

  const next = {
    ...mesocycle,
    goal: fresh.goal,
    splitType: fresh.splitType,
    experienceLevel: fresh.experienceLevel,
    safetyProfile: fresh.safetyProfile,
    volumeLandmarks,
    currentWeek,
    status: mesocycle.status ?? 'activo',
    mesocyclePlan: mesocycle.mesocyclePlan
      ? {
          ...mesocycle.mesocyclePlan,
          mesocycleGoal: fresh.goal,
          splitType: fresh.splitType,
          microcycles: merged,
        }
      : undefined,
  };

  return withMicrocycles(next, merged);
}

/**
 * Apply tiered adaptation to an active mesocycle.
 */
export function adaptMesocycleToProfile(mesocycle, newProfile, impact, referenceDate = new Date()) {
  switch (impact.tier) {
    case 'schedule_remap':
      return remapMesocycleSchedule(mesocycle, newProfile);
    case 'safety_update':
      return updateMesocycleSafety(mesocycle, newProfile);
    case 'partial_regeneration':
      return regenerateRemainingMicrocycles(mesocycle, newProfile, referenceDate);
    default:
      return mesocycle;
  }
}
