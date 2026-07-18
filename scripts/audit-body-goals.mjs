/**
 * Audit: body composition goals + muscle priorities → mesocycle + sessions
 * Run: node scripts/audit-body-goals.mjs
 */
import { generateMesocycle } from '../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../domain/session/sessionGenerator.js';
import { getWeekPlan } from '../domain/periodization/microcycle.js';
import { loadCatalogFromDisk } from '../infrastructure/catalog/catalogRepository.js';
import { getTodaySessionPlan } from '../lib/mesocycleUtils.js';

const SCHEDULE = [
  { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Martes', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Jueves', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Sábado', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
];

const SCENARIOS = [
  {
    id: 'baseline_mantener',
    label: 'Hipertrofia + Mantener (referencia)',
    profile: { bodyCompositionGoal: 'Mantener' },
  },
  {
    id: 'fat_loss_general',
    label: 'Hipertrofia + Perder grasa',
    profile: { bodyCompositionGoal: 'Perder_Grasa' },
  },
  {
    id: 'fat_loss_glutes',
    label: 'Perder grasa + prioridad Glúteos',
    profile: {
      bodyCompositionGoal: 'Perder_Grasa',
      musclePriorities: [{ muscle: 'Glúteos', intensity: 'strong' }],
    },
  },
  {
    id: 'fat_loss_pecho_hombro',
    label: 'Perder grasa + Pecho + Hombro',
    profile: {
      bodyCompositionGoal: 'Perder_Grasa',
      musclePriorities: [
        { muscle: 'Pecho', intensity: 'moderate' },
        { muscle: 'Hombro', intensity: 'moderate' },
      ],
    },
  },
  {
    id: 'fat_loss_tren_inferior',
    label: 'Perder grasa + focus Tren inferior',
    profile: { bodyCompositionGoal: 'Perder_Grasa', focusArea: 'Tren_Inferior' },
  },
  {
    id: 'gain_biceps_triceps',
    label: 'Ganar músculo + Bíceps/Tríceps',
    profile: {
      bodyCompositionGoal: 'Ganar_Musculo',
      musclePriorities: [
        { muscle: 'Bíceps', intensity: 'strong' },
        { muscle: 'Tríceps', intensity: 'moderate' },
      ],
    },
  },
  {
    id: 'fat_loss_3dias',
    label: 'Perder grasa · 3 días/semana',
    profile: {
      bodyCompositionGoal: 'Perder_Grasa',
      trainingDaysPerWeek: 3,
      weeklyScheduleContext: [
        { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
        { day: 'Martes', canTrain: false, externalLoad: 'ninguna' },
        { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
        { day: 'Jueves', canTrain: false, externalLoad: 'ninguna' },
        { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
        { day: 'Sábado', canTrain: false, externalLoad: 'ninguna' },
        { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
      ],
    },
  },
];

const BASE = {
  name: 'Audit',
  age: 32,
  gender: 'F',
  heightCm: 165,
  currentWeightKg: 72,
  trainingAgeMonths: 18,
  fitnessGoal: 'Hipertrofia',
  trainingDaysPerWeek: 4,
  weeklyScheduleContext: SCHEDULE,
  injuriesOrLimitations: [],
  timezone: 'America/Mexico_City',
  focusArea: 'General',
};

function countWarmupCardio(warmup) {
  const items = Array.isArray(warmup) ? warmup : warmup?.fases?.flatMap((f) => f.ejercicios ?? []) ?? [];
  const cardioRe = /caminadora|treadmill|bicicleta|el[ií]ptica|escaladora|elliptical|rowing|caminata/i;
  return items.filter((ex) => cardioRe.test(`${ex.nombre ?? ''} ${ex.instrucciones ?? ''}`)).length;
}

function summarizeSession(session) {
  const main = session.mainBlock ?? [];
  const setsByMuscle = {};
  let totalSets = 0;
  const priorityExercises = [];
  for (const ex of main) {
    const muscle = ex.muscleGroup ?? ex.parteCuerpo ?? '?';
    setsByMuscle[muscle] = (setsByMuscle[muscle] ?? 0) + (ex.sets ?? 0);
    totalSets += ex.sets ?? 0;
    if (ex.emphasisTag === 'priority') {
      priorityExercises.push(`${ex.exerciseName} (${ex.sets}x)`);
    }
  }
  return {
    focus: session.sessionFocus,
    week: session.weekNumber,
    exercises: main.length,
    totalSets,
    setsByMuscle,
    rirRange: main.map((e) => e.rirTarget).filter((v) => v != null),
    warmupCardioCount: countWarmupCardio(session.warmup),
    exerciseNames: main.map((e) => `${e.exerciseName ?? e.nombre} (${e.sets}x)`),
    hasFinisher: Boolean(session.finisher?.included),
    finisherName: session.finisher?.exerciseName ?? null,
    coachingItems: session.coachingBrief?.items?.map((i) => i.title) ?? [],
    priorityExercises,
  };
}

function weekVolumeFromPlan(mesocycle, weekNumber) {
  const plan = getWeekPlan(mesocycle, weekNumber);
  return plan?.volumeByMuscle ?? {};
}

function landmarkSnapshot(landmarks, muscles) {
  const out = {};
  for (const m of muscles) {
    if (landmarks[m]) out[m] = landmarks[m];
  }
  return out;
}

const KEY_MUSCLES = [
  'Pecho',
  'Espalda',
  'Hombro',
  'Cuádriceps',
  'Glúteos',
  'Bíceps',
  'Tríceps',
  'Isquiotibiales',
];

async function auditScenario(scenario, catalog) {
  const profile = { ...BASE, ...scenario.profile };
  const referenceDate = new Date('2026-07-07T12:00:00Z');
  const mesocycle = generateMesocycle(profile, referenceDate);
  const week3 = mesocycle.microcycles.find((m) => m.week === 3) ?? mesocycle.microcycles[1];
  const week3Plan = weekVolumeFromPlan(mesocycle, 3);

  const sessions = [];
  for (let day = 0; day < 7; day += 1) {
    const date = new Date(referenceDate);
    date.setUTCDate(date.getUTCDate() + (3 - 1) * 7 + day);
    const { weekNumber, session: sessionPlan, isRestDay } = getTodaySessionPlan(
      mesocycle,
      date,
      profile.timezone,
    );
    if (isRestDay || !sessionPlan || weekNumber !== 3) continue;

    const session = generateSession({
      profile,
      mesocycle,
      weekNumber: 3,
      sessionFocus: sessionPlan.sessionFocus,
      sessionMuscles: sessionPlan.muscles ?? [],
      patterns: sessionPlan.patterns ?? [],
      readiness: { energyLevel: 3, sorenessLevel: 2, sleepQuality: 3, stressLevel: 3 },
      catalog,
      history: [],
      referenceDate: date,
    });
    sessions.push(summarizeSession(session));
  }

  return {
    id: scenario.id,
    label: scenario.label,
    split: mesocycle.splitType,
    landmarks: landmarkSnapshot(mesocycle.volumeLandmarks, KEY_MUSCLES),
    week3Targets: landmarkSnapshot(week3.volumeTargets ?? {}, KEY_MUSCLES),
    week3PlanVolume: Object.fromEntries(
      KEY_MUSCLES.filter((m) => week3Plan[m] != null).map((m) => [m, week3Plan[m]]),
    ),
    week3Rir: week3.rirObjetivo,
    week3RirAccessory: week3.rirObjetivoAccessory,
    sessions,
  };
}

const catalog = await loadCatalogFromDisk();
const results = [];
for (const scenario of SCENARIOS) {
  results.push(await auditScenario(scenario, catalog));
}

const baseline = results.find((r) => r.id === 'baseline_mantener');

console.log('\n=== AUDIT: bodyCompositionGoal + musclePriorities ===\n');

for (const r of results) {
  console.log(`\n--- ${r.label} (${r.id}) ---`);
  console.log(`Split: ${r.split} | Semana 3 RIR main: ${r.week3Rir} | RIR acc: ${r.week3RirAccessory}`);

  console.log('\nLandmarks (MEV/MRV):');
  for (const [muscle, lm] of Object.entries(r.landmarks)) {
    const base = baseline.landmarks[muscle];
    const delta =
      base && (lm.MEV !== base.MEV || lm.MRV !== base.MRV)
        ? ` [Δ MEV ${lm.MEV - base.MEV >= 0 ? '+' : ''}${lm.MEV - base.MEV}, MRV ${lm.MRV - base.MRV >= 0 ? '+' : ''}${lm.MRV - base.MRV}]`
        : '';
    console.log(`  ${muscle}: MEV ${lm.MEV}, MRV ${lm.MRV}${delta}`);
  }

  console.log('\nVolumen semanal planificado (semana 3):');
  console.log(' ', JSON.stringify(r.week3PlanVolume));

  for (const s of r.sessions) {
    console.log(`\n  Sesión: ${s.focus}`);
    console.log(`    Ejercicios: ${s.exercises}, series totales: ${s.totalSets}, cardio warmup: ${s.warmupCardioCount}`);
    console.log(`    Series/músculo: ${JSON.stringify(s.setsByMuscle)}`);
    console.log(`    RIR ejercicios: ${s.rirRange.join(', ')}`);
    if (s.hasFinisher) console.log(`    Finisher LISS: ${s.finisherName}`);
    if (s.coachingItems.length) console.log(`    Coaching: ${s.coachingItems.join(' | ')}`);
    if (s.priorityExercises.length) console.log(`    Prioridad (+1 serie): ${s.priorityExercises.join(', ')}`);
    console.log(`    → ${s.exerciseNames.slice(0, 6).join(' | ')}`);
  }
}

// Compare fat loss vs baseline volume totals
const fatLoss = results.find((r) => r.id === 'fat_loss_general');
const fatGlutes = results.find((r) => r.id === 'fat_loss_glutes');
const volSum = (plan) => Object.values(plan).reduce((a, b) => a + b, 0);
console.log('\n=== RESUMEN COMPARATIVO (semana 3) ===');
console.log(
  `Volumen total planificado — baseline: ${volSum(baseline.week3PlanVolume)} sets | fat loss: ${volSum(fatLoss.week3PlanVolume)} sets (${Math.round((1 - volSum(fatLoss.week3PlanVolume) / volSum(baseline.week3PlanVolume)) * 100)}% menos)`,
);
console.log(
  `Glúteos — baseline: ${baseline.week3PlanVolume.Glúteos ?? 0} | fat+glutes priority: ${fatGlutes.week3PlanVolume.Glúteos ?? 0} (landmark MEV baseline ${baseline.landmarks.Glúteos?.MEV} → priority ${fatGlutes.landmarks.Glúteos?.MEV})`,
);
const fatSession = fatLoss.sessions[0];
console.log(
  `Finisher en pérdida de grasa: ${fatSession?.hasFinisher ? `SÍ (${fatSession.finisherName})` : 'NO'}`,
);
console.log(
  `RIR pérdida de grasa (sesión): ${fatSession?.rirRange?.[0] ?? '—'} vs baseline ${baseline.sessions[0]?.rirRange?.[0] ?? '—'}`,
);
