#!/usr/bin/env node
/**
 * One-time grant: lifetimeAccess for all current users except a denylist.
 *
 * Usage:
 *   node scripts/dev/grant-lifetime-access.mjs
 *   node scripts/dev/grant-lifetime-access.mjs --dry-run
 */
import 'dotenv/config';
import { db } from '../../lib/firebaseAdmin.js';

const EXCLUDE = new Set(
  (process.env.LIFETIME_EXCLUDE_UIDS || 'CvSeQAryO5gFhle76r6r4Z3tCi22')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const snap = await db.collection('users').get();
  let granted = 0;
  let skipped = 0;
  let already = 0;

  console.log(`Users scanned: ${snap.size}`);
  console.log(`Excluded UIDs: ${[...EXCLUDE].join(', ') || '(none)'}`);
  console.log(dryRun ? 'DRY RUN — no writes' : 'APPLYING writes…');

  for (const doc of snap.docs) {
    const id = doc.id;
    const data = doc.data() || {};

    if (EXCLUDE.has(id)) {
      skipped += 1;
      console.log(`SKIP exclude ${id} (${data.email || 'no-email'})`);
      continue;
    }

    if (data.lifetimeAccess === true) {
      already += 1;
      continue;
    }

    const patch = {
      lifetimeAccess: true,
      lifetimeAccessGrantedAt: new Date().toISOString(),
      lifetimeAccessReason: 'founding_users_grandfather',
      billingUpdatedAt: new Date().toISOString(),
    };

    if (!dryRun) {
      await doc.ref.set(patch, { merge: true });
    }
    granted += 1;
    console.log(`GRANT ${id} (${data.email || 'no-email'})`);
  }

  console.log(
    JSON.stringify(
      { granted, skippedExcluded: skipped, alreadyHad: already, dryRun },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
