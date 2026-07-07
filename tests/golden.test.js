import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateMesocycle } from '../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../domain/session/sessionGenerator.js';
import { evaluateCycle } from '../domain/progression/cycleEvaluation.js';
import { loadCatalogFromDisk } from '../infrastructure/catalog/catalogRepository.js';
import { addDays } from '../lib/dateUtils.js';
import { getTodaySessionPlan } from '../lib/mesocycleUtils.js';
import { PERSONAS } from './simulation/personas/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, 'simulation', 'golden');

const BASE_PROFILE = {
  name: 'Golden Atleta',
  age: 28,
  gender: 'M',
  heightCm: 175,
  currentWeightKg: 78,
  trainingAgeMonths: 3,
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

function summarizeTrajectory(persona, mesocycleCount = 2) {
  return async () => {
    const catalog = await loadCatalogFromDisk();
    let profile = { ...BASE_PROFILE, ...persona.profile };
    let referenceDate = new Date(persona.startDate ?? '2026-01-06T12:00:00Z');
    const sessions = [];
    const mesocycleMeta = [];

    for (let mc = 0; mc < mesocycleCount; mc += 1) {
      const mesocycle = generateMesocycle(profile, referenceDate);
      mesocycleMeta.push({
        mesocycleId: mesocycle.mesocycleId,
        durationWeeks: mesocycle.durationWeeks,
        split: mesocycle.split,
      });

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
          history: sessions,
          referenceDate: date,
        });

        sessions.push(persona.completeSession(session, readiness));
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

    return {
      personaId: persona.id,
      mesocycleCount,
      sessionCount: sessions.length,
      mesocycles: mesocycleMeta,
      sessionFocusSequence: sessions.map((s) => s.sessionFocus),
      exerciseCountPerSession: sessions.map((s) => (s.mainBlock ?? []).length),
      avgExercisesPerSession:
        sessions.reduce((sum, s) => sum + (s.mainBlock ?? []).length, 0) / sessions.length,
    };
  };
}

describe('Golden trajectory regression', () => {
  const persona = PERSONAS.find((p) => p.id === 'novato_constante');
  const goldenPath = join(GOLDEN_DIR, 'novato_constante-2mc.json');

  it('matches saved golden summary for novato_constante (2 mesociclos)', async () => {
    const summary = await summarizeTrajectory(persona, 2)();
    expect(existsSync(goldenPath)).toBe(true);

    const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
    expect(summary.personaId).toBe(golden.personaId);
    expect(summary.sessionCount).toBe(golden.sessionCount);
    expect(summary.mesocycles).toEqual(golden.mesocycles);
    expect(summary.sessionFocusSequence).toEqual(golden.sessionFocusSequence);
    expect(summary.exerciseCountPerSession).toEqual(golden.exerciseCountPerSession);
  }, 60_000);
});
