/**
 * Total tonnage from completed session performance (kg × reps per set).
 * @param {object[]} performance
 */
export function computeTotalWeightKg(performance = []) {
  if (!Array.isArray(performance) || !performance.length) return null;

  let total = 0;
  let hasWeightedSet = false;

  for (const ex of performance) {
    const sets = ex.sets ?? ex.actualSets ?? [];
    for (const set of sets) {
      if (set.completed === false) continue;
      const load =
        set.load ??
        set.weightKg ??
        set.actualWeightKg ??
        ex.actualWeightKg ??
        null;
      const reps = set.reps ?? ex.actualReps ?? 0;
      if (load == null || load <= 0 || !reps) continue;
      hasWeightedSet = true;
      total += load * reps;
    }
  }

  return hasWeightedSet ? Math.round(total) : null;
}
