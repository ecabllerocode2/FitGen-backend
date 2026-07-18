import { REP_RANGES, REST_SECONDS, EXERCISE_TYPES, MAX_SETS_PER_EXERCISE } from '../constants.js';
import { getWeekPlan } from '../periodization/microcycle.js';
import { applyReadiness } from '../autoregulation/readiness.js';
import { selectExercises, getMesocycleRotationExclusions } from '../exerciseSelection/selector.js';
import { prescribeLoad, buildLoadHistoryFromSessions } from '../prescription/loadCalculator.js';
import { isBodyweightExercise } from '../exerciseSelection/bodyweight.js';
import {
  resolveSessionGoal,
  resolvePriorityLiftId,
  orderExercisesForSession,
  resolveSessionRir,
  getSessionRepRanges,
  getSessionRestSeconds,
  enforceSessionVolumeFloors,
  isPullBiasedSession,
  isGoodMorningExercise,
} from './sessionPrescription.js';
import { appendFuerzaRampSets, generateWarmup } from './rampGenerator.js';
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
    continuityOverrides = {},
    loadPerformanceLedger = null,
    mesocycleExerciseIndex = [],
  } = context;

  const goal = mesocycle.goal ?? profile.fitnessGoal ?? 'Hipertrofia';
  const sessionGoal = resolveSessionGoal(sessionFocus, goal);
  const safetyProfile = mesocycle.safetyProfile ?? profile.safetyProfile ?? {};
  const { excludeIds, warmupExcludeIds, unavailableEquipment } = resolveExclusionFilters(exercisePreferences);
  const rotationExcludeIds = getMesocycleRotationExclusions(
    history,
    mesocycle.mesocycleId,
    weekNumber,
    sessionFocus,
    mesocycleExerciseIndex,
  );
  const mergedExcludeIds = [...new Set([...excludeIds, ...rotationExcludeIds])];

  const weekPlan = getWeekPlan(mesocycle, weekNumber, feedbackModifiers);
  const accumulationWeeks = mesocycle.durationWeeks - 1;
  const rirBase = resolveSessionRir(weekPlan, sessionGoal, accumulationWeeks, false);
  const rirAccessory = resolveSessionRir(weekPlan, sessionGoal, accumulationWeeks, true);

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

  const usePrecomputedExercises =
    sessionVolumeSlot?.exercises &&
    !sessionVolumeSlot.fromHistory &&
    weekNumber === 1;

  const rawExercises = usePrecomputedExercises
    ? sessionVolumeSlot.exercises
    : selectExercises(
          sessionFocus,
          catalog.entrenamiento ?? [],
          safetyProfile,
          history,
          goal,
          {
            weekNumber,
            sessionMuscles,
            excludeIds,
            rotationExcludeIds,
            mesocycleId: mesocycle.mesocycleId,
            trainingDaysPerWeek: profile.trainingDaysPerWeek ?? 3,
            continuityOverrides,
          },
        );

  const resolvedPriorityLiftId =
    priorityLiftId ??
    resolvePriorityLiftId(rawExercises, sessionFocus, patterns, sessionGoal);

  const ordered = orderExercisesForSession(
    rawExercises,
    sessionGoal,
    sessionFocus,
    patterns,
    resolvedPriorityLiftId,
  );

  const volumeByMuscle = weekPlan?.volumeByMuscle ?? {};
  const mainBlock = buildMainBlock({
    exercises: ordered,
    sessionGoal,
    sessionFocus,
    mesocycleGoal: goal,
    rirBase,
    rirAccessory,
    readinessAdj,
    volumeByMuscle,
    sessionMuscles,
    history,
    priorityLiftId: resolvedPriorityLiftId,
    splitType: mesocycle.splitType,
    bodyWeightKg: profile.currentWeightKg,
    weeklyMuscleSlotCounts: weeklyVolumePlan.weeklyMuscleSlotCounts,
    muscleSlotStart: sessionVolumeSlot?.muscleSlotStart ?? {},
    safetyProfile,
    trainingDaysPerWeek: profile.trainingDaysPerWeek ?? 3,
    catalog: catalog.entrenamiento ?? [],
    loadPerformanceLedger,
    experienceLevel: safetyProfile?.experienceLevel ?? profile.experienceLevel ?? 'Intermedio',
  });

  let warmup = generateWarmup(patterns, catalog.calentamiento ?? [], {
    weekNumber,
    sessionFocus,
    sessionMuscles,
    prehab: safetyProfile.prehab ?? [],
    readiness,
    goal: sessionGoal,
    conservative: safetyProfile.conservative ?? false,
    excludeIds: warmupExcludeIds,
    unavailableEquipment,
    avoidPatterns: safetyProfile.avoidPatterns ?? [],
    modifyPatterns: safetyProfile.modifyPatterns ?? [],
    injuries: safetyProfile.injuries ?? [],
    experienceLevel: mesocycle.experienceLevel ?? safetyProfile.experienceLevel ?? 'Intermedio',
  });
  warmup = appendFuerzaRampSets(
    warmup,
    mainBlock,
    sessionGoal,
    sessionFocus,
    resolvedPriorityLiftId,
  );
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

