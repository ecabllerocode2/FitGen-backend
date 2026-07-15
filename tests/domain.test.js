import { describe, it, expect } from 'vitest';
import { calculateExperienceLevel } from '../domain/athlete/experienceLevel.js';
import { buildSafetyProfile } from '../domain/athlete/safetyProfile.js';
import { selectSplit } from '../domain/periodization/splitSelector.js';
import { generateMesocycle } from '../domain/periodization/mesocycleGenerator.js';
import { getWeekPlan, applyDeloadVolume } from '../domain/periodization/microcycle.js';
import { applyReadiness } from '../domain/autoregulation/readiness.js';
import { applyWeeklyFeedback } from '../domain/autoregulation/weeklyFeedback.js';
import { estimateE1RM, applyLoadLimits, prescribeLoad } from '../domain/prescription/loadCalculator.js';
import { isBodyweightExercise } from '../domain/exerciseSelection/bodyweight.js';
import { detectPlateau, getIntervention } from '../domain/progression/plateau.js';
import { evaluateCycle } from '../domain/progression/cycleEvaluation.js';
import { orderByGoal } from '../domain/exerciseSelection/orderExercises.js';
import { selectExercises, getMesocycleRotationExclusions, isOlympicLift } from '../domain/exerciseSelection/selector.js';
import { generateSession } from '../domain/session/sessionGenerator.js';
import { resolveSessionGoal } from '../domain/session/sessionPrescription.js';
import { generateWarmup } from '../domain/session/rampGenerator.js';
import { evaluateSplitQuality } from '../domain/periodization/splitQuality.js';
import { normalizeTrainingDays } from '../domain/periodization/splitSelector.js';
import { countMuscleSessionsPerWeek, DAY_ORDER } from '../domain/constants.js';
import { computeWeeklyVolumePlan } from '../domain/periodization/weekVolumePlanner.js';
import { classifyProfileChanges } from '../domain/athlete/profileChangeImpact.js';
import {
  remapMesocycleSchedule,
  regenerateRemainingMicrocycles,
} from '../domain/periodization/adaptMesocycleToProfile.js';
import fs from 'fs';
import path from 'path';

function referenceDateForDay(dayName) {
  const monday = new Date('2026-07-06T12:00:00Z');
  const offset = DAY_ORDER.indexOf(dayName);
  const date = new Date(monday);
  date.setUTCDate(monday.getUTCDate() + Math.max(0, offset));
  return date.toISOString();
}

const baseProfile = {
  name: 'Test',
  age: 28,
  gender: 'M',
  heightCm: 175,
  currentWeightKg: 75,
  trainingAgeMonths: 12,
  fitnessGoal: 'Hipertrofia',
  trainingDaysPerWeek: 4,
  weeklyScheduleContext: [
    { day: 'Lunes', canTrain: true },
    { day: 'Martes', canTrain: false },
    { day: 'Miércoles', canTrain: true },
    { day: 'Jueves', canTrain: false },
    { day: 'Viernes', canTrain: true },
    { day: 'Sábado', canTrain: true },
    { day: 'Domingo', canTrain: false },
  ],
  injuriesOrLimitations: [],
  timezone: 'America/Mexico_City',
};

describe('experienceLevel', () => {
  it('maps training age to Novato/Intermedio/Avanzado', () => {
    expect(calculateExperienceLevel(3)).toBe('Novato');
    expect(calculateExperienceLevel(12)).toBe('Intermedio');
    expect(calculateExperienceLevel(30)).toBe('Avanzado');
  });
});

describe('mesocycle', () => {
  it('generates 5-week mesocycle for Intermedio with deload last week', () => {
    const mc = generateMesocycle(baseProfile, '2026-07-07');
    expect(mc.durationWeeks).toBe(5);
    expect(mc.experienceLevel).toBe('Intermedio');
    expect(mc.microcycles.at(-1).phase).toBe('deload');
    expect(mc.microcycles.at(-1).volumeMultiplier).toBe(0.5);
  });
});

describe('readiness', () => {
  it('never increases volume above 1.0', () => {
    const result = applyReadiness(
      { energyLevel: 5, sorenessLevel: 1, sleepQuality: 5 },
      ['Pecho'],
    );
    expect(result.volumeMultiplier).toBeLessThanOrEqual(1.0);
    expect(result.rirDelta).toBeGreaterThanOrEqual(0);
  });

  it('reduces volume on high stress', () => {
    const result = applyReadiness({ stressLevel: 5 }, ['Pecho']);
    expect(result.volumeMultiplier).toBeLessThan(1.0);
  });
});

describe('loadCalculator', () => {
  it('estimates e1RM with Brzycki', () => {
    const e1rm = estimateE1RM(100, 5);
    expect(e1rm).toBeGreaterThan(100);
    expect(e1rm).toBeCloseTo(112.5, 0);
  });

  it('caps weekly compound increase at 5%', () => {
    expect(applyLoadLimits(110, 100, 'compound', 'weekly')).toBe(105);
  });
});

describe('weeklyFeedback', () => {
  it('reduces on joint pain', () => {
    expect(applyWeeklyFeedback({ jointPain: true }, 'Pecho').modifier).toBe(0.7);
  });
});

describe('splitSelector', () => {
  it('selects Torso_Pierna for 4 days Hipertrofia', () => {
    expect(selectSplit(4, 'Hipertrofia', 'Intermedio')).toBe('Torso_Pierna');
  });

  it('selects Torso_Pierna_ondulado for 3 days Intermedio Hipertrofia', () => {
    expect(selectSplit(3, 'Hipertrofia', 'Intermedio')).toBe('Torso_Pierna_ondulado');
  });

  it('selects Full_Body for 3 days Fuerza (frecuencia en compuestos)', () => {
    expect(selectSplit(3, 'Fuerza', 'Avanzado')).toBe('Full_Body');
  });

  it('selects PHUL for 4-5 days Fuerza', () => {
    expect(selectSplit(4, 'Fuerza', 'Intermedio')).toBe('Hibrido_PHUL');
    expect(selectSplit(5, 'Fuerza', 'Avanzado')).toBe('Hibrido_PHUL');
  });

  it('caps training days at 6', () => {
    expect(selectSplit(7, 'Hipertrofia', 'Intermedio')).toBe('Push_Pull_Legs');
  });
});

describe('deload volume', () => {
  it('applies 50% reduction once via getWeekPlan', () => {
    const mc = generateMesocycle(baseProfile, '2026-07-07');
    const lastAccumWeek = mc.durationWeeks - 1;
    const lastPlan = getWeekPlan(mc, lastAccumWeek);
    const deloadPlan = getWeekPlan(mc, mc.durationWeeks);
    const muscle = Object.keys(lastPlan.volumeByMuscle)[0];
    expect(deloadPlan.volumeByMuscle[muscle]).toBe(
      applyDeloadVolume(lastPlan.volumeByMuscle[muscle]),
    );
  });
});

