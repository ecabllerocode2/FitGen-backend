/** Billing coupon helpers (Firestore-backed early-bird discounts). */

export const BILLING_COUPONS_COLLECTION = 'billingCoupons';

export function normalizeCouponCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

function couponError(message, code, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Read-only validation for paywall preview (does not claim a slot).
 * @returns {{ valid: true, code: string, amountMxn: number, remaining: number, label?: string } | never}
 */
export async function validateCoupon(db, rawCode) {
  const code = normalizeCouponCode(rawCode);
  if (!code) {
    throw couponError('Código de cupón inválido.', 'coupon_invalid');
  }

  const ref = db.collection(BILLING_COUPONS_COLLECTION).doc(code);
  const snap = await ref.get();
  if (!snap.exists) {
    throw couponError('Ese código de cupón no existe.', 'coupon_invalid');
  }

  const data = snap.data() || {};
  if (data.active === false) {
    throw couponError('Ese cupón ya no está activo.', 'coupon_inactive');
  }

  const max = Number(data.maxRedemptions) || 0;
  const count = Number(data.redemptionCount) || 0;
  if (count >= max) {
    throw couponError('Este cupón ya alcanzó el límite de usos.', 'coupon_exhausted');
  }

  const amountMxn = Number(data.amountMxn);
  if (!Number.isFinite(amountMxn) || amountMxn <= 0) {
    throw couponError('Cupón mal configurado.', 'coupon_invalid', 500);
  }

  return {
    valid: true,
    code,
    amountMxn,
    remaining: Math.max(0, max - count),
    label: typeof data.label === 'string' ? data.label : undefined,
  };
}

/**
 * Atomically claim a coupon slot for userId (or reuse if already claimed).
 * @returns {{ code: string, amountMxn: number, reused: boolean, remaining: number }}
 */
export async function claimCouponSlot(db, rawCode, userId) {
  const code = normalizeCouponCode(rawCode);
  if (!code) {
    throw couponError('Código de cupón inválido.', 'coupon_invalid');
  }
  if (!userId) {
    throw couponError('Usuario requerido para canjear cupón.', 'coupon_invalid');
  }

  const ref = db.collection(BILLING_COUPONS_COLLECTION).doc(code);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw couponError('Ese código de cupón no existe.', 'coupon_invalid');
    }

    const data = snap.data() || {};
    if (data.active === false) {
      throw couponError('Ese cupón ya no está activo.', 'coupon_inactive');
    }

    const amountMxn = Number(data.amountMxn);
    if (!Number.isFinite(amountMxn) || amountMxn <= 0) {
      throw couponError('Cupón mal configurado.', 'coupon_invalid', 500);
    }

    const max = Number(data.maxRedemptions) || 0;
    let count = Number(data.redemptionCount) || 0;
    const redeemedBy = Array.isArray(data.redeemedBy) ? [...data.redeemedBy] : [];
    const existing = redeemedBy.find((r) => r && r.userId === userId);

    if (existing) {
      return {
        code,
        amountMxn,
        reused: true,
        remaining: Math.max(0, max - count),
      };
    }

    if (count >= max) {
      throw couponError('Este cupón ya alcanzó el límite de usos.', 'coupon_exhausted');
    }

    count += 1;
    redeemedBy.push({
      userId,
      redeemedAt: new Date().toISOString(),
    });

    tx.set(
      ref,
      {
        redemptionCount: count,
        redeemedBy,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return {
      code,
      amountMxn,
      reused: false,
      remaining: Math.max(0, max - count),
    };
  });
}

/**
 * Release a previously claimed slot for userId (compensation if MP create fails).
 * No-op if user was not in redeemedBy.
 */
export async function releaseCouponSlot(db, rawCode, userId) {
  const code = normalizeCouponCode(rawCode);
  if (!code || !userId) return { released: false };

  const ref = db.collection(BILLING_COUPONS_COLLECTION).doc(code);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { released: false };

    const data = snap.data() || {};
    const redeemedBy = Array.isArray(data.redeemedBy) ? [...data.redeemedBy] : [];
    const idx = redeemedBy.findIndex((r) => r && r.userId === userId);
    if (idx < 0) return { released: false };

    redeemedBy.splice(idx, 1);
    const count = Math.max(0, (Number(data.redemptionCount) || 0) - 1);

    tx.set(
      ref,
      {
        redemptionCount: count,
        redeemedBy,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return { released: true, remaining: Math.max(0, (Number(data.maxRedemptions) || 0) - count) };
  });
}

/**
 * Attach preapprovalId to an existing redemption entry (best-effort).
 */
export async function attachPreapprovalToCoupon(db, rawCode, userId, preapprovalId) {
  const code = normalizeCouponCode(rawCode);
  if (!code || !userId || !preapprovalId) return;

  const ref = db.collection(BILLING_COUPONS_COLLECTION).doc(code);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    const redeemedBy = Array.isArray(data.redeemedBy) ? [...data.redeemedBy] : [];
    const idx = redeemedBy.findIndex((r) => r && r.userId === userId);
    if (idx < 0) return;
    redeemedBy[idx] = { ...redeemedBy[idx], preapprovalId };
    tx.set(ref, { redeemedBy, updatedAt: new Date().toISOString() }, { merge: true });
  });
}
