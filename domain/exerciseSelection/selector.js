import { SESSION_FOCUS_PATTERN_MAP } from '../constants.js';
import { detectPlateau, getIntervention } from '../progression/plateau.js';

const AXIAL_PATTERNS = new Set(['Empuje_H', 'Cadera']);

/**
 * DDS 8.4 — select exercises for a session.
 * @param {string} sessionFocus
 * @param {object[]} catalog — items from catalogs/entrenamiento
 * @param {object} safetyProfile — from buildSafetyProfile
 * @param {object[]} [history] — recent sessions for continuity
 * @param {'Hipertrofia'|'Fuerza'} goal
 * @param {object} [options]
 * @param {number} [options.maxPerPattern=2]
 * @param {number} [options.weekNumber=1]
 * @returns {object[]}
 */
export function selectExercises(
  sessionFocus,
  catalog,
  safetyProfile,
  history = [],
  goal,
  options = {},
) {
  const { maxPerPattern = 2, excludeIds = [], weekNumber = 1, sessionMuscles = [] } = options;
  const excludeSet = new Set(excludeIds);
  const requiredPatterns =
    SESSION_FOCUS_PATTERN_MAP[sessionFocus] ??
    inferPatternsFromFocus(sessionFocus);

  const avoidPatterns = new Set(safetyProfile?.avoidPatterns ?? []);
  const modifyPatterns = new Set(safetyProfile?.modifyPatterns ?? []);

  const continuityExercises = getContinuityExercises(history, sessionFocus);

  const selected = [];
  const usedIds = new Set();

  for (const pattern of requiredPatterns) {
    if (avoidPatterns.has(pattern)) continue;

    const continuity = continuityExercises.filter(
      (e) => e.patronMovimiento === pattern,
    );
    const resolvedContinuity = resolveContinuityWithPlateau(
      continuity,
      catalog,
      history,
      safetyProfile,
      weekNumber,
      excludeSet,
      pattern,
    );

    if (resolvedContinuity.length) {
      for (const ex of resolvedContinuity.slice(0, maxPerPattern)) {
        if (!usedIds.has(ex.id)) {
          selected.push({ ...ex, fromContinuity: true });
          usedIds.add(ex.id);
        }
      }
      continue;
    }

    const candidates = catalog
      .filter((ex) => ex.patronMovimiento === pattern)
      .filter((ex) => !excludeSet.has(ex.id))
      .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
      .filter((ex) => isGymExercise(ex))
      .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
      .sort((a, b) => {
        const priorityDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
        if (priorityDiff !== 0) return priorityDiff;
        if (modifyPatterns.has(pattern) && safetyProfile?.conservative) {
          return prefersMachine(a, b);
        }
        return 0;
      });

    for (const ex of candidates.slice(0, maxPerPattern)) {
      if (!usedIds.has(ex.id)) {
        selected.push({ ...ex, fromContinuity: false });
        usedIds.add(ex.id);
      }
    }
  }

  fillAccessoryMuscles(selected, usedIds, sessionMuscles, catalog, safetyProfile, weekNumber, excludeSet, avoidPatterns);

  return selected;
}

/**
 * Ensure each muscle in the session plan has at least one direct exercise
 * (e.g. Tríceps on push day, Bíceps on pull day, Glúteos on leg day).
 */
function fillAccessoryMuscles(
  selected,
  usedIds,
  sessionMuscles,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
) {
  for (const muscle of sessionMuscles) {
    const covered = selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle);
    if (covered) continue;

    const candidates = catalog
      .filter((ex) => ex.parteCuerpo === muscle)
      .filter((ex) => !excludeSet.has(ex.id))
      .filter((ex) => !usedIds.has(ex.id))
      .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
      .filter((ex) => isGymExercise(ex))
      .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
      .sort((a, b) => {
        const priorityDiff = (b.prioridad ?? 3) - (a.prioridad ?? 3);
        if (priorityDiff !== 0) return priorityDiff;
        return (a.nombre ?? '').localeCompare(b.nombre ?? '');
      });

    const pick = candidates[0];
    if (pick) {
      selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
      usedIds.add(pick.id);
    }
  }
}

function resolveContinuityWithPlateau(
  continuity,
  catalog,
  history,
  safetyProfile,
  weekNumber,
  excludeSet,
  pattern,
) {
  const resolved = [];

  for (const ex of continuity) {
    const exHistory = extractExerciseHistory(history, ex.id);
    const plateau = detectPlateau(exHistory);

    if (!plateau.isPlateau) {
      if (passesConservativeFilter(ex, safetyProfile, weekNumber)) {
        resolved.push(ex);
      }
      continue;
    }

    const intervention = getIntervention(ex, plateau, {
      repRangeChanged: Boolean(ex.repRangeOverride ?? ex.plateauRepRangeChanged),
      variantSwapped: Boolean(ex.swappedFromPlateau),
    });

    if (intervention.type === 'change_rep_range') {
      const shifted = shiftRepRange(ex.repRangeOverride ?? '8-12');
      resolved.push({
        ...ex,
        repRangeOverride: shifted,
        plateauRepRangeChanged: true,
        plateauIntervention: 'change_rep_range',
        fromContinuity: true,
      });
      continue;
    }

    if (intervention.type === 'swap_variant') {
      const replacement = findVariantReplacement(
        catalog,
        ex,
        safetyProfile,
        weekNumber,
        excludeSet,
        pattern,
      );
      if (replacement) {
        resolved.push({ ...replacement, fromContinuity: false, swappedFromPlateau: ex.id });
      }
    }
  }

  return resolved;
}

