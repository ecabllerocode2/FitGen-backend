/**
 * Audit RAMP warmups for every split session template.
 * Usage: node scripts/dev/audit-warmup.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { generateWarmup } from '../../domain/session/rampGenerator.js';
import { SPLIT_SESSIONS } from '../../domain/constants.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(
  readFileSync(path.join(root, '../colecciones/curated/calentamiento.json'), 'utf8'),
).items;

const scenarios = Object.entries(SPLIT_SESSIONS).flatMap(([splitType, sessions]) =>
  sessions.map((s) => ({
    splitType,
    ...s,
    goal: s.sessionFocus.includes('Fuerza') ? 'Fuerza' : 'Hipertrofia',
  })),
);

for (const sc of scenarios) {
  const warmup = generateWarmup(sc.patterns, catalog, {
    weekNumber: 1,
    sessionFocus: sc.sessionFocus,
    sessionMuscles: sc.muscles,
    goal: sc.goal,
    readiness: { energyLevel: 3, sorenessLevel: 2 },
  });
  const totalSec = warmup.reduce((a, w) => a + (w.durationSeconds || 0), 0);
  const phases = ['Raise', 'Activate', 'Mobilize', 'Potentiate'].filter((p) =>
    warmup.some((w) => w.phase === p),
  );
  const missing = ['Raise', 'Activate', 'Mobilize', 'Potentiate'].filter((p) => !phases.includes(p));

  console.log(`\n[${sc.splitType}] ${sc.sessionFocus} (${sc.goal}) — ${totalSec}s, fases: ${phases.length}/4`);
  if (missing.length) console.log(`  ⚠ faltan: ${missing.join(', ')}`);
  warmup.forEach((w) => console.log(`  ${w.phase}: ${w.name} — ${w.reps} (${w.durationSeconds}s)`));
}
