import { isExerciseBlocked } from '../athlete/exercisePreferences.js';

const RAMP_PHASES = ['Raise', 'Activate', 'Mobilize', 'Potentiate'];

const UPPER_PATTERNS = new Set(['Empuje_H', 'Empuje_V', 'Traccion_H', 'Traccion_V']);
const LOWER_PATTERNS = new Set(['Rodilla', 'Cadera']);
const UPPER_MUSCLES = new Set(['Hombro', 'Pecho', 'Espalda', 'Bíceps', 'Tríceps', 'Antebrazos']);
const LOWER_MUSCLES = new Set(['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas', 'Gemelos']);

const CARDIO_MACHINE = /caminadora|treadmill|bicicleta|el[ií]ptica|escaladora|elliptical|rowing/i;
const WALKING_CARDIO = /caminata|walking/i;
const HIGH_IMPACT = /saltos|pliom|bound|box jump|cajón|cone hop|salto|jump|star jump|long jump|stride jump|impulso|explosiv|potencia/i;
const STRENGTH_EXPLOSIVE_WARMUP =
  /impulso|jerk|explosiv|potencia|pliom|salt|jump|drill de pared|aceleraci[oó]n lineal|star jump|salto de estrella/i;
const JOGGING = /trote|jogging|carrera en caminadora|running_treadmill/i;
const REP_BASED = /banda|band|flexion|flexión|sentadilla|squat|press|remo|row|dominada|pull-up|push-up|deadlift|bridge|glúteo|glute|cocoons|dead bug/i;

const NEVER_POTENTIATE_IDS = new Set([
  'Push_Up_to_Side_Plank',
  'One-Arm_Kettlebell_Swings',
  'Spider_Crawl',
]);

const INTERNAL_ROTATION_IDS = new Set([
  'Cable_Internal_Rotation',
  'Internal_Rotation_with_Band',
]);

const PREHAB_MATCH = {
  movilidad_hombro: { muscles: ['Hombro'], patterns: ['Empuje_H', 'Empuje_V', 'Traccion_H', 'Traccion_V'] },
  movilidad_rodilla: { muscles: ['Cuádriceps', 'Isquiotibiales', 'Rodilla'], patterns: ['Rodilla', 'Cadera'] },
  core_estabilidad: { muscles: ['Core'], patterns: ['General'] },
  movilidad_muneca: { muscles: [], patterns: ['General'] },
};

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) % 100000;
  }
  return h;
}

function equipmentText(ex) {
  return Array.isArray(ex.equipo) ? ex.equipo.join(' ') : String(ex.equipo ?? '');
}

function labelText(ex) {
  return `${ex.nombre ?? ''} ${ex.descripcion ?? ''}`.toLowerCase();
}

function isCardioMachine(ex) {
  return CARDIO_MACHINE.test(`${equipmentText(ex)} ${labelText(ex)}`);
}

function isWalkingCardio(ex) {
  return WALKING_CARDIO.test(labelText(ex));
}

function isJoggingCardio(ex) {
  return JOGGING.test(labelText(ex)) || /running treadmill|carrera en caminadora/i.test(labelText(ex));
}

function isLowImpactPotentiate(ex) {
  const text = labelText(ex);
  return /sentadilla de impulso|jerk dip|sentadilla con banda|flexion|flexión|dominada escapular|press|remo/i.test(text);
}

function isNeckExercise(ex) {
  return /cuello|neck/i.test(labelText(ex));
}

function isIsometric(ex) {
  return ex.isDynamic === false || /isométric|isometric|squeeze/i.test(labelText(ex));
}

function isFoamMobilize(ex) {
  return /foam|miofascial|smr/i.test(labelText(ex));
}

function sessionRegion(patterns = []) {
  const hasUpper = patterns.some((p) => UPPER_PATTERNS.has(p));
  const hasLower = patterns.some((p) => LOWER_PATTERNS.has(p));
  if (hasUpper && hasLower) return 'full';
  if (hasLower) return 'lower';
  if (hasUpper) return 'upper';
  return 'general';
}

function muscleMatchesSession(muscle, sessionMuscles = []) {
  if (!muscle || !sessionMuscles.length) return false;
  return sessionMuscles.includes(muscle);
}

function patternMatchesSession(pattern, patterns = []) {
  if (!pattern || pattern === 'General') return false;
  return patterns.includes(pattern);
}

