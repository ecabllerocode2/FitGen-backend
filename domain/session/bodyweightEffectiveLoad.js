/**
 * Effective load factors for bodyweight exercises (volume / tonnage).
 * Fraction of body mass moved per rep — distinct from prescription load factors.
 *
 * @see loadCalculator suggestExploratoryLoad (lower factors for load suggestion)
 */
export const BODYWEIGHT_EFFECTIVE_LOAD_FACTORS = {
  Empuje_H: 0.65, // flexiones, fondos inclinados
  Empuje_V: 0.75, // fondos en paralelas
  Traccion_H: 0.6, // remo invertido
  Traccion_V: 1.0, // dominadas / chin-ups
  Rodilla: 1.0, // sentadilla peso corporal
  Cadera: 0.9, // puente de glúteos
  Core: 0.2, // trabajo de core por rep (aprox.)
  General: 0.5,
};

export function getExerciseMovementPattern(exercise = {}) {
  return exercise.movementPattern ?? exercise.patronMovimiento ?? 'General';
}

export function getBodyweightEffectiveLoadFactor(exercise = {}) {
  if (typeof exercise.bodyweightEffectiveLoadFactor === 'number') {
    return exercise.bodyweightEffectiveLoadFactor;
  }
  const pattern = getExerciseMovementPattern(exercise);
  return BODYWEIGHT_EFFECTIVE_LOAD_FACTORS[pattern] ?? BODYWEIGHT_EFFECTIVE_LOAD_FACTORS.General;
}

/**
 * Base kg per rep for a bodyweight exercise (before optional added load).
 */
export function getBodyweightBaseLoadKg(exercise = {}, bodyWeightKg) {
  if (!bodyWeightKg || bodyWeightKg <= 0) return null;
  return bodyWeightKg * getBodyweightEffectiveLoadFactor(exercise);
}

/**
 * @returns {number|null} kg per rep for volume (external or effective + added)
 */
export function resolveSetLoadKgForVolume(set = {}, exercise = {}, bodyWeightKg = null) {
  const isBodyweight =
    exercise.isBodyweight === true || exercise.loadMode === 'bodyweight';

  if (isBodyweight) {
    const base = getBodyweightBaseLoadKg(exercise, bodyWeightKg);
    if (base == null) return null;
    const added =
      set.load ??
      set.weightKg ??
      set.actualWeightKg ??
      exercise.actualWeightKg ??
      0;
    const addedKg = typeof added === 'number' && added > 0 ? added : 0;
    return base + addedKg;
  }

  const load =
    set.load ??
    set.weightKg ??
    set.actualWeightKg ??
    exercise.actualWeightKg ??
    null;
  if (load == null || load <= 0) return null;
  return load;
}
