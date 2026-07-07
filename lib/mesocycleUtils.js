import { diffWeeks, getDayOfWeek } from './dateUtils.js';

/**
 * Current microcycle week (1-indexed) from mesocycle start.
 */
export function getCurrentWeek(mesocycle, referenceDate) {
  const start = mesocycle.startDate;
  if (!start) return 1;
  const weeks = diffWeeks(start, referenceDate) + 1;
  return Math.min(Math.max(weeks, 1), mesocycle.durationWeeks ?? 4);
}

/**
 * Today's scheduled session from the active microcycle, or null if rest day.
 */
export function getTodaySessionPlan(mesocycle, referenceDate, timezone = 'UTC') {
  const weekNumber = getCurrentWeek(mesocycle, referenceDate);
  const micro = mesocycle.microcycles?.find((m) => m.week === weekNumber);
  if (!micro) return { weekNumber, session: null, isRestDay: true };

  const dayOfWeek = getDayOfWeek(referenceDate, timezone);
  const session = micro.sessions?.find((s) => s.dayOfWeek === dayOfWeek) ?? null;

  if (!session || session.isRestDay || session.sessionFocus === 'Descanso') {
    return { weekNumber, session: null, isRestDay: true, dayOfWeek };
  }

  return { weekNumber, session, isRestDay: false, dayOfWeek };
}

/**
 * Whether mesocycle is complete and needs evaluation.
 */
export function isMesocycleComplete(mesocycle, referenceDate) {
  if (!mesocycle?.endDate) return false;
  const ref = new Date(referenceDate).toISOString().slice(0, 10);
  return ref > mesocycle.endDate || mesocycle.status === 'evaluacion_pendiente';
}
