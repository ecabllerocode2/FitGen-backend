import { DEFAULT_PLATE_INCREMENT_KG } from '../constants.js';
import { resolveIsUnilateral } from '../exerciseSelection/laterality.js';

export const LOAD_CONVENTIONS = {
  BARBELL_TOTAL: 'barbell_total',
  DUMBBELL_PER_HAND: 'dumbbell_per_hand',
  UNILATERAL: 'unilateral',
  MACHINE_STACK: 'machine_stack',
  BODYWEIGHT: 'bodyweight',
};

function normalizeEquipo(equipo) {
  if (!equipo) return [];
  return (Array.isArray(equipo) ? equipo : [equipo]).map((item) => String(item).trim()).filter(Boolean);
}

/**
 * Fallback when catalog fields are missing from persisted session rows.
 * @param {object} exercise
 * @returns {string|null}
 */
function isSingleImplementHeldWithBothHands(haystack) {
  // `\b` fails on Goblet_Squat because `_` is a word character.
  return /goblet|plie|plié|vertical[_\s-]?swing|swing vertical/i.test(haystack);
}

function inferConventionFromMetadata(exercise = {}) {
  const nombre = String(exercise.exerciseName ?? exercise.nombre ?? exercise.name ?? '');
  const exerciseId = String(exercise.exerciseId ?? exercise.id ?? '');
  const haystack = `${nombre} ${exerciseId}`;

  if (isSingleImplementHeldWithBothHands(haystack)) {
    return LOAD_CONVENTIONS.BARBELL_TOTAL;
  }

  if (/\b(unilateral|una mano|un brazo|una pierna|single[-_ ]arm|one[-_ ]arm|single[-_ ]leg|one[-_ ]leg)\b/i.test(haystack)) {
    return LOAD_CONVENTIONS.UNILATERAL;
  }

  // Bilateral dumbbells: plural name or dumbbell_* exercise id.
  if (/\bmancuernas\b|\bdumbbells\b/i.test(haystack) || /dumbbell_/i.test(exerciseId)) {
    return LOAD_CONVENTIONS.DUMBBELL_PER_HAND;
  }

  // Common DB isolation patterns whose id/name omit "dumbbell" (e.g. Seated_Side_Lateral_Raise).
  if (
    /lateral[_\s-]?raise|elevaci[oó]n\s+lateral|side[_\s-]?lateral/i.test(haystack)
    && !/cable|polea|band|banda|machine|m[aá]quina/i.test(haystack)
  ) {
    return LOAD_CONVENTIONS.DUMBBELL_PER_HAND;
  }

  if (/\bmancuerna\b|\bdumbbell\b|\bkettlebell\b/i.test(haystack)) {
    return resolveIsUnilateral(exercise)
      ? LOAD_CONVENTIONS.UNILATERAL
      : LOAD_CONVENTIONS.DUMBBELL_PER_HAND;
  }

  if (/\bbarra\b|\bbarbell\b/i.test(haystack)) {
    return LOAD_CONVENTIONS.BARBELL_TOTAL;
  }

  if (/\bmáquina\b|\bmaquina\b|\bpolea\b|\bcable\b/i.test(haystack)) {
    return LOAD_CONVENTIONS.MACHINE_STACK;
  }

  return null;
}

/**
 * Infer how prescribed/logged load should be interpreted for an exercise.
 * @param {object} exercise
 * @returns {string}
 */
