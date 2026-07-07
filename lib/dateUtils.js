/**
 * Date utilities — domain code must receive referenceDate; never call Date.now() in domain.
 */

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * @param {Date|string} date
 * @param {string} [timezone='UTC']
 * @returns {string} Day name in Spanish (Lunes, Martes, ...)
 */
export function getDayOfWeek(date, timezone = 'UTC') {
  const d = toDate(date);
  if (timezone && timezone !== 'UTC') {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    });
    const enDay = formatter.format(d);
    const map = {
      Monday: 'Lunes',
      Tuesday: 'Martes',
      Wednesday: 'Miércoles',
      Thursday: 'Jueves',
      Friday: 'Viernes',
      Saturday: 'Sábado',
      Sunday: 'Domingo',
    };
    return map[enDay] ?? enDay;
  }
  return DAY_NAMES[d.getUTCDay()];
}

/**
 * @param {Date|string} date
 * @param {number} n
 * @returns {Date}
 */
export function addDays(date, n) {
  const d = toDate(date);
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + n);
  return result;
}

/**
 * Whole weeks between two dates (floor).
 * @param {Date|string} start
 * @param {Date|string} end
 * @returns {number}
 */
export function diffWeeks(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.floor((e.getTime() - s.getTime()) / msPerWeek);
}

/**
 * @param {Date|string} date
 * @returns {string} ISO date YYYY-MM-DD
 */
export function toISODateString(date) {
  const d = toDate(date);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {Date|string} date
 * @returns {Date}
 */
function toDate(date) {
  if (date instanceof Date) return new Date(date.getTime());
  return new Date(date);
}
