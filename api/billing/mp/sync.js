import { db, auth } from '../../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../../infrastructure/firebase/userRepository.js';
import {
  ensureDirectAthleteBilling,
  evaluateAthleteBillingAccess,
  isBillingExempt,
} from '../../../domain/billing/athleteAccess.js';
import {
  fetchPreapproval,
  searchPreapprovalsByExternalReference,
} from '../../../domain/billing/mercadoPagoClient.js';
import { applyPreapprovalSync } from '../../../domain/billing/webhookSync.js';
import { SUBSCRIPTION_STATUS } from '../../../domain/billing/constants.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  return auth.verifyIdToken(match[1]);
}

/**
 * POST /api/billing/mp/sync
 * Called when the user returns from Mercado Pago checkout (back_url).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const decoded = await authenticate(req);
    const userId = decoded.uid;
    let user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (isBillingExempt(user)) {
      return res.status(200).json({
        success: true,
        allowed: true,
        reason: 'exempt',
        subscriptionStatus: user.subscriptionStatus ?? null,
      });
    }

    user = await ensureDirectAthleteBilling({ users, auth, userId, user });

    let preapproval = null;
    const preferredId =
      (typeof req.body?.preapprovalId === 'string' && req.body.preapprovalId) ||
      user.mpPreapprovalId;

    if (preferredId) {
      preapproval = await fetchPreapproval(preferredId);
    }

    // If stored/latest checkout was cancelled, find an authorized sub for this user.
    if (!preapproval || String(preapproval.status).toLowerCase() !== 'authorized') {
      try {
        const authorized = await searchPreapprovalsByExternalReference(userId);
        if (authorized.length > 0) {
          preapproval = authorized[0];
        }
      } catch (searchErr) {
        console.warn('billing sync search warning:', searchErr.message);
      }
    }

    if (!preapproval) {
      const access = evaluateAthleteBillingAccess(user);
      return res.status(200).json({
        success: true,
        synced: false,
        reason: 'no_preapproval',
        allowed: access.allowed,
        subscriptionStatus: user.subscriptionStatus ?? null,
      });
    }

    const result = await applyPreapprovalSync({
      users,
      auth,
      user,
      userId,
      preapproval,
    });

    const refreshed = await users.getUser(userId);
    const access = evaluateAthleteBillingAccess(refreshed);

    return res.status(200).json({
      success: true,
      synced: !result.skipped,
      reason: result.reason,
      allowed: access.allowed,
      subscriptionStatus: refreshed?.subscriptionStatus ?? result.subscriptionStatus,
      mpStatus: refreshed?.mpStatus ?? preapproval.status,
      mpPreapprovalId: refreshed?.mpPreapprovalId ?? preapproval.id,
      alreadyActive: refreshed?.subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE,
    });
  } catch (err) {
    console.error('billing/mp sync error:', err);
    return res.status(err.status ?? 500).json({
      error: err.message ?? 'Error interno',
      code: err.code,
      detail: err.detail,
    });
  }
}
