import { REP_RANGES, REST_SECONDS, EXERCISE_TYPES } from '../constants.js';
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
    catalog = {},
    history = [],
    referenceDate,
    priorityLiftId = null,
  } = context;

  const goal = mesocycle.goal ?? profile.fitnessGoal ?? 'Hipertrofia';
  const safetyProfile = mesocycle.safetyProfile ?? profile.safetyProfile ?? {};

  const weekPlan = getWeekPlan(mesocycle, weekNumber);
  const rirBase = weekPlan?.rirObjetivo ?? 3;

  const readinessAdj = applyReadiness(readiness, sessionMuscles);

  const rawExercises = selectExercises(
    sessionFocus,
    catalog.entrenamiento ?? [],
    safetyProfile,
    history,
    goal,
  );

  const ordered = orderByGoal(rawExercises, goal, priorityLiftId);

  const volumeByMuscle = weekPlan?.volumeByMuscle ?? {};
  const mainBlock = buildMainBlock({
    exercises: ordered,
    goal,
    rirBase,
    readinessAdj,
    volumeByMuscle,
    sessionMuscles,
    history,
    priorityLiftId,
  });

  const warmup = generateWarmup(patterns, catalog.calentamiento ?? []);
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
  readinessAdj,
  volumeByMuscle,
  sessionMuscles,
  history,
  priorityLiftId,
}) {
  const repRanges = REP_RANGES[goal] ?? REP_RANGES.Hipertrofia;
  const rest = REST_SECONDS[goal] ?? REST_SECONDS.Hipertrofia;

  const totalSessionSets = sessionMuscles.reduce(
    (sum, m) => sum + (volumeByMuscle[m] ?? 0),
    0,
  );
  const setsPerExercise = exercises.length
    ? Math.max(2, Math.round(totalSessionSets / exercises.length))
    : 3;

  return exercises.map((ex) => {
    const exerciseType =
      (ex.prioridad ?? 3) === 1 ? EXERCISE_TYPES.COMPOUND : EXERCISE_TYPES.ISOLATION;
    const repRange =
      exerciseType === EXERCISE_TYPES.COMPOUND
        ? repRanges.compound
        : repRanges.isolation;

    const rirTarget = Math.round((rirBase + readinessAdj.rirDelta) * 10) / 10;

    const exerciseHistory = (history ?? [])
      .flatMap((s) => s.mainBlock ?? s.exercises ?? [])
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
    });

    const adjustedSets = Math.max(
      1,
      Math.round(setsPerExercise * readinessAdj.volumeMultiplier),
    );

    return {
      exerciseId: ex.id,
      exerciseName: ex.nombre,
      muscleGroup: ex.parteCuerpo,
      movementPattern: ex.patronMovimiento,
      sets: adjustedSets,
      repRange: load.repRange ?? repRange,
      rirTarget,
      prescribedLoadKg: load.prescribedLoadKg,
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
