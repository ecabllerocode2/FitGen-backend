#!/usr/bin/env node
/**
 * Clears stale currentSession for a user when generatedAt is not today.
 * Usage: node scripts/fix-user-session.mjs [userId]
 */
import 'dotenv/config';
import { db } from '../lib/firebaseAdmin.js';

const userId = process.argv[2] ?? 'pIJAVa0GRYcnMmVIlbUr7QzH0Mv1';

function isSameCalendarDay(a, b) {
  const d1 = a instanceof Date ? a : new Date(a);
  const d2 = b instanceof Date ? b : new Date(b);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

const ref = db.collection('users').doc(userId);
const snap = await ref.get();

if (!snap.exists) {
  console.error('User not found:', userId);
  process.exit(1);
}

const data = snap.data();
const session = data.currentSession;
const today = new Date();

if (!session) {
  console.log('No currentSession — nothing to clear.');
  process.exit(0);
}

const generatedAt = session.generatedAt ?? session.meta?.generatedAt;
const isToday = generatedAt ? isSameCalendarDay(generatedAt, today) : false;

console.log('User:', userId);
console.log('Session focus:', session.sessionFocus);
console.log('generatedAt:', generatedAt ?? '(missing)');
console.log('dayOfWeek:', session.dayOfWeek, 'weekNumber:', session.weekNumber);
console.log('isToday:', isToday);

if (session.completed || !isToday) {
  await ref.set({ currentSession: null }, { merge: true });
  console.log('Cleared currentSession.');
} else {
  console.log('Session is for today — left unchanged.');
}

const recent = await ref.collection('recentSessions').orderBy('archivedAt', 'desc').limit(5).get();
console.log('\nRecent archived sessions:', recent.size);
for (const doc of recent.docs) {
  const s = doc.data();
  console.log(' -', doc.id, s.sessionFocus, s.completedAt ?? s.archivedAt, 'completed:', s.completed);
}
