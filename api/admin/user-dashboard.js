import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { assertAdminUid } from '../../domain/admin/constants.js';
import {
  buildClientDashboard,
  RECENT_SESSIONS_MAX,
} from '../../domain/coach/clientDashboard.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * GET /api/admin/user-dashboard?uid=
 * Same dashboard payload as GET /api/coach/clients/:athleteId (read-only supervision).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const requesterUid = await authenticate(req);
    assertAdminUid(requesterUid);

    const athleteId = req.query?.uid;
    if (!athleteId || typeof athleteId !== 'string') {
      return res.status(400).json({ error: 'uid requerido' });
    }

    const athlete = await users.getUser(athleteId);
    if (!athlete) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const recentSessions = await users.getRecentSessions(athleteId, RECENT_SESSIONS_MAX);
    const dashboard = buildClientDashboard({ athleteUser: athlete, recentSessions });

    return res.status(200).json({
      success: true,
      client: {
        athleteId,
        relation: {
          status: athlete.status ?? 'active',
          notes: [],
        },
        profileData: athlete.profileData ?? {},
        profileCompleteness: athlete.profileCompleteness ?? null,
        currentMesocycle: athlete.currentMesocycle ?? null,
        currentSession: athlete.currentSession
          ? {
              sessionId: athlete.currentSession.sessionId ?? athlete.currentSession.id,
              sessionFocus: athlete.currentSession.sessionFocus,
              weekNumber: athlete.currentSession.weekNumber,
              dayOfWeek: athlete.currentSession.dayOfWeek,
              completed: athlete.currentSession.completed,
            }
          : null,
        notes: [],
        email: athlete.email ?? null,
        accountType: athlete.accountType ?? 'athlete',
        ...dashboard,
      },
    });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) {
      console.error('admin/user-dashboard error:', err);
    }
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
