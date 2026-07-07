import { SESSION_FOCUS_PATTERN_MAP } from '../constants.js';

/**
 * DDS 8.4 — select exercises for a session.
 * @param {string} sessionFocus
 * @param {object[]} catalog — items from catalogs/entrenamiento
 * @param {object} safetyProfile — from buildSafetyProfile
 * @param {object[]} [history] — recent sessions for continuity
 * @param {'Hipertrofia'|'Fuerza'} goal
 * @param {object} [options]
 * @param {number} [options.maxPerPattern=2]
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
  const { maxPerPattern = 2, excludeIds = [] } = options;
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
    if (continuity.length) {
      for (const ex of continuity.slice(0, maxPerPattern)) {
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

  return selected;
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
  const lastSession = history.find(
    (s) => s.sessionFocus === sessionFocus && s.mainBlock?.length,
  );
  if (!lastSession) return [];
  return lastSession.mainBlock.map((block) => ({
    id: block.exerciseId,
    nombre: block.exerciseName,
    patronMovimiento: block.movementPattern,
    parteCuerpo: block.muscleGroup,
    prioridad: block.priority ?? 2,
  }));
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
    /máquina|maquina|selectorizada|polea|smith/i.test(String(e)),
  );
}