function potentiatePatternMatches(pattern, patterns = [], region = 'full') {
  if (patternMatchesSession(pattern, patterns)) return true;
  if (region === 'lower' && patterns.includes('Rodilla') && pattern === 'Cadera') return true;
  if (region === 'lower' && patterns.includes('Cadera') && pattern === 'Rodilla') return true;
  return false;
}

function matchesPrehab(ex, prehabTags = []) {
  if (!prehabTags.length) return false;
  const pattern = ex.patronMovimiento ?? 'General';
  const muscle = ex.parteCuerpo;
  const name = ex.nombre ?? '';

  if (
    isCardioMachine(ex) &&
    (prehabTags.includes('movilidad_rodilla') || prehabTags.includes('movilidad_muneca'))
  ) {
    return /clamshell|rodilla|knee|cu[aá]driceps isom|terminal knee|glute bridge|wall slide|rotaci[oó]n externa|scaption|wrist|muñeca/i.test(
      name,
    );
  }

  return prehabTags.some((tag) => {
    const rule = PREHAB_MATCH[tag];
    if (!rule) return false;
    if (tag === 'movilidad_muneca' && !/muñeca|wrist|antebrazo/i.test(name)) return false;
    if (rule.muscles.includes(muscle)) return true;
    if (rule.patterns.includes(pattern)) return true;
    if (tag === 'movilidad_muneca' && /muñeca|wrist/i.test(name)) return true;
    return false;
  });
}