function findVariantReplacement(catalog, exercise, safetyProfile, weekNumber, excludeSet, pattern) {
  return catalog.find(
    (candidate) =>
      candidate.id !== exercise.id &&
      !excludeSet.has(candidate.id) &&
      candidate.patronMovimiento === (exercise.patronMovimiento ?? pattern) &&
      candidate.parteCuerpo === exercise.parteCuerpo &&
      isGymExercise(candidate) &&
      passesConservativeFilter(candidate, safetyProfile, weekNumber),
  );
}

function extractExerciseHistory(history, exerciseId) {
  return (history ?? [])
    .flatMap((session) => session.performance ?? session.mainBlock ?? [])
    .filter((entry) => (entry.exerciseId ?? entry.id) === exerciseId)
    .map((entry) => ({
      weightKg: entry.actualWeightKg ?? entry.prescribedLoadKg ?? entry.weight,
      reps: entry.actualReps ?? entry.reps,
      rir: entry.actualRIR ?? entry.rirReported ?? entry.rir,
    }));
}

function isAxialFreeWeight(exercise) {
  const pattern = exercise.patronMovimiento;
  const equipo = Array.isArray(exercise.equipo) ? exercise.equipo : [exercise.equipo];
  const hasFreeWeight = equipo.some((e) =>
    /barra olímpica|rack de potencia/i.test(String(e)),
  );
  if (!hasFreeWeight || hasMachineEquipment(exercise)) return false;
  return AXIAL_PATTERNS.has(pattern) || pattern === 'Rodilla';
}

function passesConservativeFilter(exercise, safetyProfile, weekNumber) {
  if (!safetyProfile?.conservative || weekNumber > 2) return true;
  if (isAxialFreeWeight(exercise)) return false;
  return true;
}

function inferPatternsFromFocus(sessionFocus) {
  const lower = sessionFocus.toLowerCase();
  if (lower.includes('empuje') || lower.includes('push')) return ['Empuje_H', 'Empuje_V'];
  if (lower.includes('tracción') || lower.includes('traccion') || lower.includes('pull')) {
    return ['Traccion_H', 'Traccion_V'];
  }
  if (lower.includes('pierna') || lower.includes('leg') || lower.includes('lower')) {
    return ['Rodilla', 'Cadera'];
  }
  return ['General'];
}

function getContinuityExercises(history, sessionFocus) {
  if (!history?.length) return [];
  const anchorSession =
    history.find(
      (s) => s.sessionFocus === sessionFocus && s.weekNumber === 1 && s.mainBlock?.length,
    ) ??
    history.find((s) => s.sessionFocus === sessionFocus && s.mainBlock?.length);
  if (!anchorSession) return [];
  return anchorSession.mainBlock.map((block) => ({
    id: block.exerciseId,
    nombre: block.exerciseName,
    patronMovimiento: block.movementPattern,
    parteCuerpo: block.muscleGroup,
    prioridad: block.priority ?? 2,
    equipo: block.equipo ?? [],
    repRangeOverride: block.repRangeOverride ?? null,
    plateauRepRangeChanged: block.plateauRepRangeChanged ?? false,
    swappedFromPlateau: block.swappedFrom ?? null,
  }));
}

function shiftRepRange(repRange) {
  const parts = String(repRange).split('-').map(Number);
  if (parts.length === 2) {
    return `${parts[0] + 2}-${parts[1] + 3}`;
  }
  return `${(parts[0] || 8) + 2}-${(parts[0] || 8) + 5}`;
}

function isGymExercise(exercise) {
  const block = exercise.categoriaBloque;
  return block === 'main_block' || block === 'core';
}

function prefersMachine(a, b) {
  const aMachine = hasMachineEquipment(a);
  const bMachine = hasMachineEquipment(b);
  if (aMachine && !bMachine) return -1;
  if (!aMachine && bMachine) return 1;
  return 0;
}

function hasMachineEquipment(exercise) {
  const equipo = exercise.equipo ?? [];
  const arr = Array.isArray(equipo) ? equipo : [equipo];
  return arr.some((e) =>
    /máquina|maquina|selectorizada|polea|smith|prensa/i.test(String(e)),
  );
}
