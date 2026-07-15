import { SESSION_FOCUS_PATTERN_MAP, SPLIT_VOLUME_ACCESSORY_MUSCLES } from '../constants.js';
import {
  applyContinuityReplacements,
  getSessionContinuityReplacements,
} from '../athlete/continuityPreferences.js';
import { getRotationIdsFromIndex } from '../athlete/mesocycleExerciseIndex.js';
import { detectPlateau, getIntervention } from '../progression/plateau.js';
import { passesBodyweightLoadFilter } from './bodyweight.js';
import { passesGymEquipmentFilter } from './equipmentFilters.js';
import {
  isUprightRowExercise,
  isNicheTricepsExercise,
  isGoodMorningExercise,
  isPullBiasedSession,
  resolveSessionGoal,
  MAX_BICEPS_EXERCISES_PULL,
} from '../session/sessionPrescription.js';
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
  'Single-Arm_Push-Up',
  'handstand_push-ups',
  'Plyo_Kettlebell_Pushups',
  'Incline_Push-Up_Depth_Jump',
  'kettlebell_pistol_squat',
  'Overhead_Squat',
  'Snatch',
  'Clean_and_Jerk',
  'Alternating_Renegade_Row',
  'Barbell_Guillotine_Bench_Press',
  'Kneeling_Jump_Squat',
  'One-Arm_Kettlebell_Snatch',
  'One-Arm_Kettlebell_Clean',
  'Muscle_Snatch',
  'Spider_Crawl',
  'Push_Up_to_Side_Plank',
  'One-Arm_Kettlebell_Swings',
  'Deficit_Deadlift',
  'Gironda_Sternum_Chins',
  'Box_Squat_with_Chains',
  'Reverse_Band_Bench_Press',
  'Pin_Presses',
  'Bent_Press',
  'Kettlebell_Turkish_Get-Up_Lunge_style',
  'Upright_Row_-_With_Bands',
  'Dumbbell_One-Arm_Upright_Row',
  'Dumbbell_Raise',
  'Single_Dumbbell_Raise',
  'Upright_Barbell_Row',
  'Upright_Cable_Row',
  'one_arm_pronated_dumbbell_triceps_extension',
  'one_arm_supinated_dumbbell_triceps_extension',
  'Dumbbell_One-Arm_Triceps_Extension',
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
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (safetyProfile?.experienceLevel === 'Novato') {
    if (isOlympicLift(exercise)) return false;
    if (/peso muerto|deadlift|piernas r[ií]gidas|stiff/i.test(name)) return false;
    if (/swing|kettlebell swing/i.test(name)) return false;
    if (/step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla/i.test(name)) return false;
    if (/hip thrust con barra|barbell hip thrust/i.test(name)) return false;
    if (/puente de gl[uú]teo con barra|barbell glute bridge/i.test(name)) return false;
    if (/elevaciones laterales a una mano|elevaci[oó]n lateral.*una mano/i.test(name)) return false;
    if (/kettlebell|pesa rusa|tir[oó]n alto/i.test(name)) return false;
    if (isNovatoNicheCurlExercise(exercise)) return false;
  }
  return true;
}

function isNovatoNicheCurlExercise(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  return /curl.*drag|drag.*curl|'drag'|spider curl|guillotine curl|curl guillotine/i.test(name);
}

function isStepUpExercise(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  return /step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla/i.test(name);
}

function isNicheUnilateralExercise(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  return (
    /una mano|one.?arm|single.?arm|unilateral/i.test(name) ||
    /press de hombro unilateral/i.test(name)
  );
}

function passesMainstreamExerciseFilter(exercise) {
  return !isNicheUnilateralExercise(exercise);
}

function passesDifficultyFilter(exercise) {
  return exercise.dificultadTecnica !== 'Alta';
}

function difficultyRank(exercise) {
  const order = { Baja: 0, Media: 1, Alta: 2 };
  return order[exercise.dificultadTecnica] ?? 1;
}

const ACCESSORY_MUSCLE_FILTERS = {
  Pantorrillas: (ex) =>
    /gemelo|pantorrilla|calf|tal[oó]n|soleus|elevaci[oó]n.*tal[oó]n|prensa de pantorrilla/i.test(
      ex.nombre ?? '',
    ),
  Glúteos: (ex) =>
    ex.patronMovimiento === 'Cadera' ||
    /gl[uú]teo|hip thrust|patada|puente|abducci[oó]n/i.test(ex.nombre ?? ''),
  Tríceps: (ex) => {
    const name = ex.nombre ?? '';
    if (/press.*suelo|floor press/i.test(name) && !/extensi[oó]n|pushdown/i.test(name)) {
      return false;
    }
    return (
      ['Empuje_H', 'Empuje_V'].includes(ex.patronMovimiento) ||
      /tr[ií]ceps|extensi[oó]n.*codo|fondos|pushdown/i.test(name)
    );
  },
  Bíceps: (ex) =>
    ['Traccion_H', 'Traccion_V'].includes(ex.patronMovimiento) ||
    /b[ií]ceps|curl(?! de muñeca)/i.test(ex.nombre ?? ''),
  Hombro: (ex, safetyProfile, ctx = {}) => {
    const { sessionMuscles = [], sessionFocus = '', goal = 'Hipertrofia' } = ctx;
    const avoidVertical = safetyProfile?.avoidPatterns?.includes('Empuje_V');
    const shoulderLimited = hasShoulderLimitation(safetyProfile);
    const isPull = isPullBiasedSession(sessionMuscles, sessionFocus);
    const name = ex.nombre ?? '';
    const sessionGoal = resolveSessionGoal(sessionFocus, goal);

    if (isUprightRowExercise(ex)) return false;
    if (hasWristLimitation(safetyProfile) && /elevaci[oó]n lateral/i.test(name) && /una mano|one.?arm/i.test(name)) {
      return false;
    }
    if (sessionGoal === 'Fuerza' && /elevaci[oó]n lateral|lateral raise/i.test(name)) return false;
    if (shoulderLimited && /elevaci[oó]n lateral|lateral raise/i.test(name)) return false;

    if (isPull) {
      if (ex.patronMovimiento === 'Empuje_V') return false;
      if (/press de hombro|shoulder press|militar|press en m[aá]quina/i.test(name)) {
        return false;
      }
      if (shoulderLimited || avoidVertical) {
        return /face pull|rotaci[oó]n externa|scaption|p[aá]jaro|posterior|reverse fly|vuelo posterior/i.test(
          name,
        );
      }
      return (
        /face pull|p[aá]jaro|posterior|reverse fly|vuelo posterior/i.test(name) ||
        (ex.patronMovimiento === 'Traccion_H' && /face pull/i.test(name))
      );
    }

    if (avoidVertical && ex.patronMovimiento === 'Empuje_V') return false;
    if (avoidVertical || shoulderLimited) {
      return (
        /face pull|p[aá]jaro|reverse fly|deltoides posterior|vuelo posterior|rotaci[oó]n externa|scaption/i.test(
          name,
        ) ||
        (ex.patronMovimiento === 'Traccion_H' && /deltoides|hombro/i.test(name)) ||
        (ex.patronMovimiento === 'General' && /hombro|deltoides/i.test(name))
      );
    }
    return ['Empuje_V', 'General', 'Traccion_H'].includes(ex.patronMovimiento);
  },
};

const ISOLATION_ACCESSORY_MUSCLES = new Set(['Tríceps', 'Bíceps', 'Isquiotibiales']);

function patternCount(selected, pattern) {
  return selected.filter((e) => e.patronMovimiento === pattern).length;
}

