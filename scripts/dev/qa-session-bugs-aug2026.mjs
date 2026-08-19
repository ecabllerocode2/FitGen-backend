#!/usr/bin/env node
/**
 * Focused quality + security gate for the Aug 2026 session bugfix batch:
 *  - bodyweight / load convention (step-up, inverted row, box jump, vertical swing)
 *  - unilateral Potentiate dosing (glute bridge timer)
 *  - season rollover on read (Aug 1)
 *  - celebration card versioned URLs (cache safety)
 *  - catalog placement (crossover reverse lunge in warmup)
 *
 * Usage:
 *   node scripts/dev/qa-session-bugs-aug2026.mjs
 *   npm run qa:session-bugs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

const FAIL = [];
const PASS = [];

function ok(label) {
  PASS.push(label);
  console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
  FAIL.push(`${label}: ${detail}`);
  console.error(`  ❌ ${label}: ${detail}`);
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function assertCatalog() {
  console.log('\n[1/4] Catalog invariants');
  const ent = loadJson('colecciones/curated/entrenamiento.json').items;
  const cal = loadJson('colecciones/curated/calentamiento.json').items;
  const enf = loadJson('colecciones/curated/enfriamiento.json').items;
  const byEnt = Object.fromEntries(ent.map((e) => [e.id, e]));
  const byCal = Object.fromEntries(cal.map((e) => [e.id, e]));
  const byEnf = Object.fromEntries(enf.map((e) => [e.id, e]));

  const mustBw = [
    ['ent', byEnt, 'Step-up_with_Knee_Raise'],
    ['ent', byEnt, 'Inverted_Row'],
    ['ent', byEnt, 'Box_Jump_Multiple_Response'],
    ['cal', byCal, 'Front_Box_Jump'],
    ['cal', byCal, 'Lateral_Box_Jump'],
  ];
  for (const [pool, map, id] of mustBw) {
    const ex = map[id];
    if (!ex) {
      fail(`${pool}/${id}`, 'missing');
      continue;
    }
    const equipo = (ex.equipo ?? []).join(' ');
    if (!/peso corporal|bodyweight|corporal/i.test(equipo)) {
      fail(`${pool}/${id} bodyweight`, `equipo=${JSON.stringify(ex.equipo)}`);
    } else {
      ok(`${pool}/${id} is bodyweight`);
    }
  }

  const swing = byEnt.Vertical_Swing;
  if (!swing) fail('Vertical_Swing', 'missing');
  else if (!/mancuerna/i.test((swing.equipo ?? []).join(' '))) {
    fail('Vertical_Swing equipo', JSON.stringify(swing.equipo));
  } else if (/mancuernas/i.test((swing.equipo ?? []).join(' '))) {
    fail('Vertical_Swing singular', 'still plural Mancuernas');
  } else ok('Vertical_Swing uses singular Mancuerna');

  if (byEnf.Crossover_Reverse_Lunge) {
    fail('Crossover_Reverse_Lunge', 'still in enfriamiento');
  } else if (!byCal.Crossover_Reverse_Lunge) {
    fail('Crossover_Reverse_Lunge', 'missing from calentamiento');
  } else if (byCal.Crossover_Reverse_Lunge.faseRAMP !== 'Activate') {
    fail('Crossover_Reverse_Lunge faseRAMP', byCal.Crossover_Reverse_Lunge.faseRAMP);
  } else {
    ok('Crossover_Reverse_Lunge moved to calentamiento/Activate');
  }
}

async function assertDomain() {
  console.log('\n[2/4] Domain logic');
  const { resolveLoadConvention } = await import(
    path.join(root, 'domain/prescription/loadConvention.js')
  );
  const { buildGamificationSummary } = await import(
    path.join(root, 'domain/gamification/summary.js')
  );
  const { generateWarmup } = await import(path.join(root, 'domain/session/rampGenerator.js'));

  const cases = [
    {
      id: 'Vertical_Swing',
      nombre: 'Swing Vertical con Mancuerna',
      equipo: ['Mancuerna'],
      expect: 'barbell_total',
    },
    {
      id: 'Inverted_Row',
      nombre: 'Remo invertido',
      equipo: ['Peso Corporal', 'Smith Machine'],
      expect: 'bodyweight',
    },
    {
      id: 'Step-up_with_Knee_Raise',
      nombre: 'Step-up con Elevación de Rodilla',
      equipo: ['Peso Corporal', 'Cajón Pliométrico'],
      isUnilateral: true,
      expect: 'bodyweight',
    },
    {
      id: 'Box_Jump_Multiple_Response',
      nombre: 'Salto al Cajón',
      equipo: ['Peso Corporal', 'Cajón Pliométrico'],
      expect: 'bodyweight',
    },
    {
      id: 'Goblet_Squat',
      nombre: 'Sentadilla Goblet',
      equipo: ['Kettlebell'],
      isUnilateral: false,
      expect: 'barbell_total',
    },
    {
      id: 'Dumbbell_Alternate_Bicep_Curl',
      nombre: 'Curl de Bíceps Alterno con Mancuernas',
      equipo: ['Mancuernas'],
      isUnilateral: true,
      expect: 'dumbbell_per_hand',
    },
  ];
  for (const c of cases) {
    const got = resolveLoadConvention({
      exerciseId: c.id,
      exerciseName: c.nombre,
      equipo: c.equipo,
      isUnilateral: c.isUnilateral === true,
    });
    if (got !== c.expect) fail(`convention ${c.id}`, `got ${got}, want ${c.expect}`);
    else ok(`convention ${c.id} → ${got}`);
  }

  // Stale per-hand repair
  const repaired = resolveLoadConvention({
    exerciseId: 'Vertical_Swing',
    exerciseName: 'Swing Vertical con Mancuerna',
    equipo: ['Mancuernas'],
    loadConvention: 'dumbbell_per_hand',
  });
  if (repaired !== 'barbell_total') fail('Vertical_Swing stale repair', repaired);
  else ok('Vertical_Swing repairs stale dumbbell_per_hand');

  const summary = buildGamificationSummary(
    { currentSeasonId: '2026-07', seasonPoints: 99, lifetimeSessionsCompleted: 5 },
    { timezone: 'UTC', referenceDate: new Date('2026-08-01T15:00:00.000Z') },
  );
  if (!summary.seasonRolledOver || summary.counters.seasonPoints !== 0 || summary.counters.currentSeasonId !== '2026-08') {
    fail('season rollover Aug 1', JSON.stringify(summary.counters));
  } else ok('season rollover on read (Jul→Aug)');

  const warmup = generateWarmup(
    ['Cadera'],
    [
      {
        id: 'raise_x',
        nombre: 'Caminata',
        faseRAMP: 'Raise',
        patronMovimiento: 'General',
        parteCuerpo: 'Cuádriceps',
        equipo: ['Cinta de Correr'],
      },
      {
        id: 'Single_Leg_Glute_Bridge',
        nombre: 'Puente de glúteo a una pierna',
        faseRAMP: 'Activate',
        patronMovimiento: 'Cadera',
        parteCuerpo: 'Glúteos',
        equipo: ['Peso Corporal'],
        isUnilateral: true,
      },
      {
        id: 'mob_x',
        nombre: 'Círculos de brazos',
        faseRAMP: 'Mobilize',
        patronMovimiento: 'General',
        parteCuerpo: 'Hombro',
        equipo: ['Peso Corporal'],
        isDynamic: true,
      },
    ],
    { sessionFocus: 'Lower', goal: 'Hipertrofia', sessionMuscles: ['Glúteos'], weekNumber: 1 },
  );
  const bridge = warmup.find((w) => w.exerciseId === 'Single_Leg_Glute_Bridge');
  if (!bridge?.perSideSeconds || bridge.durationSeconds !== bridge.perSideSeconds * 2) {
    fail('unilateral potentiate/activate dosing', JSON.stringify(bridge));
  } else ok(`unilateral bridge timer ${bridge.perSideSeconds}s × 2`);

  const src = fs.readFileSync(path.join(root, 'infrastructure/r2/celebrationStorage.js'), 'utf8');
  if (!src.includes('${sessionId}-${version}.png')) {
    fail('celebration versioned key', 'uploadCelebrationPng key is not versioned');
  } else ok('celebration PNG key is versioned (cache-bust)');
  if (/max-age=2592000/.test(src)) {
    fail('celebration Cache-Control', 'still uses 30-day cache on mutable semantics');
  } else ok('celebration Cache-Control is not 30-day mutable');
}

function runVitestSlice() {
  console.log('\n[3/4] Focused Vitest slice');
  const files = [
    'tests/domain.test.js',
    'tests/gamification.test.js',
    'tests/unilateralAndContinuity.test.js',
    'tests/loadCalibrationRegressions.test.js',
  ].filter((f) => fs.existsSync(path.join(root, f)));

  const result = spawnSync(
    process.execPath,
    [require.resolve('vitest/vitest.mjs'), 'run', ...files],
    { cwd: root, encoding: 'utf8', env: process.env },
  );
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) fail('vitest slice', `exit ${result.status}`);
  else ok(`vitest slice (${files.length} files)`);
}

function securityStaticChecks() {
  console.log('\n[4/4] Security static checks on touched surfaces');
  const celebrationApi = fs.readFileSync(path.join(root, 'api/session/celebration-card.js'), 'utf8');
  if (!/verifyIdToken|authenticate/.test(celebrationApi)) {
    fail('celebration-card auth', 'missing auth gate');
  } else ok('celebration-card requires auth');

  if (!/archivedSessionId/.test(celebrationApi) || !/getRecentSession/.test(celebrationApi)) {
    fail('celebration-card ownership', 'does not verify session belongs to user');
  } else ok('celebration-card verifies session ownership');

  const summaryApi = fs.readFileSync(path.join(root, 'api/gamification/summary.js'), 'utf8');
  if (!/seasonRolledOver/.test(summaryApi) || !/saveUser/.test(summaryApi)) {
    fail('summary persist rollover', 'read-path rollover not persisted');
  } else ok('summary persists season rollover on read');
}

async function main() {
  console.log('QA session-bugs Aug 2026 — quality + security gate');
  assertCatalog();
  await assertDomain();
  runVitestSlice();
  securityStaticChecks();

  console.log(`\nResult: ${PASS.length} passed, ${FAIL.length} failed`);
  if (FAIL.length) {
    console.error('\nFailures:');
    for (const f of FAIL) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('\nFocused gate green.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
