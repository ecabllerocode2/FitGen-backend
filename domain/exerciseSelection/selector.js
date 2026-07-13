import { SESSION_FOCUS_PATTERN_MAP, SPLIT_VOLUME_ACCESSORY_MUSCLES } from '../constants.js';
import { detectPlateau, getIntervention } from '../progression/plateau.js';
import {
  hasDistinctStimulusForMuscle,
  pickWithStimulusDiversity,
  stimulusSelectionScore,
} from './stimulusCoverage.js';

const AXIAL_PATTERNS = new Set(['Empuje_H', 'Cadera']);
const MAX_PER_PATTERN = 2;

/** When a pattern is avoided due to injury, substitute with these pattern slots */
const INJURY_PATTERN_SUBSTITUTES = {
  Rodilla: ['Cadera'],
  Empuje_V: [],
  Cadera: [],
  Empuje_H: [],
  Traccion_H: [],
  Traccion_V: [],
};

/** Excluded from automatic pattern slots (still usable via swap / continuity) */
const AUTO_SELECT_EXCLUDE = new Set([
  'Clean_Shrug',
  'Clock_Push-Up',
]);

/**
 * Olympic lifts and derivatives — excluded for Novato (DDS §8.4 / safety).
 * @param {object} exercise
 * @returns {boolean}
 */
export function isOlympicLift(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  const id = (exercise.id ?? exercise.exerciseId ?? '').toLowerCase();

  if (/apret[oó]n.*disco|plate pinch|plate_hand|hand_squeeze/i.test(name + id)) return false;

  if (
    /snatch|arrancada|hang_clean|hang_snatch|power_clean|split_clean|split_snatch|muscle_clean|muscle_snatch|clean_and_jerk|clean_from|snatch_from|snatch_balance|clean_dead|turkish_get/i.test(
      id,
    )
  ) {
    return true;
  }

  return /arrancada|snatch|\bclean\b|cargada|jerk|envi[oó]n|thruster|balance de jerk|snatch balance|hang snatch|hang clean|power clean|split clean|split snatch|muscle snatch|muscle clean|clean and jerk|cargada y envi[oó]n|clean & jerk|one-arm.*snatch|kettlebell.*snatch|kettlebell.*clean|bottoms-up clean/i.test(
    name,
  );
}

function passesExperienceExerciseFilter(exercise, safetyProfile) {
  if (safetyProfile?.experienceLevel !== 'Novato') return true;
  return !isOlympicLift(exercise);
}

const ACCESSORY_MUSCLE_FILTERS = {
  Pantorrillas: (ex) =>
    /gemelo|pantorrilla|calf|tal[oó]n|soleus|elevaci[oó]n.*tal[oó]n|prensa de pantorrilla/i.test(
      ex.nombre ?? '',
    ),
  Glúteos: (ex) =>
    ex.patronMovimiento === 'Cadera' ||
    /gl[uú]teo|hip thrust|patada|puente|abducci[oó]n/i.test(ex.nombre ?? ''),
  Tríceps: (ex) =>
    ['Empuje_H', 'Empuje_V'].includes(ex.patronMovimiento) ||
    /tr[ií]ceps|extensi[oó]n.*codo|fondos|pushdown/i.test(ex.nombre ?? ''),
  Bíceps: (ex) =>
    ['Traccion_H', 'Traccion_V'].includes(ex.patronMovimiento) ||
    /b[ií]ceps|curl(?! de muñeca)/i.test(ex.nombre ?? ''),
  Hombro: (ex, safetyProfile) => {
    const avoidVertical = safetyProfile?.avoidPatterns?.includes('Empuje_V');
    if (avoidVertical && ex.patronMovimiento === 'Empuje_V') return false;
    if (avoidVertical) {
      return (
        /lateral|face pull|p[aá]jaro|reverse fly|deltoides posterior|vuelo/i.test(ex.nombre ?? '') ||
        (ex.patronMovimiento === 'Traccion_H' && /deltoides|hombro/i.test(ex.nombre ?? '')) ||
        (ex.patronMovimiento === 'General' && /hombro|deltoides/i.test(ex.nombre ?? ''))
      );
    }
    return ['Empuje_V', 'General', 'Traccion_H'].includes(ex.patronMovimiento);
  },
};

function patternCount(selected, pattern) {
  return selected.filter((e) => e.patronMovimiento === pattern).length;
}

function hasPatternCapacity(selected, pattern, max = MAX_PER_PATTERN, options = {}) {
  const { accessoryMuscle } = options;
  if (
    pattern === 'General' &&
    accessoryMuscle &&
    SPLIT_VOLUME_ACCESSORY_MUSCLES.has(accessoryMuscle)
  ) {
    const generalAccessories = selected.filter(
      (e) =>
        e.patronMovimiento === 'General' &&
        e.accessorySlot &&
        SPLIT_VOLUME_ACCESSORY_MUSCLES.has(e.parteCuerpo ?? e.muscleGroup),
    ).length;
    return generalAccessories < 2;
  }
  return patternCount(selected, pattern) < max;
}

