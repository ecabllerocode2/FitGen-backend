import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { users } from '../../domain/coach/coachService.js';
import { summarizeSessionHistoryEntry } from '../../domain/coach/clientDashboard.js';

/**
 * GET /api/coach/clients/:athleteId/sessions/:sessionId
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const athleteId = req.params?.athleteId;
    const sessionId = req.params?.sessionId;
    if (!athleteId || !sessionId) {
      return res.status(400).json({ error: 'athleteId y sessionId requeridos' });
    }

    await assertClientOwnership(coach.id, athleteId);
    const session = await users.getRecentSession(athleteId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    return res.status(200).json({
      success: true,
      session: summarizeSessionHistoryEntry(session),
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/client-session-detail error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
