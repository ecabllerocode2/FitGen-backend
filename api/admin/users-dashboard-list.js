import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { assertAdminUid } from '../../domain/admin/constants.js';
import { buildClientListFlags } from '../../domain/coach/clientDashboard.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

function mapUserListStatus(athlete) {
  if (athlete?.accountType === 'coach') return 'coach';
  if (athlete?.status === 'pending_onboarding') return 'onboarding_client';
  if (athlete?.status === 'pending_approval') return 'invited';
  if (athlete?.status === 'approved') return 'active';
  return athlete?.status ?? 'active';
}

/**
 * GET /api/admin/users-dashboard-list
 * Coach-style client cards for every PWA user (admin only).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const requesterUid = await authenticate(req);
    assertAdminUid(requesterUid);

    const rawUsers = await users.listAllUsers(300);

    const clients = await Promise.all(
      rawUsers.map(async (athlete) => {
        const athleteId = athlete.id;
        const sessions = await users.getRecentSessions(athleteId, 10);
        const lastSession = sessions.find((s) => s.completed && s.completedAt);
        const flags = buildClientListFlags(athlete);

        return {
          athleteId,
          status: mapUserListStatus(athlete),
          name: athlete?.profileData?.name ?? athlete?.email ?? 'Sin nombre',
          email: athlete?.email ?? null,
          accountType: athlete?.accountType ?? 'athlete',
          fitnessGoal: athlete?.profileData?.fitnessGoal ?? null,
          profileCompleteness: athlete?.profileCompleteness ?? null,
          hasMesocycle: Boolean(athlete?.currentMesocycle),
          lastSessionAt: lastSession?.completedAt ?? null,
          activatedAt: athlete?.createdAt ?? athlete?.lastProfileUpdate ?? null,
          ...flags,
        };
      }),
    );

    clients.sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      clients,
    });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) {
      console.error('admin/users-dashboard-list error:', err);
    }
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
