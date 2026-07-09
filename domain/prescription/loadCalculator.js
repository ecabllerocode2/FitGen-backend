import {
  RPE_PERCENT_TABLE,
  LOAD_LIMITS,
  EXERCISE_TYPES,
  DEFAULT_PLATE_INCREMENT_KG,
} from '../constants.js';

/**
 * Brzycki e1RM — DDS 5.8.
 * @param {number} weightKg
 * @param {number} reps
 * @returns {number|null}
 */
export function estimateE1RM(weightKg, reps) {
  if (!weightKg || !reps || reps < 1) return null;
  if (reps > 10) {
    const raw = weightKg / (1.0278 - 0.0278 * reps);
    return raw * 0.9;
  }
  return weightKg / (1.0278 - 0.0278 * reps);
}

/**
 * Adjust e1RM for reported RIR (convert to RIR 0 equivalent).
 * @param {number} weightKg
 * @param {number} reps
 * @param {number} reportedRIR
 * @returns {number|null}
 */
export function estimateE1RMWithRIR(weightKg, reps, reportedRIR = 0) {
  const repsAtFailure = reps + (reportedRIR ?? 0);
  return estimateE1RM(weightKg, repsAtFailure);
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
}) {
  const targetReps = parseRepRangeMidpoint(repRange);

  if (!history.length) {
    const suggestedLoadKg = suggestExploratoryLoad(bodyWeightKg, movementPattern, exerciseType);
    return {
      mode: 'exploratory',
      prescribedLoadKg: null,
      suggestedLoadKg,
      repRange,
      rirTarget,
      explanation: suggestedLoadKg
        ? `Semana exploratoria: prueba ~${suggestedLoadKg} kg como punto de partida conservador y reporta RIR real.`
        : 'Semana exploratoria: elige una carga conservadora y reporta RIR real al terminar.',
    };
  }

  const last = history[0];
  const e1rm = estimateE1RMWithRIR(
    last.weightKg ?? last.weight ?? 0,
    last.reps ?? last.repsCompleted ?? 0,
    last.rir ?? last.rirReported ?? 0,
  );

  if (!e1rm) {
    return {
      mode: 'exploratory',
      prescribedLoadKg: null,
      repRange,
      rirTarget,
      explanation: 'Historial insuficiente para calcular carga.',
    };
  }

  const pct = getPercent1RMFromRIR(rirTarget, targetReps);
  let targetWeight = e1rm * pct;
  const previousWeight = last.weightKg ?? last.weight ?? 0;

  targetWeight = applyLoadLimits(targetWeight, previousWeight, exerciseType, 'weekly');
  targetWeight = applyLoadLimits(targetWeight, previousWeight, exerciseType, 'session');

  const rounded = roundDownToIncrement(targetWeight, plateIncrementKg);
  const result = {
    mode: 'calculated',
    prescribedLoadKg: rounded.weight,
    repRange,
    rirTarget,
    e1rm: Math.round(e1rm * 10) / 10,
    explanation: 'Carga calculada desde tu e1RM y RIR objetivo de la semana.',
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

function roundDownToIncrement(weight, increment) {
  if (!increment || increment <= 0) return { weight: Math.round(weight * 10) / 10, addRep: false };
  const rounded = Math.floor(weight / increment) * increment;
  const diff = weight - rounded;
  const addRep = diff > 0 && diff < increment;
  return { weight: Math.round(rounded * 100) / 100, addRep };
}

function bumpRepRange(repRange) {
  const parts = String(repRange).split('-').map(Number);
  if (parts.length === 2) {
    return `${parts[0] + 1}-${parts[1] + 1}`;
  }
  return `${(parts[0] || 8) + 1}`;
}

/** Conservative starting load as % bodyweight by movement pattern (display only). */
function suggestExploratoryLoad(bodyWeightKg, movementPattern, exerciseType) {
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
  const raw = bodyWeightKg * factor;
  return Math.round(raw / 2.5) * 2.5;
}
