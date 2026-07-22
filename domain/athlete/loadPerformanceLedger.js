import { estimateE1RMWithRIR } from '../prescription/loadCalculator.js';
import { resolveLoadConvention } from '../prescription/loadConvention.js';

/** Full session archives kept for continuity / feedback (FIFO). */
export const RECENT_SESSIONS_MAX = 36;

/** Compact mesocycle anchors kept for rotation (≈8 mesociclos). */
export const MESOCYCLE_INDEX_MAX = 8;

/** Drop ledger entries older than this if the user never repeated the exercise/pattern. */
export const LEDGER_MAX_AGE_MONTHS = 18;

function monthsBetween(isoDate, reference = new Date()) {
  if (!isoDate) return 0;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.max(0, (reference.getTime() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

export function emptyLoadPerformanceLedger() {
  return { byExerciseId: {}, byPattern: {} };
}

export function normalizeLoadPerformanceLedger(raw) {
  if (!raw || typeof raw !== 'object') return emptyLoadPerformanceLedger();
  return {
    byExerciseId: raw.byExerciseId ?? {},
    byPattern: raw.byPattern ?? {},
  };
}

/**
 * Update compact ledger from completed session performance rows.
 * @param {object} ledger
 * @param {object[]} performance
 * @param {string} completedAt ISO date
 */
export function updateLoadPerformanceLedger(ledger, performance = [], completedAt = new Date().toISOString()) {
  const next = normalizeLoadPerformanceLedger(ledger);

  for (const ex of performance ?? []) {
    const exerciseId = ex.exerciseId ?? ex.id;
    if (!exerciseId) continue;

    const sets = ex.sets ?? ex.actualSets ?? [];
    let bestSet = null;
    let bestE1rm = 0;
    for (const s of sets) {
      if (s?.completed === false) continue;
      const setWeight = s.load ?? s.weightKg ?? s.actualWeightKg;
      const setReps = s.reps;
      const setRir = s.rir ?? s.rirReported ?? 2;
      const setE1rm = estimateE1RMWithRIR(setWeight, setReps, setRir);
      if (setE1rm && setE1rm > bestE1rm) {
        bestE1rm = setE1rm;
        bestSet = { weightKg: setWeight, reps: setReps, rir: setRir };
      }
    }

    const weight = bestSet?.weightKg ?? ex.actualWeightKg ?? ex.prescribedLoadKg ?? ex.load;
    const reps = bestSet?.reps ?? ex.actualReps ?? ex.reps;
    const rir = bestSet?.rir ?? ex.actualRIR ?? ex.rirReported ?? ex.rir ?? 2;
    // Always recompute with capped-rep e1RM; ignore stale inflated ex.e1RM from clients.
    const e1RM = estimateE1RMWithRIR(weight, reps, rir);
    if (!e1RM || !weight) continue;

    const movementPattern = ex.movementPattern ?? ex.patronMovimiento ?? 'General';
    const priority = ex.priority ?? ex.prioridad ?? 2;
    const tier = priority === 1 ? 'basic' : 'accessory';
    const loadConvention =
      ex.loadConvention
      ?? resolveLoadConvention({
        exerciseId,
        exerciseName: ex.exerciseName ?? ex.nombre,
        equipo: ex.equipo,
        isUnilateral: ex.isUnilateral,
        isBodyweight: ex.isBodyweight,
        loadMode: ex.loadMode,
      });

    const prev = next.byExerciseId[exerciseId];
    const previousE1RM = prev?.e1RM ?? null;

    next.byExerciseId[exerciseId] = {
      exerciseId,
      exerciseName: ex.exerciseName ?? ex.nombre ?? exerciseId,
      movementPattern,
      muscleGroup: ex.muscleGroup ?? ex.parteCuerpo ?? null,
      priority,
      loadConvention,
      e1RM: Math.round(e1RM * 10) / 10,
      previousE1RM,
      lastWeightKg: weight,
      lastReps: reps,
      lastRir: rir,
      updatedAt: completedAt,
    };

    const patternKey = `${movementPattern}:${tier}`;
    const currentPattern = next.byPattern[patternKey];
    if (!currentPattern || e1RM >= (currentPattern.e1RM ?? 0)) {
      next.byPattern[patternKey] = {
        movementPattern,
        tier,
        e1RM: Math.round(e1RM * 10) / 10,
        lastWeightKg: weight,
        exerciseId,
        loadConvention,
        updatedAt: completedAt,
      };
    }
  }

  return pruneLoadPerformanceLedger(next);
}

export function pruneLoadPerformanceLedger(ledger, referenceDate = new Date()) {
  const next = normalizeLoadPerformanceLedger(ledger);

  for (const [id, entry] of Object.entries(next.byExerciseId)) {
    if (monthsBetween(entry.updatedAt, referenceDate) > LEDGER_MAX_AGE_MONTHS) {
      delete next.byExerciseId[id];
    }
  }

  for (const [key, entry] of Object.entries(next.byPattern)) {
    if (monthsBetween(entry.updatedAt, referenceDate) > LEDGER_MAX_AGE_MONTHS) {
      delete next.byPattern[key];
    }
  }

  return next;
}

/**
 * Expected strength drift when an exercise/pattern has not been trained recently
 * but the athlete kept training (novice ~2%/mo, intermediate ~1.5%, advanced ~1%).
 */
export function applyStrengthRecencyAdjustment(e1RM, monthsSinceUpdate, experienceLevel = 'Intermedio') {
  if (!e1RM || monthsSinceUpdate <= 1.5) return e1RM;
  const monthlyRate =
    experienceLevel === 'Novato' ? 0.02 : experienceLevel === 'Avanzado' ? 0.01 : 0.015;
  const cappedMonths = Math.min(monthsSinceUpdate, 6);
  return e1RM * (1 + cappedMonths * monthlyRate);
}

export function ledgerEntriesForPrescription(
  ledger,
  exerciseId,
  movementPattern,
  priority = 2,
  experienceLevel = 'Intermedio',
) {
  const store = normalizeLoadPerformanceLedger(ledger);
  const tier = priority === 1 ? 'basic' : 'accessory';
  const now = new Date();

  const exact = store.byExerciseId[exerciseId];
  if (exact?.e1RM) {
    const months = monthsBetween(exact.updatedAt, now);
    return [
      {
        weightKg: exact.lastWeightKg,
        reps: exact.lastReps,
        rir: exact.lastRir ?? 2,
        e1RM: applyStrengthRecencyAdjustment(exact.e1RM, months, experienceLevel),
        fromLedger: true,
        fromPatternFallback: false,
        loadConvention: exact.loadConvention ?? null,
        ledgerAgeMonths: months,
      },
    ];
  }

  const patternEntry = store.byPattern[`${movementPattern}:${tier}`];
  if (patternEntry?.e1RM) {
    const months = monthsBetween(patternEntry.updatedAt, now);
    return [
      {
        weightKg: patternEntry.lastWeightKg,
        reps: 8,
        rir: 2,
        e1RM: applyStrengthRecencyAdjustment(patternEntry.e1RM, months, experienceLevel),
        fromLedger: true,
        fromPatternFallback: true,
        loadConvention: patternEntry.loadConvention ?? null,
        ledgerAgeMonths: months,
      },
    ];
  }

  return [];
}
