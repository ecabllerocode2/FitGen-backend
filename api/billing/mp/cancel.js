import { db, auth } from '../../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../../infrastructure/firebase/userRepository.js';
import { isBillingExempt } from '../../../domain/billing/athleteAccess.js';
import {
  cancelPreapproval,
  fetchPreapproval,
  isMercadoPagoConfigured,
  searchPreapprovalsByExternalReference,
} from '../../../domain/billing/mercadoPagoClient.js';
import { SUBSCRIPTION_STATUS } from '../../../domain/billing/constants.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  return auth.verifyIdToken(match[1]);
}

/**
 * POST /api/billing/mp/cancel
 * Cancels the athlete's Mercado Pago subscription and revokes paid access.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    if (!isMercadoPagoConfigured()) {
      return res.status(503).json({
        error: 'Mercado Pago aún no está configurado.',
        code: 'mp_not_configured',
      });
    }

    const decoded = await authenticate(req);
    const userId = decoded.uid;
    const user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (user.lifetimeAccess === true) {
      return res.status(400).json({
        error: 'Tu acceso gratuito permanente no tiene una suscripción cancelable.',
        code: 'lifetime_access',
      });
    }

    if (isBillingExempt(user) && user.athleteOrigin === 'coached') {
      return res.status(400).json({
        error: 'Las cuentas invitadas por coach no gestionan suscripción aquí.',
        code: 'billing_exempt',
      });
    }

    let preapprovalId = user.mpPreapprovalId || null;
    let preapproval = null;

    if (preapprovalId) {
      try {
        preapproval = await fetchPreapproval(preapprovalId);
      } catch {
        preapproval = null;
      }
    }

    const status = String(preapproval?.status || '').toLowerCase();
    if (!preapproval || (status !== 'authorized' && status !== 'paused' && status !== 'pending')) {
      try {
        const authorized = await searchPreapprovalsByExternalReference(userId);
        if (authorized[0]?.id) {
          preapprovalId = authorized[0].id;
          preapproval = authorized[0];
        }
      } catch (searchErr) {
        console.warn('cancel search warning:', searchErr.message);
      }
    }

    if (!preapprovalId) {
      return res.status(400).json({
        error: 'No encontramos una suscripción activa de Mercado Pago para cancelar.',
        code: 'no_subscription',
      });
    }

    const currentStatus = String(preapproval?.status || '').toLowerCase();
    let mpResult = preapproval;
    if (currentStatus !== 'cancelled' && currentStatus !== 'canceled') {
      mpResult = await cancelPreapproval(preapprovalId);
    }

    const now = new Date().toISOString();
    const mpStatus = mpResult?.status || 'canceled';
    await users.saveUser(userId, {
      subscriptionStatus: SUBSCRIPTION_STATUS.CANCELED,
      mpPreapprovalId: preapprovalId,
      mpStatus,
      subscriptionCanceledAt: now,
      billingUpdatedAt: now,
    });

    try {
      const existing = await auth.getUser(userId);
      const claims = { ...(existing.customClaims || {}) };
      claims.access = false;
      claims.subscriptionStatus = SUBSCRIPTION_STATUS.CANCELED;
      await auth.setCustomUserClaims(userId, claims);
    } catch (claimsErr) {
      console.error('cancel claims warning:', claimsErr);
    }

    return res.status(200).json({
      success: true,
      subscriptionStatus: SUBSCRIPTION_STATUS.CANCELED,
      mpPreapprovalId: preapprovalId,
      mpStatus,
      message: 'Suscripción cancelada. Ya no se harán cobros automáticos.',
    });
  } catch (err) {
    console.error('billing/mp cancel error:', err);
    return res.status(err.status ?? 500).json({
      error: err.message ?? 'Error al cancelar la suscripción',
      code: err.code,
      detail: err.detail,
    });
  }
}