function hasPatternCapacity(selected, pattern, max = MAX_PER_PATTERN, options = {}) {
  const { accessoryMuscle } = options;
  if (accessoryMuscle && ISOLATION_ACCESSORY_MUSCLES.has(accessoryMuscle)) {
    return true;
  }
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

function hasKneeLimitation(safetyProfile) {
  return (
    safetyProfile?.injuries?.includes('Rodilla') ||
    safetyProfile?.modifyPatterns?.includes('Rodilla')
  );
}

function hasShoulderLimitation(safetyProfile) {
  return (
    safetyProfile?.injuries?.includes('Hombro') ||
    safetyProfile?.avoidPatterns?.includes('Empuje_V') ||
    safetyProfile?.avoidPatterns?.includes('Hombro')
  );
}

function hasWristLimitation(safetyProfile) {
  return (
    safetyProfile?.injuries?.includes('Muñeca') ||
    safetyProfile?.modifyPatterns?.includes('Empuje_H') ||
    safetyProfile?.modifyPatterns?.includes('Traccion_H')
  );
}

function hasLowBackLimitation(safetyProfile) {
  return (
    safetyProfile?.injuries?.includes('Espalda_Baja') ||
    safetyProfile?.avoidPatterns?.includes('Cadera')
  );
}

const KNEE_STRESS_RE =
  /swing|kettlebell|salt|jump|plyo|salto|estocada|zancada|lunge|step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla|sentadilla libre|back squat|front squat|barbell squat|peso muerto|deadlift|good morning|buenos d[ií]as|snatch|clean|jerk|impulso|sprint/i;

function isKneeOpenChainQuadExtension(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  return /extensi[oó]n.*cu[aá]driceps|leg extension/i.test(name);
}

function isKneeSafeHamstringExercise(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  if (muscle !== 'Isquiotibiales') return false;
  if (/peso muerto|deadlift|good morning|buenos d[ií]as|swing|snatch|clean|stiff/i.test(name)) {
    return false;
  }
  return /curl de piernas|curl femoral|leg curl|hamstring curl|femoral|nordic|flexi[oó]n isquio|hiperextension/i.test(
    name,
  );
}

function isWideGripPulldown(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  return (
    exercise.patronMovimiento === 'Traccion_V' &&
    (/agarre ancho|wide grip|wide-grip/i.test(name) ||
      /jal[oó]n al pecho con agarre ancho/i.test(name))
  );
}

const WRIST_STRESS_RE =
  /fondos en barra|parallel bar|bar dip|press de banca con barra|press de banca inclinado con barra|barbell bench|curl con barra(?! ez)|barbell curl/i;

function passesKneeLimitationFilter(exercise, safetyProfile) {
  if (!hasKneeLimitation(safetyProfile)) return true;
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (isKneeOpenChainQuadExtension(exercise)) return false;
  if (KNEE_STRESS_RE.test(name)) return false;
  if (exercise.patronMovimiento === 'Cadera') {
    return isKneeSafeHamstringExercise(exercise);
  }
  if (
    exercise.patronMovimiento === 'Rodilla' &&
    /sentadilla|squat/i.test(name) &&
    !/prensa|press|smith|m[aá]quina|hack|leg press/i.test(name)
  ) {
    return false;
  }
  return true;
}

function passesWristLimitationFilter(exercise, safetyProfile) {
  if (!hasWristLimitation(safetyProfile)) return true;
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (/fondos|parallel bar|bar dip|\bdip\b/i.test(name)) return false;
  if (
    /extensi[oó]n de tr[ií]ceps a una mano|one.?arm.*tr[ií]ceps|tr[ií]ceps.*una mano/i.test(name)
  ) {
    return false;
  }
  if (
    /elevaciones laterales a una mano|elevaci[oó]n lateral.*una mano|single.?arm.*lateral/i.test(
      name,
    )
  ) {
    return false;
  }
  if (
    /press de hombro unilateral|press.*hombro.*una mano|single.?arm.*shoulder press|one.?arm.*shoulder press/i.test(
      name,
    )
  ) {
    return false;
  }
  if (
    WRIST_STRESS_RE.test(name) &&
    !/m[aá]quina|machine|smith|polea|cable|neutro|cuerda/i.test(name)
  ) {
    return false;
  }
  return true;
}

function passesRedundantPecFilter(exercise, selected, safetyProfile) {
  if (safetyProfile?.experienceLevel !== 'Novato') return true;
  if (exercise.patronMovimiento !== 'Empuje_H') return true;
  if ((exercise.parteCuerpo ?? exercise.muscleGroup) !== 'Pecho') return true;
  const pecPresses = selected.filter(
    (ex) =>
      ex.patronMovimiento === 'Empuje_H' &&
      (ex.parteCuerpo ?? ex.muscleGroup) === 'Pecho',
  );
  return pecPresses.length < 1;
}

function passesRedundantQuadFilter(exercise, selected, safetyProfile) {
  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  if (muscle !== 'Cuádriceps') return true;
  const name = (exercise.nombre ?? '').toLowerCase();
  if (hasKneeLimitation(safetyProfile) && isKneeOpenChainQuadExtension(exercise)) return false;
  if (!/extensi[oó]n|leg extension/i.test(name)) return true;
  return !selected.some(
    (ex) =>
      (ex.parteCuerpo ?? ex.muscleGroup) === 'Cuádriceps' &&
      (ex.prioridad ?? 3) <= 2 &&
      ex.id !== exercise.id,
  );
}

function adjustPatternsForNovatoLowFreq(patterns, sessionFocus, safetyProfile, trainingDaysPerWeek = 3) {
  if (safetyProfile?.experienceLevel !== 'Novato' || trainingDaysPerWeek > 2) return patterns;
  if (!/full body/i.test(sessionFocus ?? '')) return patterns;
  if (patterns.includes('Traccion_H') && patterns.includes('Traccion_V')) {
    return patterns.filter((p) => p !== 'Traccion_V');
  }
  return patterns;
}

function passesRedundantBackFilter(exercise, selected, safetyProfile, sessionFocus, trainingDaysPerWeek = 3) {
  if (safetyProfile?.experienceLevel !== 'Novato' || trainingDaysPerWeek > 2) return true;
  if (!/full body/i.test(sessionFocus ?? '')) return true;
  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  if (muscle !== 'Espalda' || (exercise.prioridad ?? 3) > 2) return true;
  const backCompounds = selected.filter(
    (ex) => (ex.parteCuerpo ?? ex.muscleGroup) === 'Espalda' && (ex.prioridad ?? 3) <= 2,
  );
  return backCompounds.length < 1;
}

function isNovatoRedundantLegAccessory(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  if (muscle === 'Cuádriceps' && /extensi[oó]n|leg extension/i.test(name)) return true;
  if (muscle === 'Glúteos' && /puente de gl[uú]teo con barra|barbell glute bridge|hip thrust con barra/i.test(name)) {
    return true;
  }
  return false;
}

function pickNovatoHamstringExercise(
  selected,
  usedIds,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  sessionMuscles,
  sessionFocus,
  goal,
  trainingDaysPerWeek = 3,
) {
  return pickAccessoryForMuscle(
    'Isquiotibiales',
    selected,
    usedIds,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
    sessionMuscles,
    sessionFocus,
    goal,
    trainingDaysPerWeek,
  );
}

function makeRoomForNovatoHamstring(selected, usedIds, trainingDaysPerWeek = 3, sessionGoal = 'Hipertrofia') {
  const maxExercises =
    trainingDaysPerWeek <= 2 ? (sessionGoal === 'Fuerza' ? 5 : 7) : sessionGoal === 'Fuerza' ? 5 : 7;
  if (selected.length < maxExercises) return;

  const dropIdx = selected.findIndex((ex) => isNovatoRedundantLegAccessory(ex));
  if (dropIdx >= 0) {
    usedIds.delete(selected[dropIdx].id);
    selected.splice(dropIdx, 1);
    return;
  }

  const lowPriorityIdx = selected.findIndex(
    (ex) =>
      (ex.prioridad ?? 3) >= 3 ||
      ((ex.parteCuerpo ?? ex.muscleGroup) === 'Core' && (ex.prioridad ?? 3) >= 2),
  );
  if (lowPriorityIdx >= 0) {
    usedIds.delete(selected[lowPriorityIdx].id);
    selected.splice(lowPriorityIdx, 1);
  }
}

function ensureNovatoHamstringStimulus(
  selected,
  usedIds,
  sessionFocus,
  sessionMuscles,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  goal,
  sessionGoal = 'Hipertrofia',
  trainingDaysPerWeek = 3,
) {
  if (safetyProfile?.experienceLevel !== 'Novato') return;
  if (!/full body/i.test(sessionFocus ?? '')) return;
  if (selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Isquiotibiales')) return;

  const pick = pickNovatoHamstringExercise(
    selected,
    usedIds,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
    sessionMuscles,
    sessionFocus,
    goal,
    trainingDaysPerWeek,
  );
  if (!pick) return;

  makeRoomForNovatoHamstring(selected, usedIds, trainingDaysPerWeek, sessionGoal);
  selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
  usedIds.add(pick.id);
}

function trimNonEssentialForNovatoArms(
  selected,
  usedIds,
  maxExercises,
  safetyProfile,
  trainingDaysPerWeek,
  sessionFocus,
  sessionGoal,
) {
  if (safetyProfile?.experienceLevel !== 'Novato') return selected;
  if (!/full body/i.test(sessionFocus ?? '') || sessionGoal === 'Fuerza') return selected;
  if (selected.length <= maxExercises) return selected;

  const isProtected = (e) => {
    const m = e.parteCuerpo ?? e.muscleGroup;
    return m === 'Bíceps' || m === 'Tríceps' || m === 'Isquiotibiales';
  };

  while (selected.length > maxExercises) {
    const removable = selected
      .map((ex, idx) => ({ ex, idx }))
      .filter(({ ex }) => !isProtected(ex) && (ex.prioridad ?? 3) >= 2)
      .sort((a, b) => {
        const priDiff = (b.ex.prioridad ?? 3) - (a.ex.prioridad ?? 3);
        if (priDiff !== 0) return priDiff;
        return (b.ex.accessorySlot ? 1 : 0) - (a.ex.accessorySlot ? 1 : 0);
      });
    const victim = removable[0];
    if (!victim) break;
    usedIds.delete(victim.ex.id);
    selected.splice(victim.idx, 1);
  }
  return selected;
}

function trimSessionExerciseCount(
  selected,
  safetyProfile,
  sessionFocus,
  sessionGoal,
  trainingDaysPerWeek = 3,
) {
  const focus = (sessionFocus ?? '').toLowerCase();
  const isNovato = safetyProfile?.experienceLevel === 'Novato';

  if (/full body/i.test(focus) && sessionGoal === 'Fuerza' && selected.length > 6) {
    const ranked = [...selected].sort((a, b) => {
      const aCompound = (a.prioridad ?? 3) === 1 ? 0 : 1;
      const bCompound = (b.prioridad ?? 3) === 1 ? 0 : 1;
      if (aCompound !== bCompound) return aCompound - bCompound;
      return (a.prioridad ?? 3) - (b.prioridad ?? 3);
    });
    return ranked.slice(0, 6);
  }

  if (!isNovato || !/full body/i.test(focus)) return selected;

  let maxExercises = sessionGoal === 'Fuerza' ? 5 : 7;
  if (trainingDaysPerWeek <= 2) maxExercises = sessionGoal === 'Fuerza' ? 5 : 7;
  if (selected.length <= maxExercises) return selected;

  const ranked = [...selected].sort((a, b) => {
    const priDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
    if (priDiff !== 0) return priDiff;
    return (a.accessorySlot ? 1 : 0) - (b.accessorySlot ? 1 : 0);
  });
  return ranked.slice(0, maxExercises);
}

function pickPatternExercise(
  pattern,
  selected,
  usedIds,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  sessionFocus,
  sessionMuscles,
  goal,
) {
  const avoidPatterns = new Set(safetyProfile?.avoidPatterns ?? []);
  const candidates = catalog
    .filter((ex) => ex.patronMovimiento === pattern)
    .filter((ex) => !excludeSet.has(ex.id))
    .filter((ex) => !usedIds.has(ex.id))
    .filter((ex) => !AUTO_SELECT_EXCLUDE.has(ex.id))
    .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
    .filter((ex) => passesInjuryExerciseFilter(ex, safetyProfile))
    .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
    .filter((ex) => passesMainstreamExerciseFilter(ex))
    .filter((ex) => passesDifficultyFilter(ex))
    .filter((ex) => isGymExercise(ex))
    .filter((ex) => passesGymEquipmentFilter(ex))
    .filter((ex) => passesBodyweightLoadFilter(ex, selected))
    .filter((ex) => passesHingeFatigueFilter(ex, selected))
    .filter((ex) => passesPullPatternFilter(ex, pattern, sessionMuscles))
    .filter((ex) => passesRedundantPecFilter(ex, selected, safetyProfile))
    .filter((ex) => passesRedundantQuadFilter(ex, selected, safetyProfile))
    .filter((ex) =>
      passesClinicalSafetyFilter(ex, safetyProfile, sessionFocus, sessionMuscles, goal),
    )
    .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
    .sort((a, b) => {
      const sessionGoal = resolveSessionGoal(sessionFocus, goal);
      const aBallistic = sessionGoal === 'Fuerza' && isBallisticExercise(a) ? 1 : 0;
      const bBallistic = sessionGoal === 'Fuerza' && isBallisticExercise(b) ? 1 : 0;
      if (aBallistic !== bBallistic) return aBallistic - bBallistic;
      return (a.prioridad ?? 3) - (b.prioridad ?? 3);
    });

  return candidates[0] ?? null;
}

function isHipThrustExercise(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  return /hip thrust|empuje de cadera|glute bridge|puente de gl[uú]teo|patada de gl[uú]teo/i.test(name);
}

function ensurePhulAccesoriosMinimums(
  selected,
  usedIds,
  sessionFocus,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  sessionMuscles,
  goal,
  avoidPatterns,
  maxPerPattern,
) {
  if (!/full body accesorios/i.test(sessionFocus ?? '')) return;

  if (!selected.some((e) => e.patronMovimiento === 'Traccion_H')) {
    const pick = pickPatternExercise(
      'Traccion_H',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      sessionFocus,
      sessionMuscles,
      goal,
    );
    if (pick) {
      selected.push({ ...pick, fromContinuity: false });
      usedIds.add(pick.id);
    }
  }

  if (!selected.some((e) => e.patronMovimiento === 'Cadera')) {
    const pick = pickPatternExercise(
      'Cadera',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      sessionFocus,
      sessionMuscles,
      goal,
    );
    if (pick) {
      selected.push({ ...pick, fromContinuity: false });
      usedIds.add(pick.id);
    }
  }

  if (
    !selected.some(
      (e) =>
        e.patronMovimiento === 'Rodilla' ||
        (e.parteCuerpo ?? e.muscleGroup) === 'Cuádriceps',
    )
  ) {
    const pick = pickPatternExercise(
      'Rodilla',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      sessionFocus,
      sessionMuscles,
      goal,
    );
    if (pick) {
      selected.push({ ...pick, fromContinuity: false });
      usedIds.add(pick.id);
    }
  }

  for (let i = selected.length - 1; i >= 0; i -= 1) {
    if (isGoodMorningExercise(selected[i])) {
      usedIds.delete(selected[i].id);
      selected.splice(i, 1);
    }
  }
}

function ensurePhulAccesoriosBicepsAfterTrim(
  selected,
  usedIds,
  sessionFocus,
  sessionGoal,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  sessionMuscles,
  goal,
) {
  if (!/full body accesorios/i.test(sessionFocus ?? '') || sessionGoal === 'Fuerza') return;
  if (selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Bíceps')) return;

  const maxExercises = 8;

  const dupTricepsIdx = selected.findIndex(
    (ex) =>
      (ex.parteCuerpo ?? ex.muscleGroup) === 'Tríceps' &&
      /extensi[oó]n|pushdown/i.test(ex.nombre ?? ex.exerciseName ?? '') &&
      (ex.prioridad ?? 3) >= 2,
  );
  if (dupTricepsIdx >= 0) {
    usedIds.delete(selected[dupTricepsIdx].id);
    selected.splice(dupTricepsIdx, 1);
  }

  const lateralIdx = selected.findIndex(
    (ex) =>
      (ex.parteCuerpo ?? ex.muscleGroup) === 'Hombro' &&
      /lateral|elevaci[oó]n lateral/i.test(ex.nombre ?? ex.exerciseName ?? '') &&
      (ex.prioridad ?? 3) >= 2,
  );
  if (lateralIdx >= 0) {
    usedIds.delete(selected[lateralIdx].id);
    selected.splice(lateralIdx, 1);
  }

  if (selected.length >= maxExercises) {
    const victimIdx = selected.findIndex(
      (ex) =>
        ((ex.parteCuerpo ?? ex.muscleGroup) === 'Tríceps' && (ex.prioridad ?? 3) >= 2) ||
        ((ex.parteCuerpo ?? ex.muscleGroup) === 'Hombro' &&
          /lateral|posterior|face pull/i.test(ex.nombre ?? '') &&
          (ex.prioridad ?? 3) >= 2),
    );
    if (victimIdx >= 0) {
      usedIds.delete(selected[victimIdx].id);
      selected.splice(victimIdx, 1);
    }
  }

  const pick = pickAccessoryForMuscle(
    'Bíceps',
    selected,
    usedIds,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
    sessionMuscles,
    sessionFocus,
    goal,
  );
  if (pick) {
    selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
    usedIds.add(pick.id);
  }
}

function trimPhulAccesoriosSession(selected, usedIds, sessionFocus, sessionGoal) {
  if (!/full body accesorios/i.test(sessionFocus ?? '') || sessionGoal === 'Fuerza') return;

  const biceps = selected.filter((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Bíceps');
  while (biceps.length > 1) {
    const idx = selected.findIndex(
      (e) =>
        (e.parteCuerpo ?? e.muscleGroup) === 'Bíceps' &&
        (e.accessorySlot || (e.prioridad ?? 3) >= 2),
    );
    if (idx < 0) break;
    usedIds.delete(selected[idx].id);
    selected.splice(idx, 1);
    biceps.pop();
  }

  const maxExercises = 8;
  if (selected.length <= maxExercises) return;

  const ranked = [...selected]
    .map((ex, idx) => ({ ex, idx }))
    .sort((a, b) => {
      const priDiff = (b.ex.prioridad ?? 3) - (a.ex.prioridad ?? 3);
      if (priDiff !== 0) return priDiff;
      return (b.ex.accessorySlot ? 1 : 0) - (a.ex.accessorySlot ? 1 : 0);
    });

  while (selected.length > maxExercises && ranked.length) {
    const victim = ranked.shift();
    if (!victim) break;
    if ((victim.ex.prioridad ?? 3) === 1) continue;
    const currentIdx = selected.findIndex((e) => e.id === victim.ex.id);
    if (currentIdx < 0) continue;
    usedIds.delete(selected[currentIdx].id);
    selected.splice(currentIdx, 1);
  }
}

function ensureHipDominantLegStructure(
  selected,
  usedIds,
  sessionFocus,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  sessionMuscles,
  goal,
  avoidPatterns,
  maxPerPattern,
) {
  if (!/dominante cadera/i.test(sessionFocus ?? '')) return;

  for (let i = selected.length - 1; i >= 0; i -= 1) {
    if (isGoodMorningExercise(selected[i])) {
      usedIds.delete(selected[i].id);
      selected.splice(i, 1);
    }
  }

  if (selected.some(isHipThrustExercise)) return;

  const candidates = catalog
    .filter((ex) => ex.patronMovimiento === 'Cadera')
    .filter((ex) => isHipThrustExercise(ex))
    .filter((ex) => !excludeSet.has(ex.id))
    .filter((ex) => !usedIds.has(ex.id))
    .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
    .filter((ex) => passesMainstreamExerciseFilter(ex))
    .filter((ex) => passesClinicalSafetyFilter(ex, safetyProfile, sessionFocus, sessionMuscles, goal))
    .sort((a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3));

  const pick = candidates[0];
  if (!pick) return;

  const replaceIdx = selected.findIndex(
    (ex) =>
      (ex.parteCuerpo ?? ex.muscleGroup) === 'Glúteos' &&
      !isHipThrustExercise(ex) &&
      (ex.prioridad ?? 3) >= 2,
  );
  if (replaceIdx >= 0) {
    usedIds.delete(selected[replaceIdx].id);
    selected.splice(replaceIdx, 1);
  }

  selected.push({ ...pick, fromContinuity: false, accessorySlot: replaceIdx >= 0 });
  usedIds.add(pick.id);
}

function isBallisticExercise(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (/swing|kettlebell swing|bal[ií]stic|snatch|clean|jerk|impulso|pliom|salt|jump/i.test(name)) {
    return true;
  }
  return Boolean(exercise.isDynamic) && /swing|impulso/i.test(name);
}

function passesHingeFatigueFilter(exercise, selected) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (!/step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla/i.test(name)) return true;
  return !selected.some((e) => {
    const n = (e.nombre ?? e.exerciseName ?? '').toLowerCase();
    return (
      isGoodMorningExercise(e) ||
      isHeavyLumbarHinge(e) ||
      /rdl|rumano|stiff|peso muerto|deadlift|buenos d[ií]as|good morning/i.test(n)
    );
  });
}

function ensureNovatoArmsLowFreq(
  selected,
  usedIds,
  sessionFocus,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  sessionMuscles,
  goal,
  trainingDaysPerWeek = 3,
) {
  if (safetyProfile?.experienceLevel !== 'Novato') return;
  if (!/full body/i.test(sessionFocus ?? '')) return;

  for (const muscle of ['Tríceps', 'Bíceps']) {
    if (
      selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle)
    ) {
      continue;
    }
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
      sessionMuscles,
      sessionFocus,
      goal,
      trainingDaysPerWeek,
    );
    if (!pick) continue;
    selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
    usedIds.add(pick.id);
  }
}

function isHeavyLumbarHinge(exercise) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (exercise.patronMovimiento !== 'Cadera') return false;
  if (isGoodMorningExercise(exercise)) return true;
  if (/rumano|rdl|stiff|piernas r[ií]gidas|pull through|pull-through/i.test(name)) return false;
  return /peso muerto|deadlift/i.test(name);
}

function ensureFuerzaFullBodyLumbarCap(selected, usedIds, sessionFocus, sessionGoal) {
  if (sessionGoal !== 'Fuerza' || !/full body/i.test(sessionFocus ?? '')) return;

  const hasLegLoad = selected.some(
    (e) =>
      e.patronMovimiento === 'Rodilla' ||
      /prensa de piernas|leg press|sentadilla|squat/i.test(e.nombre ?? e.exerciseName ?? ''),
  );
  const hasHeavyPull = selected.some((e) => e.patronMovimiento === 'Traccion_H');

  if (!hasLegLoad || !hasHeavyPull) return;

  for (let i = selected.length - 1; i >= 0; i -= 1) {
    if (isHeavyLumbarHinge(selected[i])) {
      usedIds.delete(selected[i].id);
      selected.splice(i, 1);
    }
  }
}

function ensureFuerzaSessionMinimums(
  selected,
  usedIds,
  sessionMuscles,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  sessionFocus,
  goal,
  sessionGoal,
) {
  if (sessionGoal !== 'Fuerza') return;
  const focus = (sessionFocus ?? '').toLowerCase();

  if (/full body/i.test(focus)) {
    for (let i = selected.length - 1; i >= 0; i -= 1) {
      if (isGoodMorningExercise(selected[i])) {
        usedIds.delete(selected[i].id);
        selected.splice(i, 1);
      }
    }
  }

  if (/upper/i.test(focus) && !selected.some((e) => e.patronMovimiento === 'Traccion_V')) {
    const pick = pickPatternExercise(
      'Traccion_V',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      sessionFocus,
      sessionMuscles,
      goal,
    );
    if (pick) {
      selected.push({ ...pick, fromContinuity: false });
      usedIds.add(pick.id);
    }
  }

  if (/lower|legs|pierna/i.test(focus)) {
    const gmIdx = selected.findIndex((e) => isGoodMorningExercise(e));
    if (gmIdx >= 0) {
      usedIds.delete(selected[gmIdx].id);
      selected.splice(gmIdx, 1);
    }

    for (let i = selected.length - 1; i >= 0; i -= 1) {
      if (isBallisticExercise(selected[i])) {
        usedIds.delete(selected[i].id);
        selected.splice(i, 1);
      }
    }

    if (!selected.some((e) => e.patronMovimiento === 'Cadera' && !isGoodMorningExercise(e))) {
      const pick = pickPatternExercise(
        'Cadera',
        selected,
        usedIds,
        catalog,
        safetyProfile,
        weekNumber,
        excludeSet,
        sessionFocus,
        sessionMuscles,
        goal,
      );
      if (pick) {
        selected.push({ ...pick, fromContinuity: false });
        usedIds.add(pick.id);
      }
    }

    const minExercises = 3;
    while (selected.length < minExercises) {
      let added = false;
      for (const muscle of ['Isquiotibiales', 'Glúteos', 'Cuádriceps', 'Pantorrillas']) {
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
          sessionMuscles,
          sessionFocus,
          goal,
        );
        if (!pick) continue;
        selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
        usedIds.add(pick.id);
        added = true;
        break;
      }
      if (!added) break;
    }

    if (!selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Isquiotibiales')) {
      const pick = pickFuerzaHamstringExercise(
        selected,
        usedIds,
        catalog,
        safetyProfile,
        weekNumber,
        excludeSet,
        avoidPatterns,
        maxPerPattern,
        sessionMuscles,
        sessionFocus,
        goal,
      );
      if (pick) {
        selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
        usedIds.add(pick.id);
      }
    }
  }

  if (/full body/i.test(focus) && !selected.some((e) => e.patronMovimiento === 'Cadera')) {
    const hasLegLoad = selected.some(
      (e) =>
        e.patronMovimiento === 'Rodilla' ||
        /prensa de piernas|leg press/i.test(e.nombre ?? e.exerciseName ?? ''),
    );
    const hasHeavyPull = selected.some((e) => e.patronMovimiento === 'Traccion_H');
    if (!(hasLegLoad && hasHeavyPull)) {
      const pick = pickPatternExercise(
        'Cadera',
        selected,
        usedIds,
        catalog,
        safetyProfile,
        weekNumber,
        excludeSet,
        sessionFocus,
        sessionMuscles,
        goal,
      );
      if (pick) {
        selected.push({ ...pick, fromContinuity: false });
        usedIds.add(pick.id);
      }
    }
  }

  ensureFuerzaLowerMainSlots(selected, sessionFocus, sessionGoal);

  if (/full body/i.test(focus) && sessionGoal === 'Fuerza' && !selected.some((e) => e.patronMovimiento === 'Traccion_V')) {
    const pick = pickPatternExercise(
      'Traccion_V',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      sessionFocus,
      sessionMuscles,
      goal,
    );
    if (pick) {
      selected.push({ ...pick, fromContinuity: false });
      usedIds.add(pick.id);
    }
  }
}

