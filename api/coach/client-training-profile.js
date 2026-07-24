import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coachTrainingProfileSchema } from '../../schemas/coachSchema.js';
import {
  updateTrainingProfileForClient,
  generateMesocycleForAthlete,
  coaches,
} from '../../domain/coach/coachService.js';

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

    const parsed = coachTrainingProfileSchema.parse(req.body?.profileData ?? req.body ?? {});
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
      mesocycle,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('coach/training-profile error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
