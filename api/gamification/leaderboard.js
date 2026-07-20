import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { fetchCurrentLeaderboard } from '../../domain/gamification/leaderboard.js';
import { getCurrentSeasonId } from '../../domain/gamification/defaults.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * GET /api/gamification/leaderboard
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const timezone = user.profileData?.timezone ?? 'America/Mexico_City';
    const seasonId =
      req.query?.seasonId ??
      user.gamification?.currentSeasonId ??
      getCurrentSeasonId(new Date(), timezone);

    const board = await fetchCurrentLeaderboard(db, {
      seasonId,
      userId,
      limit: 50,
    });

    return res.status(200).json({
      success: true,
      ...board,
      myRank: board.myEntry?.rank ?? null,
      mySeasonPoints: user.gamification?.seasonPoints ?? 0,
      showInLeaderboard: user.gamification?.showInLeaderboard === true,
      publicDisplayName: user.gamification?.publicDisplayName ?? null,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('gamification/leaderboard error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