function ensureFuerzaLowerMainSlots(selected, sessionFocus, sessionGoal) {
  if (sessionGoal !== 'Fuerza') return;
  const focus = (sessionFocus ?? '').toLowerCase();
  if (!/lower|legs|pierna/i.test(focus)) return;

  const isHingeCompound = (ex) => {
    const name = (ex.nombre ?? ex.exerciseName ?? '').toLowerCase();
    if (isGoodMorningExercise(ex) || isBallisticExercise(ex)) return false;
    if (/pull through|pull-through|patada|kickback|abducci|curl de piernas|leg curl|curl femoral/i.test(name)) {
      return false;
    }
    if (ex.patronMovimiento === 'Cadera' || (ex.parteCuerpo ?? ex.muscleGroup) === 'Isquiotibiales') {
      return /rdl|rumano|stiff|peso muerto|deadlift|hip thrust/i.test(name) || (ex.prioridad ?? 3) === 1;
    }
    return false;
  };

  const isKneeCompound = (ex) =>
    ex.patronMovimiento === 'Rodilla' && (ex.prioridad ?? 3) <= 2;

  let mainSlots = selected.filter((ex) => (ex.prioridad ?? 3) === 1).length;
  for (const ex of selected) {
    if (mainSlots >= 2) break;
    if ((ex.prioridad ?? 3) === 1 || ex.fuerzaMainSlot) continue;
    if (!isHingeCompound(ex) && !isKneeCompound(ex)) continue;
    ex.fuerzaMainSlot = true;
    mainSlots += 1;
  }
}