function scoreExercise(ex, phase, ctx) {
  const {
    patterns = [],
    sessionMuscles = [],
    region,
    readiness = {},
    goal = 'Hipertrofia',
    conservative = false,
    seed = 0,
  } = ctx;

  const pattern = ex.patronMovimiento ?? 'General';
  const muscle = ex.parteCuerpo;
  const equipo = equipmentText(ex);
  const text = labelText(ex);
  let score = 0;

  if (patternMatchesSession(pattern, patterns)) score += 40;
  if (muscleMatchesSession(muscle, sessionMuscles)) score += 25;

  if (region === 'lower' && UPPER_MUSCLES.has(muscle) && !patternMatchesSession(pattern, patterns)) {
    score -= 50;
  }
  if (region === 'upper' && LOWER_MUSCLES.has(muscle) && !patternMatchesSession(pattern, patterns)) {
    score -= 50;
  }
  if (region === 'upper' && pattern === 'General' && LOWER_MUSCLES.has(muscle)) {
    score -= 35;
  }
  if (region === 'lower' && pattern === 'General' && UPPER_MUSCLES.has(muscle)) {
    score -= 35;
  }

  if (isNeckExercise(ex) && !sessionMuscles.includes('Core') && muscle !== 'Hombro') {
    score -= 60;
  }

  if (phase === 'Mobilize' && pattern === 'Core' && region === 'upper' && !patterns.includes('Core')) {
    score -= 40;
  }

  if (phase === 'Raise' && region === 'upper' && /carrera de rodillas?|kneeling arm drill/i.test(text)) {
    score -= 50;
  }
  if (phase === 'Raise' && /c[ií]rculo|estiramiento din[aá]mico|wrist|muñeca/i.test(text) && !isCardioMachine(ex)) {
    score -= 70;
  }
  if (phase === 'Raise' && region === 'upper' && ex.id === 'Arm_Circles') {
    score -= 20;
  }
  if (phase === 'Raise' && region === 'upper' && ex.id === 'kettlebell_pirate_ships') {
    score -= 22;
  }

  if (phase === 'Potentiate' && /plancha lateral|rotación a plancha/i.test(text)) {
    score -= 50;
  }
  if (phase === 'Potentiate' && (ex.id === 'Incline_Push-Up_Medium' || ex.id === 'Incline_Push-Up')) {
    score += 28;
  }

  if (phase === 'Activate' && region === 'lower' && muscle === 'Core' && !patterns.includes('Core')) {
    score -= 50;
  }
  if (phase === 'Activate' && (region === 'lower' || region === 'full') && LOWER_MUSCLES.has(muscle)) {
    score += 22;
  }
  if (phase === 'Activate' && (ex.id === 'Monster_Walk' || ex.id === 'Butt_Lift_Bridge')) {
    score += 18;
  }
  if (phase === 'Activate' && ex.id === 'Face_Pull_Warmup') {
    score += 28;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Traccion')) && ex.id === 'Face_Pull_Warmup') {
    score += 35;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Traccion')) && /rotación interna|internal rotation/i.test(text)) {
    score -= 55;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Traccion')) && ex.id === 'Internal_Rotation_with_Band') {
    score -= 30;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Traccion')) && /rotación externa|external rotation/i.test(text) && /polea|cable|máquina|machine/i.test(equipo)) {
    score -= 40;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Empuje')) && (ex.id === 'Shoulder_Shrug' || /encogimiento|shrug/i.test(text))) {
    score -= 40;
  }
  if (phase === 'Activate' && patterns.every((p) => p.startsWith('Empuje')) && ex.id === 'External_Rotation_with_Band') {
    score += 35;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Traccion')) && ex.id === 'Band_Pull_Apart') {
    score += 15;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Empuje')) && /rotación interna|internal rotation/i.test(text)) {
    score -= 55;
  }
  if (phase === 'Activate' && patterns.some((p) => p.startsWith('Empuje')) && /rotación externa|external rotation|separación con banda|squeeze de pecho/i.test(text)) {
    score += 18;
  }
  if (phase === 'Activate' && region === 'upper' && muscle === 'Core' && !patterns.includes('Core')) {
    score -= 45;
  }

  if (phase === 'Potentiate' && ex.id === 'Band_Triceps_Pushdown_Warmup') {
    score -= 50;
  }
  if (phase === 'Potentiate' && /scaption|cocoons|spider crawl|pase de kettlebell/i.test(text)) {
    score -= 40;
  }
  if (phase === 'Potentiate' && goal === 'Hipertrofia' && /swing con kettlebell|kettlebell swing/i.test(text)) {
    score -= 45;
  }
  if (phase === 'Potentiate' && ex.id === 'Band_Pull_Apart') {
    score -= 50;
  }
  if (phase === 'Potentiate' && patterns.includes('Rodilla') && /elevación de talón|calf|pantorrilla/i.test(text)) {
    score -= 40;
  }
  if (phase === 'Potentiate' && (ex.id === 'Squats_-_With_Bands' || ex.id === 'Jerk_Dip_Squat')) {
    score += 22;
  }

  if (phase === 'Mobilize' && isFoamMobilize(ex) && !patterns.includes('Core')) {
    score -= 55;
  }

  if (phase === 'Potentiate' && isIsometric(ex)) {
    score -= 100;
  }

  if (phase === 'Raise' && goal === 'Hipertrofia' && isJoggingCardio(ex)) {
    score -= 100;
  }

  if (phase === 'Raise') {
    if (isCardioMachine(ex)) {
      score += 50;
      if (region === 'lower' || region === 'full') {
        if (isWalkingCardio(ex)) score += 12;
        else if (isJoggingCardio(ex)) score -= 15;
        else score += 8;
      }
      if (conservative) score -= 10;
      if ((readiness.energyLevel ?? 3) <= 2) score -= 15;
    } else if (ex.isDynamic) {
      if (/escalador|mountain climber|jumping jack|skipping/i.test(text)) score += 6;
      if (region === 'upper' && muscle === 'Hombro') score += 2;
      if (region === 'lower' && LOWER_PATTERNS.has(pattern)) score += 12;
      if (region === 'full') score += 4;
      score += 2;
    }
  }

  if (phase === 'Activate') {
    if (patternMatchesSession(pattern, patterns)) score += 30;
    if (muscleMatchesSession(muscle, sessionMuscles)) score += 20;
    if (/banda|band/i.test(equipo)) score -= 80;
    if (pattern === 'General' && muscleMatchesSession(muscle, sessionMuscles)) score += 12;
  }

  if (phase === 'Mobilize') {
    if (patternMatchesSession(pattern, patterns)) score += 35;
    if (muscleMatchesSession(muscle, sessionMuscles)) score += 20;
    if (ex.isDynamic) score += 10;
    if (pattern === 'General' && !muscleMatchesSession(muscle, sessionMuscles)) score -= 15;
  }

  if (phase === 'Potentiate') {
    if (/banda|band/i.test(equipo) || /\bcon banda\b/i.test(text)) score -= 80;
    if (HIGH_IMPACT.test(text)) {
      if (goal === 'Fuerza') score -= 100;
      if (goal === 'Hipertrofia') score -= 60;
      if (conservative) score -= 40;
      if ((readiness.sorenessLevel ?? 2) >= 4) score -= 35;
    }
    if (isLowImpactPotentiate(ex)) score += 25;
    if (patternMatchesSession(pattern, patterns)) score += 35;
    if (/sentadilla|squat|press|remo|row|deadlift|peso muerto/i.test(text)) score += 15;
    if (goal === 'Fuerza' && patternMatchesSession(pattern, patterns)) score += 20;
  }

  score += (hashSeed(`${ex.id}-${seed}-${phase}`) % 13) * 0.01;
  return score;
}

