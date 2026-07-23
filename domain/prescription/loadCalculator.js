import {
  RPE_PERCENT_TABLE,
  LOAD_LIMITS,
  EXERCISE_TYPES,
  DEFAULT_PLATE_INCREMENT_KG,
} from '../constants.js';
import { ledgerEntriesForPrescription } from '../athlete/loadPerformanceLedger.js';
import {
  resolveLoadConvention,
  convertLoadBetweenConventions,
  LOAD_CONVENTIONS,
} from './loadConvention.js';
import { snapPrescribedLoad, snapToGymWeight } from './gymInventory.js';

/**
 * Brzycki is unreliable above ~10–12 reps (Reynolds et al. 2006).
 * Cap effective reps so high-rep isolation sets cannot inflate e1RM.
 */
export const E1RM_MAX_EFFECTIVE_REPS = 12;

/** Conservative discount when transferring load across exercises of the same pattern. */
export const PATTERN_TRANSFER_E1RM_FACTOR = 0.85;

/**
 * Brzycki e1RM — DDS 5.8.
 * @param {number} weightKg
 * @param {number} reps
 * @returns {number|null}
 */
export function estimateE1RM(weightKg, reps) {
  if (!weightKg || !reps || reps < 1) return null;
  const cappedReps = Math.min(Number(reps), E1RM_MAX_EFFECTIVE_REPS);
  if (cappedReps > 10) {
    const raw = weightKg / (1.0278 - 0.0278 * cappedReps);
    return raw * 0.9;
  }
  return weightKg / (1.0278 - 0.0278 * cappedReps);
}

/**
 * Adjust e1RM for reported RIR (convert to RIR 0 equivalent).
 * @param {number} weightKg
 * @param {number} reps
 * @param {number} reportedRIR
 * @returns {number|null}
 */
export function estimateE1RMWithRIR(weightKg, reps, reportedRIR = 0) {
  const repsAtFailure = Number(reps) + (reportedRIR ?? 0);
  return estimateE1RM(weightKg, repsAtFailure);
}

/**
 * Pick the performance entry with the highest estimated e1RM.
 * @param {object[]} entries
 * @returns {object|null}
 */
export function pickBestHistoryEntry(entries = []) {
  let best = null;
  let bestE1rm = 0;
  for (const entry of entries) {
    const weight = entry.weightKg ?? entry.weight ?? entry.load ?? entry.actualWeightKg;
    const reps = entry.reps ?? entry.repsCompleted ?? entry.actualReps;
    const rir = entry.rir ?? entry.rirReported ?? entry.actualRIR ?? 0;
    const e1rm = estimateE1RMWithRIR(weight, reps, rir);
    if (e1rm && e1rm > bestE1rm) {
      bestE1rm = e1rm;
      best = { ...entry, weightKg: weight, reps, rir };
    }
  }
  return best;
}

/**
 * Build load history for an exercise: exact id first, then same pattern + tier.
 * @param {object[]} sessions — archived sessions (newest first)
 */
export function buildLoadHistoryFromSessions(
  sessions = [],
  exerciseId,
  movementPattern,
  priority = 2,
  ledger = null,
  experienceLevel = 'Intermedio',
) {
  const fromLedger = ledgerEntriesForPrescription(
    ledger,
    exerciseId,
    movementPattern,
    priority,
    experienceLevel,
  );
  if (fromLedger.length) return fromLedger;

  const rows = (sessions ?? []).flatMap((s) => {
    const block = s.mainBlock ?? s.performance ?? s.exercises ?? [];
    return Array.isArray(block) ? block : [];
  });

  const mapRow = (e) => {
    const weight = e.actualWeightKg ?? e.prescribedLoadKg ?? e.weight ?? e.load;
    const reps = e.actualReps ?? e.reps;
    const rir = e.actualRIR ?? e.rirReported ?? e.rir;
    if (weight == null || reps == null) return null;
    return {
      weightKg: weight,
      reps,
      rir: rir ?? 2,
      movementPattern: e.movementPattern ?? e.patronMovimiento,
      priority: e.priority ?? e.prioridad ?? 2,
      exerciseId: e.exerciseId ?? e.id,
      loadConvention: e.loadConvention ?? resolveLoadConvention(e),
      fromPatternFallback: e.fromPatternFallback ?? false,
    };
  };

  const sameExercise = rows
    .filter((e) => (e.exerciseId ?? e.id) === exerciseId)
    .map(mapRow)
    .filter(Boolean);
  if (sameExercise.length) return sameExercise;

  const isBasic = priority === 1;
  return rows
    .filter((e) => (e.movementPattern ?? e.patronMovimiento) === movementPattern)
    .filter((e) => {
      const p = e.priority ?? e.prioridad ?? 2;
      return isBasic ? p === 1 : p > 1;
    })
    .map((e) => {
      const mapped = mapRow(e);
      return mapped ? { ...mapped, fromPatternFallback: true } : null;
    })
    .filter(Boolean);
}

