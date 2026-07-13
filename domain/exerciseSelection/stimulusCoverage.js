/**
 * Regional / angular stimulus coverage per muscle.
 * Uses catalog field `subtipoEstimulo` when present, otherwise infers from nombre + patrón.
 */

export const MUSCLE_STIMULUS_CONFIG = {
  Pecho: {
    avoidDuplicate: true,
    preferFirst: ['horizontal_press', 'incline_press'],
    preferSecond: ['fly_stretch', 'incline_press', 'incline_pushup', 'pushup'],
  },
  Espalda: {
    avoidDuplicate: true,
    preferFirst: ['vertical_pull', 'horizontal_pull'],
    preferSecond: ['horizontal_pull', 'vertical_pull'],
  },
  Hombro: {
    avoidDuplicate: true,
    preferFirst: ['vertical_press', 'lateral_raise'],
    preferSecond: ['lateral_raise', 'rear_delt', 'vertical_press'],
  },
  Cuádriceps: {
    avoidDuplicate: true,
    preferFirst: ['knee_dominant'],
    preferSecond: ['knee_dominant', 'quad_isolation'],
  },
  Isquiotibiales: {
    avoidDuplicate: true,
    preferFirst: ['hip_hinge'],
    preferSecond: ['knee_flexion', 'hip_hinge'],
  },
  Bíceps: {
    avoidDuplicate: true,
    preferFirst: ['supinated_curl'],
    preferSecond: ['neutral_curl', 'incline_curl', 'preacher_curl'],
  },
  Tríceps: {
    avoidDuplicate: true,
    preferFirst: ['elbow_extension'],
    preferSecond: ['overhead_extension', 'compound_triceps', 'elbow_extension'],
  },
  Glúteos: {
    avoidDuplicate: true,
    preferFirst: ['hip_thrust'],
    preferSecond: ['glute_accessory', 'hip_abduction', 'hip_thrust'],
  },
  Pantorrillas: {
    avoidDuplicate: true,
    preferFirst: ['standing_calf'],
    preferSecond: ['seated_calf', 'standing_calf'],
  },
};

function exerciseFields(exercise) {
  return {
    nombre: exercise.nombre ?? exercise.exerciseName ?? '',
    patronMovimiento: exercise.patronMovimiento ?? exercise.movementPattern,
    parteCuerpo: exercise.parteCuerpo ?? exercise.muscleGroup,
  };
}

/**
 * @param {object} exercise
 * @returns {string}
 */
