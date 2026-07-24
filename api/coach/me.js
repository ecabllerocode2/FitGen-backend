import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coaches, users } from '../../domain/coach/coachService.js';
import { CLIENT_STATUSES } from '../../domain/coach/constants.js';
import { buildClientInsights } from '../../domain/coach/insights.js';

/**
 * GET /api/coach/me
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const clients = await coaches.listClients(coach.id);
    const activeClients = clients.filter((c) =>
      [CLIENT_STATUSES.ACTIVE, CLIENT_STATUSES.ONBOARDING_COACH, CLIENT_STATUSES.ONBOARDING_CLIENT].includes(
        c.status,
      ),
    );

    const alerts = [];
    for (const rel of activeClients.slice(0, 20)) {
      const athlete = await users.getUser(rel.athleteId);
      if (!athlete) continue;
      const sessions = await users.getRecentSessions(rel.athleteId, 15);
      const { insights } = buildClientInsights({ athleteUser: athlete, recentSessions: sessions });
      for (const insight of insights.filter((i) => i.severity === 'high').slice(0, 2)) {
        alerts.push({
          athleteId: rel.athleteId,
          athleteName: athlete.profileData?.name ?? 'Cliente',
          ...insight,
        });
      }
    }

    return res.status(200).json({
      success: true,
      coach,
      summary: {
        activeClientCount: activeClients.length,
        seatsConsumedLifetime: coach.seatsConsumedLifetime ?? 0,
        seatLimit: coach.seatLimit,
        plan: coach.plan,
        alerts: alerts.slice(0, 10),
      },
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/me error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