function removeStepUpAfterLumbarHinge(selected, usedIds) {
  const hasLumbarHinge = selected.some((e) => {
    if (isGoodMorningExercise(e) || isHeavyLumbarHinge(e)) return true;
    const name = (e.nombre ?? e.exerciseName ?? '').toLowerCase();
    return /rdl|rumano|stiff|peso muerto|deadlift/i.test(name);
  });
  if (!hasLumbarHinge) return;

  for (let i = selected.length - 1; i >= 0; i -= 1) {
    if (isStepUpExercise(selected[i])) {
      usedIds.delete(selected[i].id);
      selected.splice(i, 1);
    }
  }
}

function finalizeNovatoFullBodySession(
  selected,
  usedIds,
  sessionFocus,
  sessionGoal,
  sessionMuscles,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  goal,
  trainingDaysPerWeek,
) {
  if (safetyProfile?.experienceLevel !== 'Novato') return selected;
  if (!/full body/i.test(sessionFocus ?? '') || sessionGoal === 'Fuerza') return selected;

  ensureNovatoHamstringStimulus(
    selected,
    usedIds,
    sessionFocus,
    sessionMuscles,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
    goal,
    sessionGoal,
    trainingDaysPerWeek,
  );
  ensureNovatoArmsLowFreq(
    selected,
    usedIds,
    sessionFocus,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
    sessionMuscles,
    goal,
    trainingDaysPerWeek,
  );

  return trimNonEssentialForNovatoArms(
    selected,
    usedIds,
    7,
    safetyProfile,
    trainingDaysPerWeek,
    sessionFocus,
    sessionGoal,
  );
}

