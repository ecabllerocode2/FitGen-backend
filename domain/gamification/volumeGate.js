/**
 * Assess whether a completed session met its planned main-block volume.
 */

function plannedSetsForExercise(exercise = {}) {
  if (typeof exercise.sets === 'number' && exercise.sets > 0) return exercise.sets;
  if (Array.isArray(exercise.sets)) return exercise.sets.length;
  if (typeof exercise.series === 'number' && exercise.series > 0) return exercise.series;
  return 0;
}

function completedSetsForExercise(performance = {}) {
  const sets = performance.sets ?? performance.actualSets ?? [];
  if (!Array.isArray(sets)) return 0;
  return sets.filter((set) => set.completed !== false).length;
}

/**
 * @param {object} session — active session template (mainBlock)
 * @param {object[]} performance — logged performance rows
 * @param {number} [threshold=0.8] — minimum completion ratio
 */
export function assessSessionVolumeCompletion(session, performance = [], threshold = 0.8) {
  const mainBlock = Array.isArray(session?.mainBlock) ? session.mainBlock : [];
  if (!mainBlock.length) {
    return { plannedSets: 0, completedSets: 0, rate: 1, meetsTarget: true };
  }

  const perfById = new Map();
  for (const row of performance ?? []) {
    const id = row.exerciseId ?? row.id;
    if (id) perfById.set(id, row);
  }

  let plannedSets = 0;
  let completedSets = 0;

  for (const planned of mainBlock) {
    const id = planned.exerciseId ?? planned.id;
    const target = plannedSetsForExercise(planned);
    if (!target) continue;

    plannedSets += target;
    const done = completedSetsForExercise(perfById.get(id) ?? {});
    completedSets += Math.min(done, target);
  }

  if (!plannedSets) {
    return { plannedSets: 0, completedSets: 0, rate: 1, meetsTarget: true };
  }

  const rate = completedSets / plannedSets;
  return {
    plannedSets,
    completedSets,
    rate,
    meetsTarget: rate >= threshold,
  };
}
