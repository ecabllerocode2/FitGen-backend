import { z } from 'zod';
import { profileSchema } from './profileSchema.js';

export const coachRegisterSchema = z.object({
  displayName: z.string().min(2).max(80),
  publicName: z.string().min(2).max(80).optional(),
  bio: z.string().max(500).optional().default(''),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export const coachPersonalProfileSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(13).max(100),
  gender: z.enum(['M', 'F', 'Masculino', 'Femenino', 'Otro']),
  heightCm: z.number().positive(),
  currentWeightKg: z.number().positive().optional(),
  initialWeight: z.number().positive().optional(),
  injuriesOrLimitations: z.array(z.string()).optional().default([]),
  timezone: z.string().min(1).optional(),
  avatarStartingBuild: z.enum(['soft', 'slender', 'ectomorph']).optional(),
});

export const coachTrainingProfileSchema = profileSchema
  .pick({
    fitnessGoal: true,
    trainingAgeMonths: true,
    trainingDaysPerWeek: true,
    weeklyScheduleContext: true,
    injuriesOrLimitations: true,
    focusArea: true,
    bodyCompositionGoal: true,
    musclePriorities: true,
  })
  .partial({ injuriesOrLimitations: true, focusArea: true, bodyCompositionGoal: true, musclePriorities: true });

export const coachNoteSchema = z.object({
  text: z.string().min(1).max(2000),
});

export const coachSetPlanSchema = z.object({
  coachId: z.string().min(1),
  plan: z.enum(['free', 'premium']),
});