function applyConservativeSessionCap(setsByExerciseId, exercises, safetyProfile) {
  if (!safetyProfile?.conservative) return;
  const MAX_TOTAL_SETS = 18;
  let total = Object.values(setsByExerciseId).reduce((sum, sets) => sum + (sets ?? 0), 0);
  if (total <= MAX_TOTAL_SETS) return;

  const ranked = [...exercises].sort(
    (a, b) =>
      (b.prioridad ?? 3) - (a.prioridad ?? 3) ||
      (setsByExerciseId[b.id] ?? 0) - (setsByExerciseId[a.id] ?? 0),
  );

  for (const ex of ranked) {
    if (total <= MAX_TOTAL_SETS) break;
    if ((ex.prioridad ?? 3) === 1) continue;
    while ((setsByExerciseId[ex.id] ?? 0) > 2 && total > MAX_TOTAL_SETS) {
      setsByExerciseId[ex.id] -= 1;
      total -= 1;
    }
  }

  for (const ex of ranked) {
    if (total <= MAX_TOTAL_SETS) break;
    while ((setsByExerciseId[ex.id] ?? 0) > 3 && total > MAX_TOTAL_SETS) {
      setsByExerciseId[ex.id] -= 1;
      total -= 1;
    }
  }
}

function applyAccesoriosSessionSetCap(setsByExerciseId, exercises, sessionGoal, sessionFocus) {
  if (sessionGoal !== 'Hipertrofia' || !/accesorios/i.test(sessionFocus ?? '')) return;
  const MAX_TOTAL = 20;
  let total = exercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
  if (total <= MAX_TOTAL) return;

  const ranked = [...exercises].sort(
    (a, b) =>
      (b.prioridad ?? 3) - (a.prioridad ?? 3) ||
      (setsByExerciseId[b.id] ?? 0) - (setsByExerciseId[a.id] ?? 0),
  );

  for (const ex of ranked) {
    if (total <= MAX_TOTAL) break;
    if ((ex.prioridad ?? 3) === 1) continue;
    while ((setsByExerciseId[ex.id] ?? 0) > 2 && total > MAX_TOTAL) {
      setsByExerciseId[ex.id] -= 1;
      total -= 1;
    }
  }
}

function applyNovatoLowFreqSetCap(
  setsByExerciseId,
  exercises,
  safetyProfile,
  sessionGoal,
  sessionFocus,
  trainingDaysPerWeek = 3,
) {
  if (safetyProfile?.experienceLevel !== 'Novato') return;
  if (sessionGoal !== 'Hipertrofia' || !/full body/i.test(sessionFocus ?? '')) return;

  const MAX_TOTAL_SETS = trainingDaysPerWeek <= 2 ? 18 : 20;
  let total = exercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
  if (total <= MAX_TOTAL_SETS) return;

  const ranked = [...exercises].sort(
    (a, b) =>
      (b.prioridad ?? 3) - (a.prioridad ?? 3) ||
      (setsByExerciseId[b.id] ?? 0) - (setsByExerciseId[a.id] ?? 0),
  );

  for (const ex of ranked) {
    if (total <= MAX_TOTAL_SETS) break;
    if ((ex.prioridad ?? 3) === 1) continue;
    while ((setsByExerciseId[ex.id] ?? 0) > 2 && total > MAX_TOTAL_SETS) {
      setsByExerciseId[ex.id] -= 1;
      total -= 1;
    }
  }
}

