import { REP_RANGES, REST_SECONDS, EXERCISE_TYPES, MAX_SETS_PER_EXERCISE } from '../constants.js';
import { getWeekPlan } from '../periodization/microcycle.js';
import { applyReadiness } from '../autoregulation/readiness.js';
import { selectExercises, getMesocycleRotationExclusions } from '../exerciseSelection/selector.js';
import { orderByGoal } from '../exerciseSelection/orderExercises.js';
import { prescribeLoad } from '../prescription/loadCalculator.js';
import { generateWarmup } from './rampGenerator.js';
import { generateCooldown } from './cooldownGenerator.js';
import { getDayOfWeek } from '../../lib/dateUtils.js';
import { resolveExclusionFilters } from '../athlete/exercisePreferences.js';
import {
  allocateWeeklySetSlot,
  computeWeeklyVolumePlan,
  findSessionVolumeSlot,
} from '../periodization/weekVolumePlanner.js';

/**
 * DDS 8.4 — session orchestrator.
 * @param {object} context
 * @param {object} context.profile
 * @param {object} context.mesocycle
 * @param {number} context.weekNumber
 * @param {string} context.sessionFocus
 * @param {string[]} context.sessionMuscles
 * @param {string[]} context.patterns
 * @param {object} [context.readiness]
 * @param {Record<string, number>} [context.feedbackModifiers]
 * @param {object} context.catalog — { entrenamiento, calentamiento, enfriamiento }
 * @param {object[]} [context.history]
 * @param {Date|string} context.referenceDate
 * @param {string} [context.priorityLiftId]
 * @returns {object}
 */
export function generateSession(context) {
  const {
    profile,
    mesocycle,
    weekNumber,
    sessionFocus,
    sessionMuscles = [],
    patterns = [],
    readiness = {},
    feedbackModifiers = {},
    catalog = {},
    history = [],
    referenceDate,
    priorityLiftId = null,
    exercisePreferences = {},
  } = context;

  const goal = mesocycle.goal ?? profile.fitnessGoal ?? 'Hipertrofia';
  const safetyProfile = mesocycle.safetyProfile ?? profile.safetyProfile ?? {};
  const { excludeIds, warmupExcludeIds, unavailableEquipment } = resolveExclusionFilters(exercisePreferences);
  const rotationExcludeIds = getMesocycleRotationExclusions(
    history,
    mesocycle.mesocycleId,
    weekNumber,
    sessionFocus,
  );
  const mergedExcludeIds = [...new Set([...excludeIds, ...rotationExcludeIds])];

  const weekPlan = getWeekPlan(mesocycle, weekNumber, feedbackModifiers);
  const rirBase = weekPlan?.rirObjetivo ?? 3;
  const rirAccessory = weekPlan?.rirObjetivoAccessory ?? rirBase;

  const readinessAdj = applyReadiness(readiness, sessionMuscles);

  const dayOfWeek = getDayOfWeek(referenceDate, profile.timezone ?? 'UTC');

  const weeklyVolumePlan =
    context.weeklyVolumePlan ??
    computeWeeklyVolumePlan({
      splitType: mesocycle.splitType,
      trainingDays: profile.trainingDaysPerWeek ?? 3,
      weeklyScheduleContext: profile.weeklyScheduleContext ?? [],
      catalog: catalog.entrenamiento ?? [],
      safetyProfile,
      goal,
      weekNumber,
      excludeIds: mergedExcludeIds,
      scheduleWeekNumber: weekNumber,
      history,
      mesocycleId: mesocycle.mesocycleId,
    });

  const sessionVolumeSlot = findSessionVolumeSlot(
    weeklyVolumePlan.sessions,
    sessionFocus,
    dayOfWeek,
  );

  const rawExercises =
    sessionVolumeSlot?.exercises && !sessionVolumeSlot.fromHistory
      ? sessionVolumeSlot.exercises
      : selectExercises(
          sessionFocus,
          catalog.entrenamiento ?? [],
          safetyProfile,
          history,
          goal,
          { weekNumber, sessionMuscles, excludeIds: mergedExcludeIds, mesocycleId: mesocycle.mesocycleId },
        );

  const ordered = orderByGoal(rawExercises, goal, priorityLiftId);

  const volumeByMuscle = weekPlan?.volumeByMuscle ?? {};
  const mainBlock = buildMainBlock({
    exercises: ordered,
    goal,
    rirBase,
    rirAccessory,
    readinessAdj,
    volumeByMuscle,
    sessionMuscles,
    history,
    priorityLiftId,
    splitType: mesocycle.splitType,
    bodyWeightKg: profile.currentWeightKg,
    weeklyMuscleSlotCounts: weeklyVolumePlan.weeklyMuscleSlotCounts,
    muscleSlotStart: sessionVolumeSlot?.muscleSlotStart ?? {},
  });

  const warmup = generateWarmup(patterns, catalog.calentamiento ?? [], {
    weekNumber,
    sessionFocus,
    sessionMuscles,
    prehab: safetyProfile.prehab ?? [],
    readiness,
    goal,
    conservative: safetyProfile.conservative ?? false,
    excludeIds: warmupExcludeIds,
    unavailableEquipment,
  });
  const cooldown = generateCooldown(catalog.enfriamiento ?? [], sessionMuscles);
  const summary = estimateSessionSummary({ warmup, mainBlock, cooldown, sessionMuscles });

  return {
    sessionId: `sess_${mesocycle.mesocycleId}_w${weekNumber}_${dayOfWeek}`,
    mesocycleId: mesocycle.mesocycleId,
    weekNumber,
    dayOfWeek,
    sessionFocus,
    generatedAt: new Date(referenceDate).toISOString(),
    patterns,
    sessionMuscles,
    readinessAdjustment: {
      energyLevel: readiness.energyLevel ?? null,
      sorenessLevel: readiness.sorenessLevel ?? null,
      volumeMultiplierApplied: readinessAdj.volumeMultiplier,
      rirDeltaApplied: readinessAdj.rirDelta,
      userMessage: readinessAdj.userMessage,
    },
    warmup,
    mainBlock,
    cooldown,
    summary,
    completed: false,
  };
}

