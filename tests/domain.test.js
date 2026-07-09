import { describe, it, expect } from 'vitest';
import { calculateExperienceLevel } from '../domain/athlete/experienceLevel.js';
import { buildSafetyProfile } from '../domain/athlete/safetyProfile.js';
import { selectSplit } from '../domain/periodization/splitSelector.js';
import { generateMesocycle } from '../domain/periodization/mesocycleGenerator.js';
import { getWeekPlan, applyDeloadVolume } from '../domain/periodization/microcycle.js';
import { applyReadiness } from '../domain/autoregulation/readiness.js';
import { applyWeeklyFeedback } from '../domain/autoregulation/weeklyFeedback.js';
import { estimateE1RM, applyLoadLimits } from '../domain/prescription/loadCalculator.js';
import { detectPlateau, getIntervention } from '../domain/progression/plateau.js';
import { evaluateCycle } from '../domain/progression/cycleEvaluation.js';
import { orderByGoal } from '../domain/exerciseSelection/orderExercises.js';
import { selectExercises } from '../domain/exerciseSelection/selector.js';
import { generateSession } from '../domain/session/sessionGenerator.js';
import { countMuscleSessionsPerWeek } from '../domain/constants.js';
import fs from 'fs';
import path from 'path';

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
  it('selects Torso_Pierna for 4 days', () => {
    expect(selectSplit(4, 'Hipertrofia', 'Intermedio')).toBe('Torso_Pierna');
  });

  it('selects Torso_Pierna_ondulado for 3 days Intermedio/Avanzado', () => {
    expect(selectSplit(3, 'Hipertrofia', 'Intermedio')).toBe('Torso_Pierna_ondulado');
    expect(selectSplit(3, 'Fuerza', 'Avanzado')).toBe('Torso_Pierna_ondulado');
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
    for (const dayPlan of sessions) {
      const session = generateSession({
        profile,
        mesocycle: mc,
        weekNumber: 1,
        sessionFocus: dayPlan.sessionFocus,
        sessionMuscles: dayPlan.muscles,
        patterns: dayPlan.patterns,
        catalog: { entrenamiento: catalog, calentamiento: [], enfriamiento: [] },
        referenceDate: '2026-07-07',
      });
      totalPechoSets += session.mainBlock
        .filter((e) => e.muscleGroup === 'Pecho')
        .reduce((sum, e) => sum + e.sets, 0);
    }

    expect(freq).toBe(3);
    expect(totalPechoSets).toBeLessThan(targetPecho * 2);
    expect(totalPechoSets).toBeGreaterThan(0);
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