describe('weeklyFeedback integration', () => {
  it('increases volume modifier when user has margin', () => {
    const mod = applyWeeklyFeedback(
      {
        pumpQuality: 1,
        sorenessTiming: 'no llegó a doler',
        perceivedWorkload: 1,
        jointPain: false,
      },
      'Pecho',
    ).modifier;
    expect(mod).toBe(1.15);
  });

  it('getWeekPlan applies feedback modifiers', () => {
    const mc = generateMesocycle(baseProfile, '2026-07-07');
    const base = getWeekPlan(mc, 2);
    const adjusted = getWeekPlan(mc, 2, { Pecho: 0.85 });
    const muscle = 'Pecho';
    if (base.volumeByMuscle[muscle]) {
      expect(adjusted.volumeByMuscle[muscle]).toBeLessThan(base.volumeByMuscle[muscle]);
    }
  });
});

describe('cycleEvaluation', () => {
  it('raises MEV when mesociclo was easy', () => {
    const mc = generateMesocycle(baseProfile, '2026-07-07');
    const result = evaluateCycle(
      { generalDifficulty: 2, persistentJointPain: false },
      mc.volumeLandmarks,
      baseProfile,
      '2026-08-07',
    );
    const muscle = Object.keys(mc.volumeLandmarks)[0];
    expect(result.updatedLandmarks[muscle].MEV).toBeGreaterThan(mc.volumeLandmarks[muscle].MEV);
    expect(result.nextMesocycle.volumeLandmarks[muscle].MEV).toBeGreaterThan(
      mc.volumeLandmarks[muscle].MEV,
    );
  });
});

describe('volume per session frequency', () => {
  it('Full Body 3x does not triple weekly volume for Pecho', () => {
    const profile = {
      ...baseProfile,
      trainingAgeMonths: 3,
      trainingDaysPerWeek: 3,
      weeklyScheduleContext: [
        { day: 'Lunes', canTrain: true },
        { day: 'Martes', canTrain: false },
        { day: 'Miércoles', canTrain: true },
        { day: 'Jueves', canTrain: false },
        { day: 'Viernes', canTrain: true },
        { day: 'Sábado', canTrain: false },
        { day: 'Domingo', canTrain: false },
      ],
    };
    const mc = generateMesocycle(profile, '2026-07-07');
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const weekPlan = getWeekPlan(mc, 1);
    const targetPecho = weekPlan.volumeByMuscle.Pecho ?? 0;
    const freq = countMuscleSessionsPerWeek(mc.splitType).Pecho ?? 1;

    const sessions = mc.microcycles[0].sessions.filter((s) => !s.isRestDay);
    let totalPechoSets = 0;
    const sessionHistory = [];
    const weeklyVolumePlan = computeWeeklyVolumePlan({
      splitType: mc.splitType,
      trainingDays: profile.trainingDaysPerWeek,
      weeklyScheduleContext: profile.weeklyScheduleContext,
      catalog,
      safetyProfile: mc.safetyProfile ?? {},
      goal: mc.goal,
      weekNumber: 1,
    });

    for (const dayPlan of sessions) {
      const session = generateSession({
        profile,
        mesocycle: mc,
        weekNumber: 1,
        sessionFocus: dayPlan.sessionFocus,
        sessionMuscles: dayPlan.muscles,
        patterns: dayPlan.patterns,
        catalog: { entrenamiento: catalog, calentamiento: [], enfriamiento: [] },
        history: sessionHistory,
        weeklyVolumePlan,
        referenceDate: referenceDateForDay(dayPlan.dayOfWeek),
      });
      sessionHistory.push(session);
      totalPechoSets += session.mainBlock
        .filter((e) => e.muscleGroup === 'Pecho')
        .reduce((sum, e) => sum + e.sets, 0);
    }

    expect(freq).toBe(3);
    expect(totalPechoSets).toBeLessThanOrEqual(Math.ceil(targetPecho * 1.25));
    expect(totalPechoSets).toBeGreaterThanOrEqual(Math.floor(targetPecho * 0.75));
  });
});

describe('continuity week 1', () => {
  it('reuses week 1 exercises in week 2 for same session focus', () => {
    const catalog = [
      {
        id: 'bench',
        nombre: 'Press',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'incline_db',
        nombre: 'Inclinado',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 2,
        equipo: ['Mancuernas'],
      },
    ];
    const history = [
      {
        weekNumber: 1,
        sessionFocus: 'Torso (Empuje)',
        mainBlock: [
          { exerciseId: 'bench', exerciseName: 'Press', movementPattern: 'Empuje_H', muscleGroup: 'Pecho', priority: 1 },
        ],
      },
      {
        weekNumber: 2,
        sessionFocus: 'Torso (Empuje)',
        mainBlock: [
          { exerciseId: 'incline_db', exerciseName: 'Inclinado', movementPattern: 'Empuje_H', muscleGroup: 'Pecho', priority: 2 },
        ],
      },
    ];
    const selected = selectExercises('Torso (Empuje)', catalog, {}, history, 'Hipertrofia', { weekNumber: 2 });
    expect(selected.some((e) => e.id === 'bench')).toBe(true);
  });

  it('reuses the same exercises for duplicate session focus within the same week', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const profile = {
      fitnessGoal: 'Hipertrofia',
      trainingDaysPerWeek: 6,
      trainingAgeMonths: 36,
      weeklyScheduleContext: DAY_ORDER.map((day, index) => ({
        day,
        canTrain: index < 6,
      })),
      forcedSplitType: 'Push_Pull_Legs',
    };
    const mesocycle = generateMesocycle(profile, '2026-07-07');
    const weekPlan = getWeekPlan(mesocycle, 1);
    const weeklyVolumePlan = computeWeeklyVolumePlan({
      splitType: mesocycle.splitType,
      trainingDays: profile.trainingDaysPerWeek,
      weeklyScheduleContext: profile.weeklyScheduleContext,
      catalog,
      safetyProfile: mesocycle.safetyProfile,
      goal: mesocycle.goal,
      weekNumber: 1,
    });
    const pushSlots = weeklyVolumePlan.sessions.filter((s) => s.sessionFocus === 'Push');
    expect(pushSlots.length).toBe(2);

    const history = [];
    const pushSessions = [];
    for (const slot of pushSlots) {
      const session = generateSession({
        profile,
        mesocycle,
        weekNumber: 1,
        sessionFocus: slot.sessionFocus,
        sessionMuscles: slot.muscles,
        patterns: slot.patterns,
        catalog: { entrenamiento: catalog, calentamiento: [], enfriamiento: [] },
        history,
        weeklyVolumePlan,
        referenceDate: referenceDateForDay(slot.dayOfWeek),
      });
      history.push(session);
      pushSessions.push(session);
    }

    const firstIds = pushSessions[0].mainBlock.map((e) => e.exerciseId).sort();
    const secondIds = pushSessions[1].mainBlock.map((e) => e.exerciseId).sort();
    expect(secondIds).toEqual(firstIds);
  });
});