const SIDE_SWITCH_REST_SECONDS = 5;

function unilateralDose(perSideSec, reps, cue = 'Primero un lado, luego el otro.') {
  return {
    perSideSeconds: perSideSec,
    durationSeconds: perSideSec * 2,
    sideSwitchRestSeconds: SIDE_SWITCH_REST_SECONDS,
    reps,
    cue,
  };
}

function prescribeDose(ex, phase, readiness = {}, goal = 'Hipertrofia') {
  const energy = readiness.energyLevel ?? 3;
  const text = labelText(ex);
  const unilateral = ex.isUnilateral === true && phase !== 'Raise' && !isCardioMachine(ex);

  if (phase === 'Raise') {
    if (isCardioMachine(ex)) {
      // McGowan 2015: ≥3 min de cardio ligero para elevar temperatura central.
      const walkSec = energy <= 2 ? 150 : energy >= 4 ? 210 : 180;
      const jogSec = energy <= 2 ? 90 : 120;
      const machineSec = energy <= 2 ? 120 : 150;
      if (isWalkingCardio(ex)) {
        const mins = Math.round(walkSec / 60);
        return { durationSeconds: walkSec, reps: `${mins} min` };
      }
      if (isJoggingCardio(ex)) {
        const mins = Math.round(jogSec / 60);
        return { durationSeconds: jogSec, reps: `${mins} min` };
      }
      const mins = Math.round(machineSec / 60);
      return { durationSeconds: machineSec, reps: `${mins} min` };
    }
    const dynamicSec = energy <= 2 ? 60 : energy >= 4 ? 90 : 75;
    return { durationSeconds: dynamicSec, reps: `${dynamicSec}s` };
  }

  if (phase === 'Potentiate') {
    // Activate-tagged unilaterals (e.g. single-leg glute bridge) often land in Potentiate.
    // Without perSideSeconds the UI shows "primero un lado" but only one timer.
    if (unilateral) {
      if (HIGH_IMPACT.test(text) && goal === 'Fuerza') {
        return unilateralDose(20, '4-6 reps por lado');
      }
      if (REP_BASED.test(text) || isLowImpactPotentiate(ex)) {
        return unilateralDose(22, '5 reps por lado');
      }
      return unilateralDose(20, '5 reps por lado');
    }
    if (HIGH_IMPACT.test(text) && goal === 'Fuerza') {
      return { durationSeconds: 40, reps: '4-6 reps' };
    }
    if (REP_BASED.test(text) || isLowImpactPotentiate(ex)) {
      return { durationSeconds: 45, reps: '5 reps' };
    }
    return { durationSeconds: 40, reps: '5 reps' };
  }

  if (phase === 'Activate') {
    if (unilateral) {
      const perSideSec = energy <= 2 ? 40 : 45;
      return unilateralDose(
        perSideSec,
        energy <= 2 ? '10 reps por lado' : '12-15 reps por lado',
        'Primero un brazo/lado, luego el otro.',
      );
    }
    if (REP_BASED.test(text) || /banda|band/i.test(equipmentText(ex))) {
      const reps = energy <= 2 ? '10 reps' : '12-15 reps';
      return { durationSeconds: energy <= 2 ? 50 : 60, reps };
    }
    return { durationSeconds: energy <= 2 ? 45 : 60, reps: energy <= 2 ? '45s' : '60s' };
  }

  if (phase === 'Mobilize') {
    if (ex.isDynamic) {
      const durationSeconds = energy <= 2 ? 50 : 60;
      if (unilateral) {
        const perSideSec = Math.round(durationSeconds / 2);
        return unilateralDose(perSideSec, '10 reps por lado');
      }
      return {
        durationSeconds,
        reps: '10 reps',
        cue: 'Reps controladas — mantén el torso estable.',
      };
    }
    if (unilateral) {
      const perSideSec = energy <= 2 ? 40 : 45;
      return unilateralDose(perSideSec, `${perSideSec}s por lado`);
    }
    return { durationSeconds: energy <= 2 ? 45 : 60, reps: energy <= 2 ? '45s' : '60s' };
  }

  if (phase === 'Prehab') {
    if (unilateral) {
      return unilateralDose(45, '12 reps por lado');
    }
    return { durationSeconds: 45, reps: '12 reps' };
  }

  const baseOther = energy <= 2 ? 45 : 60;
  if (unilateral) {
    const reps = ex.reps && typeof ex.reps === 'string' && !/^\d+s$/i.test(ex.reps)
      ? `${ex.reps} por lado`
      : `${baseOther}s por lado`;
    return unilateralDose(baseOther, reps);
  }
  if (ex.reps && typeof ex.reps === 'string' && !/^\d+s$/i.test(ex.reps)) {
    return { durationSeconds: baseOther, reps: ex.reps };
  }
  return { durationSeconds: baseOther, reps: `${baseOther}s` };
}