function pickFuerzaHamstringExercise(
  selected,
  usedIds,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  sessionMuscles,
  sessionFocus,
  goal,
  trainingDaysPerWeek = 3,
) {
  const candidates = catalog
    .filter((ex) => (ex.parteCuerpo ?? ex.muscleGroup) === 'Isquiotibiales')
    .filter((ex) => !excludeSet.has(ex.id))
    .filter((ex) => !usedIds.has(ex.id))
    .filter((ex) => !AUTO_SELECT_EXCLUDE.has(ex.id))
    .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
    .filter((ex) => !isGoodMorningExercise(ex))
    .filter((ex) => !isBallisticExercise(ex))
    .filter((ex) => passesInjuryExerciseFilter(ex, safetyProfile))
    .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
    .filter((ex) => passesMainstreamExerciseFilter(ex))
    .filter((ex) => passesDifficultyFilter(ex))
    .filter((ex) => isGymExercise(ex))
    .filter((ex) => passesGymEquipmentFilter(ex))
    .filter((ex) => passesBodyweightLoadFilter(ex, selected))
    .filter((ex) => passesHingeFatigueFilter(ex, selected))
    .filter((ex) =>
      passesClinicalSafetyFilter(ex, safetyProfile, sessionFocus, sessionMuscles, goal),
    )
    .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
    .sort((a, b) => {
      const curlRank = (ex) =>
        /curl de piernas|curl femoral|leg curl|hamstring curl/i.test(ex.nombre ?? '') ? 0 : 1;
      const curlDiff = curlRank(a) - curlRank(b);
      if (curlDiff !== 0) return curlDiff;
      return (a.prioridad ?? 3) - (b.prioridad ?? 3);
    });

  return candidates[0] ?? null;
}

