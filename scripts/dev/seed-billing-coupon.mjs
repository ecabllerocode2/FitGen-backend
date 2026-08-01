#!/usr/bin/env node
/**
 * Seed (or update) a billing coupon document in Firestore.
 *
 * Usage:
 *   node scripts/dev/seed-billing-coupon.mjs --code FITGEN125
 *   node scripts/dev/seed-billing-coupon.mjs --code FITGEN125 --amount 125 --max 10
 *   node scripts/dev/seed-billing-coupon.mjs --code FITGEN125 --dry-run
 *
 * Env overrides: COUPON_CODE, COUPON_AMOUNT_MXN, COUPON_MAX_REDEMPTIONS, COUPON_LABEL
 */
import 'dotenv/config';
import { db } from '../../lib/firebaseAdmin.js';
import { BILLING_COUPONS_COLLECTION, normalizeCouponCode } from '../../domain/billing/coupons.js';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

const dryRun = process.argv.includes('--dry-run');
const code = normalizeCouponCode(
  argValue('--code') || process.env.COUPON_CODE || 'FITGEN125',
);
const amountMxn = Number(argValue('--amount') || process.env.COUPON_AMOUNT_MXN || 125);
const maxRedemptions = Number(argValue('--max') || process.env.COUPON_MAX_REDEMPTIONS || 10);
const label =
  argValue('--label') ||
  process.env.COUPON_LABEL ||
  'Early bird $125/mes (primeras 10 personas)';

async function main() {
  if (!code) {
    throw new Error('Coupon code required (--code or COUPON_CODE)');
  }
  if (!Number.isFinite(amountMxn) || amountMxn <= 0) {
    throw new Error('Invalid amount');
  }
  if (!Number.isFinite(maxRedemptions) || maxRedemptions < 1) {
    throw new Error('Invalid max redemptions');
  }

  const ref = db.collection(BILLING_COUPONS_COLLECTION).doc(code);
  const existing = await ref.get();
  const prev = existing.exists ? existing.data() || {} : null;

  const doc = {
    code,
    amountMxn,
    maxRedemptions,
    active: true,
    label,
    redemptionCount: prev?.redemptionCount ?? 0,
    redeemedBy: Array.isArray(prev?.redeemedBy) ? prev.redeemedBy : [],
    updatedAt: new Date().toISOString(),
    ...(prev ? {} : { createdAt: new Date().toISOString() }),
  };

  console.log(
    JSON.stringify(
      {
        dryRun,
        path: `${BILLING_COUPONS_COLLECTION}/${code}`,
        previous: prev
          ? {
              redemptionCount: prev.redemptionCount,
              maxRedemptions: prev.maxRedemptions,
              amountMxn: prev.amountMxn,
              active: prev.active,
            }
          : null,
        next: {
          amountMxn: doc.amountMxn,
          maxRedemptions: doc.maxRedemptions,
          redemptionCount: doc.redemptionCount,
          active: doc.active,
          label: doc.label,
        },
      },
      null,
      2,
    ),
  );

  if (!dryRun) {
    await ref.set(doc, { merge: true });
    console.log('Seeded OK');
  } else {
    console.log('DRY RUN — no writes');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
