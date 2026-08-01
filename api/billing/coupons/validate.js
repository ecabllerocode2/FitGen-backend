import { db, auth } from '../../../lib/firebaseAdmin.js';
import { validateCoupon } from '../../../domain/billing/coupons.js';

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  return auth.verifyIdToken(match[1]);
}

/**
 * POST /api/billing/coupons/validate
 * Preview coupon without consuming a redemption slot.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    await authenticate(req);
    const rawCode =
      typeof req.body?.couponCode === 'string'
        ? req.body.couponCode
        : typeof req.body?.code === 'string'
          ? req.body.code
          : '';

    const result = await validateCoupon(db, rawCode);
    return res.status(200).json(result);
  } catch (err) {
    console.error('billing/coupons/validate error:', err);
    return res.status(err.status ?? 500).json({
      valid: false,
      error: err.message ?? 'Error al validar cupón',
      code: err.code,
    });
  }
}
