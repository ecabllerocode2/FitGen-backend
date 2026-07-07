import { describe, it, expect } from 'vitest';
import { generateMesocycle } from '../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../domain/session/sessionGenerator.js';
import { evaluateCycle } from '../domain/progression/cycleEvaluation.js';
import { loadCatalogFromDisk } from '../infrastructure/catalog/catalogRepository.js';
import { addDays } from '../lib/dateUtils.js';
import { getTodaySessionPlan } from '../lib/mesocycleUtils.js';
import { validateInvariants } from './simulation/invariants.js';
import { PERSONAS } from './simulation/personas/index.js';

const BASE_PROFILE = {
  name: 'Test Atleta',
  age: 28,
  gender: 'M',
  heightCm: 175,
  currentWeightKg: 78,
  trainingAgeMonths: 18,
  fitnessGoal: 'Hipertrofia',
  trainingDaysPerWeek: 4,
  timezone: 'America/Mexico_City',
  injuriesOrLimitations: [],
  weeklyScheduleContext: [
    { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Martes', canTrain: false, externalLoad: 'ninguna' },
    { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Jueves', canTrain: false, externalLoad: 'ninguna' },
    { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Sábado', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
  ],
};

async function simulateMesocycles(persona, mesocycleCount = 2) {
  const catalog = await loadCatalogFromDisk();
  let profile = { ...BASE_PROFILE, ...persona.profile };
  let referenceDate = new Date(persona.startDate ?? '2026-01-06T12:00:00Z');
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

      const readiness = persona.getReadiness({ day, weekNumber, sessionPlan });
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

      history.push(persona.completeSession(session, readiness));
    }

    const evaluation = persona.getCycleEvaluation(mesocycle);
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

describe('Virtual athlete simulation', () => {
  const MESOCYCLE_COUNT = 2;

  for (const persona of PERSONAS) {
    it(`simulates ${MESOCYCLE_COUNT} mesocycles: ${persona.id}`, async () => {
      const { history, mesocycles } = await simulateMesocycles(persona, MESOCYCLE_COUNT);
      expect(history.length).toBeGreaterThan(0);
      const violations = validateInvariants({ history, mesocycles, persona });
      expect(violations).toEqual([]);
    }, 60_000);
  }
});