export function resolvePatternsForSafety(requiredPatterns, safetyProfile) {
  const avoid = new Set(safetyProfile?.avoidPatterns ?? []);
  const modify = new Set(safetyProfile?.modifyPatterns ?? []);
  const resolved = [];

  for (const pattern of requiredPatterns) {
    if (!avoid.has(pattern)) {
      resolved.push(pattern);
      continue;
    }

    const substitutes = INJURY_PATTERN_SUBSTITUTES[pattern] ?? [];
    for (const sub of substitutes) {
      if (!avoid.has(sub)) resolved.push(sub);
    }
  }

  return [...new Set(resolved)];
}

function passesInjuryExerciseFilter(exercise, safetyProfile) {
  const avoid = new Set(safetyProfile?.avoidPatterns ?? []);
  const name = exercise.nombre ?? '';

  if (avoid.has('Rodilla')) {
    if (exercise.patronMovimiento === 'Rodilla') return false;
    if (/snatch|arrancada|clean|jerk|salt|plyo|jump|explosiv|estocada/i.test(name)) return false;
  }

  if (avoid.has('Empuje_V')) {
    if (exercise.patronMovimiento === 'Empuje_V') return false;
    if (/snatch|arrancada|clean|jerk/i.test(name)) return false;
  }

  if (avoid.has('Cadera') && exercise.patronMovimiento === 'Cadera') {
    if (/peso muerto|deadlift|good morning|buenos d[ií]as/i.test(name)) return false;
  }

  return true;
}

function sessionMuscleRank(exercise, sessionMuscles) {
  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  if (!sessionMuscles?.length) return 1;
  return sessionMuscles.includes(muscle) ? 0 : 1;
}

/**
 * DDS 8.4 — select exercises for a session.
 */
