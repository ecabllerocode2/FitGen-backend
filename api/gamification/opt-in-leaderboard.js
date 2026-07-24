import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { normalizeGamification } from '../../domain/gamification/defaults.js';
import { upsertLeaderboardEntry } from '../../domain/gamification/leaderboard.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/gamification/opt-in-leaderboard
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const timezone = user.profileData?.timezone ?? 'America/Mexico_City';
    const showInLeaderboard = req.body?.showInLeaderboard === true;
    const publicDisplayName =
      typeof req.body?.publicDisplayName === 'string'
        ? req.body.publicDisplayName.trim().slice(0, 40)
        : user.gamification?.publicDisplayName ?? user.profileData?.name ?? 'Atleta FitGen';

    const gamification = normalizeGamification(user.gamification, new Date(), timezone);
    gamification.showInLeaderboard = showInLeaderboard;
    gamification.publicDisplayName = publicDisplayName;
    gamification.updatedAt = new Date().toISOString();

    await users.saveUser(userId, { gamification });

    if (showInLeaderboard) {
      await upsertLeaderboardEntry(db, {
        userId,
        gamification,
        profileData: user.profileData ?? {},
        timezone,
      });
    }

    return res.status(200).json({
      success: true,
      showInLeaderboard,
      publicDisplayName,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('gamification/opt-in-leaderboard error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
