import { SPLIT_SESSIONS } from '../constants.js';
import { assignSessionsToSchedule } from './mesocycleGenerator.js';
import { selectExercises, getMesocycleRotationExclusions } from '../exerciseSelection/selector.js';
import { isBodyweightExercise } from '../exerciseSelection/bodyweight.js';

/**
 * Evenly distributes weekly sets across all exercise slots for a muscle in the week.
 * @param {number} weeklySets
 * @param {number} slotIndex — 0-based index across the full week for this muscle
 * @param {number} totalSlots — total exercise slots for this muscle in the week
 */
export function allocateWeeklySetSlot(weeklySets, slotIndex, totalSlots) {
  if (!weeklySets || totalSlots <= 0) return 2;
  if (weeklySets < totalSlots) {
    return slotIndex < weeklySets ? 1 : 0;
  }
  const base = Math.floor(weeklySets / totalSlots);
  const remainder = weeklySets % totalSlots;
  return base + (slotIndex < remainder ? 1 : 0);
}

function historyEntryToExercises(entry) {
  return (entry.mainBlock ?? []).map((block) => ({
    id: block.exerciseId,
    nombre: block.exerciseName,
    patronMovimiento: block.movementPattern,
    parteCuerpo: block.muscleGroup,
    prioridad: block.priority ?? 2,
    accessorySlot: block.accessorySlot ?? false,
    isBodyweight: block.isBodyweight ?? block.loadMode === 'bodyweight',
    loadMode: block.loadMode ?? null,
  }));
}

function matchesSlot(entry, slot, weekNumber, mesocycleId) {
  if (mesocycleId && entry.mesocycleId && entry.mesocycleId !== mesocycleId) return false;
  return (
    entry.weekNumber === weekNumber &&
    entry.sessionFocus === slot.sessionFocus &&
    (entry.dayOfWeek === slot.dayOfWeek || !entry.dayOfWeek || !slot.dayOfWeek) &&
    (entry.mainBlock?.length ?? 0) > 0
  );
}

/**
 * Simulates exercise selection for every training day in the week to count
 * how many exercise slots each muscle receives (including repeated session focuses).
 * Reuses completed sessions from history when available.
 */
export function computeWeeklyVolumePlan({
  splitType,
  trainingDays,
  weeklyScheduleContext,
  catalog,
  safetyProfile,
  goal,
  weekNumber,
  excludeIds = [],
  scheduleWeekNumber = 1,
  history = [],
  mesocycleId = null,
}) {
  const splitSessions = SPLIT_SESSIONS[splitType] ?? [];
  const schedule = assignSessionsToSchedule(
    weeklyScheduleContext ?? [],
    splitSessions,
    trainingDays,
    { weekNumber: scheduleWeekNumber },
  );

  const weeklyMuscleSlotCounts = {};
  const sessions = [];
  const rollingHistory = [...history];

  for (const slot of schedule.filter((s) => !s.isRestDay)) {
    const muscleSlotStart = { ...weeklyMuscleSlotCounts };
    const completed = rollingHistory.find((entry) =>
      matchesSlot(entry, slot, weekNumber, mesocycleId),
    );

    const rotationExcludeIds = getMesocycleRotationExclusions(
      rollingHistory,
      mesocycleId,
      weekNumber,
      slot.sessionFocus,
    );
    const mergedExcludeIds = [...new Set([...excludeIds, ...rotationExcludeIds])];

    const selected = completed
      ? historyEntryToExercises(completed)
      : selectExercises(
          slot.sessionFocus,
          catalog,
          safetyProfile,
          rollingHistory,
          goal,
          {
            weekNumber,
            sessionMuscles: slot.muscles ?? [],
            excludeIds,
            rotationExcludeIds,
            mesocycleId,
            trainingDaysPerWeek: trainingDays,
          },
        );

    for (const ex of selected) {
      const muscle = ex.parteCuerpo ?? ex.muscleGroup;
      if (muscle) {
        weeklyMuscleSlotCounts[muscle] = (weeklyMuscleSlotCounts[muscle] ?? 0) + 1;
      }
    }

    sessions.push({
      sessionFocus: slot.sessionFocus,
      dayOfWeek: slot.dayOfWeek,
      muscles: slot.muscles ?? [],
      patterns: slot.patterns ?? [],
      muscleSlotStart,
      exercises: selected,
      fromHistory: Boolean(completed),
    });

    if (!completed) {
      rollingHistory.push({
        mesocycleId,
        weekNumber,
        sessionFocus: slot.sessionFocus,
        dayOfWeek: slot.dayOfWeek,
        mainBlock: selected.map((ex) => ({
          exerciseId: ex.id,
          exerciseName: ex.nombre,
          movementPattern: ex.patronMovimiento,
          muscleGroup: ex.parteCuerpo,
          priority: ex.prioridad ?? 2,
          accessorySlot: ex.accessorySlot ?? false,
          isBodyweight: isBodyweightExercise(ex, catalog),
        })),
      });
    }
  }

  return { weeklyMuscleSlotCounts, sessions };
}

/**
 * Finds the precomputed slot offsets for a session instance.
 */
export function findSessionVolumeSlot(sessionPlans, sessionFocus, dayOfWeek) {
  return (
    sessionPlans.find((s) => s.sessionFocus === sessionFocus && s.dayOfWeek === dayOfWeek) ??
    sessionPlans.find((s) => s.sessionFocus === sessionFocus) ??
    null
  );
}
