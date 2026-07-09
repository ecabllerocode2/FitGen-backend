import { REP_RANGES, REST_SECONDS, EXERCISE_TYPES, countMuscleSessionsPerWeek } from '../constants.js';
import { getWeekPlan } from '../periodization/microcycle.js';
import { applyReadiness } from '../autoregulation/readiness.js';
import { selectExercises } from '../exerciseSelection/selector.js';
import { orderByGoal } from '../exerciseSelection/orderExercises.js';
import { prescribeLoad } from '../prescription/loadCalculator.js';
import { generateWarmup } from './rampGenerator.js';
import { generateCooldown } from './cooldownGenerator.js';
import { getDayOfWeek } from '../../lib/dateUtils.js';

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
  } = context;

  const goal = mesocycle.goal ?? profile.fitnessGoal ?? 'Hipertrofia';
  const safetyProfile = mesocycle.safetyProfile ?? profile.safetyProfile ?? {};

  const weekPlan = getWeekPlan(mesocycle, weekNumber, feedbackModifiers);
  const rirBase = weekPlan?.rirObjetivo ?? 3;
  const rirAccessory = weekPlan?.rirObjetivoAccessory ?? rirBase;

  const readinessAdj = applyReadiness(readiness, sessionMuscles);

  const rawExercises = selectExercises(
    sessionFocus,
    catalog.entrenamiento ?? [],
    safetyProfile,
    history,
    goal,
    { weekNumber, sessionMuscles },
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
  });

  const warmup = generateWarmup(patterns, catalog.calentamiento ?? [], {
    weekNumber,
    sessionFocus,
    prehab: safetyProfile.prehab ?? [],
  });
  const cooldown = generateCooldown(catalog.enfriamiento ?? [], sessionMuscles);

  const dayOfWeek = getDayOfWeek(referenceDate, profile.timezone ?? 'UTC');

  return {
    sessionId: `sess_${mesocycle.mesocycleId}_w${weekNumber}_${dayOfWeek}`,
    mesocycleId: mesocycle.mesocycleId,
    weekNumber,
    dayOfWeek,
    sessionFocus,
    generatedAt: new Date(referenceDate).toISOString(),
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
    completed: false,
  };
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
}) {
  const repRanges = REP_RANGES[goal] ?? REP_RANGES.Hipertrofia;
  const rest = REST_SECONDS[goal] ?? REST_SECONDS.Hipertrofia;
  const muscleFrequency = countMuscleSessionsPerWeek(splitType ?? 'Full_Body');

  const exercisesByMuscle = {};
  for (const ex of exercises) {
    const muscle = ex.parteCuerpo ?? ex.muscleGroup;
    if (!muscle) continue;
    exercisesByMuscle[muscle] = exercisesByMuscle[muscle] ?? [];
    exercisesByMuscle[muscle].push(ex);
  }

  const setsByExerciseId = {};
  for (const muscle of sessionMuscles) {
    const muscleExercises = exercisesByMuscle[muscle] ?? [];
    const weeklySets = volumeByMuscle[muscle] ?? 0;
    const sessionsPerWeek = muscleFrequency[muscle] || 1;
    const perExercise = muscleExercises.length
      ? Math.max(2, Math.round(weeklySets / sessionsPerWeek / muscleExercises.length))
      : 0;
    for (const ex of muscleExercises) {
      setsByExerciseId[ex.id] = perExercise || 3;
    }
  }

  for (const ex of exercises) {
    if (!setsByExerciseId[ex.id]) {
      const muscle = ex.parteCuerpo ?? ex.muscleGroup;
      const weeklySets = volumeByMuscle[muscle] ?? 0;
      const sessionsPerWeek = muscleFrequency[muscle] || 1;
      setsByExerciseId[ex.id] = weeklySets
        ? Math.max(2, Math.round(weeklySets / sessionsPerWeek))
        : ex.accessorySlot
          ? 2
          : 3;
    }
  }

  return exercises.map((ex) => {
    const exerciseType =
      (ex.prioridad ?? 3) === 1 ? EXERCISE_TYPES.COMPOUND : EXERCISE_TYPES.ISOLATION;
    const repRange =
      ex.repRangeOverride ??
      (exerciseType === EXERCISE_TYPES.COMPOUND
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

    return {
      exerciseId: ex.id,
      exerciseName: ex.nombre,
      muscleGroup: ex.parteCuerpo,
      movementPattern: ex.patronMovimiento,
      sets: adjustedSets,
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
