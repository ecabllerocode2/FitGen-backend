import { EXERCISE_TYPES } from '../constants.js';

/**
 * DDS 5.6 — order exercises by goal.
 * Fuerza: priority lift first, then accessories.
 * Hipertrofia: compound → accessory → isolation (practical, not hypertrophy superiority).
 *
 * @param {object[]} exercises
 * @param {'Hipertrofia'|'Fuerza'} goal
 * @param {string} [priorityLiftId] — exercise id for strength focus
 * @returns {object[]}
 */
export function orderByGoal(exercises, goal, priorityLiftId = null) {
  const list = [...exercises];

  if (goal === 'Fuerza') {
    return list.sort((a, b) => {
      if (priorityLiftId) {
        if (a.id === priorityLiftId) return -1;
        if (b.id === priorityLiftId) return 1;
      }
      const aPriority = a.prioridad ?? 3;
      const bPriority = b.prioridad ?? 3;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return classifyExercise(a) === EXERCISE_TYPES.COMPOUND ? -1 : 1;
    });
  }

  return list.sort((a, b) => {
    const order = { compound: 0, accessory: 1, isolation: 2 };
    const aClass = classifyExercise(a);
    const bClass = classifyExercise(b);
    if (order[aClass] !== order[bClass]) return order[aClass] - order[bClass];
    return (a.prioridad ?? 3) - (b.prioridad ?? 3);
  });
}

/**
 * @param {object} exercise
 * @returns {'compound'|'accessory'|'isolation'}
 */
function classifyExercise(exercise) {
  const priority = exercise.prioridad ?? 3;
  if (priority === 1) return EXERCISE_TYPES.COMPOUND;
  if (priority === 2) return 'accessory';
  return EXERCISE_TYPES.ISOLATION;
}