function applyFuerzaFullBodyAccessoryCaps(setsByExerciseId, exercises, sessionGoal, sessionFocus) {
  if (sessionGoal !== 'Fuerza' || !/full body/i.test(sessionFocus ?? '')) return;
  for (const ex of exercises) {
    const muscle = ex.parteCuerpo ?? ex.muscleGroup;
    if (muscle === 'Bíceps' && (ex.prioridad ?? 3) >= 2) {
      setsByExerciseId[ex.id] = Math.min(setsByExerciseId[ex.id] ?? 0, 2);
    }
  }
}

function applyFuerzaFullBodyBalance(setsByExerciseId, exercises, sessionGoal, sessionFocus) {
  if (sessionGoal !== 'Fuerza' || !/full body/i.test(sessionFocus ?? '')) return;

  const isPullCompound = (ex) => {
    if ((ex.prioridad ?? 3) !== 1) return false;
    if (['Traccion_H', 'Traccion_V'].includes(ex.patronMovimiento)) return true;
    const name = (ex.nombre ?? ex.exerciseName ?? '').toLowerCase();
    return (
      ex.patronMovimiento === 'Cadera' &&
      /peso muerto|deadlift|rdl|rumano|stiff/i.test(name) &&
      !isGoodMorningExercise(ex)
    );
  };
  const isPushCompound = (ex) => {
    if ((ex.prioridad ?? 3) !== 1) return false;
    if (['Empuje_H', 'Empuje_V'].includes(ex.patronMovimiento)) return true;
    return ex.patronMovimiento === 'Rodilla';
  };

  const pushCompounds = exercises.filter(isPushCompound);
  const pullCompounds = exercises.filter(isPullCompound);

  let pushSets = pushCompounds.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
  let pullSets = pullCompounds.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);

  while (pushSets > pullSets + 1 && pushCompounds.length && pullCompounds.length) {
    const press = [...pushCompounds].sort(
      (a, b) => (setsByExerciseId[b.id] ?? 0) - (setsByExerciseId[a.id] ?? 0),
    )[0];
    if (!press || (setsByExerciseId[press.id] ?? 0) <= 2) break;
    setsByExerciseId[press.id] -= 1;
    pushSets -= 1;
    const pull = [...pullCompounds].sort(
      (a, b) => (setsByExerciseId[a.id] ?? 0) - (setsByExerciseId[b.id] ?? 0),
    )[0];
    if (pull && (setsByExerciseId[pull.id] ?? 0) < 5) {
      setsByExerciseId[pull.id] = (setsByExerciseId[pull.id] ?? 0) + 1;
      pullSets += 1;
    }
  }

  let total = exercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
  const maxSets = 20;
  if (total <= maxSets) return;

  const ranked = [...exercises].sort(
    (a, b) => (b.prioridad ?? 3) - (a.prioridad ?? 3),
  );
  for (const ex of ranked) {
    if (total <= maxSets) break;
    if ((ex.prioridad ?? 3) === 1) continue;
    while ((setsByExerciseId[ex.id] ?? 0) > 2 && total > maxSets) {
      setsByExerciseId[ex.id] -= 1;
      total -= 1;
    }
  }
}

