/**
 * Calendar day helpers for session freshness / same-day completion guards.
 */

/**
 * @param {Date|string} dateInput
 * @param {string} [timezone='UTC']
 * @returns {string|null} YYYY-MM-DD in the given timezone
 */
export function calendarDayKey(dateInput, timezone = 'UTC') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * True when the athlete already finished today's scheduled training slot.
 * Allows completing a stale carried-over session on a different calendar day
 * without blocking the real session for that later day.
 *
 * @param {{
 *   user: Record<string, any>,
 *   history?: Array<Record<string, any>>,
 *   dayOfWeek: string,
 *   weekNumber: number,
 *   referenceDate?: Date|string,
 *   timezone?: string,
 * }} args
 */
export function hasCompletedScheduledSessionToday({
  user,
  history = [],
  dayOfWeek,
  weekNumber,
  referenceDate = new Date(),
  timezone = 'UTC',
}) {
  const todayKey = calendarDayKey(referenceDate, timezone);
  if (!todayKey || !dayOfWeek) return false;
  const dayLower = String(dayOfWeek).toLowerCase();

  const lastWorkout = user?.lastWorkoutDate;
  if (lastWorkout && calendarDayKey(lastWorkout, timezone) === todayKey) {
    const lastDay = String(user.lastCompletedDayOfWeek ?? '').toLowerCase();
    if (lastDay === dayLower) {
      if (user.lastCompletedWeekNumber == null || user.lastCompletedWeekNumber === weekNumber) {
        return true;
      }
      // Week numbering can drift FE/BE; same calendar day + same plan weekday is enough.
      return true;
    }
  }

  return history.some((session) => {
    if (!session || session.completed === false) return false;
    const completedKey = calendarDayKey(session.completedAt ?? session.archivedAt, timezone);
    if (completedKey !== todayKey) return false;
    return String(session.dayOfWeek ?? '').toLowerCase() === dayLower;
  });
}
