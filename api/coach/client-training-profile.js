import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coachTrainingProfileSchema } from '../../schemas/coachSchema.js';
import { db } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { normalizeProfileInput } from '../../lib/profileNormalizer.js';
import {
  updateTrainingProfileForClient,
  generateMesocycleForAthlete,
  coaches,
} from '../../domain/coach/coachService.js';

const users = createUserRepository(db);

/**
 * PATCH /api/coach/clients/:athleteId/training-profile
 */
export default async function handler(req, res) {
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach, authUser } = await requireCoach(req);
    const athleteId = req.params?.athleteId ?? req.body?.athleteId;
    if (!athleteId) {
      return res.status(400).json({ error: 'athleteId requerido' });
    }

    const rawPatch = req.body?.profileData ?? req.body ?? {};
    const existingUser = await users.getUser(athleteId);
    if (!existingUser) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const normalized = normalizeProfileInput({
      ...(existingUser.profileData ?? {}),
      ...rawPatch,
    });
    const parsed = coachTrainingProfileSchema.parse({
      fitnessGoal: normalized.fitnessGoal,
      trainingAgeMonths: normalized.trainingAgeMonths,
      trainingDaysPerWeek: normalized.trainingDaysPerWeek,
      weeklyScheduleContext: normalized.weeklyScheduleContext,
      injuriesOrLimitations: normalized.injuriesOrLimitations,
      focusArea: normalized.focusArea,
      bodyCompositionGoal: normalized.bodyCompositionGoal,
      musclePriorities: normalized.musclePriorities,
    });
    const result = await updateTrainingProfileForClient(coach.id, athleteId, parsed);

    await coaches.logCoachAction({
      coachId: coach.id,
      athleteId,
      action: 'training_profile_updated',
      metadata: { tier: result.profileChange?.tier },
    });

    let mesocycle = null;
    if (req.body?.generateMesocycle && result.profileCompleteness.readyForMesocycle) {
      mesocycle = await generateMesocycleForAthlete(athleteId);
      await coaches.saveClientRelation(coach.id, athleteId, {
        status: 'active',
      });
      await coaches.logCoachAction({
        coachId: coach.id,
        athleteId,
        action: 'mesocycle_generated',
      });
    }

    return res.status(200).json({
      success: true,
      ...result,
      profileChange: result.profileChange,
      message: result.profileChange?.message,
      mesocycle,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('coach/training-profile error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
