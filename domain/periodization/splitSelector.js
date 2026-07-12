import { SPLIT_TYPES } from '../constants.js';

/** Máximo de días con sesión — 7 sin descanso no tiene respaldo en recuperación (DDS §5.7). */
export const MAX_TRAINING_DAYS_PER_WEEK = 6;

/**
 * Normaliza días de entrenamiento al rango soportado por el motor.
 * @param {number} trainingDays
 * @returns {number}
 */
export function normalizeTrainingDays(trainingDays) {
  return Math.min(Math.max(trainingDays ?? 3, 1), MAX_TRAINING_DAYS_PER_WEEK);
}

/**
 * DDS 8.2 — select training split (gym only).
 * @param {number} trainingDays
 * @param {'Hipertrofia'|'Fuerza'} goal
 * @param {'Novato'|'Intermedio'|'Avanzado'} experienceLevel
 * @returns {string} split type key
 */
export function selectSplit(trainingDays, goal, experienceLevel) {
  const days = normalizeTrainingDays(trainingDays);

  if (days <= 2) {
    return SPLIT_TYPES.FULL_BODY;
  }

  if (goal === 'Fuerza') {
    if (days === 3) return SPLIT_TYPES.FULL_BODY;
    if (days === 4 || days === 5) return SPLIT_TYPES.HIBRIDO_PHUL;
    return SPLIT_TYPES.PUSH_PULL_LEGS;
  }

  if (days === 3) {
    return experienceLevel === 'Novato'
      ? SPLIT_TYPES.FULL_BODY
      : SPLIT_TYPES.TORSO_PIERNA_ONDULADO;
  }
  if (days === 4) {
    return SPLIT_TYPES.TORSO_PIERNA;
  }
  if (days === 5) {
    return SPLIT_TYPES.HIBRIDO_PHUL;
  }
  return SPLIT_TYPES.PUSH_PULL_LEGS;
}