export function selectExercises(
  sessionFocus,
  catalog,
  safetyProfile,
  history = [],
  goal,
  options = {},
) {
  const {
    maxPerPattern = MAX_PER_PATTERN,
    excludeIds = [],
    weekNumber = 1,
    sessionMuscles = [],
    mesocycleId = null,
  } = options;
  const excludeSet = new Set(excludeIds);
  const requiredPatterns = resolvePatternsForSafety(
    SESSION_FOCUS_PATTERN_MAP[sessionFocus] ?? inferPatternsFromFocus(sessionFocus),
    safetyProfile,
  );

  const patternSlotLimit = (pattern) => (pattern === 'Core' ? 1 : maxPerPattern);

  const avoidPatterns = new Set(safetyProfile?.avoidPatterns ?? []);
  const modifyPatterns = new Set(safetyProfile?.modifyPatterns ?? []);

  const continuityExercises = getContinuityExercises(history, sessionFocus, mesocycleId);

  const selected = [];
  const usedIds = new Set();

  for (const pattern of requiredPatterns) {
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
      for (const ex of resolvedContinuity.slice(0, patternSlotLimit(pattern))) {
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
      .filter((ex) => !AUTO_SELECT_EXCLUDE.has(ex.id))
      .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
      .filter((ex) => passesInjuryExerciseFilter(ex, safetyProfile))
      .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
      .filter((ex) => isGymExercise(ex))
      .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
      .sort((a, b) => {
        const stimulusDiff = stimulusSelectionScore(selected, a) - stimulusSelectionScore(selected, b);
        if (stimulusDiff !== 0) return stimulusDiff;
        const muscleDiff =
          sessionMuscleRank(a, sessionMuscles) - sessionMuscleRank(b, sessionMuscles);
        if (muscleDiff !== 0) return muscleDiff;
        const priorityDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
        if (priorityDiff !== 0) return priorityDiff;
        if (modifyPatterns.has(pattern) && safetyProfile?.conservative) {
          return prefersMachine(a, b);
        }
        if (avoidPatterns.size > 0) {
          const machineDiff = prefersMachine(a, b);
          if (machineDiff !== 0) return machineDiff;
        }
        return (a.nombre ?? '').localeCompare(b.nombre ?? '');
      });

    const picked = pickWithStimulusDiversity(
      candidates,
      patternSlotLimit(pattern),
      selected,
      usedIds,
    );
    for (const ex of picked) {
      selected.push({ ...ex, fromContinuity: false });
    }
  }

  fillAccessoryMuscles(
    selected,
    usedIds,
    sessionMuscles,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
  );

  return selected;
}

function fillAccessoryMuscles(
  selected,
  usedIds,
  sessionMuscles,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
) {
  for (const muscle of sessionMuscles) {
    if (!muscle) continue;
    const targetCount = SPLIT_VOLUME_ACCESSORY_MUSCLES.has(muscle) ? 2 : 1;

    while (selected.filter((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle).length < targetCount) {
      const pick = pickAccessoryForMuscle(
        muscle,
        selected,
        usedIds,
        catalog,
        safetyProfile,
        weekNumber,
        excludeSet,
        avoidPatterns,
        maxPerPattern,
      );
      if (!pick) break;
      selected.push({
        ...pick,
        fromContinuity: false,
        accessorySlot: true,
        splitVolumeSlot: targetCount > 1,
      });
      usedIds.add(pick.id);
    }
  }
}

function pickAccessoryForMuscle(
  muscle,
  selected,
  usedIds,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
) {
  const muscleFilter = ACCESSORY_MUSCLE_FILTERS[muscle];

  const candidates = catalog
    .filter((ex) => ex.parteCuerpo === muscle)
    .filter((ex) => !excludeSet.has(ex.id))
    .filter((ex) => !usedIds.has(ex.id))
    .filter((ex) => !AUTO_SELECT_EXCLUDE.has(ex.id))
    .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
    .filter((ex) => passesInjuryExerciseFilter(ex, safetyProfile))
    .filter((ex) => isGymExercise(ex))
    .filter((ex) => !/muñeca|wrist|antebrazo/i.test(ex.nombre ?? ''))
    .filter((ex) =>
      muscleFilter ? muscleFilter(ex, safetyProfile) : ex.patronMovimiento !== 'General',
    )
    .filter((ex) =>
      hasPatternCapacity(selected, ex.patronMovimiento, maxPerPattern, { accessoryMuscle: muscle }),
    )
    .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
    .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
    .filter((ex) => hasDistinctStimulusForMuscle(selected, ex))
    .sort((a, b) => {
      const stimulusDiff = stimulusSelectionScore(selected, a) - stimulusSelectionScore(selected, b);
      if (stimulusDiff !== 0) return stimulusDiff;
      const priorityDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
      if (priorityDiff !== 0) return priorityDiff;
      const patternLoad =
        patternCount(selected, a.patronMovimiento) - patternCount(selected, b.patronMovimiento);
      if (patternLoad !== 0) return patternLoad;
      return (a.nombre ?? '').localeCompare(b.nombre ?? '');
    });

  return candidates[0] ?? null;
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
      if (
        passesConservativeFilter(ex, safetyProfile, weekNumber) &&
        passesExperienceExerciseFilter(ex, safetyProfile)
      ) {
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
  const candidates = catalog
    .filter(
      (candidate) =>
        candidate.id !== exercise.id &&
        !excludeSet.has(candidate.id) &&
        !AUTO_SELECT_EXCLUDE.has(candidate.id) &&
        candidate.patronMovimiento === (exercise.patronMovimiento ?? pattern) &&
        candidate.parteCuerpo === exercise.parteCuerpo &&
        isGymExercise(candidate) &&
        passesConservativeFilter(candidate, safetyProfile, weekNumber) &&
        passesExperienceExerciseFilter(candidate, safetyProfile) &&
        hasDistinctStimulusForMuscle([exercise], candidate),
    )
    .sort(
      (a, b) =>
        stimulusSelectionScore([exercise], a) - stimulusSelectionScore([exercise], b) ||
        (a.prioridad ?? 3) - (b.prioridad ?? 3),
    );

  return candidates[0] ?? null;
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

/**
 * Week 1 of a new mesocycle: exclude previous mesocycle's anchor exercises
 * for the same sessionFocus to enforce systematic variation (Kassiano et al.).
 * @param {object[]} history
 * @param {string|null} mesocycleId
 * @param {number} weekNumber
 * @param {string} sessionFocus
 * @returns {string[]}
 */
export function getMesocycleRotationExclusions(history, mesocycleId, weekNumber, sessionFocus) {
  if (weekNumber !== 1 || !mesocycleId || !sessionFocus || !history?.length) return [];

  const alreadyAnchoredInCurrentMc = history.some(
    (s) =>
      s.mesocycleId === mesocycleId &&
      s.weekNumber === 1 &&
      s.sessionFocus === sessionFocus &&
      (s.mainBlock?.length ?? 0) > 0,
  );
  if (alreadyAnchoredInCurrentMc) return [];

  const previousMesocycleIds = [
    ...new Set(history.map((s) => s.mesocycleId).filter((id) => id && id !== mesocycleId)),
  ];
  if (!previousMesocycleIds.length) return [];

  const previousMesocycleId = previousMesocycleIds[previousMesocycleIds.length - 1];
  const anchor =
    history.find(
      (s) =>
        s.mesocycleId === previousMesocycleId &&
        s.sessionFocus === sessionFocus &&
        s.weekNumber === 1,
    ) ??
    history.find(
      (s) => s.mesocycleId === previousMesocycleId && s.sessionFocus === sessionFocus,
    );

  if (!anchor?.mainBlock?.length) return [];
  return anchor.mainBlock.map((b) => b.exerciseId).filter(Boolean);
}

function getContinuityExercises(history, sessionFocus, mesocycleId) {
  if (!history?.length) return [];

  const scopedHistory = mesocycleId
    ? history.filter((s) => s.mesocycleId === mesocycleId)
    : history;

  if (!scopedHistory.length) return [];

  const anchorSession =
    scopedHistory.find(
      (s) => s.sessionFocus === sessionFocus && s.weekNumber === 1 && s.mainBlock?.length,
    ) ??
    scopedHistory.find((s) => s.sessionFocus === sessionFocus && s.mainBlock?.length);

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
