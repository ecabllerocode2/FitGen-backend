/**
 * Equipment filters for automatic exercise selection (gym basics only).
 */

function equipmentList(exercise) {
  const equipo = exercise?.equipo ?? [];
  return Array.isArray(equipo) ? equipo : [equipo].filter(Boolean);
}

/**
 * Resistance-band exercises are excluded from auto-select — not available in every gym.
 * @param {object} exercise
 * @returns {boolean}
 */
export function usesResistanceBands(exercise) {
  const items = equipmentList(exercise).map(String);
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();

  if (items.some((e) => /banda|band/i.test(e))) return true;
  if (/\bcon banda\b|\bcon bandas\b|\bbandas de resistencia\b/i.test(name)) return true;
  return false;
}

/**
 * @param {object} exercise
 * @returns {boolean}
 */
export function passesGymEquipmentFilter(exercise) {
  return !usesResistanceBands(exercise);
}