describe('plateau interventions', () => {
  it('suggests swap variant after rep range change', () => {
    const intervention = getIntervention(
      { id: 'bench', patronMovimiento: 'Empuje_H', parteCuerpo: 'Pecho' },
      { isPlateau: true },
      { repRangeChanged: true },
    );
    expect(intervention.type).toBe('swap_variant');
  });
});

describe('accessory muscle selection', () => {
  it('fills Tríceps on push session when only compound patterns selected', () => {
    const catalog = [
      {
        id: 'bench',
        nombre: 'Press banca',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'ohp',
        nombre: 'Press militar',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_V',
        parteCuerpo: 'Hombro',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'tricep_pushdown',
        nombre: 'Extensión tríceps polea',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Tríceps',
        prioridad: 3,
        equipo: ['Poleas'],
      },
    ];
    const selected = selectExercises(
      'Torso (Empuje)',
      catalog,
      {},
      [],
      'Hipertrofia',
      { weekNumber: 1, sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'] },
    );
    expect(selected.some((e) => e.parteCuerpo === 'Tríceps')).toBe(true);
  });

  it('fills Tríceps on push when Empuje_H pattern slots are already full', () => {
    const catalog = [
      {
        id: 'bench',
        nombre: 'Press banca',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'incline',
        nombre: 'Press inclinado',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 2,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'ohp',
        nombre: 'Press militar',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_V',
        parteCuerpo: 'Hombro',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'tricep_pushdown',
        nombre: 'Extensión tríceps polea',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Tríceps',
        prioridad: 3,
        equipo: ['Poleas'],
      },
    ];
    const selected = selectExercises('Push', catalog, {}, [], 'Hipertrofia', {
      weekNumber: 1,
      sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'],
    });
    expect(selected.some((e) => e.parteCuerpo === 'Tríceps')).toBe(true);
  });

  it('respects max 2 exercises per pattern when filling accessories', () => {
    const catalog = [
      {
        id: 'bench',
        nombre: 'Press banca',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'incline',
        nombre: 'Press inclinado',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 2,
        equipo: ['Mancuernas'],
      },
      {
        id: 'ohp',
        nombre: 'Press militar',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_V',
        parteCuerpo: 'Hombro',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'curl1',
        nombre: 'Curl bíceps polea',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Bíceps',
        prioridad: 3,
        equipo: ['Poleas'],
      },
      {
        id: 'curl2',
        nombre: 'Curl bíceps barra',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Bíceps',
        prioridad: 3,
        equipo: ['Barra EZ'],
      },
      {
        id: 'curl3',
        nombre: 'Curl bíceps mancuerna',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Bíceps',
        prioridad: 3,
        equipo: ['Mancuernas'],
      },
    ];
    const selected = selectExercises(
      'Full Body B',
      catalog,
      {},
      [],
      'Hipertrofia',
      { weekNumber: 1, sessionMuscles: ['Pecho', 'Hombro', 'Bíceps'] },
    );
    const traccionH = selected.filter((e) => e.patronMovimiento === 'Traccion_H');
    expect(traccionH.length).toBeLessThanOrEqual(2);
    expect(selected.some((e) => e.parteCuerpo === 'Bíceps')).toBe(true);
  });

  it('excludes Clean_Shrug and Clock_Push-Up from automatic selection', () => {
    const catalog = [
      {
        id: 'Clean_Shrug',
        nombre: 'Encogimiento tipo Clean',
        categoriaBloque: 'main_block',
        patronMovimiento: 'General',
        parteCuerpo: 'Hombro',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'shrug_alt',
        nombre: 'Encogimiento con mancuernas',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Traccion_V',
        parteCuerpo: 'Espalda',
        prioridad: 2,
        equipo: ['Mancuernas'],
      },
      {
        id: 'Clock_Push-Up',
        nombre: 'Flexión de Reloj',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Peso Corporal'],
      },
      {
        id: 'pushup',
        nombre: 'Flexión estándar',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 2,
        equipo: ['Peso Corporal'],
      },
      {
        id: 'row',
        nombre: 'Remo',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Espalda',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'squat',
        nombre: 'Sentadilla',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Rodilla',
        parteCuerpo: 'Cuádriceps',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
    ];
    const selected = selectExercises(
      'Full Body A',
      catalog,
      {},
      [],
      'Hipertrofia',
      { weekNumber: 1, sessionMuscles: ['Pecho', 'Espalda', 'Cuádriceps'] },
    );
    expect(selected.some((e) => e.id === 'Clean_Shrug')).toBe(false);
    expect(selected.some((e) => e.id === 'Clock_Push-Up')).toBe(false);
  });
});

describe('main block set caps', () => {
  it('caps isolation exercises at 4 sets and splits volume across same-muscle movements', () => {
    const catalog = {
      entrenamiento: [
        {
          id: 'curl1',
          nombre: 'Curl barra',
          categoriaBloque: 'main_block',
          patronMovimiento: 'Traccion_H',
          parteCuerpo: 'Bíceps',
          prioridad: 3,
          equipo: ['Barra EZ'],
        },
        {
          id: 'curl2',
          nombre: 'Curl mancuerna',
          categoriaBloque: 'main_block',
          patronMovimiento: 'Traccion_H',
          parteCuerpo: 'Bíceps',
          prioridad: 3,
          equipo: ['Mancuernas'],
        },
      ],
      calentamiento: [],
      enfriamiento: [],
    };
    const mesocycle = {
      mesocycleId: 'test',
      goal: 'Hipertrofia',
      splitType: 'Full_Body',
      safetyProfile: {},
      microcycles: [
        {
          weekNumber: 1,
          phase: 'exploratory',
          rirObjetivo: 4,
          volumeByMuscle: { Bíceps: 16 },
        },
      ],
    };
    const session = generateSession({
      profile: { fitnessGoal: 'Hipertrofia', currentWeightKg: 75, timezone: 'UTC' },
      mesocycle,
      weekNumber: 1,
      sessionFocus: 'Full Body B',
      sessionMuscles: ['Bíceps'],
      patterns: ['Traccion_H'],
      catalog,
      referenceDate: '2026-07-07',
    });
    const biceps = session.mainBlock.filter((e) => e.muscleGroup === 'Bíceps');
    expect(biceps.length).toBeGreaterThan(0);
    for (const ex of biceps) {
      expect(ex.sets).toBeLessThanOrEqual(4);
    }
    const totalSets = biceps.reduce((sum, e) => sum + e.sets, 0);
    expect(totalSets).toBeLessThanOrEqual(8);
  });
});

describe('conservative selector', () => {
  it('excludes free-weight axial lifts in week 1-2 for conservative profile', () => {
    const catalog = [
      {
        id: 'barbell_squat',
        nombre: 'Sentadilla',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Rodilla',
        parteCuerpo: 'Cuádriceps',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'leg_press',
        nombre: 'Prensa',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Rodilla',
        parteCuerpo: 'Cuádriceps',
        prioridad: 1,
        equipo: ['Prensa de Piernas'],
      },
    ];
    const safety = { conservative: true, avoidPatterns: [], modifyPatterns: [] };
    const week1 = selectExercises('Pierna (Dominante Rodilla)', catalog, safety, [], 'Hipertrofia', {
      weekNumber: 1,
    });
    expect(week1.some((e) => e.id === 'barbell_squat')).toBe(false);
    expect(week1.some((e) => e.id === 'leg_press')).toBe(true);
  });
});

describe('fuerza accessory RIR', () => {
  it('stores separate accessory RIR in microcycle for Fuerza goal', () => {
    const profile = { ...baseProfile, fitnessGoal: 'Fuerza' };
    const mc = generateMesocycle(profile, '2026-07-07');
    const week1 = mc.microcycles[0];
    expect(week1.rirObjetivoAccessory).toBeGreaterThan(week1.rirObjetivo);
  });
});

describe('orderExercises', () => {
  it('puts priority lift first for Fuerza', () => {
    const exercises = [
      { id: 'a', prioridad: 2, nombre: 'Acc' },
      { id: 'b', prioridad: 1, nombre: 'Main' },
    ];
    const ordered = orderByGoal(exercises, 'Fuerza', 'b');
    expect(ordered[0].id).toBe('b');
  });
});

describe('plateau', () => {
  it('detects plateau when 4+ stagnant sessions', () => {
    const history = Array.from({ length: 6 }, () => ({
      weightKg: 100,
      reps: 8,
      rir: 2,
    }));
    expect(detectPlateau(history).isPlateau).toBe(true);
  });
});

describe('microcycle', () => {
  it('returns week plan with volume targets', () => {
    const mc = generateMesocycle(baseProfile, '2026-07-07');
    const plan = getWeekPlan(mc, 1);
    expect(plan.week).toBe(1);
    expect(Object.keys(plan.volumeByMuscle).length).toBeGreaterThan(0);
  });
});

describe('safetyProfile', () => {
  it('activates conservative protocol for age >= 50', () => {
    const profile = buildSafetyProfile({ age: 55, injuriesOrLimitations: [] });
    expect(profile.conservative).toBe(true);
  });
});

describe('mesocycle-scoped continuity', () => {
  it('reuses exercises within the same mesocycle but not across mesocycles', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const mc1 = 'mc_2026-01-06_Hipertrofia_Full_Body';
    const mc2 = 'mc_2026-02-18_Hipertrofia_Full_Body';

    const history = [
      {
        mesocycleId: mc1,
        weekNumber: 1,
        sessionFocus: 'Full Body A',
        mainBlock: [
          {
            exerciseId: 'bench_anchor',
            exerciseName: 'Press ancla',
            movementPattern: 'Empuje_H',
            muscleGroup: 'Pecho',
            priority: 1,
          },
        ],
      },
    ];

    const week2SameMc = selectExercises('Full Body A', catalog, {}, history, 'Hipertrofia', {
      weekNumber: 2,
      sessionMuscles: ['Pecho', 'Espalda', 'Cuádriceps', 'Hombro', 'Core'],
      mesocycleId: mc1,
    });
    expect(week2SameMc.some((e) => e.id === 'bench_anchor')).toBe(true);

    const week1NewMc = selectExercises('Full Body A', catalog, {}, history, 'Hipertrofia', {
      weekNumber: 1,
      sessionMuscles: ['Pecho', 'Espalda', 'Cuádriceps', 'Hombro', 'Core'],
      mesocycleId: mc2,
    });
    expect(week1NewMc.some((e) => e.id === 'bench_anchor')).toBe(false);
  });

  it('excludes previous mesocycle accessory exercises on week 1 but keeps basic lifts', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const mc1 = 'mc_prev';
    const mc2 = 'mc_next';
    const prevIds = selectExercises('Torso (Empuje)', catalog, {}, [], 'Hipertrofia', {
      weekNumber: 1,
      sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'],
      mesocycleId: mc1,
    }).map((e) => e.id);

    const history = [
      {
        mesocycleId: mc1,
        weekNumber: 1,
        sessionFocus: 'Torso (Empuje)',
        mainBlock: prevIds.map((id) => {
          const ex = catalog.find((c) => c.id === id);
          return {
            exerciseId: id,
            exerciseName: ex?.nombre ?? id,
            movementPattern: ex?.patronMovimiento,
            muscleGroup: ex?.parteCuerpo,
            priority: ex?.prioridad ?? 2,
          };
        }),
      },
    ];

    const basicIds = history[0].mainBlock.filter((b) => (b.priority ?? 2) === 1).map((b) => b.exerciseId);
    const accessoryIds = history[0].mainBlock.filter((b) => (b.priority ?? 2) > 1).map((b) => b.exerciseId);

    const week1NewMc = selectExercises('Torso (Empuje)', catalog, {}, history, 'Hipertrofia', {
      weekNumber: 1,
      sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'],
      mesocycleId: mc2,
      excludeIds: getMesocycleRotationExclusions(history, mc2, 1, 'Torso (Empuje)'),
    });

    const overlap = week1NewMc.filter((e) => prevIds.includes(e.id)).length;
    expect(overlap).toBeLessThan(prevIds.length);

    if (basicIds.length > 0) {
      const keptBasics = week1NewMc.filter((e) => basicIds.includes(e.id)).length;
      expect(keptBasics).toBeGreaterThan(0);
    }
    if (accessoryIds.length > 0) {
      const rotatedAccessories = week1NewMc.filter((e) => accessoryIds.includes(e.id)).length;
      expect(rotatedAccessories).toBeLessThan(accessoryIds.length);
    }
  });
});

