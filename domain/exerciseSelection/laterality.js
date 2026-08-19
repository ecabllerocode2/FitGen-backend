/**
 * True unilateral = one limb works while the other rests for the whole set.
 * Alternating curls/presses load both sides in the same set (left-right-left…).
 */
const TRUE_UNILATERAL_RE =
  /\b(unilateral|una mano|un brazo|una pierna|a un brazo|a una pierna|single[-_ ]arm|one[-_ ]arm|single[-_ ]leg|one[-_ ]leg)\b/i;

const ALTERNATING_RE = /alternat(?:e|ing)|altern[oa]s?\b|alternate[_-]/i;

function lateralityHaystack(exercise = {}) {
  return `${exercise.exerciseName ?? exercise.nombre ?? exercise.name ?? ''} ${exercise.exerciseId ?? exercise.id ?? ''}`;
}

export function isAlternatingBilateralExercise(exercise = {}) {
  const haystack = lateralityHaystack(exercise);
  if (!ALTERNATING_RE.test(haystack)) return false;
  if (TRUE_UNILATERAL_RE.test(haystack)) return false;
  return true;
}

export function resolveIsUnilateral(exercise = {}) {
  if (isAlternatingBilateralExercise(exercise)) return false;
  return exercise.isUnilateral === true;
}
