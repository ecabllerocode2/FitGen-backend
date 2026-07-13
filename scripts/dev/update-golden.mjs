import { writeFileSync } from 'fs';
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { getTodaySessionPlan } from '../../lib/mesocycleUtils.js';
import { loadCatalogFromDisk } from '../../infrastructure/catalog/catalogRepository.js';
import { addDays } from '../../lib/dateUtils.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { PERSONAS } from '../../tests/simulation/personas/index.js';

const persona = PERSONAS.find((p) => p.id === 'novato_constante');
const catalog = await loadCatalogFromDisk();
const BASE = {
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
    { day: 'Lunes', canTrain: true },
    { day: 'Martes', canTrain: false },
    { day: 'Miércoles', canTrain: true },
    { day: 'Jueves', canTrain: false },
    { day: 'Viernes', canTrain: true },
    { day: 'Sábado', canTrain: true },
    { day: 'Domingo', canTrain: false },
  ],
};

let profile = { ...BASE, ...persona.profile };
let referenceDate = new Date('2026-01-06T12:00:00Z');
const sessions = [];
const mesocycleMeta = [];

for (let mc = 0; mc < 2; mc += 1) {
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

const golden = {
  personaId: persona.id,
  mesocycleCount: 2,
  sessionCount: sessions.length,
  mesocycles: mesocycleMeta,
  sessionFocusSequence: sessions.map((s) => s.sessionFocus),
  exerciseCountPerSession: sessions.map((s) => (s.mainBlock ?? []).length),
};

writeFileSync(
  new URL('../../tests/simulation/golden/novato_constante-2mc.json', import.meta.url),
  JSON.stringify(golden, null, 2) + '\n',
);
console.log('Golden updated:', golden.exerciseCountPerSession.join(', '));