const WORK_SECONDS_PER_SET = 45;
const TRANSITION_SECONDS = 30;

function estimateSessionSummary({ warmup, mainBlock, cooldown, sessionMuscles }) {
  let totalSeconds = 0;

  for (const item of warmup ?? []) {
    totalSeconds += item.durationSeconds ?? parseDurationSeconds(item.duracion) ?? 45;
  }

  for (const ex of mainBlock ?? []) {
    const sets = ex.sets ?? 3;
    const rest = ex.restSeconds ?? 90;
    totalSeconds += sets * WORK_SECONDS_PER_SET;
    totalSeconds += Math.max(0, sets - 1) * rest;
    totalSeconds += TRANSITION_SECONDS;
  }

  totalSeconds += (cooldown?.duracionEstimada ?? 8) * 60;

  const minutes = Math.max(15, Math.round(totalSeconds / 60));
  const seriesTotales = (mainBlock ?? []).reduce((sum, ex) => sum + (ex.sets ?? 0), 0);

  return {
    duracionEstimada: formatDurationMinutes(minutes),
    duracionMinutos: minutes,
    ejerciciosTotales: (mainBlock ?? []).length,
    seriesTotales,
    musculosTrabajos: sessionMuscles ?? [],
  };
}

function parseDurationSeconds(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function formatDurationMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder} min` : `${hours}h`;
}

function buildMainBlock({
  exercises,
  goal,
  rirBase,
  rirAccessory,
  readinessAdj,
  volumeByMuscle,
  sessionMuscles,
  history,
  priorityLiftId,
  splitType,
  bodyWeightKg,
  weeklyMuscleSlotCounts = {},
  muscleSlotStart = {},
}) {
  const repRanges = REP_RANGES[goal] ?? REP_RANGES.Hipertrofia;
  const rest = REST_SECONDS[goal] ?? REST_SECONDS.Hipertrofia;

  const muscleIndexInSession = {};
  const setsByExerciseId = {};
  for (const ex of exercises) {
    const muscle = ex.parteCuerpo ?? ex.muscleGroup;
    const idxInSession = muscleIndexInSession[muscle] ?? 0;
    muscleIndexInSession[muscle] = idxInSession + 1;

    const weeklySets = volumeByMuscle[muscle] ?? 0;
    const totalWeeklySlots = weeklyMuscleSlotCounts[muscle] || idxInSession + 1;
    const slotIndex = (muscleSlotStart[muscle] ?? 0) + idxInSession - 1;

    setsByExerciseId[ex.id] =
      weeklySets > 0
        ? allocateWeeklySetSlot(weeklySets, slotIndex, totalWeeklySlots)
        : ex.accessorySlot
          ? 2
          : 3;
  }

  return exercises
    .filter((ex) => (setsByExerciseId[ex.id] ?? 0) > 0)
    .map((ex) => {
    const exerciseType =
      (ex.prioridad ?? 3) === 1 ? EXERCISE_TYPES.COMPOUND : EXERCISE_TYPES.ISOLATION;
    const isCore = ex.patronMovimiento === 'Core' || ex.parteCuerpo === 'Core';
    const repRange =
      ex.repRangeOverride ??
      (isCore
        ? repRanges.core ?? repRanges.isolation
        : exerciseType === EXERCISE_TYPES.COMPOUND
          ? repRanges.compound
          : repRanges.isolation);

    const isAccessory = (ex.prioridad ?? 3) !== 1;
    const rirForExercise =
      goal === 'Fuerza' && isAccessory ? rirAccessory : rirBase;
    const rirTarget = Math.round((rirForExercise + readinessAdj.rirDelta) * 10) / 10;

    const exerciseHistory = (history ?? [])
      .flatMap((s) => s.mainBlock ?? s.exercises ?? s.performance ?? [])
      .filter((e) => (e.exerciseId ?? e.id) === ex.id)
      .map((e) => ({
        weightKg: e.actualWeightKg ?? e.prescribedLoadKg ?? e.weight,
        reps: e.actualReps ?? e.reps,
        rir: e.actualRIR ?? e.rirReported,
      }));

    const load = prescribeLoad({
      exerciseType,
      rirTarget,
      repRange,
      history: exerciseHistory,
      bodyWeightKg,
      movementPattern: ex.patronMovimiento,
    });

    const adjustedSets = Math.max(
      1,
      Math.round((setsByExerciseId[ex.id] ?? 3) * readinessAdj.volumeMultiplier),
    );
    const setCap =
      exerciseType === EXERCISE_TYPES.COMPOUND
        ? MAX_SETS_PER_EXERCISE.compound
        : MAX_SETS_PER_EXERCISE.isolation;
    const cappedSets = Math.min(adjustedSets, setCap);

    return {
      exerciseId: ex.id,
      exerciseName: ex.nombre,
      imageUrl: ex.url_img_0 ?? ex.imageUrl ?? null,
      imageUrl2: ex.url_img_1 ?? ex.imageUrl2 ?? null,
      muscleGroup: ex.parteCuerpo,
      movementPattern: ex.patronMovimiento,
      sets: cappedSets,
      repRange: load.repRange ?? repRange,
      repRangeOverride: ex.repRangeOverride ?? null,
      plateauIntervention: ex.plateauIntervention ?? null,
      rirTarget,
      prescribedLoadKg: load.prescribedLoadKg,
      suggestedLoadKg: load.suggestedLoadKg ?? null,
      loadMode: load.mode,
      loadExplanation: load.explanation,
      restSeconds:
        exerciseType === EXERCISE_TYPES.COMPOUND ? rest.compound : rest.isolation,
      tempo: exerciseType === EXERCISE_TYPES.COMPOUND ? '2-0-1-0' : '3-1-2-1',
      isPriorityLift: ex.id === priorityLiftId || ex.prioridad === 1,
      priority: ex.prioridad ?? 2,
    };
  });
}
