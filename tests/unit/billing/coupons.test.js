import { describe, expect, it } from 'vitest';
import {
  normalizeCouponCode,
  validateCoupon,
  claimCouponSlot,
  releaseCouponSlot,
} from '../../../domain/billing/coupons.js';

function makeDb(initial) {
  let data = initial ? { ...initial, redeemedBy: [...(initial.redeemedBy || [])] } : null;

  const ref = {
    // marker
  };

  const db = {
    collection: () => ({
      doc: () => ref,
    }),
    runTransaction: async (fn) => {
      const tx = {
        get: async () => ({
          exists: Boolean(data),
          data: () => (data ? { ...data, redeemedBy: [...(data.redeemedBy || [])] } : undefined),
        }),
        set: (_r, patch) => {
          data = {
            ...(data || {}),
            ...patch,
            redeemedBy: patch.redeemedBy
              ? [...patch.redeemedBy]
              : [...(data?.redeemedBy || [])],
          };
        },
      };
      return fn(tx);
    },
  };

  // validateCoupon uses ref.get() directly
  ref.get = async () => ({
    exists: Boolean(data),
    data: () => (data ? { ...data, redeemedBy: [...(data.redeemedBy || [])] } : undefined),
  });

  return {
    db,
    getData: () => data,
  };
}

describe('billing coupons', () => {
  it('normalizes codes', () => {
    expect(normalizeCouponCode('  fitgen125 ')).toBe('FITGEN125');
  });

  it('validates active coupon without consuming', async () => {
    const { db, getData } = makeDb({
      active: true,
      amountMxn: 125,
      maxRedemptions: 10,
      redemptionCount: 3,
      redeemedBy: [],
    });
    const result = await validateCoupon(db, 'fitgen125');
    expect(result).toMatchObject({ valid: true, amountMxn: 125, remaining: 7, code: 'FITGEN125' });
    expect(getData().redemptionCount).toBe(3);
  });

  it('rejects exhausted coupons', async () => {
    const { db } = makeDb({
      active: true,
      amountMxn: 125,
      maxRedemptions: 10,
      redemptionCount: 10,
      redeemedBy: [],
    });
    await expect(validateCoupon(db, 'FITGEN125')).rejects.toMatchObject({
      code: 'coupon_exhausted',
    });
  });

  it('claims a slot once and reuses for same user', async () => {
    const { db, getData } = makeDb({
      active: true,
      amountMxn: 125,
      maxRedemptions: 10,
      redemptionCount: 0,
      redeemedBy: [],
    });

    const first = await claimCouponSlot(db, 'FITGEN125', 'user-a');
    expect(first.reused).toBe(false);
    expect(getData().redemptionCount).toBe(1);

    const second = await claimCouponSlot(db, 'FITGEN125', 'user-a');
    expect(second.reused).toBe(true);
    expect(getData().redemptionCount).toBe(1);

    await claimCouponSlot(db, 'FITGEN125', 'user-b');
    expect(getData().redemptionCount).toBe(2);
  });

  it('releases a claimed slot', async () => {
    const { db, getData } = makeDb({
      active: true,
      amountMxn: 125,
      maxRedemptions: 10,
      redemptionCount: 1,
      redeemedBy: [{ userId: 'user-a', redeemedAt: '2026-01-01T00:00:00.000Z' }],
    });

    const result = await releaseCouponSlot(db, 'FITGEN125', 'user-a');
    expect(result.released).toBe(true);
    expect(getData().redemptionCount).toBe(0);
    expect(getData().redeemedBy).toEqual([]);
  });
});