function toWarmupItem(ex, phase, readiness, goal) {
  const dose = prescribeDose(ex, phase, readiness, goal);
  const unilateral = ex.isUnilateral === true && phase !== 'Raise' && !isCardioMachine(ex);
  const cue = dose.cue ?? (unilateral ? 'Primero un brazo/lado, luego el otro.' : null);
  return {
    exerciseId: ex.id,
    id: ex.id,
    name: ex.nombre,
    nombre: ex.nombre,
    phase,
    faseRAMP: phase,
    movementPattern: ex.patronMovimiento ?? 'General',
    patronMovimiento: ex.patronMovimiento ?? 'General',
    parteCuerpo: ex.parteCuerpo,
    durationSeconds: dose.durationSeconds,
    duracion: `${dose.durationSeconds} seg`,
    sets: 1,
    reps: dose.reps,
    isUnilateral: unilateral,
    perSideSeconds: dose.perSideSeconds ?? null,
    sideSwitchRestSeconds: dose.sideSwitchRestSeconds ?? (unilateral ? SIDE_SWITCH_REST_SECONDS : null),
    unilateralCue: cue,
    instrucciones: cue
      ? `${ex.descripcion ?? ''}${ex.descripcion ? ' ' : ''}${cue}`.trim()
      : ex.descripcion,
    descripcion: ex.descripcion,
    imageUrl: ex.url_img_0,
    imageUrl2: ex.url_img_1,
    equipo: ex.equipo,
  };
}

function pickTop(items, count, seed) {
  if (!items.length) return [];
  const ranked = [...items].sort(
    (a, b) => b.score - a.score || a.ex.id.localeCompare(b.ex.id),
  );
  const start = seed % Math.max(1, ranked.length);
  const picked = [];
  for (let i = 0; i < Math.min(count, ranked.length); i += 1) {
    picked.push(ranked[(start + i) % ranked.length].ex);
  }
  return picked;
}

function isPotentiateEligible(ex, patterns, goal, experienceLevel = 'Intermedio') {
  const name = labelText(ex);
  if (NEVER_POTENTIATE_IDS.has(ex.id)) return false;
  if (/plancha lateral|rotación a plancha/i.test(name)) return false;
  if (/elevación de talón|elevación de talones|calf raise|pantorrilla/i.test(name)) return false;
  if (goal === 'Hipertrofia' && /swing con kettlebell|kettlebell swing/i.test(name)) return false;
  if (
    experienceLevel === 'Novato' &&
    /dominada escapular|pull-up|dominada/i.test(name) &&
    !/flexion|flexión|inclinada/i.test(name)
  ) {
    return false;
  }
  const exPhase = ex.faseRAMP ?? ex.faseRamp;
  if (exPhase === 'Potentiate') return true;
  return (
    isLowImpactPotentiate(ex)
    || /dominada escapular|sentadilla|puente de glúteo|extensión de tríceps|face pull/i.test(name)
  );
}

