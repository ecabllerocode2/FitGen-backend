/**
 * Dev tool: advance simulated time for a test user in Firestore.
 * NEVER enable in production without DEV_TOOLS=true.
 *
 * Usage:
 *   DEV_TOOLS=true node scripts/dev/advance-time.mjs --user <uid> --days 7
 */
import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { initFirebaseAdmin } = require('../lib/firebaseInit.cjs');

if (process.env.DEV_TOOLS !== 'true') {
  console.error('❌ Requiere DEV_TOOLS=true');
  process.exit(1);
}

const args = process.argv.slice(2);
const userIdx = args.indexOf('--user');
const daysIdx = args.indexOf('--days');
const userId = userIdx >= 0 ? args[userIdx + 1] : null;
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 7;

if (!userId || Number.isNaN(days)) {
  console.error('Uso: DEV_TOOLS=true node scripts/dev/advance-time.mjs --user <uid> --days <n>');
  process.exit(1);
}

const admin = initFirebaseAdmin();

const db = admin.firestore();

function shiftIso(iso, deltaDays) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString();
}

function shiftDate(isoDate, deltaDays) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

const snap = await db.collection('users').doc(userId).get();
if (!snap.exists) {
  console.error(`Usuario ${userId} no encontrado`);
  process.exit(1);
}

const data = snap.data();
const updates = {};

if (data.currentMesocycle?.startDate) {
  updates['currentMesocycle.startDate'] = shiftDate(data.currentMesocycle.startDate, -days);
  updates['currentMesocycle.endDate'] = shiftDate(data.currentMesocycle.endDate, -days);
}

if (data.lastWorkoutDate) {
  updates.lastWorkoutDate = shiftIso(data.lastWorkoutDate, -days);
}

if (data.currentSession?.generatedAt) {
  updates['currentSession.generatedAt'] = shiftIso(data.currentSession.generatedAt, -days);
}

updates.devTimeShiftDays = (data.devTimeShiftDays ?? 0) + days;
updates.devLastTimeShift = new Date().toISOString();

await db.collection('users').doc(userId).update(updates);

console.log(`✓ Usuario ${userId}: fechas retrocedidas ${days} días (simula que pasó el tiempo)`);
console.log('  Ahora genera la siguiente sesión desde la app como si hubieran pasado esos días.');
process.exit(0);
