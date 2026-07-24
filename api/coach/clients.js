import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coaches, users } from '../../domain/coach/coachService.js';

/**
 * GET /api/coach/clients
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const relations = await coaches.listClients(coach.id);

    const clients = await Promise.all(
      relations.map(async (rel) => {
        const athlete = await users.getUser(rel.athleteId);
        const sessions = await users.getRecentSessions(rel.athleteId, 10);
        const lastSession = sessions.find((s) => s.completed && s.completedAt);
        return {
          athleteId: rel.athleteId,
          status: rel.status,
          name: athlete?.profileData?.name ?? 'Sin nombre',
          fitnessGoal: athlete?.profileData?.fitnessGoal ?? null,
          profileCompleteness: athlete?.profileCompleteness ?? null,
          hasMesocycle: Boolean(athlete?.currentMesocycle),
          lastSessionAt: lastSession?.completedAt ?? null,
          activatedAt: rel.activatedAt,
        };
      }),
    );

    return res.status(200).json({ success: true, clients });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/clients error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
