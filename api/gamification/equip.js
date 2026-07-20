import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { normalizeGamification } from '../../domain/gamification/defaults.js';
import { equipShopItem } from '../../domain/gamification/shop.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/gamification/equip
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

    const itemId = req.body?.itemId;
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId requerido' });
    }

    const timezone = user.profileData?.timezone ?? 'America/Mexico_City';
    const base = normalizeGamification(user.gamification, new Date(), timezone);
    const { gamification, item } = equipShopItem(base, itemId);

    await users.saveUser(userId, { gamification });

    return res.status(200).json({
      success: true,
      item,
      avatar: gamification.avatar,
      inventory: gamification.inventory,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('gamification/equip error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
