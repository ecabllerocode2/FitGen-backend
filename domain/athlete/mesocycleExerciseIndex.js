import { MESOCYCLE_INDEX_MAX } from './loadPerformanceLedger.js';

export function emptyMesocycleExerciseIndex() {
  return [];
}

export function normalizeMesocycleExerciseIndex(raw) {
  return Array.isArray(raw) ? raw : [];
}

/**
 * Record week-1 anchor exercises per mesocycle + session focus for long-term rotation.
 * @param {object[]} index
 * @param {object} session — completed session with mainBlock
 */
export function upsertMesocycleExerciseIndex(index, session) {
  const list = normalizeMesocycleExerciseIndex(index);
  const mesocycleId = session.mesocycleId;
  const sessionFocus = session.sessionFocus;
  if (!mesocycleId || !sessionFocus || !session.mainBlock?.length) return list;

  const exerciseIds = session.mainBlock.map((b) => b.exerciseId).filter(Boolean);
  const entry = {
    mesocycleId,
    sessionFocus,
    weekNumber: session.weekNumber ?? 1,
    exerciseIds,
    completedAt: session.completedAt ?? session.archivedAt ?? new Date().toISOString(),
  };

  const withoutDup = list.filter(
    (row) => !(row.mesocycleId === mesocycleId && row.sessionFocus === sessionFocus),
  );
  const next = [...withoutDup, entry];
  next.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  return next.slice(0, MESOCYCLE_INDEX_MAX);
}

/**
 * All exercise ids used in previous mesociclos for a session focus (rotation exclusions).
 */
export function getRotationIdsFromIndex(index, mesocycleId, sessionFocus) {
  return [
    ...new Set(
      normalizeMesocycleExerciseIndex(index)
        .filter((row) => row.mesocycleId !== mesocycleId && row.sessionFocus === sessionFocus)
        .flatMap((row) => row.exerciseIds ?? []),
    ),
  ];
}
