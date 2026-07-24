import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coaches, users } from '../../domain/coach/coachService.js';
import {
  buildClientDashboard,
  RECENT_SESSIONS_MAX,
} from '../../domain/coach/clientDashboard.js';

/**
 * GET /api/coach/clients/:athleteId
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

    const { relation, athlete } = await assertClientOwnership(coach.id, athleteId);
    const recentSessions = await users.getRecentSessions(athleteId, RECENT_SESSIONS_MAX);
    const dashboard = buildClientDashboard({ athleteUser: athlete, recentSessions });
    const notes = relation.notes ?? [];

    return res.status(200).json({
      success: true,
      client: {
        athleteId,
        relation,
        profileData: athlete.profileData,
        profileCompleteness: athlete.profileCompleteness,
        currentMesocycle: athlete.currentMesocycle,
        currentSession: athlete.currentSession
          ? {
              sessionId: athlete.currentSession.sessionId ?? athlete.currentSession.id,
              sessionFocus: athlete.currentSession.sessionFocus,
              weekNumber: athlete.currentSession.weekNumber,
              dayOfWeek: athlete.currentSession.dayOfWeek,
              completed: athlete.currentSession.completed,
            }
          : null,
        notes,
        ...dashboard,
      },
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/client-detail error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
