/**
 * Detect personal e1RM records from ledger diff after session complete.
 */

const MIN_IMPROVEMENT_KG = 0.5;

/**
 * @param {object} previousLedger
 * @param {object} nextLedger
 * @param {number} [maxCount=3]
 */
export function detectE1rmPersonalRecords(previousLedger, nextLedger, maxCount = 3) {
  const previous = previousLedger?.byExerciseId ?? {};
  const next = nextLedger?.byExerciseId ?? {};
  const records = [];

  for (const [exerciseId, entry] of Object.entries(next)) {
    const prevEntry = previous[exerciseId];
    const previousE1RM = prevEntry?.e1RM ?? entry.previousE1RM ?? null;
    const newE1RM = entry.e1RM ?? null;
    if (!newE1RM) continue;

    if (previousE1RM == null) continue;
    if (newE1RM < previousE1RM + MIN_IMPROVEMENT_KG) continue;

    records.push({
      exerciseId,
      exerciseName: entry.exerciseName ?? exerciseId,
      previousE1RM,
      newE1RM,
    });
  }

  records.sort((a, b) => (b.newE1RM ?? 0) - (a.newE1RM ?? 0));
  return records.slice(0, maxCount);
}
