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

/**
 * GET /api/session/celebrations
 * Returns celebration cards from the last 7 days.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const userId = await authenticate(req);
    const celebrations = await users.getRecentCelebrations(userId);
    return res.status(200).json({ success: true, celebrations });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/celebrations error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
