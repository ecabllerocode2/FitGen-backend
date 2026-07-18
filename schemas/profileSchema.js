import { z } from 'zod';

export const GOAL_ENUM = z.enum(['Hipertrofia', 'Fuerza']);
export const BODY_COMPOSITION_GOAL_ENUM = z.enum(['Mantener', 'Perder_Grasa', 'Ganar_Musculo']);
export const MUSCLE_EMPHASIS_INTENSITY_ENUM = z.enum(['light', 'moderate', 'strong']);
export const GENDER_ENUM = z.enum(['M', 'F']);
export const EXTERNAL_LOAD_ENUM = z.enum(['ninguna', 'ligera', 'moderada', 'alta']);
export const INJURY_ENUM = z.enum(['Hombro', 'Rodilla', 'Espalda_Baja', 'Muñeca']);

export const weeklyScheduleEntrySchema = z.object({
  day: z.enum(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']),
  canTrain: z.boolean(),
  externalLoad: EXTERNAL_LOAD_ENUM.optional().default('ninguna'),
});

export const profileSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(13).max(100),
  gender: GENDER_ENUM,
  heightCm: z.number().positive(),
  currentWeightKg: z.number().positive(),
  trainingAgeMonths: z.number().int().min(0),
  fitnessGoal: GOAL_ENUM,
  trainingDaysPerWeek: z.number().int().min(2).max(6),
  weeklyScheduleContext: z.array(weeklyScheduleEntrySchema).min(1),
  injuriesOrLimitations: z.array(INJURY_ENUM).optional().default([]),
  timezone: z.string().min(1),
  focusArea: z
    .enum(['General', 'Tren_Superior', 'Tren_Inferior', 'Core'])
    .optional()
    .default('General'),
  bodyCompositionGoal: BODY_COMPOSITION_GOAL_ENUM.optional().default('Mantener'),
  musclePriorities: z
    .array(
      z.object({
        muscle: z.string().min(1),
        intensity: MUSCLE_EMPHASIS_INTENSITY_ENUM.optional().default('moderate'),
      }),
    )
    .max(2)
    .optional()
    .default([]),
});

export const readinessSchema = z.object({
  energyLevel: z.number().int().min(1).max(5),
  sorenessLevel: z.number().int().min(1).max(5),
  sorenessZone: z.string().optional(),
  sleepQuality: z.number().int().min(1).max(5).optional(),
  stressLevel: z.number().int().min(1).max(5).optional(),
  externalLoad: EXTERNAL_LOAD_ENUM.optional(),
});

export const weeklyFeedbackSchema = z.object({
  pumpQuality: z.number().int().min(1).max(5).optional(),
  sorenessTiming: z
    .enum(['no llegó a doler', 'sanó a tiempo', 'aún dolía al entrenar de nuevo'])
    .optional(),
  jointPain: z.boolean().optional(),
  perceivedWorkload: z.number().int().min(1).max(5).optional(),
});

export const mesocycleEvaluationSchema = z.object({
  generalDifficulty: z.number().int().min(1).max(5),
  persistentJointPain: z.boolean().optional().default(false),
  changeGoal: z.boolean().optional().default(false),
  newGoal: GOAL_ENUM.optional(),
  painZones: z.array(z.string()).optional().default([]),
});

export function validateProfile(data) {
  return profileSchema.parse(data);
}

export function validateReadiness(data) {
  return readinessSchema.parse(data);
}
