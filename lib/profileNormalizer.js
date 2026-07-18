import { calculateExperienceLevel } from '../domain/athlete/experienceLevel.js';
import { buildSafetyProfile } from '../domain/athlete/safetyProfile.js';

const GENDER_MAP = {
  Masculino: 'M',
  Femenino: 'F',
  Otro: 'M',
  M: 'M',
  F: 'F',
};

const LOAD_MAP = {
  none: 'ninguna',
  light: 'ligera',
  low: 'ligera',
  moderate: 'moderada',
  medium: 'moderada',
  high: 'alta',
  extreme: 'alta',
  ninguna: 'ninguna',
  ligera: 'ligera',
  moderada: 'moderada',
  alta: 'alta',
};

const EXPERIENCE_TO_MONTHS = {
  Principiante: 3,
  Novato: 3,
  Intermedio: 18,
  Avanzado: 36,
};

const GOAL_MAP = {
  Hipertrofia: 'Hipertrofia',
  Fuerza: 'Fuerza',
  'Fuerza_Maxima': 'Fuerza',
  Fuerza_Maxima: 'Fuerza',
};

const BODY_COMPOSITION_MAP = {
  Mantener: 'Mantener',
  Perder_Grasa: 'Perder_Grasa',
  'Pérdida de Grasa': 'Perder_Grasa',
  Perder_Grasa: 'Perder_Grasa',
  Ganar_Musculo: 'Ganar_Musculo',
  'Ganancia Muscular': 'Ganar_Musculo',
};

/**
 * Normalizes frontend onboarding payload to DDS profileData shape.
 */
export function normalizeProfileInput(raw) {
  const trainingAgeMonths =
    raw.trainingAgeMonths ??
    EXPERIENCE_TO_MONTHS[raw.experienceLevel] ??
    12;

  const fitnessGoal = GOAL_MAP[raw.fitnessGoal] ?? 'Hipertrofia';

  const weeklyScheduleContext = (raw.weeklyScheduleContext ?? []).map((entry) => ({
    day: entry.day,
    canTrain: entry.canTrain !== false,
    externalLoad: LOAD_MAP[entry.externalLoad] ?? 'ninguna',
  }));

const INJURY_MAP = {
  'Espalda Baja': 'Espalda_Baja',
  Espalda_Baja: 'Espalda_Baja',
  Hombro: 'Hombro',
  Rodilla: 'Rodilla',
  Muñeca: 'Muñeca',
  Ninguna: null,
};

function normalizeInjuries(raw) {
  let injuries = raw ?? [];
  if (typeof injuries === 'string') {
    injuries = injuries === 'Ninguna' || injuries === '' ? [] : [injuries];
  }
  return injuries
    .map((item) => INJURY_MAP[item] ?? item)
    .filter((item) => item && item !== 'Ninguna');
}

  const profile = {
    name: raw.name,
    age: Number(raw.age),
    gender: GENDER_MAP[raw.gender] ?? 'M',
    heightCm: Number(raw.heightCm),
    currentWeightKg: Number(raw.currentWeightKg ?? raw.initialWeight),
    trainingAgeMonths: Number(trainingAgeMonths),
    fitnessGoal,
    trainingDaysPerWeek: Number(raw.trainingDaysPerWeek),
    weeklyScheduleContext,
    injuriesOrLimitations: normalizeInjuries(raw.injuriesOrLimitations),
    timezone: raw.timezone ?? 'America/Mexico_City',
    preferredTrainingDays: raw.preferredTrainingDays ?? [],
    focusArea: raw.focusArea ?? 'General',
    bodyCompositionGoal: BODY_COMPOSITION_MAP[raw.bodyCompositionGoal] ?? 'Mantener',
    musclePriorities: Array.isArray(raw.musclePriorities)
      ? raw.musclePriorities.slice(0, 2).map((item) => ({
          muscle: item.muscle,
          intensity: item.intensity ?? 'moderate',
        }))
      : [],
  };

  profile.experienceLevel = calculateExperienceLevel(profile.trainingAgeMonths);
  profile.safetyProfile = buildSafetyProfile(profile);

  return profile;
}