function rankPhaseItems(phase, items, ctx, usedIds, exclusionFilters) {
  const { patterns, goal, region } = ctx;
  const phaseTags = phase === 'Potentiate' ? ['Potentiate', 'Activate'] : [phase];

  const phaseItems = items.filter((ex) => {
    const exPhase = ex.faseRAMP ?? ex.faseRamp;
    if (phase === 'Raise' && isCardioMachine(ex)) {
      // Cardio sistémico válido aunque el catálogo no etiquete fase Raise.
    } else if (exPhase && !phaseTags.includes(exPhase)) {
      return false;
    }
    if (isExerciseBlocked(ex, exclusionFilters)) return false;
    if (phase === 'Mobilize' && isFoamMobilize(ex)) return false;
    if (phase === 'Activate' && patterns.some((p) => p.startsWith('Empuje')) && ex.id === 'Shoulder_Shrug') return false;
    if (phase === 'Activate' && patterns.some((p) => p.startsWith('Empuje')) && NEVER_POTENTIATE_IDS.has(ex.id)) return false;
    if (phase === 'Activate' && patterns.some((p) => p.startsWith('Empuje')) && /plancha lateral|side plank/i.test(labelText(ex))) return false;
    if (
      phase === 'Activate'
      && (patterns.some((p) => p.startsWith('Empuje')) || patterns.some((p) => p.startsWith('Traccion')))
      && (INTERNAL_ROTATION_IDS.has(ex.id) || /rotación interna|internal rotation/i.test(labelText(ex)))
    ) return false;
    if (phase === 'Activate' && patterns.some((p) => p.startsWith('Traccion')) && /flexion|flexión|push-up|incline push/i.test(labelText(ex))) return false;
    if (phase === 'Potentiate' && /elevación de talón|elevación de talones|calf|pantorrilla/i.test(labelText(ex))) return false;
    if (phase === 'Potentiate' && goal === 'Hipertrofia' && HIGH_IMPACT.test(labelText(ex))) return false;
    if (phase === 'Potentiate' && goal === 'Fuerza' && STRENGTH_EXPLOSIVE_WARMUP.test(labelText(ex))) return false;
    if (phase === 'Activate' && goal === 'Fuerza' && STRENGTH_EXPLOSIVE_WARMUP.test(labelText(ex))) return false;
    if (
      (phase === 'Activate' || phase === 'Potentiate') &&
      (/banda|band/i.test(equipmentText(ex)) || /\bcon banda\b/i.test(labelText(ex)))
    ) {
      return false;
    }
    if (
      phase === 'Activate' &&
      (ctx.avoidPatterns?.includes('Empuje_V') ?? false) &&
      /encogimiento|shrug/i.test(labelText(ex))
    ) {
      return false;
    }
    if (
      phase === 'Activate' &&
      (ctx.injuries?.includes('Espalda_Baja') || ctx.avoidPatterns?.includes('Cadera')) &&
      /encogimiento|shrug/i.test(labelText(ex))
    ) {
      return false;
    }
    if (
      phase === 'Activate' &&
      /drill de pared|aceleraci[oó]n lineal/i.test(labelText(ex))
    ) {
      return false;
    }
    if (
      phase === 'Activate' &&
      (ctx.injuries?.includes('Hombro') || ctx.avoidPatterns?.includes('Empuje_V')) &&
      /scaption/i.test(labelText(ex))
    ) {
      return false;
    }
    if (
      phase === 'Raise' &&
      /skipping|saltos r[aá]pidos/i.test(labelText(ex)) &&
      (ctx.conservative ||
        ctx.injuries?.includes('Rodilla') ||
        ctx.injuries?.includes('Espalda_Baja'))
    ) {
      return false;
    }
    if (
      (phase === 'Activate' || phase === 'Potentiate') &&
      (ctx.avoidPatterns?.includes('Rodilla') ?? false) &&
      (/salt|jump|pliom|salto|impulso|diagonal/i.test(labelText(ex)) ||
        (ex.patronMovimiento === 'Rodilla' && /explosiv|potencia|drill/i.test(labelText(ex))))
    ) {
      return false;
    }
    if (phase === 'Potentiate' && isIsometric(ex)) return false;
    if (phase === 'Potentiate' && NEVER_POTENTIATE_IDS.has(ex.id)) return false;
    if (phase === 'Raise' && goal === 'Hipertrofia' && isJoggingCardio(ex)) return false;
    if (!patterns?.length) return true;
    return scoreExercise(ex, phase, ctx) > -20;
  });

  const raiseItems =
    phase === 'Raise'
      ? phaseItems.filter((ex) => {
          const cardioOptions = phaseItems.filter(
            (candidate) => isCardioMachine(candidate) && !usedIds.has(candidate.id),
          );
          if (!cardioOptions.length) return true;
          return isCardioMachine(ex) || isWalkingCardio(ex);
        })
      : phaseItems;

  return raiseItems
    .filter((ex) => !usedIds.has(ex.id))
    .map((ex) => ({ ex, score: scoreExercise(ex, phase, ctx) }))
    .filter((row) => {
      if (row.score <= 0 && phase !== 'Raise') return false;
      if (phase === 'Raise' && row.score < -10) return false;
      if (phase !== 'Potentiate') return true;
      const pattern = row.ex.patronMovimiento ?? 'General';
      if (!potentiatePatternMatches(pattern, patterns, region)) return false;
      if (!isPotentiateEligible(row.ex, patterns, goal, ctx.experienceLevel)) return false;
      const exPhase = row.ex.faseRAMP ?? row.ex.faseRamp;
      if (exPhase === 'Potentiate') return true;
      return row.score >= 25;
    });
}

