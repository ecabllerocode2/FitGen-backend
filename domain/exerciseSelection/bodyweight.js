/**
 * Detect bodyweight-only exercises from catalog fields.
 * @param {object} exercise
 * @returns {boolean}
 */
export function isBodyweightExercise(exercise) {
  const equipo = exercise?.equipo ?? [];
  const arr = Array.isArray(equipo) ? equipo : [equipo].filter(Boolean);
  if (
    arr.some((e) =>
      /peso corporal|bodyweight|corporal/i.test(String(e)),
    )
  ) {
    return true;
  }
  if (exercise?.loadMode === 'bodyweight') return true;
  return false;
}

/**
 * Bodyweight movements are only auto-selected when the same muscle already has
 * a loadable (weighted) exercise in the session — e.g. push-ups after bench press.
 * @param {object} exercise
 * @param {object[]} selected
 * @returns {boolean}
 */
export function passesBodyweightLoadFilter(exercise, selected) {
  if (!isBodyweightExercise(exercise)) return true;

  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  return selected.some(
    (e) =>
      (e.parteCuerpo ?? e.muscleGroup) === muscle && !isBodyweightExercise(e),
  );
}
