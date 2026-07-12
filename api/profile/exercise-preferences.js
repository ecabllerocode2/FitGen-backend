import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import {
  getUserExercisePreferences,
  restoreExerciseExclusion,
} from '../../domain/athlete/exercisePreferences.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/profile/exercise-preferences
 * Body: { action: 'restore', exerciseId?: string, equipment?: string }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    const { action, exerciseId, equipment } = req.body ?? {};

    if (action !== 'restore') {
      return res.status(400).json({ error: 'action no soportada' });
    }
    if (!exerciseId && !equipment) {
      return res.status(400).json({ error: 'exerciseId o equipment requerido' });
    }

    const current = getUserExercisePreferences(user);
    const exercisePreferences = restoreExerciseExclusion(current, { exerciseId, equipment });
    await users.saveUser(userId, { exercisePreferences });

    return res.status(200).json({ success: true, exercisePreferences });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('profile/exercise-preferences error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
