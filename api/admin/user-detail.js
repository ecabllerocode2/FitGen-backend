import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { assertAdminUid } from '../../domain/admin/constants.js';
import { buildAdminUserDetail } from '../../domain/admin/userDetail.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * GET /api/admin/user-detail?uid=
 * Admin-only deep dive: sessions, prescribed vs actual loads, charts series.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const requesterUid = await authenticate(req);
    assertAdminUid(requesterUid);

    const targetUid = typeof req.query?.uid === 'string' ? req.query.uid.trim() : '';
    if (!targetUid) {
      return res.status(400).json({ error: 'Parámetro uid requerido' });
    }

    const user = await users.getUser(targetUid);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!user.email) {
      try {
        const authUser = await auth.getUser(targetUid);
        user.email = authUser.email ?? null;
      } catch {
        // ignore missing auth user
      }
    }

    const recentSessions = await users.getRecentSessions(targetUid, 36);
    const detail = buildAdminUserDetail(user, recentSessions);

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      ...detail,
    });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) {
      console.error('admin/user-detail error:', err);
    }
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
