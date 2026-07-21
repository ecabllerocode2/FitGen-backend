import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

function mapSessionRow(session) {
  const completedAt = session.completedAt ?? session.archivedAt ?? null;
  return {
    id: session.id,
    sessionFocus: session.sessionFocus ?? session.sessionName ?? 'Entrenamiento',
    completedAt,
    weekNumber: session.weekNumber ?? null,
    dayOfWeek: session.dayOfWeek ?? null,
    summary: {
      durationLabel:
        session.celebrationSummary?.durationLabel
        ?? session.summary?.durationLabel
        ?? session.summary?.duracionEstimada
        ?? '—',
      exerciseCount: session.summary?.ejerciciosTotales ?? session.summary?.exerciseCount ?? 0,
      totalSets: session.summary?.seriesTotales ?? session.summary?.totalSets ?? 0,
      muscles: session.summary?.musculosTrabajos ?? session.sessionMuscles ?? [],
    },
    celebrationCardUrl: session.celebrationCardUrl ?? null,
    celebrationCardExpiresAt: session.celebrationCardExpiresAt ?? null,
    celebrationSummary: session.celebrationSummary ?? null,
  };
}

/**
 * GET /api/session/history?limit=40
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const userId = await authenticate(req);
    const limit = Math.min(Number(req.query?.limit) || 40, 60);
    const sessions = await users.getRecentSessions(userId, limit);
    const completed = sessions
      .filter((s) => s.completed !== false)
      .map(mapSessionRow);

    return res.status(200).json({
      success: true,
      totalCompleted: completed.length,
      sessions: completed,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/history error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
