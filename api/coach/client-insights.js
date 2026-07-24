import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { users } from '../../domain/coach/coachService.js';
import { buildClientInsights } from '../../domain/coach/insights.js';

/**
 * GET /api/coach/clients/:athleteId/insights
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const athleteId = req.params?.athleteId ?? req.query?.athleteId;
    if (!athleteId) {
      return res.status(400).json({ error: 'athleteId requerido' });
    }

    const { athlete } = await assertClientOwnership(coach.id, athleteId);
    const recentSessions = await users.getRecentSessions(athleteId, 25);
    const result = buildClientInsights({ athleteUser: athlete, recentSessions });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/insights error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
