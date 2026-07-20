import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { normalizeGamification } from '../../domain/gamification/defaults.js';
import { redeemPremiumMonth, PREMIUM_REDEMPTION_COST } from '../../domain/gamification/shop.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/shop/redeem-premium
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
    const base = normalizeGamification(user.gamification, new Date(), timezone);
    const { gamification, fitCoinsSpent, premiumExpiresAt } = redeemPremiumMonth(base);

    const profileData = {
      ...(user.profileData ?? {}),
      premiumUntil: premiumExpiresAt,
      premiumSource: 'fitcoin_redemption',
    };

    await users.saveUser(userId, { gamification, profileData });

    return res.status(200).json({
      success: true,
      fitCoinsSpent,
      fitCoinsBalance: gamification.fitCoinsBalance,
      premiumExpiresAt,
      cost: PREMIUM_REDEMPTION_COST,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('shop/redeem-premium error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
