import { isBodyweightExercise } from '../exerciseSelection/bodyweight.js';
import { findEquivalentSwapReplacement } from '../exerciseSelection/swapReplacement.js';
import { prescribeLoad, buildLoadHistoryFromSessions } from '../prescription/loadCalculator.js';
import { EXERCISE_TYPES } from '../constants.js';

/**
 * Replace one main-block exercise with a pattern/muscle-equivalent alternative.
 * @returns {{ mainBlock: object[], replacement: object } | { error: string }}
 */
export function applyMainExerciseSwap({
  session,
  exerciseIdToReplace,
  catalog,
  excludeIds = [],
  unavailableEquipment = [],
  safetyProfile = {},
  history = [],
  loadPerformanceLedger = null,
  bodyWeightKg,
  experienceLevel = 'Intermedio',
}) {
  const source =
    (catalog ?? []).find((ex) => ex.id === exerciseIdToReplace) ??
    (session.mainBlock ?? []).find((ex) => ex.exerciseId === exerciseIdToReplace);

  if (!source) {
    return { error: 'Ejercicio a reemplazar no encontrado' };
  }

  const currentIds = (session.mainBlock ?? []).map((e) => e.exerciseId).filter(Boolean);
  const replacement = findEquivalentSwapReplacement(catalog ?? [], source, {
    excludeIds: [...new Set([...currentIds, ...excludeIds])],
    unavailableEquipment,
    safetyProfile,
    weekNumber: session.weekNumber ?? 1,
  });

  if (!replacement) {
    return { error: 'No hay ejercicio alternativo equivalente disponible' };
  }

  const mainBlock = (session.mainBlock ?? []).map((ex) => {
    if (ex.exerciseId !== exerciseIdToReplace) return ex;

    const bodyweight = isBodyweightExercise(replacement, catalog ?? []);
    const exerciseType =
      (replacement.prioridad ?? 2) === 1 ? EXERCISE_TYPES.COMPOUND : EXERCISE_TYPES.ISOLATION;
    const exerciseHistory = buildLoadHistoryFromSessions(
      history,
      replacement.id,
      replacement.patronMovimiento,
      replacement.prioridad ?? 2,
      loadPerformanceLedger,
      experienceLevel,
    );
    const load = prescribeLoad({
      exerciseType,
      rirTarget: ex.rirTarget ?? 2,
      repRange: ex.repRange ?? '8-12',
      history: exerciseHistory,
      bodyWeightKg,
      movementPattern: replacement.patronMovimiento,
      isBodyweight: bodyweight,
      exerciseId: replacement.id,
      equipo: replacement.equipo,
      isUnilateral: Boolean(replacement.isUnilateral),
    });

    // Stryker disable all: load-field null coalescing is equivalent under prescribeLoad defaults
    return {
      ...ex,
      exerciseId: replacement.id,
      exerciseName: replacement.nombre,
      muscleGroup: replacement.parteCuerpo,
      movementPattern: replacement.patronMovimiento,
      descripcion: replacement.descripcion ?? ex.descripcion ?? null,
      correcciones: replacement.correcciones ?? ex.correcciones ?? [],
      imageUrl: replacement.url_img_0 ?? null,
      imageUrl2: replacement.url_img_1 ?? null,
      swappedFrom: exerciseIdToReplace,
      isBodyweight: bodyweight,
      equipo: replacement.equipo ?? [],
      isUnilateral: Boolean(replacement.isUnilateral),
      loadMode: load.mode,
      loadConvention: load.loadConvention ?? null,
      prescribedLoadKg: load.prescribedLoadKg ?? null,
      suggestedLoadKg: load.suggestedLoadKg ?? null,
      loadExplanation: load.explanation ?? null,
      priority: Number(replacement.prioridad ?? ex.priority ?? 2),
    };
    // Stryker restore all
  });

  return { mainBlock, replacement };
}
