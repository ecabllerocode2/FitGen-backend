import { REP_RANGES, REST_SECONDS, RIR_PROGRESSION, EXERCISE_TYPES, MAX_SETS_PER_EXERCISE } from '../constants.js';
import { isBodyweightExercise } from '../exerciseSelection/bodyweight.js';

/** Upright rows — high shoulder impingement risk (Escamilla et al.). */
const UPRIGHT_ROW_RE =
  /remo vertical|upright row|elevaci[oó]n lateral de hombros \(remo vertical\)/i;

const NICHE_TRICEPS_IDS = new Set([
  'one_arm_pronated_dumbbell_triceps_extension',
  'one_arm_supinated_dumbbell_triceps_extension',
  'Dumbbell_One-Arm_Triceps_Extension',
]);

const UPRIGHT_ROW_IDS = new Set([
  'Upright_Row_-_With_Bands',
  'Dumbbell_One-Arm_Upright_Row',
  'Dumbbell_Raise',
  'Single_Dumbbell_Raise',
  'Upright_Barbell_Row',
  'Upright_Cable_Row',
]);

/**
 * Session-level goal overrides mesocycle goal (PHUL H/L days, etc.).
 * @param {string} sessionFocus
 * @param {'Hipertrofia'|'Fuerza'} mesocycleGoal
 * @returns {'Hipertrofia'|'Fuerza'}
 */
export function resolveSessionGoal(sessionFocus, mesocycleGoal = 'Hipertrofia') {
  const focus = (sessionFocus ?? '').toLowerCase();
  if (/hipertrofia|volumen alto|accesorios/i.test(focus)) return 'Hipertrofia';
  if (/fuerza/i.test(focus)) return 'Fuerza';
  return mesocycleGoal;
}

export function isUprightRowExercise(exercise) {
  const id = exercise?.id ?? exercise?.exerciseId ?? '';
  if (UPRIGHT_ROW_IDS.has(id)) return true;
  const name = exercise?.nombre ?? exercise?.exerciseName ?? '';
  return UPRIGHT_ROW_RE.test(name);
}

export function isNicheTricepsExercise(exercise) {
  const id = (exercise?.id ?? exercise?.exerciseId ?? '').toLowerCase();
  if (NICHE_TRICEPS_IDS.has(id)) return true;
  const name = (exercise?.nombre ?? exercise?.exerciseName ?? '').toLowerCase();
  return (
    /supina agarre|one.?arm.*triceps|tr[ií]ceps.*una mano|press.*suelo|floor press/i.test(name) &&
    !/extensi[oó]n.*tr[ií]ceps|pushdown|fondos en paralelas/i.test(name)
  );
}

export function isGoodMorningExercise(exercise) {
  return /buenos d[ií]as|good morning/i.test(
    (exercise?.nombre ?? exercise?.exerciseName ?? '').toLowerCase(),
  );
}

/**
 * @param {object} weekPlan
 * @param {'Hipertrofia'|'Fuerza'} sessionGoal
 * @param {number} accumulationWeeks
 * @param {boolean} isAccessory
 */
export function resolveSessionRir(weekPlan, sessionGoal, accumulationWeeks, isAccessory = false) {
  const week = weekPlan?.week ?? 1;
  const isDeload = weekPlan?.isDeload ?? false;

  const plannedRir = isAccessory
    ? weekPlan?.rirObjetivoAccessory ?? weekPlan?.rirObjetivo
    : weekPlan?.rirObjetivo;
  if (plannedRir != null && Number.isFinite(plannedRir)) {
    return plannedRir;
  }

  const prog =
    sessionGoal === 'Fuerza'
      ? RIR_PROGRESSION.Fuerza[isAccessory ? 'accessory' : 'main']
      : RIR_PROGRESSION.Hipertrofia;

  if (isDeload) {
    const lastAccum = interpolateRIR(prog.week1, prog.accumulationEnd, accumulationWeeks, accumulationWeeks);
    return Math.round((lastAccum + prog.deloadDelta) * 10) / 10;
  }
  return interpolateRIR(prog.week1, prog.accumulationEnd, week, accumulationWeeks);
}

