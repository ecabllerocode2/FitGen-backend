/**
 * QA gate for recent training-engine fixes (swap, exclusions, unilateral, Upper Fuerza).
 * Pure domain checks — no Firebase required.
 *
 * Usage: node scripts/dev/qa-quality-gate.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findEquivalentSwapReplacement } from '../../domain/exerciseSelection/swapReplacement.js';
import { applyMainExerciseSwap } from '../../domain/session/applyMainExerciseSwap.js';
import { applyContinuityReplacements } from '../../domain/athlete/continuityPreferences.js';
import {
  addExerciseExclusion,
  getUserExercisePreferences,
  resolveExclusionFilters,
  isExerciseBlocked,
} from '../../domain/athlete/exercisePreferences.js';
import { selectExercises } from '../../domain/exerciseSelection/selector.js';
import { generateWarmup } from '../../domain/session/rampGenerator.js';
import { SESSION_FOCUS_PATTERN_MAP } from '../../domain/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const issues = [];
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) issues.push(`${name}: ${detail || 'FAILED'}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const training = JSON.parse(
  fs.readFileSync(path.join(root, 'colecciones/curated/entrenamiento.json'), 'utf8'),
).items.filter((ex) => ex.categoriaBloque === 'main_block');

const warmupCatalog = JSON.parse(
  fs.readFileSync(path.join(root, 'colecciones/curated/calentamiento.json'), 'utf8'),
).items;

// 1. Swap equivalence
{
  const source = training.find((ex) => ex.id === 'Underhand_Cable_Pulldowns');
  const replacement = findEquivalentSwapReplacement(training, source, {
    excludeIds: ['Incline_Dumbbell_Bench_With_Palms_Facing_In'],
    unavailableEquipment: ['Polea Alta'],
    safetyProfile: { experienceLevel: 'Avanzado' },
  });
  check(
    'swap_keeps_pull_pattern',
    Boolean(replacement) && replacement.patronMovimiento === 'Traccion_V',
    replacement
      ? `${source.nombre} → ${replacement.nombre} (${replacement.patronMovimiento})`
      : 'no replacement',
  );
  check(
    'swap_never_chest_for_pulldown',
    !replacement || replacement.parteCuerpo !== 'Pecho',
    replacement?.parteCuerpo ?? 'n/a',
  );
}

// 2. applyMainExerciseSwap preserves description from catalog
{
  const source = training.find((ex) => ex.id === 'Underhand_Cable_Pulldowns');
  const session = {
    weekNumber: 1,
    mainBlock: [
      {
        exerciseId: source.id,
        exerciseName: source.nombre,
        muscleGroup: source.parteCuerpo,
        movementPattern: source.patronMovimiento,
        descripcion: 'DESCRIPCION_VIEJA_DEL_JALON',
        rirTarget: 2,
        repRange: '3-6',
      },
    ],
  };
  const result = applyMainExerciseSwap({
    session,
    exerciseIdToReplace: source.id,
    catalog: training,
    unavailableEquipment: ['Polea Alta'],
    safetyProfile: { experienceLevel: 'Avanzado' },
  });
  const swapped = result.mainBlock?.[0];
  check(
    'swap_updates_catalog_description',
    Boolean(swapped) &&
      swapped.descripcion !== 'DESCRIPCION_VIEJA_DEL_JALON' &&
      swapped.descripcion === result.replacement.descripcion,
    swapped?.exerciseName ?? result.error,
  );
}

// 3. Corrupted continuity ignored
{
  const stubs = [
    {
      id: 'Underhand_Cable_Pulldowns',
      patronMovimiento: 'Traccion_V',
      parteCuerpo: 'Espalda',
      nombre: 'Jalón',
    },
  ];
  const resolved = applyContinuityReplacements(stubs, {
    Underhand_Cable_Pulldowns: {
      exerciseId: 'Smith_Machine_Bench_Press',
      patronMovimiento: 'Empuje_H',
      parteCuerpo: 'Pecho',
      nombre: 'Press Smith',
    },
  });
  check(
    'continuity_rejects_cross_pattern',
    resolved[0].id === 'Underhand_Cable_Pulldowns',
    resolved[0].id,
  );
}

// 4. Exclusions + preferences helper
{
  const user = {
    exercisePreferences: addExerciseExclusion(
      { excluded: [], unavailableEquipment: [] },
      {
        exerciseId: 'Underhand_Cable_Pulldowns',
        nombre: 'Jalón',
        equipmentTags: ['Polea Alta'],
      },
      true,
    ),
  };
  const prefs = getUserExercisePreferences(user);
  const filters = resolveExclusionFilters(prefs);
  check(
    'exclusions_block_id_and_equipment',
    filters.excludeIds.includes('Underhand_Cable_Pulldowns') &&
      filters.unavailableEquipment.includes('Polea Alta') &&
      isExerciseBlocked({ id: 'Other', equipo: ['Polea Alta'] }, filters),
    JSON.stringify(filters),
  );
}

// 5. Upper Fuerza coverage
{
  const patterns = SESSION_FOCUS_PATTERN_MAP['Upper (Fuerza)'] ?? [];
  check(
    'upper_fuerza_includes_empuje_v',
    patterns.includes('Empuje_V') && patterns.includes('Traccion_V'),
    patterns.join(', '),
  );

  const selected = selectExercises(
    'Upper (Fuerza)',
    training,
    { experienceLevel: 'Avanzado' },
    [],
    'Hipertrofia',
    { weekNumber: 1, sessionMuscles: ['Pecho', 'Espalda', 'Hombro'] },
  );
  check(
    'upper_fuerza_selects_at_least_4',
    selected.length >= 4,
    `count=${selected.length}; patterns=${selected.map((e) => e.patronMovimiento).join('|')}`,
  );
  check(
    'upper_fuerza_has_vertical_push',
    selected.some((e) => e.patronMovimiento === 'Empuje_V'),
    selected.map((e) => `${e.nombre}:${e.patronMovimiento}`).join('; '),
  );
}

// 6. Unilateral warmup dosing
{
  const uniSource = warmupCatalog.find((ex) => ex.id === 'External_Rotation_with_Cable');
  check('catalog_marks_cable_rotation_unilateral', uniSource?.isUnilateral === true, uniSource?.id);

  const warmup = generateWarmup(['Empuje_H', 'Traccion_V'], warmupCatalog, {
    sessionFocus: 'Upper (Fuerza)',
    goal: 'Fuerza',
    weekNumber: 1,
  });
  const uniItems = warmup.filter((w) => w.isUnilateral);
  check(
    'warmup_propagates_unilateral_flag',
    uniItems.length >= 1,
    `unilateral=${uniItems.map((w) => w.nombre).join(', ') || 'none'}`,
  );
  check(
    'unilateral_warmup_has_both_sides_cue',
    uniItems.every((w) => /por lado/i.test(w.reps ?? '') || /lado|brazo/i.test(w.unilateralCue ?? '')),
    uniItems.map((w) => `${w.nombre}:${w.reps}`).join('; '),
  );
  check(
    'unilateral_warmup_time_covers_both_sides',
    uniItems.every((w) => (w.durationSeconds ?? 0) >= 80),
    uniItems.map((w) => `${w.nombre}:${w.durationSeconds}s`).join('; '),
  );
}

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok).length;
const summary = {
  startedAt: new Date().toISOString(),
  passed,
  failed,
  total: checks.length,
  issues,
  checks,
};

const outDir = path.join(root, 'reports', 'qa');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'quality-gate.json'), JSON.stringify(summary, null, 2));

console.log('\n──────────────────────────────────');
console.log(`QA gate: ${passed}/${checks.length} passed, ${failed} failed`);
console.log(`Report: reports/qa/quality-gate.json`);

if (failed > 0) {
  process.exit(1);
}
