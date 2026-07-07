import { estimateE1RMWithRIR } from '../prescription/loadCalculator.js';

const PLATEAU_SESSION_WINDOW = 6;
const PLATEAU_THRESHOLD = 4;

/**
 * DDS 8.9 — detect plateau in last 6 sessions of same exercise.
 * @param {object[]} history — chronological, newest first
 * @returns {{ isPlateau: boolean, stagnantSessions: number, totalSessions: number }}
 */
export function detectPlateau(history) {
  const recent = (history ?? []).slice(0, PLATEAU_SESSION_WINDOW);
  if (recent.length < PLATEAU_SESSION_WINDOW) {
    return { isPlateau: false, stagnantSessions: 0, totalSessions: recent.length };
  }

  let stagnant = 0;
  let previousE1RM = null;

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const entry = recent[i];
    const e1rm = estimateE1RMWithRIR(
      entry.weightKg ?? entry.weight ?? 0,
      entry.reps ?? entry.repsCompleted ?? 0,
      entry.rir ?? entry.rirReported ?? 0,
    );

    if (e1rm == null) continue;

    if (previousE1RM != null && e1rm <= previousE1RM) {
      stagnant += 1;
    }
    previousE1RM = e1rm;
  }

  return {
    isPlateau: stagnant >= PLATEAU_THRESHOLD,
    stagnantSessions: stagnant,
    totalSessions: recent.length,
  };
}

/**
 * DDS 8.9 — intervention priority for plateaued exercise.
 * @param {object} exercise
 * @param {object} plateauState — from detectPlateau
 * @param {object} [interventionHistory]
 * @returns {{ type: string, description: string }}
 */
export function getIntervention(exercise, plateauState, interventionHistory = {}) {
  if (!plateauState?.isPlateau) {
    return { type: 'none', description: 'Sin intervención necesaria' };
  }

  if (!interventionHistory.repRangeChanged) {
    return {
      type: 'change_rep_range',
      description:
        'Cambiar rango de repeticiones (ej. 8-12 → 12-15) manteniendo patrón y músculo',
      exerciseId: exercise.id ?? exercise.exerciseId,
    };
  }

  if (!interventionHistory.variantSwapped) {
    return {
      type: 'swap_variant',
      description:
        'Sustituir por variante biomecánicamente similar del catálogo',
      pattern: exercise.patronMovimiento ?? exercise.movementPattern,
      muscle: exercise.parteCuerpo ?? exercise.muscleGroup,
    };
  }

  return {
    type: 'volume_emphasis_next_mesocycle',
    description:
      'Marcar músculo para mayor énfasis de volumen en el próximo mesociclo',
    muscle: exercise.parteCuerpo ?? exercise.muscleGroup,
  };
}