function interpolateRIR(start, end, week, totalWeeks) {
  if (totalWeeks <= 1) return start;
  const t = (week - 1) / (totalWeeks - 1);
  return Math.round((start + t * (end - start)) * 10) / 10;
}

/**
 * Primary lift for ramp sets and exercise order (specificity — Bompa & Haff).
 * @param {object[]} exercises
 * @param {string} sessionFocus
 * @param {string[]} patterns
 * @returns {string|null}
 */
export function resolvePriorityLiftId(
  exercises,
  sessionFocus,
  patterns = [],
  sessionGoal = 'Hipertrofia',
) {
  const focus = (sessionFocus ?? '').toLowerCase();
  if (sessionGoal !== 'Fuerza') return null;

  const loadable = (ex) =>
    !isBodyweightExercise(ex) &&
    (ex.prioridad ?? 3) === 1 &&
    ex.patronMovimiento !== 'General';

  if (/upper/i.test(focus) || /\bpush\b/.test(focus) || /empuje/i.test(focus)) {
    const bench =
      exercises.find(
        (ex) =>
          loadable(ex) &&
          ex.patronMovimiento === 'Empuje_H' &&
          (ex.parteCuerpo ?? ex.muscleGroup) === 'Pecho',
      ) ??
      exercises.find((ex) => loadable(ex) && ex.patronMovimiento === 'Empuje_V');
    return bench?.id ?? null;
  }

  if (/lower/i.test(focus) || /\blegs\b/.test(focus) || /pierna/i.test(focus)) {
    const knee =
      exercises.find((ex) => loadable(ex) && ex.patronMovimiento === 'Rodilla') ??
      exercises.find((ex) => loadable(ex) && ex.patronMovimiento === 'Cadera');
    return knee?.id ?? null;
  }

  if (/\bpull\b/.test(focus) || /tracci/i.test(focus)) {
    const row =
      exercises.find((ex) => loadable(ex) && ex.patronMovimiento === 'Traccion_H') ??
      exercises.find((ex) => loadable(ex) && ex.patronMovimiento === 'Traccion_V');
    return row?.id ?? null;
  }

  const patternOrder = patterns.filter((p) => p !== 'Core');
  for (const pattern of patternOrder) {
    const match = exercises.find((ex) => loadable(ex) && ex.patronMovimiento === pattern);
    if (match) return match.id;
  }
  return exercises.find(loadable)?.id ?? null;
}

const PATTERN_ORDER_FUERZA_LOWER = ['Rodilla', 'Cadera', 'Traccion_H', 'Traccion_V', 'Empuje_H', 'Empuje_V'];
const PATTERN_ORDER_FUERZA_UPPER = ['Empuje_H', 'Traccion_H', 'Traccion_V', 'Empuje_V'];
const PATTERN_ORDER_FUERZA_PULL = ['Traccion_H', 'Traccion_V', 'Empuje_V', 'Empuje_H', 'Rodilla', 'Cadera'];
const PATTERN_ORDER_FUERZA_PUSH = ['Empuje_H', 'Empuje_V', 'Traccion_H', 'Traccion_V', 'Rodilla', 'Cadera'];
const PATTERN_ORDER_FUERZA_FULL_BODY = [
  'Traccion_H',
  'Traccion_V',
  'Rodilla',
  'Cadera',
  'Empuje_H',
  'Empuje_V',
];

function patternRank(pattern, sessionFocus) {
  const focus = (sessionFocus ?? '').toLowerCase();
  let order = PATTERN_ORDER_FUERZA_LOWER;
  if (/\bpull\b/.test(focus) || (/tracci[oó]n/i.test(focus) && !/empuje/i.test(focus))) {
    order = PATTERN_ORDER_FUERZA_PULL;
  } else if (/\bpush\b/.test(focus) || /empuje/i.test(focus)) {
    order = PATTERN_ORDER_FUERZA_PUSH;
  } else if (/upper/i.test(focus)) {
    order = PATTERN_ORDER_FUERZA_UPPER;
  } else if (/full body/i.test(focus)) {
    order = PATTERN_ORDER_FUERZA_FULL_BODY;
  } else if (/lower|legs|pierna/i.test(focus)) {
    order = PATTERN_ORDER_FUERZA_LOWER;
  }
  const idx = order.indexOf(pattern);
  return idx === -1 ? 99 : idx;
}