function pickForPhase(phase, items, ctx, usedIds, exclusionFilters) {
  const ranked = rankPhaseItems(phase, items, ctx, usedIds, exclusionFilters);
  const mobilizeCount =
    phase === 'Mobilize' && ['full', 'upper', 'lower'].includes(ctx.region) ? 2 : 1;
  const pickCount = mobilizeCount;
  const picked = pickTop(ranked, pickCount, ctx.seed + phase.length);

  if (phase === 'Raise' && !picked.length) {
    const fallback = items.find(
      (ex) =>
        !usedIds.has(ex.id) &&
        !isExerciseBlocked(ex, exclusionFilters) &&
        (isCardioMachine(ex) || isWalkingCardio(ex) || /jumping jack|escalador/i.test(labelText(ex))),
    );
    if (fallback) return [fallback];
  }

  return picked;
}

/**
 * Replace a single warmup item while preserving RAMP phase.
 */
export function replaceWarmupExercise(currentWarmup, exerciseIdToReplace, catalog, options = {}) {
  const idx = currentWarmup.findIndex(
    (w) => w.exerciseId === exerciseIdToReplace || w.id === exerciseIdToReplace,
  );
  if (idx === -1) return null;

  const target = currentWarmup[idx];
  const phase = target.phase ?? target.faseRAMP;
  const {
    patterns = [],
    sessionMuscles = [],
    weekNumber = 1,
    sessionFocus = '',
    prehab = [],
    readiness = {},
    goal = 'Hipertrofia',
    conservative = false,
    excludeIds = [],
    unavailableEquipment = [],
  } = options;

  const exclusionFilters = {
    excludeIds: [...new Set([...excludeIds, exerciseIdToReplace])],
    unavailableEquipment,
  };

  const seed = hashSeed(`${weekNumber}-${sessionFocus}-${patterns.join(',')}-swap`);
  const region = sessionRegion(patterns);
  const ctx = { patterns, sessionMuscles, region, readiness, goal, conservative, seed };
  const usedIds = new Set(
    currentWarmup
      .map((w) => w.exerciseId ?? w.id)
      .filter((id) => id && id !== exerciseIdToReplace),
  );

  const picked = pickForPhase(phase, catalog ?? [], ctx, usedIds, exclusionFilters);
  if (!picked.length) return null;

  const replacement = toWarmupItem(picked[0], phase, readiness, goal);
  const next = [...currentWarmup];
  next[idx] = { ...replacement, swappedFrom: exerciseIdToReplace };
  return { warmup: next, replacement };
}

/**
 * DDS 8.4 paso 6 — RAMP contextual (McGowan 2015; Fradkin 2010; Jeffreys 2017).
 * @param {string[]} patterns
 * @param {object[]} warmupCatalog
 * @param {object} [options]
 */
