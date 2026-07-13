/**
 * Anota subtipoEstimulo en colecciones/curated/entrenamiento.json
 * usando la misma lógica que resolveStimulusSubtype.
 *
 * Uso: node scripts/dev/annotate-stimulus-subtypes.mjs [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { resolveStimulusSubtype } from '../../domain/exerciseSelection/stimulusCoverage.js';

/** Overrides manuales para ejercicios mal etiquetados o ambiguos en el catálogo. */
const MANUAL_OVERRIDES = {
  Alternate_Heel_Touchers: 'flexion',
  Bent_Press: 'vertical_press',
  'Bottoms-Up_Clean_From_The_Hang_Position': 'vertical_press',
  Cable_Hip_Adduction: 'adductor',
  Car_Drivers: 'other_shoulder',
  Dumbbell_Lying_Pronation: 'other_core',
  Dumbbell_Lying_Supination: 'other_core',
  Iron_Cross: 'other_shoulder',
  'Kettlebell_Turkish_Get-Up_Lunge_style': 'other_shoulder',
  'Kettlebell_Turkish_Get-Up_Squat_style': 'other_shoulder',
  Low_Pulley_Row_To_Neck: 'other_shoulder',
  Lying_Face_Down_Plate_Neck_Resistance: 'other_core',
  Plate_Pinch: 'other_core',
  Rack_Delivery: 'vertical_press',
  Smith_Machine_Hip_Raise: 'glute_accessory',
  Spell_Caster: 'rotation',
  Standing_Cable_Lift: 'rotation',
  Standing_Cable_Wood_Chop: 'rotation',
  standing_olympic_plate_hand_squeeze: 'other_core',
  suspended_fallout: 'anti_extension',
  Upright_Barbell_Row: 'vertical_press',
  Upright_Cable_Row: 'vertical_press',
  'Upright_Row_-_With_Bands': 'vertical_press',
  Scissor_Kick: 'flexion',
  Wrist_Roller: 'other_shoulder',
  Wrist_Rotations_with_Straight_Bar: 'other_shoulder',
};

function resolveSubtypeForCatalog(item) {
  if (MANUAL_OVERRIDES[item.id]) return MANUAL_OVERRIDES[item.id];
  return resolveStimulusSubtype(item);
}

const dryRun = process.argv.includes('--dry-run');
const catalogPath = path.join(process.cwd(), 'colecciones/curated/entrenamiento.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const bySubtype = {};
const byMuscle = {};
let changed = 0;

for (const item of catalog.items) {
  const subtype = resolveSubtypeForCatalog(item);
  bySubtype[subtype] = (bySubtype[subtype] ?? 0) + 1;
  const muscle = item.parteCuerpo ?? 'unknown';
  if (!byMuscle[muscle]) byMuscle[muscle] = {};
  byMuscle[muscle][subtype] = (byMuscle[muscle][subtype] ?? 0) + 1;

  if (item.subtipoEstimulo !== subtype) {
    changed += 1;
    item.subtipoEstimulo = subtype;
  }
}

catalog.updatedAt = new Date().toISOString();

console.log(`Ejercicios: ${catalog.items.length}`);
console.log(`Actualizados: ${changed}`);
console.log('\nPor subtipo:');
console.log(
  Object.entries(bySubtype)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n'),
);

console.log('\nPor músculo (top subtipos):');
for (const [muscle, subs] of Object.entries(byMuscle).sort()) {
  const top = Object.entries(subs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');
  console.log(`  ${muscle}: ${top}`);
}

if (!dryRun) {
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`\n✓ Guardado en ${catalogPath}`);
} else {
  console.log('\n(dry-run — sin escribir archivo)');
}