/**
 * Exercise order: priority lift → pattern specificity → compound before isolation.
 */
export function orderExercisesForSession(
  exercises,
  sessionGoal,
  sessionFocus,
  patterns = [],
  priorityLiftId = null,
) {
  const list = [...exercises];

  return list.sort((a, b) => {
    if (priorityLiftId) {
      if (a.id === priorityLiftId) return -1;
      if (b.id === priorityLiftId) return 1;
    }

    if (sessionGoal === 'Fuerza') {
      const aCompound = (a.prioridad ?? 3) === 1;
      const bCompound = (b.prioridad ?? 3) === 1;
      if (aCompound !== bCompound) return aCompound ? -1 : 1;

      const patternDiff =
        patternRank(a.patronMovimiento, sessionFocus) -
        patternRank(b.patronMovimiento, sessionFocus);
      if (patternDiff !== 0) return patternDiff;
      const priDiff = (a.prioridad ?? 3) - (b.prioridad ?? 3);
      if (priDiff !== 0) return priDiff;
      return classifyExercise(a) === EXERCISE_TYPES.COMPOUND ? -1 : 1;
    }

    const order = { compound: 0, accessory: 1, isolation: 2 };
    const aClass = classifyExercise(a);
    const bClass = classifyExercise(b);
    if (order[aClass] !== order[bClass]) return order[aClass] - order[bClass];

    if ((a.parteCuerpo ?? '') === 'Pecho' && (b.parteCuerpo ?? '') === 'Pecho') {
      if (a.patronMovimiento === 'Empuje_H' && b.patronMovimiento !== 'Empuje_H') return -1;
    }

    const aPecHorizontal = a.patronMovimiento === 'Empuje_H' && (a.parteCuerpo ?? '') === 'Pecho';
    const bPecHorizontal = b.patronMovimiento === 'Empuje_H' && (b.parteCuerpo ?? '') === 'Pecho';
    const aShoulderVertical = a.patronMovimiento === 'Empuje_V' && (a.parteCuerpo ?? '') === 'Hombro';
    const bShoulderVertical = b.patronMovimiento === 'Empuje_V' && (b.parteCuerpo ?? '') === 'Hombro';
    if (aPecHorizontal && bShoulderVertical) return -1;
    if (bPecHorizontal && aShoulderVertical) return 1;

    return (a.prioridad ?? 3) - (b.prioridad ?? 3);
  });
}

function classifyExercise(exercise) {
  const priority = exercise.prioridad ?? 3;
  if (priority === 1) return EXERCISE_TYPES.COMPOUND;
  if (priority === 2) return 'accessory';
  return EXERCISE_TYPES.ISOLATION;
}

export function getSessionRepRanges(sessionGoal) {
  return REP_RANGES[sessionGoal] ?? REP_RANGES.Hipertrofia;
}

export function getSessionRestSeconds(sessionGoal) {
  return REST_SECONDS[sessionGoal] ?? REST_SECONDS.Hipertrofia;
}

/** Minimum direct sets per muscle group per session (Schoenfeld volume landmarks). */
export const SESSION_MUSCLE_MIN_SETS = {
  Hipertrofia: 4,
  Fuerza: 3,
};

/** Max direct biceps exercises on pull-biased sessions (Krieger — diminishing returns). */
export const MAX_BICEPS_EXERCISES_PULL = 1;

/**
 * Ensures each trained muscle in the session meets minimum effective per-session volume.
 */