/**
 * Get %1RM from RIR using Zourdos/Helms table.
 * @param {number} rirTarget
 * @param {number} targetReps — midpoint of rep range
 * @returns {number}
 */
export function getPercent1RMFromRIR(rirTarget, targetReps) {
  const repKey = findNearestRepKey(targetReps);
  const table = RPE_PERCENT_TABLE[repKey];
  const rirIndex = Math.min(Math.max(Math.round(rirTarget), 0), 4);
  return table[rirIndex];
}

/**
 * DDS 8.7 — prescribe load from history.
 * @param {object} params
 * @param {string} params.exerciseType — 'compound'|'isolation'
 * @param {number} params.rirTarget
 * @param {string} params.repRange — e.g. "8-12"
 * @param {object[]} [params.history] — recent performance entries
 * @param {number} [params.plateIncrementKg]
 * @returns {object}
 */
export function prescribeLoad({
  exerciseType = EXERCISE_TYPES.COMPOUND,
  rirTarget,
  repRange,
  history = [],
  plateIncrementKg = DEFAULT_PLATE_INCREMENT_KG,
  bodyWeightKg,
  movementPattern,
  isBodyweight = false,
  exerciseId = '',
  exerciseName = '',
  equipo = [],
  isUnilateral = false,
  loadConvention: loadConventionInput = null,
}) {
  const targetReps = parseRepRangeMidpoint(repRange);
  const loadConvention = loadConventionInput
    ?? resolveLoadConvention({
      equipo,
      isUnilateral,
      isBodyweight,
      exerciseId,
      exerciseName,
    });

  if (isBodyweight || loadConvention === LOAD_CONVENTIONS.BODYWEIGHT) {
    return {
      mode: 'bodyweight',
      loadConvention: LOAD_CONVENTIONS.BODYWEIGHT,
      prescribedLoadKg: null,
      suggestedLoadKg: null,
      repRange,
      rirTarget,
      explanation: 'Ejercicio con peso corporal: registra repeticiones y RIR en la última serie.',
    };
  }

  if (!history.length) {
    let suggestedLoadKg = suggestExploratoryLoad(
      bodyWeightKg,
      movementPattern,
      exerciseType,
      exerciseId,
    );
    if (
      suggestedLoadKg != null
      && (loadConvention === LOAD_CONVENTIONS.DUMBBELL_PER_HAND
        || loadConvention === LOAD_CONVENTIONS.UNILATERAL)
    ) {
      suggestedLoadKg = snapToGymWeight(
        suggestedLoadKg * 0.45,
        loadConvention,
        { direction: 'nearest' },
      );
    } else if (suggestedLoadKg != null) {
      suggestedLoadKg = snapToGymWeight(suggestedLoadKg, loadConvention, { direction: 'nearest' });
    }
    const suffix = loadConvention === LOAD_CONVENTIONS.DUMBBELL_PER_HAND
      ? ' por mano'
      : loadConvention === LOAD_CONVENTIONS.UNILATERAL
        ? ' por lado'
        : '';
    return {
      mode: 'exploratory',
      loadConvention,
      prescribedLoadKg: null,
      suggestedLoadKg: suggestedLoadKg ?? null,
      repRange,
      rirTarget,
      explanation: suggestedLoadKg
        ? `Semana exploratoria: prueba ~${suggestedLoadKg} kg${suffix} como punto de partida conservador y reporta RIR real.`
        : 'Semana exploratoria: elige una carga conservadora y reporta RIR real al terminar.',
    };
  }

  const last = pickBestHistoryEntry(history);
  if (!last) {
    return {
      mode: 'exploratory',
      loadConvention,
      prescribedLoadKg: null,
      suggestedLoadKg: null,
      repRange,
      rirTarget,
      explanation: 'Historial insuficiente para calcular carga.',
    };
  }

  // Recompute e1RM with capped-rep formula even if ledger stored a stale inflated value.
  const rawWeight = last.weightKg ?? last.weight ?? 0;
  const rawReps = last.reps ?? last.repsCompleted ?? 0;
  const rawRir = last.rir ?? last.rirReported ?? 0;
  let e1rm = estimateE1RMWithRIR(rawWeight, rawReps, rawRir);
  if (e1rm == null && last.e1RM) e1rm = last.e1RM;

  if (last.fromPatternFallback && e1rm) {
    e1rm *= PATTERN_TRANSFER_E1RM_FACTOR;
  }

  const pct = getPercent1RMFromRIR(rirTarget, targetReps);
  let targetWeight = e1rm * pct;
  let previousWeight = rawWeight;
  // Missing history convention almost always means the athlete logged in the same
  // units as this exercise (per-hand / unilateral). Defaulting to barbell_total
  // incorrectly applied ×0.45 and under-prescribed dumbbell/unilateral lifts.
  const historyConvention = last.loadConvention ?? loadConvention;

  if (historyConvention !== loadConvention) {
    targetWeight = convertLoadBetweenConventions(targetWeight, historyConvention, loadConvention);
    previousWeight = convertLoadBetweenConventions(previousWeight, historyConvention, loadConvention);
  }

  targetWeight = applyLoadLimits(targetWeight, previousWeight, exerciseType, 'weekly');
  targetWeight = applyLoadLimits(targetWeight, previousWeight, exerciseType, 'session');

  const rounded = snapPrescribedLoad(targetWeight, loadConvention);
  const result = {
    mode: last.fromPatternFallback ? 'pattern_transfer' : 'calculated',
    loadConvention,
    prescribedLoadKg: rounded.weight,
    suggestedLoadKg: null,
    repRange,
    rirTarget,
    e1rm: Math.round(e1rm * 10) / 10,
    explanation: last.fromPatternFallback
      ? 'Carga estimada desde un ejercicio similar del mismo patrón (ajuste conservador −15%).'
      : 'Carga calculada desde tu e1RM y RIR objetivo de la semana.',
  };

  if (rounded.addRep) {
    result.repRange = bumpRepRange(repRange);
    result.explanation +=
      ' Incremento de equipo excede el permitido: añadimos 1 repetición al rango objetivo.';
  }

  return result;
}

