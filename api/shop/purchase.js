import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { normalizeGamification } from '../../domain/gamification/defaults.js';
import { listShopCatalog, purchaseShopItem } from '../../domain/gamification/shop.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * GET /api/shop/catalog — POST /api/shop/purchase
 */
export default async function handler(req, res) {
  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const timezone = user.profileData?.timezone ?? 'America/Mexico_City';
    const gamification = normalizeGamification(user.gamification, new Date(), timezone);

    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        fitCoinsBalance: gamification.fitCoinsBalance,
        items: listShopCatalog(gamification.inventory),
      });
    }

    if (req.method === 'POST') {
      const itemId = req.body?.itemId;
      if (!itemId || typeof itemId !== 'string') {
        return res.status(400).json({ error: 'itemId requerido' });
      }

      const { gamification: next, item, fitCoinsSpent } = purchaseShopItem(gamification, itemId);
      await users.saveUser(userId, { gamification: next });

      return res.status(200).json({
        success: true,
        item,
        fitCoinsSpent,
        fitCoinsBalance: next.fitCoinsBalance,
        inventory: next.inventory,
      });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('shop/purchase error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