export function enforceSessionVolumeFloors({
  setsByExerciseId,
  exercises,
  sessionMuscles,
  sessionGoal,
  sessionFocus = '',
  volumeByMuscle = {},
  weeklyMuscleSlotCounts = {},
}) {
  const absoluteMin = SESSION_MUSCLE_MIN_SETS[sessionGoal] ?? 4;
  const dedicated =
    isPushBiasedSession(sessionMuscles, sessionFocus) ||
    isPullBiasedSession(sessionMuscles, sessionFocus);

  for (const muscle of sessionMuscles ?? []) {
    if (!muscle || muscle === 'Core') continue;
    const muscleExercises = exercises.filter((ex) => (ex.parteCuerpo ?? ex.muscleGroup) === muscle);
    if (!muscleExercises.length) continue;

    const weeklySets = volumeByMuscle[muscle] ?? 0;
    const sessionsPerWeek = weeklyMuscleSlotCounts[muscle] ?? 1;
    const proportional =
      weeklySets > 0 ? Math.ceil(weeklySets / sessionsPerWeek) : absoluteMin;
    let minPerMuscle =
      dedicated && sessionGoal === 'Hipertrofia'
        ? Math.max(absoluteMin, proportional)
        : Math.max(2, proportional);

    if (
      sessionGoal === 'Fuerza' &&
      isPullBiasedSession(sessionMuscles, sessionFocus) &&
      muscle === 'Bíceps'
    ) {
      minPerMuscle = Math.min(minPerMuscle, 2);
    }

    const total = muscleExercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
    if (total >= minPerMuscle) continue;

    let remaining = minPerMuscle - total;
    const ranked = [...muscleExercises].sort(
      (a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3),
    );
    for (const ex of ranked) {
      if (remaining <= 0) break;
      const add = Math.min(remaining, ex.prioridad === 1 ? remaining : 2);
      setsByExerciseId[ex.id] = (setsByExerciseId[ex.id] ?? 0) + add;
      remaining -= add;
    }
  }

  if (sessionGoal === 'Hipertrofia' && dedicated) {
    for (const ex of exercises) {
      const current = setsByExerciseId[ex.id] ?? 0;
      if (current === 1 && (ex.prioridad ?? 3) >= 2) {
        setsByExerciseId[ex.id] = 2;
      }
    }
  }

  if (sessionGoal === 'Hipertrofia' && /accesorios/i.test(sessionFocus ?? '')) {
    for (const ex of exercises) {
      const current = setsByExerciseId[ex.id] ?? 0;
      if (current === 1) {
        setsByExerciseId[ex.id] = 2;
      }
    }
  }

  if (sessionGoal === 'Hipertrofia' && isPullBiasedSession(sessionMuscles, sessionFocus)) {
    const backExercises = exercises.filter(
      (ex) => (ex.parteCuerpo ?? ex.muscleGroup) === 'Espalda',
    );
    const backSets = backExercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
    const minBackSets = 8;
    if (backSets < minBackSets) {
      let remaining = minBackSets - backSets;
      const ranked = [...backExercises].sort(
        (a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3),
      );
      for (const ex of ranked) {
        while (remaining > 0 && (setsByExerciseId[ex.id] ?? 0) < 5) {
          setsByExerciseId[ex.id] = (setsByExerciseId[ex.id] ?? 0) + 1;
          remaining -= 1;
        }
      }
    }

    const shoulderExercises = exercises.filter(
      (ex) => (ex.parteCuerpo ?? ex.muscleGroup) === 'Hombro',
    );
    if (shoulderExercises.length) {
      const shoulderSets = shoulderExercises.reduce(
        (sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0),
        0,
      );
      if (shoulderSets < absoluteMin) {
        let remaining = absoluteMin - shoulderSets;
        const ranked = [...shoulderExercises].sort(
          (a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3),
        );
        for (const ex of ranked) {
          while (remaining > 0 && (setsByExerciseId[ex.id] ?? 0) < MAX_SETS_PER_EXERCISE.isolation) {
            setsByExerciseId[ex.id] = (setsByExerciseId[ex.id] ?? 0) + 1;
            remaining -= 1;
          }
        }
      }
    }
  }

  if (sessionGoal === 'Hipertrofia' && isPushBiasedSession(sessionMuscles, sessionFocus)) {
    const pecExercises = exercises.filter(
      (ex) =>
        (ex.parteCuerpo ?? ex.muscleGroup) === 'Pecho' &&
        ['Empuje_H', 'Empuje_V'].includes(ex.patronMovimiento),
    );
    const pecSets = pecExercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
    const minPecSets = 6;
    if (pecSets < minPecSets) {
      let remaining = minPecSets - pecSets;
      const ranked = [...pecExercises].sort(
        (a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3),
      );
      for (const ex of ranked) {
        while (remaining > 0 && (setsByExerciseId[ex.id] ?? 0) < 5) {
          setsByExerciseId[ex.id] = (setsByExerciseId[ex.id] ?? 0) + 1;
          remaining -= 1;
        }
      }
    }
  }

  if (/dominante cadera/i.test(sessionFocus ?? '')) {
    const hipExercises = exercises.filter((ex) =>
      /hip thrust|empuje de cadera|glute bridge|puente de gl[uú]teo|patada de gl[uú]teo/i.test(
        ex.nombre ?? ex.exerciseName ?? '',
      ),
    );
    if (hipExercises.length) {
      const hipSets = hipExercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
      if (hipSets < 3) {
        const primary = hipExercises.sort((a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3))[0];
        setsByExerciseId[primary.id] = Math.max(setsByExerciseId[primary.id] ?? 0, 3);
      }
    }
  }

  if (sessionGoal === 'Fuerza') {
    const focus = (sessionFocus ?? '').toLowerCase();
    const calfExercises = exercises.filter((ex) => (ex.parteCuerpo ?? ex.muscleGroup) === 'Pantorrillas');
    const calfCap = /full body/i.test(focus) ? 3 : /lower|legs|pierna/i.test(focus) ? 4 : 2;
    const calfTotal = calfExercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
    if (calfTotal > calfCap) {
      let remaining = calfTotal - calfCap;
      for (const ex of [...calfExercises].reverse()) {
        while (remaining > 0 && (setsByExerciseId[ex.id] ?? 0) > 1) {
          setsByExerciseId[ex.id] -= 1;
          remaining -= 1;
        }
      }
    }

    if (isPullBiasedSession(sessionMuscles, sessionFocus)) {
      const totalSets = exercises.reduce((sum, ex) => sum + (setsByExerciseId[ex.id] ?? 0), 0);
      if (totalSets < 12) {
        const compounds = exercises
          .filter((ex) => (ex.prioridad ?? 3) === 1)
          .sort((a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3));
        let remaining = 12 - totalSets;
        for (const ex of compounds) {
          while (remaining > 0 && (setsByExerciseId[ex.id] ?? 0) < 5) {
            setsByExerciseId[ex.id] = (setsByExerciseId[ex.id] ?? 0) + 1;
            remaining -= 1;
          }
        }
        if (remaining > 0) {
          const accessories = exercises
            .filter((ex) => (ex.prioridad ?? 3) > 1 && (ex.parteCuerpo ?? ex.muscleGroup) !== 'Bíceps')
            .sort((a, b) => (a.prioridad ?? 3) - (b.prioridad ?? 3));
          for (const ex of accessories) {
            while (remaining > 0 && (setsByExerciseId[ex.id] ?? 0) < 4) {
              setsByExerciseId[ex.id] = (setsByExerciseId[ex.id] ?? 0) + 1;
              remaining -= 1;
            }
          }
        }
      }
    }
  }
}

export function isPullBiasedSession(sessionMuscles = [], sessionFocus = '') {
  const focus = sessionFocus.toLowerCase();
  if (/accesorios|full body/i.test(focus)) return false;
  if (/tracci[oó]n|pull/i.test(focus)) return true;
  return (
    sessionMuscles.includes('Espalda') &&
    sessionMuscles.includes('Bíceps') &&
    !sessionMuscles.includes('Pecho')
  );
}

export function isPushBiasedSession(sessionMuscles = [], sessionFocus = '') {
  const focus = sessionFocus.toLowerCase();
  if (/accesorios|full body/i.test(focus)) return false;
  if (/empuje|push/i.test(focus)) return true;
  return (
    sessionMuscles.includes('Pecho') &&
    !sessionMuscles.includes('Espalda')
  );
}