/**
 * DDS 5.8 — cap weekly/session load increases.
 * @param {number} targetWeight
 * @param {number} previousWeight
 * @param {'compound'|'isolation'} exerciseType
 * @param {'weekly'|'session'} period
 * @returns {number}
 */
export function applyLoadLimits(targetWeight, previousWeight, exerciseType, period = 'weekly') {
  if (!previousWeight || previousWeight <= 0) return targetWeight;

  const limits = LOAD_LIMITS[exerciseType] ?? LOAD_LIMITS.compound;
  const maxIncrease = limits[period] ?? limits.weekly;
  const maxAllowed = previousWeight * (1 + maxIncrease);

  if (targetWeight > maxAllowed) {
    return maxAllowed;
  }
  return targetWeight;
}

function parseRepRangeMidpoint(repRange) {
  if (!repRange) return 8;
  const parts = String(repRange).split('-').map(Number);
  if (parts.length === 2) return Math.round((parts[0] + parts[1]) / 2);
  return parts[0] || 8;
}

function findNearestRepKey(targetReps) {
  const keys = Object.keys(RPE_PERCENT_TABLE).map(Number).sort((a, b) => a - b);
  let nearest = keys[0];
  for (const k of keys) {
    if (Math.abs(k - targetReps) < Math.abs(nearest - targetReps)) nearest = k;
  }
  return nearest;
}


function bumpRepRange(repRange) {
  const parts = String(repRange).split('-').map(Number);
  if (parts.length === 2) {
    return `${parts[0] + 1}-${parts[1] + 1}`;
  }
  return `${(parts[0] || 8) + 1}`;
}

function suggestExploratoryLoad(bodyWeightKg, movementPattern, exerciseType, exerciseId = '') {
  if (!bodyWeightKg || bodyWeightKg <= 0) return null;
  const patternFactors = {
    Empuje_H: 0.35,
    Empuje_V: 0.25,
    Traccion_H: 0.4,
    Traccion_V: 0.3,
    Rodilla: 0.5,
    Cadera: 0.45,
    Core: 0.1,
    General: 0.2,
  };
  const factor = patternFactors[movementPattern] ?? (exerciseType === EXERCISE_TYPES.COMPOUND ? 0.35 : 0.15);
  let variance = 1;
  if (exerciseId) {
    let hash = 0;
    for (const ch of exerciseId) hash = (hash + ch.charCodeAt(0)) % 11;
    variance = 1 + (hash - 5) * 0.04;
  }
  const raw = bodyWeightKg * factor * variance;
  return snapToGymWeight(raw, LOAD_CONVENTIONS.BARBELL_TOTAL, { direction: 'nearest' });
}
