/**
 * Simula 3 atletas ficticios × 2 mesociclos completos con feedback sintético.
 * Uso: node scripts/dev/simulate-3-personas.mjs
 */
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { getWeekPlan } from '../../domain/periodization/microcycle.js';
import { loadCatalogFromDisk } from '../../infrastructure/catalog/catalogRepository.js';
import { addDays } from '../../lib/dateUtils.js';
import { getTodaySessionPlan } from '../../lib/mesocycleUtils.js';
import { validateInvariants } from '../../tests/simulation/invariants.js';
import {
  resolveStimulusSubtype,
  validateMuscleStimulusCoverage,
} from '../../domain/exerciseSelection/stimulusCoverage.js';

const SCHEDULE_3D = [
  { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Martes', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Jueves', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Sábado', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
];

const SCHEDULE_4D = [
  { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Martes', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Jueves', canTrain: false, externalLoad: 'ninguna' },
  { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Sábado', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
];

const SCHEDULE_6D = [
  { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Martes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Jueves', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Sábado', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
];

function completeSession(session, readiness, feedbackProfile) {
  const rirVariance = feedbackProfile.rirVariance ?? 0;
  const mainBlock = (session.mainBlock ?? []).map((ex) => ({
    ...ex,
    actualWeightKg: ex.prescribedLoadKg ?? 40,
    actualReps: ex.repsTarget ?? 10,
    actualRIR: Math.max(0, (ex.rirTarget ?? 2) + rirVariance),
    sets: Array.from({ length: ex.sets }, (_, i) => ({
      setNumber: i + 1,
      reps: ex.repsTarget ?? 10,
      load: ex.prescribedLoadKg ?? 40,
      rir: Math.max(0, (ex.rirTarget ?? 2) + rirVariance),
      completed: true,
    })),
  }));

  return {
    ...session,
    completed: true,
    mainBlock,
    sessionFeedback: {
      pumpQuality: feedbackProfile.pumpQuality ?? 3,
      sorenessTiming: feedbackProfile.sorenessTiming ?? 'sanó a tiempo',
      jointPain: feedbackProfile.jointPain ?? false,
      perceivedWorkload: feedbackProfile.perceivedWorkload ?? 3,
    },
    readinessPreSession: readiness,
  };
}

const PERSONAS = [
  {
    id: 'carlos_novato_fb3',
    label: 'Carlos — novato, Full Body 3d, hipertrofia',
    profile: {
      name: 'Carlos Méndez',
      age: 22,
      gender: 'M',
      heightCm: 172,
      currentWeightKg: 68,
      trainingAgeMonths: 4,
      fitnessGoal: 'Hipertrofia',
      trainingDaysPerWeek: 3,
      weeklyScheduleContext: SCHEDULE_3D,
      injuriesOrLimitations: [],
      timezone: 'America/Mexico_City',
    },
    startDate: '2026-01-06T12:00:00Z',
    getReadiness: () => ({
      energyLevel: 3,
      sorenessLevel: 2,
      sleepQuality: 3,
      stressLevel: 2,
    }),
    getSessionFeedback: ({ weekNumber, mesocycleIndex }) => ({
      pumpQuality: weekNumber >= 3 ? 4 : 3,
      sorenessTiming: weekNumber === 4 ? 'persistió' : 'sanó a tiempo',
      jointPain: false,
      perceivedWorkload: mesocycleIndex === 0 ? 2 : 3,
      rirVariance: mesocycleIndex === 0 ? -0.5 : 0,
    }),
    getCycleEvaluation: ({ mesocycleIndex }) => ({
      generalDifficulty: mesocycleIndex === 0 ? 2 : 3,
      persistentJointPain: false,
      changeGoal: false,
    }),
  },
  {
    id: 'laura_intermedia_tp4',
    label: 'Laura — intermedia, Torso/Pierna 4d, hipertrofia',
    profile: {
      name: 'Laura Vega',
      age: 31,
      gender: 'F',
      heightCm: 165,
      currentWeightKg: 62,
      trainingAgeMonths: 20,
      fitnessGoal: 'Hipertrofia',
      trainingDaysPerWeek: 4,
      weeklyScheduleContext: SCHEDULE_4D,
      injuriesOrLimitations: [],
      timezone: 'America/Mexico_City',
    },
    startDate: '2026-02-03T12:00:00Z',
    getReadiness: ({ weekNumber }) => ({
      energyLevel: weekNumber >= 4 ? 3 : 4,
      sorenessLevel: weekNumber >= 4 ? 3 : 2,
      sleepQuality: 4,
      stressLevel: 3,
    }),
    getSessionFeedback: ({ weekNumber }) => ({
      pumpQuality: 4,
      sorenessTiming: weekNumber === 4 ? 'persistió' : 'sanó a tiempo',
      jointPain: false,
      perceivedWorkload: weekNumber >= 3 ? 4 : 3,
      rirVariance: weekNumber >= 3 ? 0.5 : -0.5,
    }),
    getCycleEvaluation: () => ({
      generalDifficulty: 3,
      persistentJointPain: false,
      changeGoal: false,
    }),
  },
  {
    id: 'diego_avanzado_ppl6',
    label: 'Diego — avanzado, PPL 6d, hipertrofia',
    profile: {
      name: 'Diego Ruiz',
      age: 35,
      gender: 'M',
      heightCm: 180,
      currentWeightKg: 88,
      trainingAgeMonths: 48,
      fitnessGoal: 'Hipertrofia',
      trainingDaysPerWeek: 6,
      weeklyScheduleContext: SCHEDULE_6D,
      injuriesOrLimitations: [],
      timezone: 'America/Mexico_City',
    },
    startDate: '2026-03-03T12:00:00Z',
    getReadiness: ({ weekNumber }) => ({
      energyLevel: weekNumber >= 3 ? 2 : 3,
      sorenessLevel: weekNumber >= 3 ? 4 : 2,
      sleepQuality: weekNumber >= 4 ? 2 : 3,
      stressLevel: 4,
    }),
    getSessionFeedback: ({ weekNumber, mesocycleIndex }) => ({
      pumpQuality: 3,
      sorenessTiming: weekNumber === 4 ? 'persistió' : 'sanó a tiempo',
      jointPain: mesocycleIndex === 1 && weekNumber >= 3,
      perceivedWorkload: weekNumber >= 3 ? 4 : 3,
      rirVariance: weekNumber >= 3 ? 1 : 0,
    }),
    getCycleEvaluation: ({ mesocycleIndex }) => ({
      generalDifficulty: mesocycleIndex === 0 ? 4 : 3,
      persistentJointPain: false,
      changeGoal: false,
    }),
  },
];

async function simulatePersona(persona, catalog, mesocycleCount = 2) {
  let profile = { ...persona.profile };
  let referenceDate = new Date(persona.startDate);
  const history = [];
  const mesocycles = [];

  for (let mc = 0; mc < mesocycleCount; mc += 1) {
    const mesocycle = generateMesocycle(profile, referenceDate);
    mesocycles.push(mesocycle);

    for (let day = 0; day < mesocycle.durationWeeks * 7; day += 1) {
      const date = addDays(referenceDate, day);
      const { weekNumber, session: sessionPlan, isRestDay } = getTodaySessionPlan(
        mesocycle,
        date,
        profile.timezone,
      );
      if (isRestDay || !sessionPlan) continue;

      const readiness = persona.getReadiness({ day, weekNumber, sessionPlan, mesocycleIndex: mc });
      const session = generateSession({
        profile,
        mesocycle,
        weekNumber,
        sessionFocus: sessionPlan.sessionFocus,
        sessionMuscles: sessionPlan.muscles ?? [],
        patterns: sessionPlan.patterns ?? [],
        readiness,
        catalog,
        history,
        referenceDate: date,
      });

      const feedback = persona.getSessionFeedback({
        day,
        weekNumber,
        sessionPlan,
        mesocycleIndex: mc,
        session,
      });
      history.push(completeSession(session, readiness, feedback));
    }

    const evaluation = persona.getCycleEvaluation({ mesocycle: mesocycles[mc], mesocycleIndex: mc });
    const result = evaluateCycle(
      evaluation,
      mesocycle.volumeLandmarks,
      profile,
      addDays(referenceDate, mesocycle.durationWeeks * 7),
    );
    profile = result.updatedProfile;
    referenceDate = addDays(referenceDate, mesocycle.durationWeeks * 7 + 1);
  }

  return { history, mesocycles, profile };
}

function summarizePersona(persona, { history, mesocycles }) {
  const violations = validateInvariants({ history, mesocycles, persona });
  const lines = [];
  lines.push(`\n${'='.repeat(72)}`);
  lines.push(persona.label);
  lines.push(`${'='.repeat(72)}`);
  lines.push(`Sesiones totales: ${history.length}`);
  lines.push(`Mesociclos: ${mesocycles.map((m) => m.mesocycleId).join(' → ')}`);
  lines.push(`Split: ${mesocycles[0]?.splitType ?? 'N/A'}`);

  for (const mc of mesocycles) {
    const mcSessions = history.filter((s) => s.mesocycleId === mc.mesocycleId);
    lines.push(`\n--- ${mc.mesocycleId} (${mc.durationWeeks} sem) ---`);

    for (let w = 1; w <= mc.durationWeeks; w += 1) {
      const weekSessions = mcSessions.filter((s) => s.weekNumber === w);
      const plan = getWeekPlan(mc, w);
      const phase = mc.microcycles?.find((m) => m.week === w)?.phase ?? '?';
      lines.push(
        `  Semana ${w} [${phase}] RIR objetivo ${plan.rirTarget} | vol pecho ${plan.volumeByMuscle?.Pecho ?? 0} series`,
      );
      for (const s of weekSessions) {
        const exercises = (s.mainBlock ?? [])
          .map((e) => `${e.exerciseName?.slice(0, 28)} (${e.sets}×${e.repRange} @RIR${e.rirTarget})`)
          .join('; ');
        const w1 = s.weekNumber === 1 ? ' [W1]' : '';
        lines.push(`    ${s.sessionFocus}${w1}: ${exercises}`);
      }
    }

    const w1ByFocus = mcSessions.filter((s) => s.weekNumber === 1);
    for (const s of w1ByFocus) {
      const muscles = [...new Set((s.mainBlock ?? []).map((e) => e.muscleGroup))];
      for (const muscle of muscles) {
        const check = validateMuscleStimulusCoverage(
          (s.mainBlock ?? []).map((e) => ({
            parteCuerpo: e.muscleGroup,
            nombre: e.exerciseName,
            patronMovimiento: e.movementPattern,
          })),
          muscle,
        );
        if ((s.mainBlock ?? []).filter((e) => e.muscleGroup === muscle).length >= 2) {
          lines.push(`  Estímulo ${muscle} S1: ${check.subtypes.join(', ')} ${check.ok ? '✓' : '✗'}`);
        }
      }
    }
  }

  if (mesocycles.length >= 2) {
    const mc1w1 = history.filter((s) => s.mesocycleId === mesocycles[0].mesocycleId && s.weekNumber === 1);
    const mc2w1 = history.filter((s) => s.mesocycleId === mesocycles[1].mesocycleId && s.weekNumber === 1);
    lines.push('\nRotación inter-mesociclo (semana 1):');
    for (const s2 of mc2w1) {
      const s1 = mc1w1.find((s) => s.sessionFocus === s2.sessionFocus);
      if (!s1) continue;
      const ids1 = s1.mainBlock.map((e) => e.exerciseId);
      const ids2 = s2.mainBlock.map((e) => e.exerciseId);
      const kept = ids2.filter((id) => ids1.includes(id)).length;
      const rotated = ids2.length - kept;
      lines.push(`  ${s2.sessionFocus}: ${rotated}/${ids2.length} ejercicios nuevos`);
    }
  }

  const w1Loads = history.filter((s) => s.weekNumber === 1).flatMap((s) => s.mainBlock ?? []);
  const exploratory = w1Loads.filter((e) => e.prescribedLoadKg == null || e.prescribedLoadKg === 0);
  lines.push(`\nCargas exploratorias S1 (sin historial): ${exploratory.length}/${w1Loads.length} ejercicios`);

  lines.push(`\nInvariantes DDS: ${violations.length === 0 ? 'TODAS OK' : violations.join('; ')}`);
  return { lines, violations };
}

const catalog = await loadCatalogFromDisk();
const allViolations = [];

console.log('SIMULACIÓN — 3 atletas × 2 mesociclos completos\n');

for (const persona of PERSONAS) {
  const result = await simulatePersona(persona, catalog, 2);
  const { lines, violations } = summarizePersona(persona, result);
  console.log(lines.join('\n'));
  allViolations.push(...violations);
}

console.log(`\n${'='.repeat(72)}`);
console.log(
  allViolations.length === 0
    ? 'RESUMEN GLOBAL: 0 violaciones — periodización alineada con invariantes DDS'
    : `RESUMEN GLOBAL: ${allViolations.length} violaciones\n${allViolations.join('\n')}`,
);
