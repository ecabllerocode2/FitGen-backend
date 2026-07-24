import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { generateMesocycleForAthlete, coaches } from '../../domain/coach/coachService.js';
import { assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';

/**
 * POST /api/coach/clients/:athleteId/mesocycle/generate
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const athleteId = req.params?.athleteId ?? req.body?.athleteId;
    if (!athleteId) {
      return res.status(400).json({ error: 'athleteId requerido' });
    }

    await assertClientOwnership(coach.id, athleteId);

    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    const mesocycle = await generateMesocycleForAthlete(athleteId, referenceDate);

    await coaches.saveClientRelation(coach.id, athleteId, { status: 'active' });
    await coaches.logCoachAction({
      coachId: coach.id,
      athleteId,
      action: 'mesocycle_generated',
    });

    return res.status(200).json({ success: true, mesocycle });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/mesocycle/generate error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
