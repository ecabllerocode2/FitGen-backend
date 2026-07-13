const BODYWEIGHT_SUBTIPOS = new Set(['pushup', 'incline_pushup']);

function hasBodyweightEquipo(exercise) {
  const equipo = exercise?.equipo ?? [];
  const arr = Array.isArray(equipo) ? equipo : [equipo].filter(Boolean);
  return arr.some((e) => /peso corporal|bodyweight|corporal/i.test(String(e)));
}

function hasBodyweightSubtype(exercise) {
  const subtype = exercise?.subtipoEstimulo;
  return Boolean(subtype && BODYWEIGHT_SUBTIPOS.has(subtype));
}

/**
 * Detect bodyweight exercises from catalog fields, persisted flags, or catalog lookup.
 * @param {object} exercise
 * @param {object[]} [catalog]
 * @returns {boolean}
 */
export function isBodyweightExercise(exercise, catalog = null) {
  if (!exercise) return false;
  if (hasBodyweightEquipo(exercise)) return true;
  if (exercise.loadMode === 'bodyweight' || exercise.isBodyweight === true) return true;
  if (hasBodyweightSubtype(exercise)) return true;

  const id = exercise.id ?? exercise.exerciseId;
  if (!id || !catalog?.length) return false;

  const catalogEntry = catalog.find((entry) => entry.id === id);
  if (!catalogEntry || catalogEntry === exercise) return false;

  if (hasBodyweightEquipo(catalogEntry)) return true;
  if (hasBodyweightSubtype(catalogEntry)) return true;
  return false;
}

/**
 * Bodyweight movements are only auto-selected when the same muscle already has
 * a loadable (weighted) exercise in the session — e.g. push-ups after bench press.
 * @param {object} exercise
 * @param {object[]} selected
 * @param {object[]} [catalog]
 * @returns {boolean}
 */
export function passesBodyweightLoadFilter(exercise, selected, catalog = null) {
  if (!isBodyweightExercise(exercise, catalog)) return true;

  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  return selected.some(
    (e) =>
      (e.parteCuerpo ?? e.muscleGroup) === muscle &&
      !isBodyweightExercise(e, catalog),
  );
}
