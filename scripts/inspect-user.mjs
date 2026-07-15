#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

const userId = process.argv[2] ?? 'pIJAVa0GRYcnMmVIlbUr7QzH0Mv1';

function loadServiceAccount() {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT='));
  if (!line) throw new Error('FIREBASE_SERVICE_ACCOUNT not found');
  let raw = line.slice('FIREBASE_SERVICE_ACCOUNT='.length).trim();
  if (raw.startsWith('"')) raw = raw.slice(1);
  if (raw.endsWith('"')) raw = raw.slice(0, -1);
  return JSON.parse(raw);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

const db = admin.firestore();
const ref = db.collection('users').doc(userId);
const snap = await ref.get();
if (!snap.exists) {
  console.error('User not found');
  process.exit(1);
}

const data = snap.data();
const cs = data.currentSession;
console.log('=== USER', userId, '===');
console.log('lastWorkoutDate:', data.lastWorkoutDate);
console.log('currentSession:', cs ? {
  sessionFocus: cs.sessionFocus,
  completed: cs.completed,
  generatedAt: cs.generatedAt ?? cs.meta?.generatedAt,
  completedAt: cs.completedAt,
  dayOfWeek: cs.dayOfWeek,
  weekNumber: cs.weekNumber,
} : null);

const recentSnap = await ref.collection('recentSessions').get();
console.log('\nrecentSessions count:', recentSnap.size);
for (const doc of recentSnap.docs) {
  const s = doc.data();
  console.log({
    id: doc.id,
    sessionFocus: s.sessionFocus,
    completed: s.completed,
    completedAt: s.completedAt,
    archivedAt: s.archivedAt,
    generatedAt: s.generatedAt,
    dayOfWeek: s.dayOfWeek,
    weekNumber: s.weekNumber,
  });
}

// Simulate history API filter
const rows = recentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const completed = rows.filter((s) => s.completed !== false);
console.log('\nhistory API would return:', completed.length);