function buildMainBlock({
  exercises,
  sessionGoal,
  sessionFocus = '',
  mesocycleGoal,
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
  safetyProfile = {},
  trainingDaysPerWeek = 3,
  catalog = [],
  loadPerformanceLedger = null,
  experienceLevel = 'Intermedio',
}) {
  const repRanges = getSessionRepRanges(sessionGoal);
  const rest = getSessionRestSeconds(sessionGoal);

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

  if (
    sessionGoal === 'Fuerza' &&
    isPullBiasedSession(sessionMuscles, sessionFocus)
  ) {
    for (const ex of exercises) {
      const muscle = ex.parteCuerpo ?? ex.muscleGroup;
      if (muscle === 'Bíceps' && (ex.prioridad ?? 3) >= 2) {
        setsByExerciseId[ex.id] = Math.min(setsByExerciseId[ex.id] ?? 0, 2);
      }
    }
  }

  enforceSessionVolumeFloors({
    setsByExerciseId,
    exercises,
    sessionMuscles,
    sessionGoal,
    sessionFocus,
    volumeByMuscle,
    weeklyMuscleSlotCounts,
  });

  applyConservativeSessionCap(setsByExerciseId, exercises, safetyProfile);

  applyFuerzaFullBodyAccessoryCaps(setsByExerciseId, exercises, sessionGoal, sessionFocus);
  applyAccesoriosSessionSetCap(setsByExerciseId, exercises, sessionGoal, sessionFocus);
  applyNovatoLowFreqSetCap(
    setsByExerciseId,
    exercises,
    safetyProfile,
    sessionGoal,
    sessionFocus,
    trainingDaysPerWeek,
  );
  applyFuerzaFullBodyBalance(setsByExerciseId, exercises, sessionGoal, sessionFocus);

  return exercises
    .filter((ex) => (setsByExerciseId[ex.id] ?? 0) > 0)
    .map((ex) => {
    const isFuerzaMain =
      sessionGoal === 'Fuerza' &&
      ((ex.prioridad ?? 3) === 1 || ex.fuerzaMainSlot === true);
    const exerciseType = isFuerzaMain
      ? EXERCISE_TYPES.COMPOUND
      : (ex.prioridad ?? 3) === 1
        ? EXERCISE_TYPES.COMPOUND
        : EXERCISE_TYPES.ISOLATION;
    const isCore = ex.patronMovimiento === 'Core' || ex.parteCuerpo === 'Core';
    const muscle = ex.parteCuerpo ?? ex.muscleGroup;
    const isFuerzaPullBiceps =
      sessionGoal === 'Fuerza' &&
      isPullBiasedSession(sessionMuscles, sessionFocus) &&
      muscle === 'Bíceps' &&
      (ex.prioridad ?? 3) >= 2;

    let repRange =
      ex.repRangeOverride ??
      (isCore
        ? repRanges.core ?? repRanges.isolation
        : isFuerzaPullBiceps
          ? repRanges.isolation
          : exerciseType === EXERCISE_TYPES.COMPOUND
            ? repRanges.compound
            : repRanges.isolation);

    const isAccessory = sessionGoal === 'Fuerza' ? !isFuerzaMain : (ex.prioridad ?? 3) !== 1;
    let rirForExercise =
      sessionGoal === 'Fuerza' && isAccessory ? rirAccessory : rirBase;
    const rirTarget = Math.round((rirForExercise + readinessAdj.rirDelta) * 10) / 10;

    const exerciseHistory = buildLoadHistoryFromSessions(
      history,
      ex.id,
      ex.patronMovimiento,
      ex.prioridad ?? 2,
      loadPerformanceLedger,
      experienceLevel,
    );

    const bodyweight = isBodyweightExercise(ex, catalog);
    const load = prescribeLoad({
      exerciseType,
      rirTarget,
      repRange,
      history: exerciseHistory,
      bodyWeightKg,
      movementPattern: ex.patronMovimiento,
      isBodyweight: bodyweight,
      exerciseId: ex.id,
      equipo: ex.equipo,
      isUnilateral: ex.isUnilateral === true,
    });

    const adjustedSets = Math.max(
      1,
      Math.round((setsByExerciseId[ex.id] ?? 3) * readinessAdj.volumeMultiplier),
    );
    const setCap =
      exerciseType === EXERCISE_TYPES.COMPOUND
        ? MAX_SETS_PER_EXERCISE.compound
        : MAX_SETS_PER_EXERCISE.isolation;
    const cappedSets = Math.min(
      adjustedSets,
      isFuerzaPullBiceps ? 2 : setCap,
    );

    return {
      exerciseId: ex.id,
      exerciseName: ex.nombre,
      descripcion: ex.descripcion ?? null,
      correcciones: ex.correcciones ?? [],
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
      loadConvention: load.loadConvention ?? null,
      isBodyweight: bodyweight,
      loadExplanation: load.explanation,
      restSeconds:
        exerciseType === EXERCISE_TYPES.COMPOUND ? rest.compound : rest.isolation,
      tempo: exerciseType === EXERCISE_TYPES.COMPOUND ? '2-0-1-0' : '3-1-2-1',
      isPriorityLift: ex.id === priorityLiftId || ex.prioridad === 1,
      exerciseType,
      fuerzaMainLift: isFuerzaMain,
      priority: ex.prioridad ?? 2,
    };
  });
}