function makeRoomForFuerzaHamstring(selected, usedIds, sessionGoal, sessionFocus) {
  if (sessionGoal !== 'Fuerza' || !/full body/i.test(sessionFocus ?? '')) return;
  if (selected.length < 6) return;
  const coreIdx = selected.findIndex((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Core');
  if (coreIdx >= 0) {
    usedIds.delete(selected[coreIdx].id);
    selected.splice(coreIdx, 1);
  }
}

function ensureFuerzaFullBodyHamstringsPostTrim(
  selected,
  usedIds,
  sessionFocus,
  sessionGoal,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  sessionMuscles,
  goal,
) {
  if (sessionGoal !== 'Fuerza' || !/full body/i.test(sessionFocus ?? '')) return;
  if (selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Isquiotibiales')) return;

  makeRoomForFuerzaHamstring(selected, usedIds, sessionGoal, sessionFocus);

  const pick = pickFuerzaHamstringExercise(
    selected,
    usedIds,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    maxPerPattern,
    sessionMuscles,
    sessionFocus,
    goal,
  );
  if (!pick) return;
  selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
  usedIds.add(pick.id);
}

function ensureKneeLegHamstringBalance(
  selected,
  usedIds,
  sessionFocus,
  sessionMuscles,
  catalog,
  safetyProfile,
  weekNumber,
  excludeSet,
  avoidPatterns,
  maxPerPattern,
  goal,
) {
  if (!hasKneeLimitation(safetyProfile)) return;
  if (!/dominante rodilla/i.test(sessionFocus ?? '')) return;
  if (selected.some((e) => (e.parteCuerpo ?? e.muscleGroup) === 'Isquiotibiales')) return;

  const pick =
    pickPatternExercise(
      'Cadera',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      sessionFocus,
      sessionMuscles,
      goal,
    ) ??
    pickAccessoryForMuscle(
      'Isquiotibiales',
      selected,
      usedIds,
      catalog,
      safetyProfile,
      weekNumber,
      excludeSet,
      avoidPatterns,
      maxPerPattern,
      sessionMuscles,
      sessionFocus,
      goal,
    );

  if (!pick) return;
  selected.push({ ...pick, fromContinuity: false, accessorySlot: true });
  usedIds.add(pick.id);
}

function passesPullPatternFilter(exercise, pattern, sessionMuscles) {
  if (!sessionMuscles?.includes('Espalda')) return true;
  if (pattern !== 'Traccion_H' && pattern !== 'Traccion_V') return true;

  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();

  if (muscle === 'Espalda') return true;
  if (/remo vertical|upright row/i.test(name)) return false;
  return false;
}

function passesClinicalSafetyFilter(exercise, safetyProfile, sessionFocus, sessionMuscles, goal) {
  if (isUprightRowExercise(exercise)) return false;
  if (isNicheTricepsExercise(exercise)) return false;

  const avoid = new Set(safetyProfile?.avoidPatterns ?? []);
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  const focus = (sessionFocus ?? '').toLowerCase();
  const sessionGoal = resolveSessionGoal(sessionFocus, goal);

  if (hasShoulderLimitation(safetyProfile)) {
    if (/elevaci[oó]n lateral|lateral raise/i.test(name)) return false;
    if (/curl.*agarre ancho|wide grip.*curl|curl de b[ií]ceps con barra agarre ancho/i.test(name)) {
      return false;
    }
    if (isWideGripPulldown(exercise)) return false;
  }

  if (avoid.has('Hombro') || avoid.has('Empuje_V')) {
    if (isUprightRowExercise(exercise)) return false;
  }

  if (isGoodMorningExercise(exercise)) {
    if (safetyProfile?.conservative || safetyProfile?.experienceLevel === 'Novato') return false;
    if (avoid.has('Cadera') || avoid.has('Rodilla')) return false;
    if (sessionGoal === 'Fuerza' && /lower|legs|pierna/i.test(focus)) return false;
  }

  if (sessionGoal === 'Fuerza') {
    if (/m[aá]quina de abducci[oó]n/i.test(name)) return false;
    if (/elevaci[oó]n lateral|lateral raise/i.test(name)) return false;
    if (/fondos|parallel bar|bar dip|\bdip\b/i.test(name)) return false;
    if (isBallisticExercise(exercise)) return false;
    if (
      (exercise.prioridad ?? 3) === 1 &&
      /flexion|push-up|pushup|flexiones/i.test(name)
    ) {
      return false;
    }
  }

  if (safetyProfile?.conservative && /fondos|parallel bar|bar dip|\bdip\b/i.test(name)) {
    return false;
  }

  if (isPullBiasedSession(sessionMuscles, sessionFocus)) {
    if (
      exercise.patronMovimiento === 'Empuje_V' &&
      (exercise.parteCuerpo ?? exercise.muscleGroup) === 'Hombro'
    ) {
      return false;
    }
  }

  if (!passesKneeLimitationFilter(exercise, safetyProfile)) return false;
  if (!passesWristLimitationFilter(exercise, safetyProfile)) return false;

  return true;
}

function accessoryTargetCount(
  muscle,
  sessionMuscles,
  sessionFocus,
  sessionGoal = 'Hipertrofia',
  safetyProfile = {},
  trainingDaysPerWeek = 3,
) {
  if (sessionGoal === 'Fuerza' && muscle === 'Pantorrillas' && /full body/i.test(sessionFocus ?? '')) {
    return 1;
  }
  if (
    muscle === 'Espalda' &&
    safetyProfile?.experienceLevel === 'Novato' &&
    trainingDaysPerWeek <= 2 &&
    /full body/i.test(sessionFocus ?? '')
  ) {
    return 1;
  }
  if (
    muscle === 'Isquiotibiales' &&
    safetyProfile?.experienceLevel === 'Novato' &&
    /full body/i.test(sessionFocus ?? '')
  ) {
    return 1;
  }
  if (
    muscle === 'Cuádriceps' &&
    safetyProfile?.experienceLevel === 'Novato' &&
    /full body/i.test(sessionFocus ?? '')
  ) {
    return 0;
  }
  if (muscle === 'Bíceps' && isPullBiasedSession(sessionMuscles, sessionFocus)) {
    return MAX_BICEPS_EXERCISES_PULL;
  }
  if (muscle === 'Bíceps' && /full body accesorios/i.test(sessionFocus ?? '')) {
    return 1;
  }
  if (
    (muscle === 'Bíceps' || muscle === 'Tríceps') &&
    sessionMuscles.includes('Pecho') &&
    sessionMuscles.includes('Espalda')
  ) {
    return 1;
  }
  return SPLIT_VOLUME_ACCESSORY_MUSCLES.has(muscle) ? 2 : 1;
}

function passesInjuryExerciseFilter(exercise, safetyProfile) {
  const avoid = new Set(safetyProfile?.avoidPatterns ?? []);
  const name = (exercise.nombre ?? '').toLowerCase();

  if (hasKneeLimitation(safetyProfile) && !passesKneeLimitationFilter(exercise, safetyProfile)) {
    return false;
  }

  if (hasWristLimitation(safetyProfile) && !passesWristLimitationFilter(exercise, safetyProfile)) {
    return false;
  }

  if (avoid.has('Rodilla')) {
    if (exercise.patronMovimiento === 'Rodilla') return false;
    if (/snatch|arrancada|clean|jerk|salt|plyo|jump|explosiv|estocada/i.test(name)) return false;
    if (isGoodMorningExercise(exercise)) return false;
  }

  if (avoid.has('Empuje_V')) {
    if (exercise.patronMovimiento === 'Empuje_V') return false;
    if (/snatch|arrancada|clean|jerk/i.test(name)) return false;
    if (isUprightRowExercise(exercise)) return false;
  }

  if (avoid.has('Cadera') && exercise.patronMovimiento === 'Cadera') {
    if (/peso muerto|deadlift|good morning|buenos d[ií]as|swing|kettlebell/i.test(name)) return false;
  }

  if (hasLowBackLimitation(safetyProfile)) {
    if (/peso muerto|deadlift|good morning|buenos d[ií]as|swing|kettlebell/i.test(name)) return false;
    if (isGoodMorningExercise(exercise)) return false;
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
    rotationExcludeIds = [],
    weekNumber = 1,
    sessionMuscles = [],
    mesocycleId = null,
    trainingDaysPerWeek = 3,
    continuityOverrides = {},
  } = options;
  const sessionGoal = resolveSessionGoal(sessionFocus, goal);
  const effectiveMaxPerPattern = sessionGoal === 'Fuerza' ? 1 : maxPerPattern;
  const excludeSet = new Set(excludeIds);
  const rotationExcludeSet = new Set(rotationExcludeIds);
  const patternExcludeSet = (allowRotationRepeats = false) =>
    allowRotationRepeats ? excludeSet : new Set([...excludeIds, ...rotationExcludeIds]);
  const requiredPatterns = adjustPatternsForNovatoLowFreq(
    resolvePatternsForSafety(
      SESSION_FOCUS_PATTERN_MAP[sessionFocus] ?? inferPatternsFromFocus(sessionFocus),
      safetyProfile,
    ),
    sessionFocus,
    safetyProfile,
    trainingDaysPerWeek,
  );

  const patternSlotLimit = (pattern) => {
    if (pattern === 'Core') return 1;
    if (safetyProfile?.experienceLevel === 'Novato' && pattern === 'Empuje_H') return 1;
    if (safetyProfile?.experienceLevel === 'Novato' && pattern === 'Rodilla') return 1;
    if (
      safetyProfile?.experienceLevel === 'Novato' &&
      pattern === 'Cadera' &&
      /full body/i.test(sessionFocus ?? '')
    ) {
      return 1;
    }
    return effectiveMaxPerPattern;
  };

  const avoidPatterns = new Set(safetyProfile?.avoidPatterns ?? []);
  const modifyPatterns = new Set(safetyProfile?.modifyPatterns ?? []);

  const continuityExercises = getContinuityExercises(
    history,
    sessionFocus,
    mesocycleId,
    continuityOverrides,
  );

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
      for (const ex of resolvedContinuity) {
        if (!usedIds.has(ex.id)) {
          selected.push({ ...ex, fromContinuity: true });
          usedIds.add(ex.id);
        }
      }
      continue;
    }

    const candidates = catalog
      .filter((ex) => ex.patronMovimiento === pattern)
      .filter((ex) => !patternExcludeSet(false).has(ex.id))
      .filter((ex) => !AUTO_SELECT_EXCLUDE.has(ex.id))
      .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
      .filter((ex) => passesInjuryExerciseFilter(ex, safetyProfile))
      .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
      .filter((ex) => passesMainstreamExerciseFilter(ex))
      .filter((ex) => passesDifficultyFilter(ex))
      .filter((ex) => isGymExercise(ex))
      .filter((ex) => passesGymEquipmentFilter(ex))
      .filter((ex) => passesBodyweightLoadFilter(ex, selected))
      .filter((ex) => passesHingeFatigueFilter(ex, selected))
      .filter((ex) => passesPullPatternFilter(ex, pattern, sessionMuscles))
      .filter((ex) => passesRedundantPecFilter(ex, selected, safetyProfile))
      .filter((ex) =>
        passesRedundantBackFilter(ex, selected, safetyProfile, sessionFocus, trainingDaysPerWeek),
      )
      .filter((ex) => passesRedundantQuadFilter(ex, selected, safetyProfile))
      .filter((ex) =>
        passesClinicalSafetyFilter(ex, safetyProfile, sessionFocus, sessionMuscles, goal),
      )
      .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
      .sort((a, b) => {
        const aBallistic = sessionGoal === 'Fuerza' && isBallisticExercise(a) ? 1 : 0;
        const bBallistic = sessionGoal === 'Fuerza' && isBallisticExercise(b) ? 1 : 0;
        if (aBallistic !== bBallistic) return aBallistic - bBallistic;
        const stimulusDiff = stimulusSelectionScore(selected, a) - stimulusSelectionScore(selected, b);
        if (stimulusDiff !== 0) return stimulusDiff;
        const muscleDiff =
          sessionMuscleRank(a, sessionMuscles) - sessionMuscleRank(b, sessionMuscles);
        if (muscleDiff !== 0) return muscleDiff;
        const priorityDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
        if (priorityDiff !== 0) return priorityDiff;
        const diffDiff = difficultyRank(a) - difficultyRank(b);
        if (diffDiff !== 0) return diffDiff;
        const equipmentDiff = prefersEquipmentByExperience(
          a,
          b,
          safetyProfile?.experienceLevel,
        );
        if (equipmentDiff !== 0) return equipmentDiff;
        if (modifyPatterns.has(pattern) && safetyProfile?.conservative) {
          return prefersMachine(a, b);
        }
        if (hasKneeLimitation(safetyProfile) && pattern === 'Rodilla') {
          const kneeRank = (ex) => {
            if (isKneeOpenChainQuadExtension(ex)) return 99;
            return /prensa|leg press|hack|m[aá]quina|smith/i.test(ex.nombre ?? '') ? 0 : 1;
          };
          const kneeDiff = kneeRank(a) - kneeRank(b);
          if (kneeDiff !== 0) return kneeDiff;
        }
        if (hasKneeLimitation(safetyProfile) && pattern === 'Cadera') {
          const hamRank = (ex) => (isKneeSafeHamstringExercise(ex) ? 0 : 99);
          const hamDiff = hamRank(a) - hamRank(b);
          if (hamDiff !== 0) return hamDiff;
        }
        if (hasShoulderLimitation(safetyProfile) && pattern === 'Traccion_V') {
          const gripRank = (ex) => {
            const n = ex.nombre ?? '';
            if (/ancho|wide/i.test(n)) return 99;
            if (/neutro|supino|cerrado|palmas enfrentadas|underhand|parallel/i.test(n)) return 0;
            return 1;
          };
          const gripDiff = gripRank(a) - gripRank(b);
          if (gripDiff !== 0) return gripDiff;
        }
        if (safetyProfile?.experienceLevel === 'Novato' && pattern === 'Cadera') {
          const novatoCaderaRank = (ex) => {
            const n = ex.nombre ?? '';
            if (/hip thrust con barra|barbell hip thrust/i.test(n)) return 99;
            if (/curl de piernas|curl femoral|leg curl|hamstring|femoral/i.test(n)) return 0;
            if (/puente|glute bridge|m[aá]quina/i.test(n)) return 1;
            return 2;
          };
          const novatoDiff = novatoCaderaRank(a) - novatoCaderaRank(b);
          if (novatoDiff !== 0) return novatoDiff;
        }
        if (/dominante cadera/i.test(sessionFocus ?? '') && pattern === 'Cadera') {
          const hipRank = (ex) => {
            if (isGoodMorningExercise(ex)) return 99;
            if (isHipThrustExercise(ex)) return 0;
            if (/curl de piernas|curl femoral|leg curl|nordic/i.test(ex.nombre ?? '')) return 1;
            return 2;
          };
          const hipDiff = hipRank(a) - hipRank(b);
          if (hipDiff !== 0) return hipDiff;
        }
        if (
          sessionGoal === 'Fuerza' &&
          pattern === 'Cadera' &&
          /lower|legs|pierna/i.test((sessionFocus ?? '').toLowerCase())
        ) {
          const caderaRank = (ex) => {
            if (isGoodMorningExercise(ex)) return 99;
            if (/rumano|rdl|stiff|hip thrust|prensa/i.test(ex.nombre ?? '')) return 0;
            return 1;
          };
          const caderaDiff = caderaRank(a) - caderaRank(b);
          if (caderaDiff !== 0) return caderaDiff;
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

  for (const stub of continuityExercises) {
    if (usedIds.has(stub.id)) continue;
    const full = catalog.find((c) => c.id === stub.id);
    if (!full) continue;
    if (
      !passesClinicalSafetyFilter(full, safetyProfile, sessionFocus, sessionMuscles, goal) ||
      !passesGymEquipmentFilter(full)
    ) {
      continue;
    }
    selected.push({ ...full, fromContinuity: true });
    usedIds.add(full.id);
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
    effectiveMaxPerPattern,
    sessionFocus,
    goal,
    sessionGoal,
    trainingDaysPerWeek,
  );

  ensureFuerzaSessionMinimums(
    selected,
    usedIds,
    sessionMuscles,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    sessionFocus,
    goal,
    sessionGoal,
  );

  ensurePhulAccesoriosMinimums(
    selected,
    usedIds,
    sessionFocus,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    sessionMuscles,
    goal,
    avoidPatterns,
    effectiveMaxPerPattern,
  );

  trimPhulAccesoriosSession(selected, usedIds, sessionFocus, sessionGoal);

  ensurePhulAccesoriosBicepsAfterTrim(
    selected,
    usedIds,
    sessionFocus,
    sessionGoal,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    sessionMuscles,
    goal,
  );

  ensureHipDominantLegStructure(
    selected,
    usedIds,
    sessionFocus,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    sessionMuscles,
    goal,
    avoidPatterns,
    effectiveMaxPerPattern,
  );

  ensureKneeLegHamstringBalance(
    selected,
    usedIds,
    sessionFocus,
    sessionMuscles,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    goal,
  );

  ensureNovatoHamstringStimulus(
    selected,
    usedIds,
    sessionFocus,
    sessionMuscles,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    goal,
    sessionGoal,
    trainingDaysPerWeek,
  );

  ensureNovatoArmsLowFreq(
    selected,
    usedIds,
    sessionFocus,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    sessionMuscles,
    goal,
    trainingDaysPerWeek,
  );

  let result = trimSessionExerciseCount(
    selected,
    safetyProfile,
    sessionFocus,
    sessionGoal,
    trainingDaysPerWeek,
  );

  ensureNovatoArmsLowFreq(
    result,
    usedIds,
    sessionFocus,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    sessionMuscles,
    goal,
    trainingDaysPerWeek,
  );

  ensureFuerzaFullBodyLumbarCap(result, usedIds, sessionFocus, sessionGoal);

  ensureFuerzaFullBodyHamstringsPostTrim(
    result,
    usedIds,
    sessionFocus,
    sessionGoal,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    sessionMuscles,
    goal,
  );

  result = finalizeNovatoFullBodySession(
    result,
    usedIds,
    sessionFocus,
    sessionGoal,
    sessionMuscles,
    catalog,
    safetyProfile,
    weekNumber,
    excludeSet,
    avoidPatterns,
    effectiveMaxPerPattern,
    goal,
    trainingDaysPerWeek,
  );

  removeStepUpAfterLumbarHinge(result, usedIds);

  return result;
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
  sessionFocus,
  goal,
  sessionGoal = 'Hipertrofia',
  trainingDaysPerWeek = 3,
) {
  for (const muscle of sessionMuscles) {
    if (!muscle) continue;
    const targetCount = accessoryTargetCount(
      muscle,
      sessionMuscles,
      sessionFocus,
      sessionGoal,
      safetyProfile,
      trainingDaysPerWeek,
    );

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
        sessionMuscles,
        sessionFocus,
        goal,
        trainingDaysPerWeek,
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

function patternCapacityMax(selected, pattern, maxPerPattern, sessionFocus, goal) {
  if (pattern === 'Core') return 1;
  const sessionGoal = resolveSessionGoal(sessionFocus, goal);
  const focus = (sessionFocus ?? '').toLowerCase();
  if (sessionGoal === 'Fuerza' && pattern === 'Cadera' && /lower|legs|pierna/i.test(focus)) {
    return 2;
  }
  return maxPerPattern;
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
  sessionMuscles,
  sessionFocus,
  goal,
  trainingDaysPerWeek = 3,
) {
  const muscleFilter = ACCESSORY_MUSCLE_FILTERS[muscle];
  const accessoryCtx = { sessionMuscles, sessionFocus, goal };

  const candidates = catalog
    .filter((ex) => ex.parteCuerpo === muscle)
    .filter((ex) => !excludeSet.has(ex.id))
    .filter((ex) => !usedIds.has(ex.id))
    .filter((ex) => !AUTO_SELECT_EXCLUDE.has(ex.id))
    .filter((ex) => !avoidPatterns.has(ex.patronMovimiento))
    .filter((ex) => passesInjuryExerciseFilter(ex, safetyProfile))
    .filter((ex) =>
      passesClinicalSafetyFilter(ex, safetyProfile, sessionFocus, sessionMuscles, goal),
    )
    .filter((ex) => isGymExercise(ex))
    .filter((ex) => passesGymEquipmentFilter(ex))
    .filter((ex) => passesBodyweightLoadFilter(ex, selected))
    .filter((ex) => passesHingeFatigueFilter(ex, selected))
    .filter((ex) => !/muñeca|wrist|antebrazo/i.test(ex.nombre ?? ''))
    .filter((ex) => passesRedundantQuadFilter(ex, selected, safetyProfile))
    .filter((ex) => passesRedundantPecFilter(ex, selected, safetyProfile))
    .filter((ex) =>
      passesRedundantBackFilter(ex, selected, safetyProfile, sessionFocus, trainingDaysPerWeek),
    )
    .filter((ex) =>
      muscleFilter ? muscleFilter(ex, safetyProfile, accessoryCtx) : ex.patronMovimiento !== 'General',
    )
    .filter((ex) =>
      hasPatternCapacity(
        selected,
        ex.patronMovimiento,
        patternCapacityMax(selected, ex.patronMovimiento, maxPerPattern, sessionFocus, goal),
        { accessoryMuscle: muscle },
      ),
    )
    .filter((ex) => passesConservativeFilter(ex, safetyProfile, weekNumber))
    .filter((ex) => passesExperienceExerciseFilter(ex, safetyProfile))
    .filter((ex) => passesMainstreamExerciseFilter(ex))
    .filter((ex) => passesDifficultyFilter(ex))
    .filter((ex) => hasDistinctStimulusForMuscle(selected, ex))
    .sort((a, b) => {
      if (safetyProfile?.experienceLevel === 'Novato' && muscle === 'Bíceps') {
        const novatoCurlRank = (ex) => {
          const n = ex.nombre ?? '';
          if (isNovatoNicheCurlExercise(ex)) return 99;
          if (/martillo|hammer|polea|m[aá]quina|barra/i.test(n)) return 0;
          return 1;
        };
        const curlDiff = novatoCurlRank(a) - novatoCurlRank(b);
        if (curlDiff !== 0) return curlDiff;
      }
      const stimulusDiff = stimulusSelectionScore(selected, a) - stimulusSelectionScore(selected, b);
      if (stimulusDiff !== 0) return stimulusDiff;
      const priorityDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
      if (priorityDiff !== 0) return priorityDiff;
      const diffDiff = difficultyRank(a) - difficultyRank(b);
      if (diffDiff !== 0) return diffDiff;
      const equipmentDiff = prefersEquipmentByExperience(
        a,
        b,
        safetyProfile?.experienceLevel,
      );
      if (equipmentDiff !== 0) return equipmentDiff;
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
        passesExperienceExerciseFilter(ex, safetyProfile) &&
        passesMainstreamExerciseFilter(ex)
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
        passesGymEquipmentFilter(candidate) &&
        passesBodyweightLoadFilter(candidate, [exercise]) &&
        passesConservativeFilter(candidate, safetyProfile, weekNumber) &&
        passesExperienceExerciseFilter(candidate, safetyProfile) &&
        passesMainstreamExerciseFilter(candidate) &&
        passesDifficultyFilter(candidate) &&
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
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (safetyProfile?.conservative) {
    if (/fondos|parallel bar|bar dip|\bdip\b/i.test(name)) return false;
    if (weekNumber <= 2 && isAxialFreeWeight(exercise)) return false;
  }
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
 * @param {object[]} [mesocycleExerciseIndex]
 * @returns {string[]}
 */
export function getMesocycleRotationExclusions(
  history,
  mesocycleId,
  weekNumber,
  sessionFocus,
  mesocycleExerciseIndex = [],
) {
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

  const usedIds = new Set();
  for (const prevId of previousMesocycleIds) {
    const anchor =
      history.find(
        (s) =>
          s.mesocycleId === prevId &&
          s.sessionFocus === sessionFocus &&
          s.weekNumber === 1 &&
          s.mainBlock?.length,
      ) ??
      history.find(
        (s) => s.mesocycleId === prevId && s.sessionFocus === sessionFocus && s.mainBlock?.length,
      );
    for (const block of anchor?.mainBlock ?? []) {
      if (block.exerciseId) usedIds.add(block.exerciseId);
    }
  }

  return [...new Set([...usedIds, ...getRotationIdsFromIndex(mesocycleExerciseIndex, mesocycleId, sessionFocus)])];
}

function getContinuityExercises(history, sessionFocus, mesocycleId, continuityOverrides = {}) {
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

  const replacements = getSessionContinuityReplacements(
    continuityOverrides,
    mesocycleId,
    sessionFocus,
  );

  const stubs = anchorSession.mainBlock.map((block) => ({
    id: block.exerciseId,
    nombre: block.exerciseName,
    patronMovimiento: block.movementPattern,
    parteCuerpo: block.muscleGroup,
    prioridad: block.priority ?? 2,
    equipo: block.equipo ?? [],
    isBodyweight: block.isBodyweight ?? block.loadMode === 'bodyweight',
    loadMode: block.loadMode ?? null,
    repRangeOverride: block.repRangeOverride ?? null,
    plateauRepRangeChanged: block.plateauRepRangeChanged ?? false,
    swappedFromPlateau: block.swappedFrom ?? null,
  }));

  return applyContinuityReplacements(stubs, replacements);
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

function hasFreeWeightEquipment(exercise) {
  const equipo = exercise.equipo ?? [];
  const arr = Array.isArray(equipo) ? equipo : [equipo];
  return arr.some((e) =>
    /barra ol[ií]mpica|mancuerna|kettlebell|rack de potencia|disco|barra z|barra hex/i.test(
      String(e),
    ),
  );
}

function prefersEquipmentByExperience(a, b, experienceLevel) {
  const level = experienceLevel ?? 'Intermedio';
  if (level === 'Novato') return prefersMachine(a, b);
  if (level === 'Intermedio' || level === 'Avanzado') {
    const aFree = hasFreeWeightEquipment(a);
    const bFree = hasFreeWeightEquipment(b);
    if (aFree && !bFree) return -1;
    if (!aFree && bFree) return 1;
  }
  return 0;
}

function hasMachineEquipment(exercise) {
  const equipo = exercise.equipo ?? [];
  const arr = Array.isArray(equipo) ? equipo : [equipo];
  return arr.some((e) =>
    /máquina|maquina|selectorizada|polea|smith|prensa/i.test(String(e)),
  );
}