describe('stimulus coverage', () => {
  it('avoids duplicate chest angles when selecting two Empuje_H exercises', () => {
    const catalog = [
      {
        id: 'decline_bench',
        nombre: 'Press declinado con barra',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'decline_db',
        nombre: 'Press declinado con mancuernas',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 2,
        equipo: ['Mancuernas'],
      },
      {
        id: 'cable_cross',
        nombre: 'Cruce de poleas',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 3,
        equipo: ['Poleas'],
      },
      {
        id: 'flat_bench',
        nombre: 'Press de banca plano',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
    ];

    const selected = selectExercises('Torso (Empuje)', catalog, {}, [], 'Hipertrofia', {
      weekNumber: 1,
      sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'],
      mesocycleId: 'mc_test',
    });

    const chest = selected.filter((e) => e.parteCuerpo === 'Pecho');
    const ids = chest.map((e) => e.id);
    expect(ids).toContain('flat_bench');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toEqual(['decline_bench', 'decline_db']);
  });
});

describe('novice olympic lift exclusion', () => {
  it('does not auto-select Olympic lifts for Novato experience level', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const safety = { experienceLevel: 'Novato', avoidPatterns: [], modifyPatterns: [], conservative: false };

    const focuses = ['Full Body A', 'Torso (Empuje)', 'Pierna (Dominante Cadera)'];
    for (const focus of focuses) {
      const selected = selectExercises(focus, catalog, safety, [], 'Hipertrofia', {
        weekNumber: 1,
        mesocycleId: 'mc_novice_test',
      });
      for (const ex of selected) {
        expect(isOlympicLift(ex)).toBe(false);
      }
    }
  });

  it('does not auto-select Alta-difficulty Olympic lifts (staples-first policy)', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const olympicInCatalog = catalog.filter((ex) => isOlympicLift(ex));
    expect(olympicInCatalog.length).toBeGreaterThan(0);

    const safety = { experienceLevel: 'Intermedio', avoidPatterns: [], modifyPatterns: [], conservative: false };
    const allSelected = [];
    for (const focus of ['Full Body A', 'Pierna (Dominante Cadera)', 'Torso (Empuje)']) {
      allSelected.push(
        ...selectExercises(focus, catalog, safety, [], 'Hipertrofia', {
          weekNumber: 1,
          mesocycleId: 'mc_inter_test',
        }),
      );
    }
    expect(allSelected.some((ex) => isOlympicLift(ex))).toBe(false);
  });
});