export function generateWarmup(patterns, warmupCatalog, options = {}) {
  const {
    weekNumber = 1,
    sessionFocus = '',
    sessionMuscles = [],
    prehab = [],
    readiness = {},
    goal = 'Hipertrofia',
    conservative = false,
    excludeIds = [],
    unavailableEquipment = [],
    avoidPatterns = [],
    modifyPatterns = [],
    injuries = [],
    experienceLevel = 'Intermedio',
  } = options;

  const exclusionFilters = { excludeIds, unavailableEquipment };
  const items = warmupCatalog ?? [];
  const seed = hashSeed(`${weekNumber}-${sessionFocus}-${patterns.join(',')}`);
  const region = sessionRegion(patterns);
  const ctx = {
    patterns,
    sessionMuscles,
    region,
    readiness,
    goal,
    conservative,
    seed,
    avoidPatterns,
    modifyPatterns,
    injuries,
    sessionFocus,
    experienceLevel,
  };

  const warmup = [];
  const usedIds = new Set();

  for (const phase of RAMP_PHASES) {
    const picked = pickForPhase(phase, items, ctx, usedIds, exclusionFilters);
    for (const ex of picked) {
      usedIds.add(ex.id);
      warmup.push(toWarmupItem(ex, phase, readiness, goal));
    }
  }

  if (prehab.length) {
    const prehabPool = items
      .filter((ex) => matchesPrehab(ex, prehab) && !usedIds.has(ex.id) && !isExerciseBlocked(ex, exclusionFilters))
      .filter((ex) => !/banda|band/i.test(`${equipmentText(ex)} ${labelText(ex)}`))
      .filter(
        (ex) =>
          !(
            (avoidPatterns?.includes('Empuje_V') ?? false) &&
            /encogimiento|shrug/i.test(labelText(ex))
          ),
      )
      .filter(
        (ex) =>
          !(
            (injuries?.includes('Espalda_Baja') ?? false) &&
            /encogimiento|shrug|skipping/i.test(labelText(ex))
          ),
      )
      .filter(
        (ex) =>
          !(
            (injuries?.includes('Rodilla') ?? false) &&
            /sprint|salt|jump|pliom|salto|impulso|skipping/i.test(labelText(ex))
          ),
      )
      .filter((ex) => {
        const riskyPrehab =
          /salt|jump|pliom|salto|impulso|diagonal|longitud|salida lineal|skipping|sprint/i.test(
            labelText(ex),
          );
        if (!riskyPrehab) return true;
        return !(
          conservative ||
          injuries?.includes('Rodilla') ||
          injuries?.includes('Espalda_Baja') ||
          injuries?.includes('Muñeca')
        );
      })
      .map((ex) => ({ ex, score: scoreExercise(ex, 'Activate', ctx) + 15 }));

    const prehabPick = pickTop(prehabPool, 2, seed + 99);
    for (const ex of prehabPick) {
      usedIds.add(ex.id);
      warmup.push({
        ...toWarmupItem(ex, 'Prehab', readiness, goal),
        phase: 'Prehab',
        isPrehab: true,
      });
    }
  }

  if (!warmup.length && items.length) {
    const fallback = pickTop(
      items.filter((ex) => !isExerciseBlocked(ex, exclusionFilters)).map((ex) => ({ ex, score: 1 })),
      4,
      seed,
    );
    return fallback.map((ex) => toWarmupItem(ex, ex.faseRAMP ?? 'General', readiness, goal));
  }

  return warmup.slice(0, 10);
}

const FUERZA_RAMP_PROTOCOL = [
  { pct: 0.4, reps: '5', restAfterSeconds: 45 },
  { pct: 0.6, reps: '3', restAfterSeconds: 60 },
  { pct: 0.8, reps: '2', restAfterSeconds: 90 },
];

/**
 * Append approximation (ramp) sets before the main lift on Fuerza sessions.
 * Skipped for bodyweight lifts and exploratory weeks without a working load.
 * @param {object[]} warmup
 * @param {object[]} mainBlock
 * @param {string} goal
 * @param {string|null} priorityLiftId
 * @returns {object[]}
 */
export function appendFuerzaRampSets(warmup, mainBlock, goal, sessionFocus = '', priorityLiftId = null) {
  if (goal !== 'Fuerza') return warmup ?? [];

  const priority =
    mainBlock.find((ex) => ex.exerciseId === priorityLiftId) ??
    mainBlock.find((ex) => ex.isPriorityLift) ??
    mainBlock.find((ex) => (ex.priority ?? 2) === 1);

  if (!priority || priority.loadMode === 'bodyweight') {
    return warmup ?? [];
  }

  const workingLoad = priority.prescribedLoadKg ?? priority.suggestedLoadKg;
  if (!workingLoad || workingLoad <= 0) return warmup ?? [];

  const rampItems = FUERZA_RAMP_PROTOCOL.map((step, index) => {
    const kg = Math.round((workingLoad * step.pct) / 2.5) * 2.5;
    return {
      exerciseId: priority.exerciseId,
      id: `${priority.exerciseId}_ramp_${index + 1}`,
      name: priority.exerciseName,
      nombre: priority.exerciseName,
      phase: 'Potentiate',
      faseRAMP: 'Potentiate',
      movementPattern: priority.movementPattern,
      patronMovimiento: priority.movementPattern,
      parteCuerpo: priority.muscleGroup,
      sets: 1,
      reps: step.reps,
      prescribedLoadKg: kg,
      peso: `${kg} kg`,
      isRampSet: true,
      rampSetNumber: index + 1,
      restAfterSeconds: step.restAfterSeconds,
      instrucciones: `Aproximación ${index + 1}/${FUERZA_RAMP_PROTOCOL.length}: ${step.reps} reps a ~${Math.round(step.pct * 100)}% de la carga de trabajo.`,
      imageUrl: priority.imageUrl ?? null,
      imageUrl2: priority.imageUrl2 ?? null,
    };
  });

  return [...(warmup ?? []), ...rampItems];
}
