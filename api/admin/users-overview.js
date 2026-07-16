import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { assertAdminUid } from '../../domain/admin/constants.js';
import { buildAdminUsersOverview } from '../../domain/admin/usersOverview.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

async function enrichEmails(userRows) {
  const missing = userRows.filter((u) => !u.email);
  if (missing.length === 0) return userRows;

  const enriched = [...userRows];
  await Promise.all(
    missing.map(async (row) => {
      try {
        const authUser = await auth.getUser(row.id);
        const idx = enriched.findIndex((u) => u.id === row.id);
        if (idx >= 0) {
          enriched[idx] = { ...enriched[idx], email: authUser.email ?? null };
        }
      } catch {
        // ignore missing auth user
      }
    }),
  );
  return enriched;
}

/**
 * GET /api/admin/users-overview
 * Admin-only snapshot of users for operations dashboard.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const requesterUid = await authenticate(req);
    assertAdminUid(requesterUid);

    const rawUsers = await users.listAllUsers(300);
    const withEmails = await enrichEmails(rawUsers);
    const overview = buildAdminUsersOverview(withEmails);

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      ...overview,
    });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) {
      console.error('admin/users-overview error:', err);
    }
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