describe('injury-aware exercise selection', () => {
  it('selects knee-safe leg work when Rodilla is limited', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const safety = buildSafetyProfile({ injuriesOrLimitations: ['Rodilla'] });
    const selected = selectExercises(
      'Pierna (Dominante Rodilla)',
      catalog,
      safety,
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Cuádriceps', 'Glúteos', 'Pantorrillas'],
      },
    );
    expect(selected.some((e) => e.parteCuerpo === 'Cuádriceps')).toBe(true);
    expect(
      selected.some((e) => /prensa|leg press|m[aá]quina|hack|smith/i.test(e.nombre ?? '')),
    ).toBe(true);
    expect(
      selected.every(
        (e) => !/swing|kettlebell|peso muerto|deadlift|good morning|buenos d[ií]as/i.test(e.nombre ?? ''),
      ),
    ).toBe(true);
  });

  it('avoids Empuje_V and olympic lifts for shoulder limitation on push day', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const safety = buildSafetyProfile({ injuriesOrLimitations: ['Hombro'] });
    const selected = selectExercises(
      'Torso (Empuje)',
      catalog,
      safety,
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'],
      },
    );
    expect(selected.some((e) => e.patronMovimiento === 'Empuje_V')).toBe(false);
    expect(selected.some((e) => /snatch|arrancada|clean|jerk/i.test(e.nombre ?? ''))).toBe(false);
    expect(selected.some((e) => e.parteCuerpo === 'Hombro')).toBe(true);
  });
});

