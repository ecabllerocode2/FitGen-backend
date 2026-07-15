import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { getTodaySessionPlan } from '../../lib/mesocycleUtils.js';
import { isStaleIncompleteSession } from '../../domain/session/sessionFreshness.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/session/discard-stale
 * Clears currentSession when it is incomplete and not for today, or wrongly marked completed.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    const session = user?.currentSession;

    if (!session) {
      return res.status(200).json({ success: true, cleared: false, reason: 'no_current_session' });
    }

    if (session.completed === true) {
      await users.saveSession(userId, null);
      return res.status(200).json({
        success: true,
        cleared: true,
        reason: 'completed_session_should_be_archived',
      });
    }

    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    const { weekNumber, dayOfWeek } = getTodaySessionPlan(
      user.currentMesocycle,
      referenceDate,
      user.profileData?.timezone,
    );

    if (!isStaleIncompleteSession(session, referenceDate, dayOfWeek, weekNumber)) {
      return res.status(200).json({ success: true, cleared: false, reason: 'still_valid' });
    }

    await users.saveSession(userId, null);
    return res.status(200).json({
      success: true,
      cleared: true,
      reason: 'stale_incomplete_session',
      previousSessionFocus: session.sessionFocus ?? null,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/discard-stale error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
