import { EXPERIENCE_LEVELS } from '../constants.js';

/**
 * DDS 8.1 — experience level from structured training age in months.
 * @param {number} trainingAgeMonths
 * @returns {'Novato'|'Intermedio'|'Avanzado'}
 */
export function calculateExperienceLevel(trainingAgeMonths) {
  if (trainingAgeMonths < 6) {
    return EXPERIENCE_LEVELS.NOVATO;
  }
  if (trainingAgeMonths <= 24) {
    return EXPERIENCE_LEVELS.INTERMEDIO;
  }
  return EXPERIENCE_LEVELS.AVANZADO;
}
