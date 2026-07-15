#!/usr/bin/env node
/** Backfill lastCompletedDayOfWeek from latest recentSession */
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

const userId = process.argv[2] ?? 'pIJAVa0GRYcnMmVIlbUr7QzH0Mv1';

function loadServiceAccount() {
  const text = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT='));
  let raw = line.slice('FIREBASE_SERVICE_ACCOUNT='.length).trim();
  if (raw.startsWith('"')) raw = raw.slice(1);
  if (raw.endsWith('"')) raw = raw.slice(0, -1);
  return JSON.parse(raw);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
}

const db = admin.firestore();
const ref = db.collection('users').doc(userId);
const recent = await ref.collection('recentSessions').orderBy('archivedAt', 'desc').limit(1).get();
if (recent.empty) {
  console.log('No sessions');
  process.exit(0);
}
const latest = recent.docs[0].data();
await ref.set(
  {
    lastCompletedDayOfWeek: latest.dayOfWeek,
    lastCompletedWeekNumber: latest.weekNumber ?? 1,
    currentSession: null,
  },
  { merge: true },
);
console.log('Backfilled:', latest.dayOfWeek, 'week', latest.weekNumber);