export function resolveLoadConvention(exercise = {}) {
  const nameHaystack = `${exercise.exerciseName ?? exercise.nombre ?? exercise.name ?? ''} ${exercise.exerciseId ?? exercise.id ?? ''}`;
  const isSingleImplementDb = isSingleImplementHeldWithBothHands(nameHaystack);
  const isUnilateral = resolveIsUnilateral(exercise);

  if (exercise.loadConvention && Object.values(LOAD_CONVENTIONS).includes(exercise.loadConvention)) {
    const stored = exercise.loadConvention;
    // Repair stale barbell_total on clear dumbbell-only catalog rows (e.g. lateral raise).
    if (stored === LOAD_CONVENTIONS.BARBELL_TOTAL) {
      const equipo = normalizeEquipo(exercise.equipo).join(' ').toLowerCase();
      const isDumbbellOnly = /mancuerna|dumbbell|kettlebell/i.test(equipo)
        && !/barra|barbell|smith/i.test(equipo);
      if (isDumbbellOnly || inferConventionFromMetadata(exercise) === LOAD_CONVENTIONS.DUMBBELL_PER_HAND) {
        if (isSingleImplementDb) return LOAD_CONVENTIONS.BARBELL_TOTAL;
        if (isUnilateral) return LOAD_CONVENTIONS.UNILATERAL;
        return LOAD_CONVENTIONS.DUMBBELL_PER_HAND;
      }
    }
    // Repair stale per-hand on single-implement swings/goblets.
    if (stored === LOAD_CONVENTIONS.DUMBBELL_PER_HAND && isSingleImplementDb) {
      return LOAD_CONVENTIONS.BARBELL_TOTAL;
    }
    if (stored === LOAD_CONVENTIONS.UNILATERAL && isSingleImplementDb) {
      return LOAD_CONVENTIONS.BARBELL_TOTAL;
    }
    if (stored === LOAD_CONVENTIONS.UNILATERAL && !isUnilateral) {
      // Alternate curls: catalog/session marked unilateral but both sides work in one set.
    } else {
      return stored;
    }
  }
  if (exercise.loadMode === 'bodyweight' || exercise.isBodyweight === true) {
    return LOAD_CONVENTIONS.BODYWEIGHT;
  }

  const equipo = normalizeEquipo(exercise.equipo);
  const joined = equipo.join(' ').toLowerCase();

  if (/peso corporal|bodyweight|corporal/i.test(joined)) {
    return LOAD_CONVENTIONS.BODYWEIGHT;
  }

  const isDumbbellLike = /mancuerna|dumbbell|kettlebell|kettelbell/i.test(joined);
  const isBarbellLike = /barra|barbell|smith/i.test(joined);
  const isMachineLike = /máquina|maquina|polea|cable|selectorizado|stack|máquina de palancas/i.test(joined)
    || /máquina|maquina/i.test(nameHaystack);

  // Machine stack wins over catalog isUnilateral (e.g. iso-lateral row machines log pin weight,
  // not per-hand dumbbell load — treating them as unilateral under-prescribes by ~55%).
  if (isMachineLike && !isBarbellLike && !isDumbbellLike) {
    return LOAD_CONVENTIONS.MACHINE_STACK;
  }

  if (isUnilateral) {
    return LOAD_CONVENTIONS.UNILATERAL;
  }

  const inferredUnilateral = inferConventionFromMetadata(exercise);
  if (inferredUnilateral === LOAD_CONVENTIONS.UNILATERAL) {
    return LOAD_CONVENTIONS.UNILATERAL;
  }

  if (isDumbbellLike && !isBarbellLike) {
    // Single DB held with both hands → total load, not per-hand.
    if (isSingleImplementDb) return LOAD_CONVENTIONS.BARBELL_TOTAL;
    return LOAD_CONVENTIONS.DUMBBELL_PER_HAND;
  }
  if (isBarbellLike) {
    return LOAD_CONVENTIONS.BARBELL_TOTAL;
  }
  if (isDumbbellLike) {
    if (isSingleImplementDb) return LOAD_CONVENTIONS.BARBELL_TOTAL;
    return LOAD_CONVENTIONS.DUMBBELL_PER_HAND;
  }

  const inferred = inferConventionFromMetadata(exercise);
  if (inferred) return inferred;

  return LOAD_CONVENTIONS.BARBELL_TOTAL;
}

/**
 * Adaptive plate increment for the load convention.
 * Dumbbells: 1 kg per hand below 20 kg, else 2.5 kg per hand.
 * @param {string} convention
 * @param {number} [weightKg]
 * @returns {number}
 */
export function getPlateIncrementForConvention(convention, weightKg = 0) {
  if (
    convention === LOAD_CONVENTIONS.DUMBBELL_PER_HAND
    || convention === LOAD_CONVENTIONS.UNILATERAL
  ) {
    return weightKg < 20 ? 1 : 2.5;
  }
  return DEFAULT_PLATE_INCREMENT_KG;
}

/**
 * Convert a total/barbell-style load into per-hand when switching conventions.
 * @param {number} weightKg
 * @param {string} fromConvention
 * @param {string} toConvention
 * @returns {number}
 */
export function convertLoadBetweenConventions(weightKg, fromConvention, toConvention) {
  if (!weightKg || fromConvention === toConvention) return weightKg;

  const toPerHand = toConvention === LOAD_CONVENTIONS.DUMBBELL_PER_HAND
    || toConvention === LOAD_CONVENTIONS.UNILATERAL;
  const fromPerHand = fromConvention === LOAD_CONVENTIONS.DUMBBELL_PER_HAND
    || fromConvention === LOAD_CONVENTIONS.UNILATERAL;

  if (!fromPerHand && toPerHand) {
    return weightKg * 0.45;
  }
  if (fromPerHand && !toPerHand) {
    return weightKg * 2;
  }
  return weightKg;
}