describe('warmup RAMP', () => {
  const warmupCatalog = [
    {
      id: 'treadmill',
      nombre: 'Caminata en Cinta',
      faseRAMP: 'Raise',
      patronMovimiento: 'General',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Caminadora'],
    },
    {
      id: 'wrist',
      nombre: 'Círculos de Muñeca',
      faseRAMP: 'Raise',
      patronMovimiento: 'General',
      parteCuerpo: 'Hombro',
      equipo: ['Peso Corporal'],
    },
    {
      id: 'shoulder_rot',
      nombre: 'Rotación externa con banda',
      faseRAMP: 'Activate',
      patronMovimiento: 'General',
      parteCuerpo: 'Hombro',
      equipo: ['Bandas de Resistencia'],
    },
    {
      id: 'knee_circles',
      nombre: 'Círculos de Rodilla',
      faseRAMP: 'Mobilize',
      patronMovimiento: 'Rodilla',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Peso Corporal'],
    },
    {
      id: 'hip_open',
      nombre: 'Apertura de cadera',
      faseRAMP: 'Mobilize',
      patronMovimiento: 'Cadera',
      parteCuerpo: 'Glúteos',
      equipo: ['Peso Corporal'],
    },
    {
      id: 'leg_swing',
      nombre: 'Balanceo de pierna',
      faseRAMP: 'Potentiate',
      patronMovimiento: 'Rodilla',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Peso Corporal'],
    },
  ];

  it('excludes upper-body General drills on lower-body sessions', () => {
    const warmup = generateWarmup(['Rodilla', 'Cadera'], warmupCatalog, {
      sessionFocus: 'Lower (Hipertrofia)',
      sessionMuscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'],
    });
    const names = warmup.map((w) => w.name);
    expect(names).not.toContain('Círculos de Muñeca');
    expect(names).not.toContain('Rotación externa con banda');
    expect(warmup.length).toBeLessThanOrEqual(8);
  });

  it('avoids treadmill jogging on upper-body sessions', () => {
    const upperCatalog = [
      ...warmupCatalog,
      {
        id: 'jog_treadmill',
        nombre: 'Trote en Caminadora',
        faseRAMP: 'Raise',
        patronMovimiento: 'General',
        parteCuerpo: 'Cuádriceps',
        equipo: ['Caminadora'],
        isDynamic: false,
      },
      {
        id: 'arm_circles',
        nombre: 'Círculos de brazos',
        faseRAMP: 'Raise',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Hombro',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
      {
        id: 'band_pull',
        nombre: 'Face pull con banda',
        faseRAMP: 'Activate',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Espalda',
        equipo: ['Bandas de Resistencia'],
      },
      {
        id: 'thoracic',
        nombre: 'Rotación torácica',
        faseRAMP: 'Mobilize',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Espalda',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
      {
        id: 'pushup',
        nombre: 'Flexiones ligeras',
        faseRAMP: 'Potentiate',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
        equipo: ['Peso Corporal'],
      },
    ];

    const warmup = generateWarmup(['Empuje_H', 'Traccion_H'], upperCatalog, {
      sessionFocus: 'Upper (Hipertrofia)',
      sessionMuscles: ['Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps'],
      goal: 'Hipertrofia',
    });
    const names = warmup.map((w) => w.name);
    expect(names).not.toContain('Trote en Caminadora');
    expect(names).not.toContain('Caminata en Cinta');
  });

  it('blocks explosive drills in fuerza Activate and Potentiate phases', () => {
    const catalog = [
      {
        id: 'walk',
        nombre: 'Caminata en Cinta',
        faseRAMP: 'Raise',
        patronMovimiento: 'General',
        parteCuerpo: 'Cuádriceps',
        equipo: ['Caminadora'],
      },
      {
        id: 'wall_drill',
        nombre: 'Drill de Pared para Aceleración Lineal',
        faseRAMP: 'Activate',
        patronMovimiento: 'Rodilla',
        parteCuerpo: 'Cuádriceps',
        equipo: ['Peso Corporal'],
      },
      {
        id: 'hip_mob',
        nombre: 'Basculación Pélvica de Pie',
        faseRAMP: 'Mobilize',
        patronMovimiento: 'Cadera',
        parteCuerpo: 'Glúteos',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
      {
        id: 'lateral_leg',
        nombre: 'Elevaciones de Pierna Lateral',
        faseRAMP: 'Mobilize',
        patronMovimiento: 'Cadera',
        parteCuerpo: 'Glúteos',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
      {
        id: 'jerk_squat',
        nombre: 'Sentadilla de Impulso de Jerk',
        faseRAMP: 'Potentiate',
        patronMovimiento: 'Rodilla',
        parteCuerpo: 'Cuádriceps',
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'glute_bridge',
        nombre: 'Puente de glúteo a una pierna',
        faseRAMP: 'Potentiate',
        patronMovimiento: 'Cadera',
        parteCuerpo: 'Glúteos',
        equipo: ['Peso Corporal'],
      },
    ];

    const warmup = generateWarmup(['Rodilla', 'Cadera'], catalog, {
      sessionFocus: 'Lower (Fuerza)',
      sessionMuscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos'],
      goal: 'Fuerza',
    });
    const names = warmup.map((w) => w.name);
    expect(names).not.toContain('Drill de Pared para Aceleración Lineal');
    expect(names).not.toContain('Sentadilla de Impulso de Jerk');
  });

  it('avoids shoulder shrugs in activate when Empuje_V is restricted', () => {
    const catalog = [
      {
        id: 'raise',
        nombre: 'Balanceo lateral',
        faseRAMP: 'Raise',
        patronMovimiento: 'Traccion_H',
        parteCuerpo: 'Espalda',
        equipo: ['Kettlebell'],
        isDynamic: true,
      },
      {
        id: 'shrug',
        nombre: 'Elevación de Hombros (Encogimientos)',
        faseRAMP: 'Activate',
        patronMovimiento: 'Traccion_V',
        parteCuerpo: 'Hombro',
        equipo: ['Mancuernas'],
      },
      {
        id: 'scaption',
        nombre: 'Scaption con Mancuernas',
        faseRAMP: 'Activate',
        patronMovimiento: 'Empuje_V',
        parteCuerpo: 'Hombro',
        equipo: ['Mancuernas'],
      },
      {
        id: 'mob1',
        nombre: 'Círculos de Hombros',
        faseRAMP: 'Mobilize',
        patronMovimiento: 'Empuje_V',
        parteCuerpo: 'Hombro',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
      {
        id: 'mob2',
        nombre: 'Círculos con Codos',
        faseRAMP: 'Mobilize',
        patronMovimiento: 'Empuje_V',
        parteCuerpo: 'Hombro',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
      {
        id: 'pot',
        nombre: 'Dominada Escapular',
        faseRAMP: 'Potentiate',
        patronMovimiento: 'Traccion_V',
        parteCuerpo: 'Espalda',
        equipo: ['Barra de Dominadas'],
      },
    ];

    const warmup = generateWarmup(['Traccion_H', 'Traccion_V'], catalog, {
      sessionFocus: 'Torso (Tracción)',
      sessionMuscles: ['Espalda', 'Bíceps', 'Hombro'],
      goal: 'Hipertrofia',
      avoidPatterns: ['Empuje_V'],
    });
    const names = warmup.map((w) => w.name);
    expect(names).not.toContain('Elevación de Hombros (Encogimientos)');
  });
});

describe('accessory muscle fill', () => {
  it('picks calf exercises for Pantorrillas, not wrist curls', () => {
    const catalog = [
      {
        id: 'wrist_curl',
        nombre: 'Curl de Muñeca Prono con Mancuerna',
        categoriaBloque: 'main_block',
        patronMovimiento: 'General',
        parteCuerpo: 'Pantorrillas',
        prioridad: 3,
        equipo: ['Mancuernas'],
      },
      {
        id: 'calf_press',
        nombre: 'Prensa de Pantorrilla',
        categoriaBloque: 'main_block',
        patronMovimiento: 'General',
        parteCuerpo: 'Pantorrillas',
        prioridad: 2,
        equipo: ['Prensa de Piernas'],
      },
      {
        id: 'squat',
        nombre: 'Sentadilla',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Rodilla',
        parteCuerpo: 'Cuádriceps',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
      {
        id: 'rdl',
        nombre: 'Peso muerto rumano',
        categoriaBloque: 'main_block',
        patronMovimiento: 'Cadera',
        parteCuerpo: 'Isquiotibiales',
        prioridad: 1,
        equipo: ['Barra Olímpica'],
      },
    ];
    const selected = selectExercises(
      'Lower (Hipertrofia)',
      catalog,
      {},
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'],
      },
    );
    const calf = selected.find((e) => e.parteCuerpo === 'Pantorrillas');
    expect(calf?.id).toBe('calf_press');
  });
});

describe('full body exercise mix', () => {
  it('selects upper and lower patterns for Full Body C', () => {
    const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).items;
    const selected = selectExercises(
      'Full Body C',
      catalog,
      {},
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Cuádriceps', 'Pecho', 'Espalda', 'Hombro', 'Pantorrillas'],
      },
    );
    const patterns = new Set(selected.map((e) => e.patronMovimiento));
    expect(patterns.has('Rodilla')).toBe(true);
    expect(
      patterns.has('Empuje_H') || patterns.has('Empuje_V') || patterns.has('Traccion_H'),
    ).toBe(true);
  });
});

describe('split quality across calendars', () => {
  function combinations(arr, k) {
    if (k === 0) return [[]];
    if (!arr.length) return [];
    const [head, ...tail] = arr;
    return [
      ...combinations(tail, k - 1).map((c) => [head, ...c]),
      ...combinations(tail, k),
    ];
  }

  it('rates 3-6 day calendars as muy_bien or excelente for Intermedio Hipertrofia', () => {
    const days = [...DAY_ORDER];
    let poor = 0;
    for (const k of [3, 4, 5, 6]) {
      for (const cal of combinations(days, k)) {
        const profile = {
          fitnessGoal: 'Hipertrofia',
          trainingDaysPerWeek: k,
          trainingAgeMonths: 12,
          experienceLevel: 'Intermedio',
          weeklyScheduleContext: days.map((day) => ({
            day,
            canTrain: cal.includes(day),
          })),
          injuriesOrLimitations: [],
        };
        const mc = generateMesocycle(profile, '2026-07-07');
        const week = mc.microcycles[0].sessions.filter((s) => !s.isRestDay);
        const quality = evaluateSplitQuality({
          splitType: mc.splitType,
          goal: 'Hipertrofia',
          experienceLevel: 'Intermedio',
          trainingDaysPerWeek: k,
          effectiveTrainingDays: week.length,
          sessions: week,
        });
        if (!['excelente', 'muy_bien'].includes(quality.grade)) poor += 1;
      }
    }
    expect(poor).toBe(0);
  });

  it('caps 7 requested days to 6 effective sessions', () => {
    expect(normalizeTrainingDays(7)).toBe(6);
    const profile = {
      fitnessGoal: 'Hipertrofia',
      trainingDaysPerWeek: 7,
      trainingAgeMonths: 12,
      weeklyScheduleContext: DAY_ORDER.map((day) => ({ day, canTrain: true })),
      injuriesOrLimitations: [],
    };
    const mc = generateMesocycle(profile, '2026-07-07');
    const week = mc.microcycles[0].sessions.filter((s) => !s.isRestDay);
    expect(week.length).toBe(6);
    const quality = evaluateSplitQuality({
      splitType: mc.splitType,
      goal: 'Hipertrofia',
      experienceLevel: 'Intermedio',
      trainingDaysPerWeek: 7,
      effectiveTrainingDays: week.length,
      sessions: week,
    });
    expect(quality.grade).not.toBe('insuficiente');
  });

  it('rotates single-day Full Body templates across weeks', () => {
    const profile = {
      fitnessGoal: 'Hipertrofia',
      trainingDaysPerWeek: 1,
      trainingAgeMonths: 12,
      weeklyScheduleContext: DAY_ORDER.map((day, i) => ({ day, canTrain: i === 0 })),
      injuriesOrLimitations: [],
    };
    const mc = generateMesocycle(profile, '2026-07-07');
    const focuses = mc.microcycles
      .slice(0, 3)
      .map((w) => w.sessions.find((s) => !s.isRestDay)?.sessionFocus);
    expect(new Set(focuses).size).toBeGreaterThan(1);
  });
});

describe('profile change impact', () => {
  const profileBase = {
    name: 'Test',
    age: 28,
    gender: 'M',
    heightCm: 175,
    currentWeightKg: 75,
    fitnessGoal: 'Hipertrofia',
    trainingAgeMonths: 18,
    experienceLevel: 'Intermedio',
    trainingDaysPerWeek: 5,
    weeklyScheduleContext: DAY_ORDER.map((day) => ({
      day,
      canTrain: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'].includes(day),
    })),
    injuriesOrLimitations: [],
    focusArea: 'General',
  };

  it('metadata-only changes do not touch the plan', () => {
    const meso = generateMesocycle(profileBase, '2026-07-07');
    const impact = classifyProfileChanges(profileBase, { ...profileBase, name: 'Nuevo' }, meso);
    expect(impact.tier).toBe('metadata_only');
    expect(impact.requiresSessionClear).toBe(false);
  });

  it('schedule remap when training days count unchanged', () => {
    const meso = generateMesocycle(profileBase, '2026-07-07');
    const newProfile = {
      ...profileBase,
      trainingDaysPerWeek: 5,
      weeklyScheduleContext: DAY_ORDER.map((day) => ({
        day,
        canTrain: ['Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].includes(day),
      })),
    };
    const impact = classifyProfileChanges(profileBase, newProfile, meso);
    expect(impact.tier).toBe('schedule_remap');
    const adapted = remapMesocycleSchedule(meso, newProfile);
    const week1 = adapted.microcycles[0].sessions.filter((s) => !s.isRestDay);
    expect(week1.length).toBe(5);
  });

  it('structural change triggers partial regeneration preserving past weeks', () => {
    const meso = generateMesocycle(profileBase, '2026-07-07');
    meso.currentWeek = 2;
    const newProfile = {
      ...profileBase,
      trainingDaysPerWeek: 3,
      weeklyScheduleContext: DAY_ORDER.map((day) => ({
        day,
        canTrain: ['Lunes', 'Miércoles', 'Viernes'].includes(day),
      })),
    };
    const impact = classifyProfileChanges(profileBase, newProfile, meso);
    expect(impact.tier).toBe('partial_regeneration');
    const adapted = regenerateRemainingMicrocycles(meso, newProfile, new Date('2026-07-14'));
    expect(adapted.microcycles[0]).toEqual(meso.microcycles[0]);
    expect(adapted.splitType).not.toBe(meso.splitType);
    expect(adapted.microcycles.length).toBe(meso.microcycles.length);
  });
});

describe('bodyweight and fuerza session rules', () => {
  it('does not prescribe load for bodyweight exercises', () => {
    const ex = {
      id: 'Pushups',
      equipo: ['Peso Corporal'],
      patronMovimiento: 'Empuje_H',
    };
    expect(isBodyweightExercise(ex)).toBe(true);
    const load = prescribeLoad({
      exerciseType: 'compound',
      rirTarget: 3,
      repRange: '8-12',
      history: [],
      bodyWeightKg: 80,
      movementPattern: 'Empuje_H',
      isBodyweight: true,
    });
    expect(load.mode).toBe('bodyweight');
    expect(load.prescribedLoadKg).toBeNull();
    expect(load.suggestedLoadKg).toBeNull();
  });

  it('detects bodyweight from catalog when continuity stub lacks equipo', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items;

    const inclineStub = {
      id: 'Incline_Push-Up_Wide',
      nombre: 'Flexión inclinada agarre ancho',
      patronMovimiento: 'Empuje_H',
      parteCuerpo: 'Pecho',
      equipo: [],
    };

    expect(isBodyweightExercise(inclineStub, catalog)).toBe(true);
  });

  it('prescribes bodyweight load for incline push-up continuity stubs', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items;

    const history = [
      {
        mesocycleId: 'bw-test',
        weekNumber: 1,
        sessionFocus: 'Torso (Empuje)',
        mainBlock: [
          {
            exerciseId: 'Incline_Push-Up_Wide',
            exerciseName: 'Flexión inclinada agarre ancho',
            movementPattern: 'Empuje_H',
            muscleGroup: 'Pecho',
            priority: 1,
            loadMode: 'bodyweight',
            isBodyweight: true,
          },
          {
            exerciseId: 'Barbell_Bench_Press_-_Medium_Grip',
            exerciseName: 'Press de banca con barra',
            movementPattern: 'Empuje_H',
            muscleGroup: 'Pecho',
            priority: 1,
          },
        ],
      },
    ];

    const selected = selectExercises('Torso (Empuje)', catalog, {}, history, 'Hipertrofia', {
      weekNumber: 2,
      sessionMuscles: ['Pecho', 'Hombro', 'Tríceps'],
      mesocycleId: 'bw-test',
    });

    const incline = selected.find((ex) => ex.id === 'Incline_Push-Up_Wide');
    expect(incline).toBeTruthy();
    expect(incline.equipo ?? []).toEqual([]);
    expect(isBodyweightExercise(incline, catalog)).toBe(true);

    const load = prescribeLoad({
      exerciseType: 'compound',
      rirTarget: 3,
      repRange: '8-12',
      history: [],
      bodyWeightKg: 80,
      movementPattern: incline.patronMovimiento,
      isBodyweight: isBodyweightExercise(incline, catalog),
      exerciseId: incline.id,
    });
    expect(load.mode).toBe('bodyweight');
    expect(load.suggestedLoadKg).toBeNull();
    expect(load.prescribedLoadKg).toBeNull();
  });

  it('selects at most one exercise per pattern on Fuerza upper sessions', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');

    const selected = selectExercises(
      'Upper (Fuerza)',
      catalog,
      { experienceLevel: 'Intermedio' },
      [],
      'Fuerza',
      { weekNumber: 1, sessionMuscles: ['Pecho', 'Espalda', 'Hombro'] },
    );

    const empuje = selected.filter((e) => e.patronMovimiento === 'Empuje_H');
    const traccion = selected.filter((e) => e.patronMovimiento === 'Traccion_H');
    expect(empuje.length).toBeLessThanOrEqual(1);
    expect(traccion.length).toBeLessThanOrEqual(1);
    expect(selected.some((e) => e.id === 'Single-Arm_Push-Up')).toBe(false);
    const chest = selected.find((e) => e.parteCuerpo === 'Pecho');
    if (chest) {
      expect(isBodyweightExercise(chest)).toBe(false);
    }
  });

  it('pull sessions prioritize back over upright rows in pattern slots', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');

    const selected = selectExercises(
      'Torso (Tracción)',
      catalog,
      {},
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Espalda', 'Bíceps', 'Hombro'],
      },
    );

    const back = selected.filter((e) => e.parteCuerpo === 'Espalda');
    expect(back.length).toBeGreaterThanOrEqual(2);
    expect(selected.some((e) => e.id === 'Upright_Row_-_With_Bands')).toBe(false);
  });

  it('excludes band exercises and upright rows from auto-select', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');

    for (const focus of ['Torso (Tracción)', 'Torso (Empuje)', 'Pierna (Dominante Cadera)']) {
      const selected = selectExercises(focus, catalog, {}, [], 'Hipertrofia', { weekNumber: 1 });
      for (const ex of selected) {
        expect((ex.equipo ?? []).join(' ')).not.toMatch(/banda|band/i);
        expect(ex.nombre ?? '').not.toMatch(/con banda|con bandas/i);
        expect(ex.id).not.toMatch(/upright|Dumbbell_Raise/i);
      }
    }
  });

  it('blocks upright rows for shoulder injury profile', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');
    const safety = {
      experienceLevel: 'Intermedio',
      avoidPatterns: ['Empuje_V'],
      modifyPatterns: ['Empuje_H'],
      conservative: false,
    };

    const selected = selectExercises(
      'Torso (Tracción)',
      catalog,
      safety,
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Espalda', 'Bíceps', 'Hombro'],
      },
    );

    expect(selected.every((ex) => !/remo vertical|upright row/i.test(ex.nombre ?? ''))).toBe(true);
    expect(selected.filter((ex) => ex.parteCuerpo === 'Bíceps').length).toBeLessThanOrEqual(1);
  });

  it('uses hypertrophy rep intent on PHUL upper hypertrophy day', () => {
    expect(resolveSessionGoal('Upper (Hipertrofia)', 'Fuerza')).toBe('Hipertrofia');
    expect(resolveSessionGoal('Upper (Fuerza)', 'Fuerza')).toBe('Fuerza');
    expect(resolveSessionGoal('Legs', 'Fuerza')).toBe('Fuerza');
    expect(resolveSessionGoal('Full Body A', 'Fuerza')).toBe('Fuerza');
    expect(resolveSessionGoal('Push', 'Fuerza')).toBe('Fuerza');
  });

  it('blocks lateral raises and step-ups for injury profiles', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');

    const shoulderSafety = {
      experienceLevel: 'Intermedio',
      injuries: ['Hombro'],
      avoidPatterns: ['Empuje_V'],
      modifyPatterns: ['Empuje_H'],
      conservative: false,
    };
    const pullWithShoulder = selectExercises(
      'Torso (Tracción)',
      catalog,
      shoulderSafety,
      [],
      'Hipertrofia',
      { weekNumber: 1, sessionMuscles: ['Espalda', 'Bíceps', 'Hombro'] },
    );
    expect(
      pullWithShoulder.every((ex) => !/elevaci[oó]n lateral|lateral raise/i.test(ex.nombre ?? '')),
    ).toBe(true);
    expect(
      pullWithShoulder.every((ex) => !/jal[oó]n.*agarre ancho/i.test(ex.nombre ?? '')),
    ).toBe(true);

    const kneeSafety = {
      experienceLevel: 'Intermedio',
      injuries: ['Rodilla'],
      modifyPatterns: ['Rodilla', 'Cadera'],
      conservative: false,
    };
    const kneeDay = selectExercises(
      'Pierna (Dominante Rodilla)',
      catalog,
      kneeSafety,
      [],
      'Hipertrofia',
      { weekNumber: 1, sessionMuscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'] },
    );
    expect(
      kneeDay.every(
        (ex) => !/step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla/i.test(ex.nombre ?? ''),
      ),
    ).toBe(true);
    expect(
      kneeDay.every((ex) => !/extensi[oó]n.*cu[aá]driceps|leg extension/i.test(ex.nombre ?? '')),
    ).toBe(true);
    expect(kneeDay.some((ex) => (ex.parteCuerpo ?? ex.muscleGroup) === 'Isquiotibiales')).toBe(true);
  });

  it('lower fuerza avoids good mornings and includes stable hinge', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');

    const selected = selectExercises(
      'Lower (Fuerza)',
      catalog,
      { experienceLevel: 'Avanzado', conservative: false },
      [],
      'Fuerza',
      {
        weekNumber: 1,
        sessionMuscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos'],
      },
    );

    expect(selected.length).toBeGreaterThanOrEqual(3);
    expect(selected.every((ex) => !/buenos d[ií]as|good morning/i.test(ex.nombre ?? ''))).toBe(true);
    expect(selected.some((ex) => ex.patronMovimiento === 'Rodilla')).toBe(true);
    expect(
      selected.some(
        (ex) =>
          ex.patronMovimiento === 'Cadera' &&
          /rumano|rdl|hip thrust|prensa/i.test(ex.nombre ?? ''),
      ),
    ).toBe(true);
  });

  it('full body B includes knee pattern for novata profile', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
    ).items.filter((ex) => ex.categoriaBloque === 'main_block');

    const selected = selectExercises(
      'Full Body B',
      catalog,
      { experienceLevel: 'Novato', conservative: false },
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Espalda', 'Pecho', 'Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Bíceps', 'Tríceps', 'Core'],
      },
    );

    expect(selected.some((ex) => ex.patronMovimiento === 'Rodilla')).toBe(true);
    expect(selected.every((ex) => !/swing|kettlebell swing/i.test(ex.nombre ?? ''))).toBe(true);
  });
});
