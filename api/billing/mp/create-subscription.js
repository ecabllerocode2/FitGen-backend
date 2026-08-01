import { db, auth } from '../../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../../infrastructure/firebase/userRepository.js';
import {
  ensureDirectAthleteBilling,
  evaluateAthleteBillingAccess,
  isBillingExempt,
} from '../../../domain/billing/athleteAccess.js';
import {
  createAthletePreapproval,
  isMercadoPagoConfigured,
} from '../../../domain/billing/mercadoPagoClient.js';
import {
  ATHLETE_SUBSCRIPTION_AMOUNT_MXN,
  SUBSCRIPTION_STATUS,
} from '../../../domain/billing/constants.js';
import {
  attachPreapprovalToCoupon,
  claimCouponSlot,
  normalizeCouponCode,
  releaseCouponSlot,
} from '../../../domain/billing/coupons.js';

const users = createUserRepository(db);

function resolveSubscriptionAmountMxn() {
  const fromEnv = Number(process.env.MP_SUBSCRIPTION_AMOUNT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return ATHLETE_SUBSCRIPTION_AMOUNT_MXN;
}

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  return auth.verifyIdToken(match[1]);
}

/**
 * POST /api/billing/mp/create-subscription
 * Creates a pending Mercado Pago preapproval and returns checkout init_point.
 * Optional couponCode applies a discounted amount (claimed atomically).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  let claimedCouponCode = null;

  try {
    if (!isMercadoPagoConfigured()) {
      return res.status(503).json({
        error: 'Mercado Pago aún no está configurado en el servidor.',
        code: 'mp_not_configured',
      });
    }

    const decoded = await authenticate(req);
    const userId = decoded.uid;
    let user = await users.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (isBillingExempt(user)) {
      return res.status(400).json({
        error: 'Esta cuenta no requiere suscripción de atleta independiente.',
        code: 'billing_exempt',
      });
    }

    user = await ensureDirectAthleteBilling({ users, auth, userId, user });
    const access = evaluateAthleteBillingAccess(user);
    if (access.allowed && access.reason === 'active') {
      return res.status(200).json({
        success: true,
        alreadyActive: true,
        subscriptionStatus: user.subscriptionStatus,
      });
    }

    const bodyEmail =
      typeof req.body?.payerEmail === 'string' ? req.body.payerEmail.trim().toLowerCase() : '';
    const payerEmail = bodyEmail || decoded.email || user.email || '';
    if (!payerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
      return res.status(400).json({
        error: 'Necesitas un email válido para Mercado Pago (el mismo con el que pagarás).',
        code: 'email_required',
      });
    }

    const rawCoupon =
      typeof req.body?.couponCode === 'string' ? req.body.couponCode : '';
    const couponCode = normalizeCouponCode(rawCoupon);

    let amountMxn = resolveSubscriptionAmountMxn();
    let couponClaim = null;

    if (couponCode) {
      couponClaim = await claimCouponSlot(db, couponCode, userId);
      claimedCouponCode = couponClaim.code;
      amountMxn = couponClaim.amountMxn;
    }

    let preapproval;
    try {
      preapproval = await createAthletePreapproval({
        userId,
        payerEmail,
        amountMxn,
      });
    } catch (mpErr) {
      if (claimedCouponCode && !couponClaim?.reused) {
        try {
          await releaseCouponSlot(db, claimedCouponCode, userId);
        } catch (releaseErr) {
          console.error('coupon release after MP failure:', releaseErr);
        }
      }
      throw mpErr;
    }

    if (!preapproval.initPoint) {
      if (claimedCouponCode && !couponClaim?.reused) {
        try {
          await releaseCouponSlot(db, claimedCouponCode, userId);
        } catch (releaseErr) {
          console.error('coupon release after missing init_point:', releaseErr);
        }
      }
      return res.status(502).json({
        error: 'Mercado Pago no devolvió URL de checkout.',
        code: 'mp_missing_init_point',
      });
    }

    if (claimedCouponCode) {
      try {
        await attachPreapprovalToCoupon(db, claimedCouponCode, userId, preapproval.id);
      } catch (attachErr) {
        console.warn('coupon attach preapproval warning:', attachErr.message);
      }
    }

    const userPatch = {
      subscriptionStatus: SUBSCRIPTION_STATUS.PENDING_CHECKOUT,
      mpPreapprovalId: preapproval.id,
      mpPayerEmail: payerEmail,
      mpStatus: preapproval.status,
      subscriptionAmountMxn: amountMxn,
      billingUpdatedAt: new Date().toISOString(),
    };

    if (claimedCouponCode) {
      userPatch.billingCouponCode = claimedCouponCode;
      userPatch.billingCouponAmountMxn = amountMxn;
    }

    await users.saveUser(userId, userPatch);

    return res.status(200).json({
      success: true,
      initPoint: preapproval.initPoint,
      sandboxInitPoint: preapproval.sandboxInitPoint,
      preapprovalId: preapproval.id,
      amountMxn,
      couponCode: claimedCouponCode || null,
    });
  } catch (err) {
    console.error('billing/create-subscription error:', err);
    return res.status(err.status ?? 500).json({
      error: err.message ?? 'Error interno',
      code: err.code,
      detail: err.detail,
    });
  }
}
