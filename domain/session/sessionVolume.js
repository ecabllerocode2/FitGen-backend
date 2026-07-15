/**
 * Main-block training volume = Σ (load kg × reps) per completed set.
 * External loads use logged weight; bodyweight uses effective load (e.g. 65% BW for push-ups).
 */

import {
  resolveSetLoadKgForVolume,
} from './bodyweightEffectiveLoad.js';

export function isBodyweightPerformanceExercise(exercise = {}) {
  if (exercise.isBodyweight === true) return true;
  if (exercise.loadMode === 'bodyweight') return true;
  return false;
}

function setReps(set, exercise) {
  const reps = set.reps ?? set.actualReps ?? exercise.actualReps ?? 0;
  return reps > 0 ? reps : 0;
}

/**
 * @param {object[]} performance — main block rows from session complete
 * @param {{ bodyWeightKg?: number|null }} [options]
 */
export function computeMainBlockVolumeKg(performance = [], options = {}) {
  const { bodyWeightKg = null } = options;
  if (!Array.isArray(performance) || !performance.length) return null;

  let total = 0;
  let hasVolumeSet = false;

  for (const exercise of performance) {
    const sets = exercise.sets ?? exercise.actualSets ?? [];
    for (const set of sets) {
      if (set.completed === false) continue;
      const load = resolveSetLoadKgForVolume(set, exercise, bodyWeightKg);
      const reps = setReps(set, exercise);
      if (load == null || !reps) continue;
      hasVolumeSet = true;
      total += load * reps;
    }
  }

  return hasVolumeSet ? Math.round(total) : null;
}

/** @deprecated alias — prefer computeMainBlockVolumeKg */
export const computeTotalWeightKg = computeMainBlockVolumeKg;

/**
 * @param {object} params
 * @param {object[]} params.mainBlock
 * @param {Record<string, { weight?: number|null, reps?: number }[]>} params.exerciseLogs
 * @param {(ex: object) => boolean} [params.isBodyweight]
 * @param {number|null} [params.bodyWeightKg]
 */
export function computeMainBlockVolumeFromLogs({
  mainBlock = [],
  exerciseLogs = {},
  isBodyweight = () => false,
  bodyWeightKg = null,
}) {
  let total = 0;
  let hasVolumeSet = false;

  const exercises = Array.isArray(mainBlock) ? mainBlock : [];
  for (const ex of exercises) {
    const exerciseId = ex.exerciseId ?? ex.id;
    if (!exerciseId) continue;

    const exerciseMeta = {
      ...ex,
      isBodyweight: isBodyweight(ex),
      loadMode: ex.loadMode ?? (isBodyweight(ex) ? 'bodyweight' : undefined),
    };

    const logs = exerciseLogs[exerciseId] ?? [];
    for (const log of logs) {
      if (!log.reps) continue;
      const load = resolveSetLoadKgForVolume(
        { load: log.weight, reps: log.reps },
        exerciseMeta,
        bodyWeightKg,
      );
      if (load == null) continue;
      hasVolumeSet = true;
      total += load * log.reps;
    }
  }

  return hasVolumeSet ? Math.round(total) : null;
}

export function formatVolumeKg(kg) {
  if (kg == null || kg <= 0) return null;
  return `${kg.toLocaleString('es-MX')} kg`;
}
