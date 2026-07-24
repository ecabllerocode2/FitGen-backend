import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { releaseClient, coaches } from '../../domain/coach/coachService.js';

/**
 * POST /api/coach/clients/:athleteId/release
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

    const result = await releaseClient(coach.id, athleteId, {
      reason: req.body?.reason ?? 'coach_release',
    });

    await coaches.logCoachAction({
      coachId: coach.id,
      athleteId,
      action: 'client_released',
    });

    return res.status(200).json(result);
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/release error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