export function resolveStimulusSubtype(exercise) {
  if (exercise.subtipoEstimulo) return exercise.subtipoEstimulo;

  const { nombre, patronMovimiento, parteCuerpo } = exerciseFields(exercise);
  const name = nombre.toLowerCase();
  const muscle = parteCuerpo;
  const pattern = patronMovimiento;

  if (muscle === 'Pecho') {
    if (/flexi[oó]n|push-?up/i.test(name) && /inclin/i.test(name)) return 'incline_pushup';
    if (/flexi[oó]n|push-?up/i.test(name)) return 'pushup';
    if (/inclin|incline/i.test(name)) return 'incline_press';
    if (/declin|decline/i.test(name)) return 'decline_press';
    if (/fly|vuelo|apertura|cross|cruce|pullover|pec deck|alrededor|around/i.test(name)) {
      return 'fly_stretch';
    }
    if (pattern === 'Empuje_H') return 'horizontal_press';
    return 'other_chest';
  }

  if (muscle === 'Espalda') {
    if (pattern === 'Traccion_V' || /dominad|jal[oó]n|pull-up|pullup|pull up/i.test(name)) {
      return 'vertical_pull';
    }
    if (pattern === 'Traccion_H' || /remo|row/i.test(name)) return 'horizontal_pull';
    if (
      pattern === 'Cadera' ||
      /peso muerto|deadlift|rumano|rdl|good morning|buenos d[ií]as|rack pull|tir[oó]n alto/i.test(name)
    ) {
      return 'hip_hinge';
    }
    return 'other_back';
  }

  if (muscle === 'Hombro') {
    if (/lateral|elevaci[oó]n.*lateral/i.test(name)) return 'lateral_raise';
    if (
      /posterior|p[aá]jaro|reverse|face pull|deltoides posterior|apertura.*invers/i.test(name)
    ) {
      return 'rear_delt';
    }
    if (
      pattern === 'Empuje_V' ||
      /press|militar|overhead|push|snatch|clean|jerk|thruster|envi[oó]n|arrancada|cargada/i.test(name)
    ) {
      return 'vertical_press';
    }
    if (/shrug|encogimiento/i.test(name)) return 'shrug';
    return 'other_shoulder';
  }

  if (muscle === 'Cuádriceps') {
    if (/extensi[oó]n.*cu[aá]dr|leg extension/i.test(name)) return 'quad_isolation';
    if (
      pattern === 'Rodilla' ||
      pattern === 'Cadera' ||
      /sentadilla|squat|prensa|leg press|zancada|lunge|estocada|snatch|clean|jerk|salto|hop|sprint|cargada|arrancada/i.test(name)
    ) {
      return 'knee_dominant';
    }
    return 'other_quad';
  }

  if (muscle === 'Isquiotibiales') {
    if (/curl.*femor|leg curl|flexi[oó]n.*rodilla/i.test(name)) return 'knee_flexion';
    if (
      pattern === 'Cadera' ||
      /peso muerto|deadlift|rumano|rdl|good morning|buenos d[ií]as|clean|snatch|cargada|arrancada/i.test(
        name,
      )
    ) {
      return 'hip_hinge';
    }
    if (/adductor|aducci[oó]n/i.test(name)) return 'adductor';
    return 'other_hamstring';
  }

  if (muscle === 'Bíceps') {
    if (/martillo|hammer|neutro/i.test(name)) return 'neutral_curl';
    if (/spider|araña|prono|predicador|preacher|concentrad/i.test(name)) return 'preacher_curl';
    if (/inclinad|incline/i.test(name)) return 'incline_curl';
    return 'supinated_curl';
  }

  if (muscle === 'Tríceps') {
    if (/fondo|dip|cerrado|floor press|press de suelo|press de pecho|board press|pin press|press en rack|bench press|press de banca|jm\b/i.test(name)) {
      return 'compound_triceps';
    }
    if (/supina|overhead|por detr[aá]s|behind|franc[eé]s|skull|rompecr[aá]neos/i.test(name)) {
      return 'overhead_extension';
    }
    if (/pushdown|polea|extensi[oó]n|tr[ií]ceps|jm press|tate/i.test(name)) {
      return 'elbow_extension';
    }
    return 'other_triceps';
  }

  if (muscle === 'Glúteos') {
    if (/hip thrust|empuje.*cadera/i.test(name)) return 'hip_thrust';
    if (/m[aá]quina de abducci[oó]n|abductor/i.test(name)) return 'hip_abduction';
    if (
      /patada|kickback|puente|bridge|abducci[oó]n|pull through|extensi[oó]n.*cadera|hip lift|hip extension|elevaci[oó]n.*cadera|step-up|step up|elevaci[oó]n.*pierna|leg lift|sentadilla arrodillado|kneeling|arrodill|rodillas a sentadilla/i.test(
        name,
      )
    ) {
      return 'glute_accessory';
    }
    return 'other_glute';
  }

  if (muscle === 'Pantorrillas') {
    if (/sentado|seated|s[oó]leo/i.test(name)) return 'seated_calf';
    return 'standing_calf';
  }

  if (muscle === 'Core') {
    if (/plancha|plank|dead\s*bug|ab\s*wheel|rueda\s*abdominal|rollout/i.test(name)) {
      return 'anti_extension';
    }
    if (/pallof|anti-?rot|press\s*pallof/i.test(name)) return 'anti_rotation';
    if (
      /oblicuo|russian\s*twist|bicycle|rotaci[oó]n|molinillo|windmill|giro|judo flip|landmine\s*180/i.test(
        name,
      )
    ) {
      return 'rotation';
    }
    if (
      /crunch|sit-?up|abdominal|flexi[oó]n|elevaci[oó]n.*piernas|leg\s*raise|colgado|pull-?in|encogimiento|puente|bridge|butt-?up|pelvis|bottoms up|codo a rodilla/i.test(
        name,
      )
    ) {
      return 'flexion';
    }
    if (/lateral|side bend|inclinaci[oó]n lateral/i.test(name)) return 'lateral_flexion';
    if (/wood\s*chop|chop|elevaci[oó]n diagonal|tal[oó]n|heel touch|scissor|fallout|sprint/i.test(name)) {
      return 'rotation';
    }
    if (/carry|farmer|caminata/i.test(name)) return 'carry';
    return 'other_core';
  }

  return `${muscle ?? 'general'}_general`;
}

