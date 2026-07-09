import { SPLIT_TYPES } from '../constants.js';

/**
 * DDS 8.2 — select training split (gym only).
 * @param {number} trainingDays
 * @param {'Hipertrofia'|'Fuerza'} goal
 * @param {'Novato'|'Intermedio'|'Avanzado'} experienceLevel
 * @returns {string} split type key
 */
export function selectSplit(trainingDays, goal, experienceLevel) {
  if (trainingDays <= 2) {
    return SPLIT_TYPES.FULL_BODY;
  }
  if (trainingDays === 3) {
    return experienceLevel === 'Novato'
      ? SPLIT_TYPES.FULL_BODY
      : SPLIT_TYPES.TORSO_PIERNA_ONDULADO;
  }
  if (trainingDays === 4) {
    return SPLIT_TYPES.TORSO_PIERNA;
  }
  if (trainingDays === 5) {
    return SPLIT_TYPES.HIBRIDO_PHUL;
  }
  return SPLIT_TYPES.PUSH_PULL_LEGS;
}
