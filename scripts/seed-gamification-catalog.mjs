#!/usr/bin/env node
/**
 * Seed catalogs/gamification with achievement definitions (Phase 1).
 */
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import { ACHIEVEMENT_DEFINITIONS } from '../domain/gamification/achievements.js';

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

const payload = {
  achievements: ACHIEVEMENT_DEFINITIONS.map(({ id, title, description, category, target }) => ({
    id,
    title,
    description,
    category,
    target: target ?? null,
  })),
  avatarStages: [
    { stage: 0, name: 'Recruit', requirement: 'Registro' },
    { stage: 1, name: 'Trainee', requirement: '1 semana perfecta' },
    { stage: 2, name: 'Regular', requirement: '4 semanas perfectas' },
    { stage: 3, name: 'Dedicated', requirement: '12 semanas perfectas' },
  ],
  shop: [],
  updatedAt: new Date().toISOString(),
};

await db.collection('catalogs').doc('gamification').set(payload, { merge: true });
console.log(`✓ catalogs/gamification seeded (${payload.achievements.length} achievements)`);