/**
 * @param {object[]} selected
 * @param {object} candidate
 */
export function hasDistinctStimulusForMuscle(selected, candidate) {
  const muscle = candidate.parteCuerpo ?? candidate.muscleGroup;
  const config = MUSCLE_STIMULUS_CONFIG[muscle];
  if (!config?.avoidDuplicate) return true;

  const subtype = resolveStimulusSubtype(candidate);
  const existing = selected
    .filter((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle)
    .map(resolveStimulusSubtype);

  if (!existing.length) return true;
  return !existing.includes(subtype);
}

/**
 * Lower score = preferred. Used in candidate sorting.
 * @param {object[]} selected
 * @param {object} exercise
 */
export function stimulusSelectionScore(selected, exercise) {
  const muscle = exercise.parteCuerpo ?? exercise.muscleGroup;
  const config = MUSCLE_STIMULUS_CONFIG[muscle];
  if (!config) return 0;

  const subtype = resolveStimulusSubtype(exercise);
  const covered = new Set(
    selected
      .filter((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle)
      .map(resolveStimulusSubtype),
  );

  if (covered.has(subtype)) return 100;

  const countForMuscle = selected.filter((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle).length;
  if (countForMuscle === 0 && config.preferFirst?.includes(subtype)) return -30;
  if (countForMuscle === 1 && config.preferSecond?.includes(subtype)) return -20;
  return 0;
}

/**
 * @param {object[]} candidates — pre-sorted
 * @param {number} limit
 * @param {object[]} selected — session exercises so far
 * @param {Set<string>} usedIds
 */
export function pickWithStimulusDiversity(candidates, limit, selected, usedIds) {
  const picked = [];
  for (const ex of candidates) {
    if (picked.length >= limit) break;
    if (usedIds.has(ex.id)) continue;
    if (!hasDistinctStimulusForMuscle([...selected, ...picked], ex)) continue;
    picked.push(ex);
    usedIds.add(ex.id);
  }
  return picked;
}

/**
 * Validates that a muscle with 2+ exercises in a session has distinct stimulus subtypes.
 * @param {object[]} exercises
 * @param {string} muscle
 */
export function validateMuscleStimulusCoverage(exercises, muscle) {
  const config = MUSCLE_STIMULUS_CONFIG[muscle];
  if (!config) return { ok: true, subtypes: [] };

  const muscleExercises = exercises.filter((e) => (e.parteCuerpo ?? e.muscleGroup) === muscle);
  const subtypes = muscleExercises.map(resolveStimulusSubtype);
  const unique = new Set(subtypes);

  if (muscleExercises.length >= 2 && unique.size < muscleExercises.length) {
    return {
      ok: false,
      subtypes,
      message: `${muscle}: subtipos duplicados (${subtypes.join(', ')})`,
    };
  }

  return { ok: true, subtypes: [...unique] };
}
