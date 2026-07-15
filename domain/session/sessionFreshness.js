/**
 * Whether an incomplete session belongs to the requested training day.
 */
export function isSameCalendarDay(a, b) {
  const d1 = a instanceof Date ? a : new Date(a);
  const d2 = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function isIncompleteSessionForDate(session, referenceDate, dayOfWeek, weekNumber) {
  if (!session || session.completed) return false;

  const generatedAt = session.generatedAt ?? session.meta?.generatedAt;
  if (generatedAt) {
    return isSameCalendarDay(generatedAt, referenceDate);
  }

  return (
    String(session.dayOfWeek ?? '').toLowerCase() === String(dayOfWeek ?? '').toLowerCase() &&
    (session.weekNumber == null || session.weekNumber === weekNumber)
  );
}

export function isStaleIncompleteSession(session, referenceDate, dayOfWeek, weekNumber) {
  if (!session || session.completed) return false;
  return !isIncompleteSessionForDate(session, referenceDate, dayOfWeek, weekNumber);
}
