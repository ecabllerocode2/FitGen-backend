import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import {
  ensureDirectAthleteBilling,
  evaluateAthleteBillingAccess,
} from '../../domain/billing/athleteAccess.js';
import {
  ATHLETE_SUBSCRIPTION_AMOUNT_MXN,
  ATHLETE_TRIAL_DAYS,
} from '../../domain/billing/constants.js';
import { isMercadoPagoConfigured } from '../../domain/billing/mercadoPagoClient.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  return auth.verifyIdToken(match[1]);
}

/**
 * GET /api/billing/status
 * Returns trial/subscription access for the authenticated athlete.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido. Solo GET.' });
  }

  try {
    const decoded = await authenticate(req);
    const userId = decoded.uid;
    let user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    user = await ensureDirectAthleteBilling({ users, auth, userId, user });
    const access = evaluateAthleteBillingAccess(user);

    return res.status(200).json({
      allowed: access.allowed,
      reason: access.reason,
      subscriptionStatus: user.subscriptionStatus ?? access.subscriptionStatus,
      trialStartedAt: user.trialStartedAt ?? null,
      trialEndsAt: user.trialEndsAt ?? null,
      amountMxn: user.subscriptionAmountMxn ?? ATHLETE_SUBSCRIPTION_AMOUNT_MXN,
      trialDays: ATHLETE_TRIAL_DAYS,
      mpConfigured: isMercadoPagoConfigured(),
      mpPreapprovalId: user.mpPreapprovalId ?? null,
    });
  } catch (err) {
    console.error('billing/status error:', err);
    return res.status(err.status ?? 500).json({ error: err.message ?? 'Error interno' });
  }
}
