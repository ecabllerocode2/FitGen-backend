#!/usr/bin/env node
/**
 * Backfill users/{uid}.gamification from recentSessions (partial — max 36 sessions).
 *
 * Usage:
 *   node scripts/backfill-gamification.mjs [userId]
 *   node scripts/backfill-gamification.mjs --all
 */
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { estimateGamificationFromSessions } from '../domain/gamification/updateGamification.js';
import { normalizeGamification } from '../domain/gamification/defaults.js';

function loadServiceAccount() {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT='));
  if (!line) throw new Error('FIREBASE_SERVICE_ACCOUNT missing in .env.local');
  let raw = line.slice('FIREBASE_SERVICE_ACCOUNT='.length).trim();
  if (raw.startsWith('"')) raw = raw.slice(1);
  if (raw.endsWith('"')) raw = raw.slice(0, -1);
  return JSON.parse(raw);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
}

const db = admin.firestore();
const targetAll = process.argv.includes('--all');
const userId = process.argv.find((arg) => arg && !arg.startsWith('-'));

async function backfillUser(uid) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`Skip ${uid}: not found`);
    return;
  }

  const user = snap.data();
  if (user.gamification?.lifetimeSessionsCompleted > 0 && !process.argv.includes('--force')) {
    console.log(`Skip ${uid}: gamification already initialized (${user.gamification.lifetimeSessionsCompleted} sessions)`);
    return;
  }

  const recentSnap = await ref.collection('recentSessions').orderBy('archivedAt', 'asc').get();
  const sessions = recentSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const timezone = user.profileData?.timezone ?? 'America/Mexico_City';

  const estimated = estimateGamificationFromSessions(sessions, timezone);
  const gamification = normalizeGamification(estimated, new Date(), timezone);

  await ref.set({ gamification }, { merge: true });
  console.log(
    `✓ ${uid}: lifetimeSessions=${gamification.lifetimeSessionsCompleted}, achievements=${Object.keys(gamification.achievementsUnlocked).length}`,
  );
}

if (targetAll) {
  const usersSnap = await db.collection('users').get();
  for (const doc of usersSnap.docs) {
    await backfillUser(doc.id);
  }
} else if (userId) {
  await backfillUser(userId);
} else {
  console.error('Usage: node scripts/backfill-gamification.mjs <userId> | --all [--force]');
  process.exit(1);
}
