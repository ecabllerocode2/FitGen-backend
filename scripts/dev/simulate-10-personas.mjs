/**
 * Simulación integral: 10 atletas × 2 mesociclos completos.
 * Replica flujo generateV2 + complete (readiness, feedback semanal, cargas).
 *
 * Uso: node scripts/dev/simulate-10-personas.mjs
 */
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { getWeekPlan } from '../../domain/periodization/microcycle.js';
import { applyWeeklyFeedback } from '../../domain/autoregulation/weeklyFeedback.js';
import { estimateE1RMWithRIR } from '../../domain/prescription/loadCalculator.js';
import { loadCatalogFromDisk } from '../../infrastructure/catalog/catalogRepository.js';
import { addDays } from '../../lib/dateUtils.js';
import { getTodaySessionPlan, isLastSessionOfWeek } from '../../lib/mesocycleUtils.js';
import { validateInvariants } from '../../tests/simulation/invariants.js';
import {
  validateMuscleStimulusCoverage,
  MUSCLE_STIMULUS_CONFIG,
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

const SCHEDULE_5D = [
  { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Martes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Jueves', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
  { day: 'Sábado', canTrain: false, externalLoad: 'ninguna' },
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

function musclesWorked(session) {
  return [...new Set((session.mainBlock ?? []).map((e) => e.muscleGroup).filter(Boolean))];
}

function completeSessionRealistic(session, readiness, persona, weekNumber) {
  const perf = persona.getPerformanceProfile({ weekNumber, readiness, session });
  const mainBlock = (session.mainBlock ?? []).map((ex) => {
    const baseLoad =
      ex.prescribedLoadKg ??
      ex.suggestedLoadKg ??
      persona.estimateStartingLoad(ex, session);
    const loadDelta = perf.loadProgressPct ?? 0;
    const actualWeightKg = Math.max(2.5, Math.round((baseLoad * (1 + loadDelta)) / 2.5) * 2.5);
    const repMid = parseInt(String(ex.repRange ?? '8-12').split('-')[0], 10) || 8;
    const actualReps = repMid + (perf.repBonus ?? 0);
    const actualRIR = Math.max(0, (ex.rirTarget ?? 2) + (perf.rirVariance ?? 0));

    return {
      ...ex,
      actualWeightKg,
      actualReps,
      actualRIR,
      sets: Array.from({ length: ex.sets }, (_, i) => ({
        setNumber: i + 1,
        reps: actualReps,
        load: actualWeightKg,
        weightKg: actualWeightKg,
        rir: actualRIR,
        completed: true,
      })),
    };
  });

  const feedback = persona.getSessionFeedback({ weekNumber, session, readiness, perf });

  return {
    ...session,
    completed: true,
    mainBlock,
    sessionFeedback: feedback,
    readinessPreSession: readiness,
    readinessAdjustment: session.readinessAdjustment ?? null,
  };
}

const PERSONAS = [
  {
    id: 'p01_novato_fb3_facil',
    label: 'Carlos — novato FB 3d, progresa fácil',
    profile: {
      name: 'Carlos', age: 22, gender: 'M', heightCm: 172, currentWeightKg: 68,
      trainingAgeMonths: 4, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 3,
      weeklyScheduleContext: SCHEDULE_3D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-01-06T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 40 : 12),
    getReadiness: () => ({ energyLevel: 4, sorenessLevel: 2, sleepQuality: 4, stressLevel: 2 }),
    getPerformanceProfile: () => ({ rirVariance: -1, loadProgressPct: 0.025 }),
    getSessionFeedback: () => ({
      pumpQuality: 3, sorenessTiming: 'sanó a tiempo', jointPain: false, perceivedWorkload: 2,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 2, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p02_intermedia_tp4',
    label: 'Laura — intermedia Torso/Pierna 4d',
    profile: {
      name: 'Laura', age: 31, gender: 'F', heightCm: 165, currentWeightKg: 62,
      trainingAgeMonths: 20, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 4,
      weeklyScheduleContext: SCHEDULE_4D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-02-03T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 50 : 14),
    getReadiness: ({ weekNumber }) => ({
      energyLevel: weekNumber >= 4 ? 3 : 4, sorenessLevel: weekNumber >= 4 ? 3 : 2,
      sleepQuality: 4, stressLevel: 3,
    }),
    getPerformanceProfile: ({ weekNumber }) => ({
      rirVariance: weekNumber >= 3 ? 0.5 : -0.5, loadProgressPct: 0.02,
    }),
    getSessionFeedback: ({ weekNumber }) => ({
      pumpQuality: 4,
      sorenessTiming: weekNumber === 4 ? 'persistió' : 'sanó a tiempo',
      jointPain: false, perceivedWorkload: weekNumber >= 3 ? 4 : 3,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p03_avanzado_ppl6_fatiga',
    label: 'Diego — avanzado PPL 6d, fatiga tardía',
    profile: {
      name: 'Diego', age: 35, gender: 'M', heightCm: 180, currentWeightKg: 88,
      trainingAgeMonths: 48, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 6,
      weeklyScheduleContext: SCHEDULE_6D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-03-03T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 80 : 20),
    getReadiness: ({ weekNumber }) => ({
      energyLevel: weekNumber >= 3 ? 2 : 4, sorenessLevel: weekNumber >= 3 ? 4 : 2,
      sleepQuality: weekNumber >= 4 ? 2 : 3, stressLevel: 4,
    }),
    getPerformanceProfile: ({ weekNumber }) => ({
      rirVariance: weekNumber >= 3 ? 1.5 : 0, loadProgressPct: weekNumber >= 3 ? 0.005 : 0.02,
    }),
    getSessionFeedback: ({ weekNumber }) => ({
      pumpQuality: 3, sorenessTiming: weekNumber >= 4 ? 'persistió' : 'sanó a tiempo',
      jointPain: false, perceivedWorkload: weekNumber >= 3 ? 5 : 3,
    }),
    getCycleEvaluation: ({ mesocycleIndex }) => ({
      generalDifficulty: mesocycleIndex === 0 ? 4 : 3, persistentJointPain: false, changeGoal: false,
    }),
  },
  {
    id: 'p04_intermedia_fuerza4',
    label: 'Marina — intermedia 4d fuerza',
    profile: {
      name: 'Marina', age: 29, gender: 'F', heightCm: 168, currentWeightKg: 70,
      trainingAgeMonths: 24, fitnessGoal: 'Fuerza', trainingDaysPerWeek: 4,
      weeklyScheduleContext: SCHEDULE_4D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-01-20T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 60 : 15),
    getReadiness: () => ({ energyLevel: 4, sorenessLevel: 2, sleepQuality: 4, stressLevel: 2 }),
    getPerformanceProfile: () => ({ rirVariance: -0.5, loadProgressPct: 0.03 }),
    getSessionFeedback: () => ({
      pumpQuality: 3, sorenessTiming: 'sanó a tiempo', jointPain: false, perceivedWorkload: 3,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p05_hombro_lesionado',
    label: 'Roberto — hombro limitado, 4d hipertrofia',
    profile: {
      name: 'Roberto', age: 40, gender: 'M', heightCm: 178, currentWeightKg: 82,
      trainingAgeMonths: 24, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 4,
      weeklyScheduleContext: SCHEDULE_4D, injuriesOrLimitations: ['Hombro'],
      timezone: 'America/Mexico_City',
    },
    startDate: '2026-02-10T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 45 : 10),
    getReadiness: () => ({ energyLevel: 3, sorenessLevel: 3, sleepQuality: 3, stressLevel: 3 }),
    getPerformanceProfile: () => ({ rirVariance: 0.5, loadProgressPct: 0.01 }),
    getSessionFeedback: () => ({
      pumpQuality: 3, sorenessTiming: 'sanó a tiempo', jointPain: true, perceivedWorkload: 3,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: true, changeGoal: false }),
  },
  {
    id: 'p06_facil_subvolumen',
    label: 'Sofía — bloque muy fácil, pide más volumen',
    profile: {
      name: 'Sofía', age: 26, gender: 'F', heightCm: 160, currentWeightKg: 55,
      trainingAgeMonths: 14, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 4,
      weeklyScheduleContext: SCHEDULE_4D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-02-17T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 35 : 8),
    getReadiness: () => ({ energyLevel: 5, sorenessLevel: 1, sleepQuality: 5, stressLevel: 1 }),
    getPerformanceProfile: () => ({ rirVariance: -1.5, loadProgressPct: 0.03 }),
    getSessionFeedback: () => ({
      pumpQuality: 1, sorenessTiming: 'no llegó a doler', jointPain: false, perceivedWorkload: 1,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 1, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p07_avanzado_phul5',
    label: 'Andrés — avanzado PHUL 5d fuerza/hipertrofia',
    profile: {
      name: 'Andrés', age: 33, gender: 'M', heightCm: 182, currentWeightKg: 92,
      trainingAgeMonths: 60, fitnessGoal: 'Fuerza', trainingDaysPerWeek: 5,
      weeklyScheduleContext: SCHEDULE_5D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-03-10T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 100 : 25),
    getReadiness: () => ({ energyLevel: 4, sorenessLevel: 2, sleepQuality: 4, stressLevel: 3 }),
    getPerformanceProfile: ({ weekNumber }) => ({
      rirVariance: 0, loadProgressPct: weekNumber <= 2 ? 0.025 : 0.015,
    }),
    getSessionFeedback: () => ({
      pumpQuality: 3, sorenessTiming: 'sanó a tiempo', jointPain: false, perceivedWorkload: 3,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p08_readiness_bajo',
    label: 'Elena — readiness bajo recurrente',
    profile: {
      name: 'Elena', age: 45, gender: 'F', heightCm: 163, currentWeightKg: 72,
      trainingAgeMonths: 8, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 3,
      weeklyScheduleContext: SCHEDULE_3D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-01-27T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 30 : 8),
    getReadiness: ({ day }) => ({
      energyLevel: day % 2 === 0 ? 1 : 3,
      sorenessLevel: 4,
      sorenessZone: 'Cuádriceps',
      sleepQuality: 2,
      stressLevel: 4,
      externalLoad: day % 3 === 0 ? 'alta' : 'ninguna',
    }),
    getPerformanceProfile: () => ({ rirVariance: 1, loadProgressPct: 0.005 }),
    getSessionFeedback: () => ({
      pumpQuality: 2, sorenessTiming: 'persistió', jointPain: false, perceivedWorkload: 4,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 4, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p09_rir_miss',
    label: 'Miguel — reporta RIR más alto de lo objetivo',
    profile: {
      name: 'Miguel', age: 27, gender: 'M', heightCm: 176, currentWeightKg: 80,
      trainingAgeMonths: 12, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 4,
      weeklyScheduleContext: SCHEDULE_4D, injuriesOrLimitations: [], timezone: 'America/Mexico_City',
    },
    startDate: '2026-02-24T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 55 : 14),
    getReadiness: () => ({ energyLevel: 3, sorenessLevel: 2, sleepQuality: 3, stressLevel: 3 }),
    getPerformanceProfile: () => ({ rirVariance: 2, loadProgressPct: 0.01 }),
    getSessionFeedback: () => ({
      pumpQuality: 2, sorenessTiming: 'sanó a tiempo', jointPain: false, perceivedWorkload: 2,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 2, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'p10_rodilla_limitada',
    label: 'Patricia — rodilla limitada, 3d hipertrofia',
    profile: {
      name: 'Patricia', age: 38, gender: 'F', heightCm: 167, currentWeightKg: 65,
      trainingAgeMonths: 30, fitnessGoal: 'Hipertrofia', trainingDaysPerWeek: 3,
      weeklyScheduleContext: SCHEDULE_3D, injuriesOrLimitations: ['Rodilla'],
      timezone: 'America/Mexico_City',
    },
    startDate: '2026-03-17T12:00:00Z',
    estimateStartingLoad: (ex) => (ex.isPriorityLift ? 45 : 12),
    getReadiness: () => ({ energyLevel: 3, sorenessLevel: 3, sleepQuality: 3, stressLevel: 3 }),
    getPerformanceProfile: () => ({ rirVariance: 0, loadProgressPct: 0.015 }),
    getSessionFeedback: () => ({
      pumpQuality: 3, sorenessTiming: 'sanó a tiempo', jointPain: false, perceivedWorkload: 3,
    }),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
];

async function simulatePersona(persona, catalog, catalogById) {
  let profile = { ...persona.profile };
  let referenceDate = new Date(persona.startDate);
  const history = [];
  const mesocycles = [];
  const metrics = {
    stimulusIssues: [],
    readinessAdjustments: 0,
    readinessVolumeCuts: 0,
    readinessRirRaises: 0,
    exploratoryLoads: 0,
    calculatedLoads: 0,
    loadProgression: [],
    weeklyFeedbackApplied: [],
    e1rmSeries: {},
    deloadChecks: [],
    rirProgression: [],
    rotationMc2: [],
    shoulderViolations: 0,
    kneeRodillaViolations: 0,
  };

  let weeklyFeedbackModifiers = {};
  let pendingWeeklyFeedback = {};

  for (let mc = 0; mc < 2; mc += 1) {
    const mesocycle = generateMesocycle(profile, referenceDate);
    mesocycles.push(mesocycle);

    for (let day = 0; day < mesocycle.durationWeeks * 7; day += 1) {
      const date = addDays(referenceDate, day);
      const { weekNumber, session: sessionPlan, isRestDay, dayOfWeek } = getTodaySessionPlan(
        mesocycle,
        date,
        profile.timezone,
      );
      if (isRestDay || !sessionPlan) continue;

      const readiness = persona.getReadiness({ day, weekNumber, sessionPlan, mesocycleIndex: mc });
      const feedbackModifiers = weekNumber > 1 ? weeklyFeedbackModifiers : {};

      const session = generateSession({
        profile,
        mesocycle,
        weekNumber,
        sessionFocus: sessionPlan.sessionFocus,
        sessionMuscles: sessionPlan.muscles ?? [],
        patterns: sessionPlan.patterns ?? [],
        readiness,
        feedbackModifiers,
        catalog,
        history,
        referenceDate: date,
      });

      if (session.readinessAdjustment?.volumeMultiplierApplied < 1) {
        metrics.readinessAdjustments += 1;
        metrics.readinessVolumeCuts += 1;
      }
      if ((session.readinessAdjustment?.rirDeltaApplied ?? 0) > 0) {
        metrics.readinessRirRaises += 1;
      }

      for (const ex of session.mainBlock ?? []) {
        if (ex.loadMode === 'exploratory' || ex.prescribedLoadKg == null) {
          metrics.exploratoryLoads += 1;
        } else {
          metrics.calculatedLoads += 1;
        }
      }

      const completed = completeSessionRealistic(session, readiness, persona, weekNumber);
      history.push(completed);

      for (const muscle of Object.keys(MUSCLE_STIMULUS_CONFIG)) {
        const check = validateMuscleStimulusCoverage(
          (completed.mainBlock ?? []).map((e) => {
            const cat = catalogById.get(e.exerciseId);
            return {
              parteCuerpo: e.muscleGroup,
              nombre: e.exerciseName,
              patronMovimiento: e.movementPattern,
              subtipoEstimulo: cat?.subtipoEstimulo,
            };
          }),
          muscle,
        );
        if (!check.ok) {
          metrics.stimulusIssues.push(`${completed.sessionId}: ${check.message}`);
        }
      }

      if (persona.profile.injuriesOrLimitations?.includes('Hombro')) {
        for (const ex of completed.mainBlock ?? []) {
          if (ex.movementPattern === 'Empuje_V') metrics.shoulderViolations += 1;
        }
      }
      if (persona.profile.injuriesOrLimitations?.includes('Rodilla')) {
        for (const ex of completed.mainBlock ?? []) {
          if (ex.movementPattern === 'Rodilla') metrics.kneeRodillaViolations += 1;
        }
      }

      const anchor = (completed.mainBlock ?? []).find((e) => e.isPriorityLift || e.priority === 1);
      if (anchor?.actualWeightKg) {
        const e1rm = estimateE1RMWithRIR(anchor.actualWeightKg, anchor.actualReps, anchor.actualRIR);
        if (!metrics.e1rmSeries[anchor.exerciseId]) metrics.e1rmSeries[anchor.exerciseId] = [];
        metrics.e1rmSeries[anchor.exerciseId].push({
          mc, week: weekNumber, e1rm: Math.round(e1rm * 10) / 10, load: anchor.actualWeightKg,
        });
      }

      const plan = getWeekPlan(mesocycle, weekNumber, feedbackModifiers);
      if (plan && !metrics.rirProgression.find((r) => r.mc === mc && r.week === weekNumber)) {
        metrics.rirProgression.push({
          mc, week: weekNumber, phase: plan.phase, rir: plan.rirObjetivo,
          volPecho: plan.volumeByMuscle?.Pecho,
        });
      }

      for (const muscle of musclesWorked(completed)) {
        pendingWeeklyFeedback[muscle] = completed.sessionFeedback;
      }

      const weekClosed = isLastSessionOfWeek(mesocycle, weekNumber, dayOfWeek);
      if (weekClosed) {
        for (const [muscle, feedback] of Object.entries(pendingWeeklyFeedback)) {
          const { modifier, message } = applyWeeklyFeedback(feedback, muscle);
          if (modifier !== 1.0) {
            weeklyFeedbackModifiers[muscle] = modifier;
            metrics.weeklyFeedbackApplied.push({ mc, week: weekNumber, muscle, modifier, message });
          }
        }
        pendingWeeklyFeedback = {};
      }
    }

    const accumWeeks = mesocycle.microcycles?.filter((m) => m.phase !== 'deload') ?? [];
    const deloadWeek = mesocycle.microcycles?.find((m) => m.phase === 'deload');
    const lastAccum = accumWeeks[accumWeeks.length - 1];
    if (deloadWeek && lastAccum) {
      const lastPlan = getWeekPlan(mesocycle, lastAccum.week);
      const deloadPlan = getWeekPlan(mesocycle, deloadWeek.week);
      metrics.deloadChecks.push({
        mc,
        pecho: { accum: lastPlan?.volumeByMuscle?.Pecho, deload: deloadPlan?.volumeByMuscle?.Pecho },
      });
    }

    const evaluation = persona.getCycleEvaluation({ mesocycle, mesocycleIndex: mc });
    const result = evaluateCycle(
      evaluation,
      mesocycle.volumeLandmarks,
      profile,
      addDays(referenceDate, mesocycle.durationWeeks * 7),
    );
    profile = result.updatedProfile;
    referenceDate = addDays(referenceDate, mesocycle.durationWeeks * 7 + 1);
    weeklyFeedbackModifiers = {};
    pendingWeeklyFeedback = {};
  }

  if (mesocycles.length >= 2) {
    const mc1w1 = history.filter((s) => s.mesocycleId === mesocycles[0].mesocycleId && s.weekNumber === 1);
    const mc2w1 = history.filter((s) => s.mesocycleId === mesocycles[1].mesocycleId && s.weekNumber === 1);
    for (const s2 of mc2w1) {
      const s1 = mc1w1.find((s) => s.sessionFocus === s2.sessionFocus);
      if (!s1) continue;
      const prev = new Set(s1.mainBlock.map((e) => e.exerciseId));
      const next = s2.mainBlock.map((e) => e.exerciseId);
      const newCount = next.filter((id) => !prev.has(id)).length;
      metrics.rotationMc2.push({ focus: s2.sessionFocus, newCount, total: next.length });
    }
  }

  const violations = validateInvariants({ history, mesocycles, persona });

  return { history, mesocycles, metrics, violations };
}

function summarizePersona(persona, result) {
  const { metrics, violations, history, mesocycles } = result;
  const e1rmKeys = Object.keys(metrics.e1rmSeries);
  const e1rmTrend = e1rmKeys.map((id) => {
    const series = metrics.e1rmSeries[id];
    const first = series[0]?.e1rm ?? 0;
    const last = series[series.length - 1]?.e1rm ?? 0;
    return { id, first, last, delta: Math.round((last - first) * 10) / 10 };
  });

  return {
    id: persona.id,
    label: persona.label,
    sessions: history.length,
    split: mesocycles[0]?.splitType,
    violations: violations.length,
    violationList: violations,
    stimulusIssues: metrics.stimulusIssues.length,
    shoulderViolations: metrics.shoulderViolations,
    kneeRodillaViolations: metrics.kneeRodillaViolations,
    readinessAdjustments: metrics.readinessAdjustments,
    readinessRirRaises: metrics.readinessRirRaises,
    exploratoryLoads: metrics.exploratoryLoads,
    calculatedLoads: metrics.calculatedLoads,
    weeklyFeedbackApplied: metrics.weeklyFeedbackApplied.length,
    feedbackDetails: metrics.weeklyFeedbackApplied.slice(0, 3),
    e1rmTrend,
    deloadChecks: metrics.deloadChecks,
    rirCurve: metrics.rirProgression.filter((r) => r.mc === 0).map((r) => `S${r.week}:${r.rir}`).join('→'),
    rotationMc2: metrics.rotationMc2,
  };
}

const catalog = await loadCatalogFromDisk();
const catalogById = new Map((catalog.entrenamiento ?? []).map((e) => [e.id, e]));

console.log('SIMULACIÓN INTEGRAL — 10 atletas × 2 mesociclos\n');
console.log('='.repeat(80));

const summaries = [];
for (const persona of PERSONAS) {
  const result = await simulatePersona(persona, catalog, catalogById);
  const s = summarizePersona(persona, result);
  summaries.push(s);

  console.log(`\n${s.label}`);
  console.log(`  Sesiones: ${s.sessions} | Split: ${s.split}`);
  console.log(`  Invariantes DDS: ${s.violations === 0 ? 'OK' : s.violations + ' violaciones'}`);
  if (s.violationList.length) console.log(`    → ${s.violationList.slice(0, 3).join('; ')}`);
  console.log(`  Estímulo duplicado: ${s.stimulusIssues} | Hombro Empuje_V: ${s.shoulderViolations} | Rodilla patrón: ${s.kneeRodillaViolations}`);
  console.log(`  Readiness ajustó sesión: ${s.readinessAdjustments}x (RIR↑: ${s.readinessRirRaises}x)`);
  console.log(`  Cargas: ${s.calculatedLoads} calculadas / ${s.exploratoryLoads} exploratorias`);
  console.log(`  Feedback semanal aplicado: ${s.weeklyFeedbackApplied}x`);
  if (s.feedbackDetails.length) {
    console.log(`    → ${s.feedbackDetails.map((f) => `${f.muscle}×${f.modifier}`).join(', ')}`);
  }
  console.log(`  RIR MC1: ${s.rirCurve}`);
  if (s.deloadChecks.length) {
    const d = s.deloadChecks[0];
    console.log(`  Deload pecho MC1: ${d.pecho.accum} → ${d.pecho.deload} series`);
  }
  if (s.e1rmTrend.length) {
    const t = s.e1rmTrend[0];
    console.log(`  e1RM ancla (${t.id}): ${t.first} → ${t.last} kg (${t.delta >= 0 ? '+' : ''}${t.delta})`);
  }
  if (s.rotationMc2.length) {
    const rot = s.rotationMc2.map((r) => `${r.focus}:${r.newCount}/${r.total}`).join(', ');
    console.log(`  Rotación MC2 S1: ${rot}`);
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log('RESUMEN AGREGADO');
const totalViolations = summaries.reduce((a, s) => a + s.violations, 0);
const totalStimulus = summaries.reduce((a, s) => a + s.stimulusIssues, 0);
const totalShoulder = summaries.reduce((a, s) => a + s.shoulderViolations, 0);
const totalKnee = summaries.reduce((a, s) => a + s.kneeRodillaViolations, 0);
const totalReadiness = summaries.reduce((a, s) => a + s.readinessAdjustments, 0);
const totalFeedback = summaries.reduce((a, s) => a + s.weeklyFeedbackApplied, 0);
const personasOk = summaries.filter((s) => s.violations === 0 && s.stimulusIssues === 0).length;

console.log(`  Atletas sin violaciones DDS+estímulo: ${personasOk}/10`);
console.log(`  Violaciones DDS totales: ${totalViolations}`);
console.log(`  Duplicados de subtipoEstimulo: ${totalStimulus}`);
console.log(`  Violaciones seguridad hombro/rodilla: ${totalShoulder}/${totalKnee}`);
console.log(`  Sesiones con ajuste readiness: ${totalReadiness}`);
console.log(`  Ajustes feedback semanal: ${totalFeedback}`);
