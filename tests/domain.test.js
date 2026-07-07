import { describe, it, expect } from 'vitest';
import { calculateExperienceLevel } from '../domain/athlete/experienceLevel.js';
import { buildSafetyProfile } from '../domain/athlete/safetyProfile.js';
import { selectSplit } from '../domain/periodization/splitSelector.js';
import { generateMesocycle } from '../domain/periodization/mesocycleGenerator.js';
import { getWeekPlan } from '../domain/periodization/microcycle.js';
import { applyReadiness } from '../domain/autoregulation/readiness.js';
import { applyWeeklyFeedback } from '../domain/autoregulation/weeklyFeedback.js';
import { estimateE1RM, applyLoadLimits } from '../domain/prescription/loadCalculator.js';
import { detectPlateau } from '../domain/progression/plateau.js';
import { orderByGoal } from '../domain/exerciseSelection/orderExercises.js';

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

  it('reduces volume on low energy', () => {
    const result = applyReadiness({ energyLevel: 1 }, ['Pecho']);
    expect(result.volumeMultiplier).toBe(0.6);
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
