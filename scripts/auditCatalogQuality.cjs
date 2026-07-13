/**
 * Auditoría semántica del catálogo curado.
 * Uso: node scripts/auditCatalogQuality.cjs
 */
const fs = require('fs');
const path = require('path');
const CURATED_DIR = path.join(__dirname, '../colecciones/curated');
const DOCS = ['calentamiento', 'enfriamiento', 'entrenamiento'];

const PATTERN_MUSCLE_HINTS = {
  Empuje_H: ['Pecho', 'Tríceps', 'Hombro'],
  Empuje_V: ['Hombro', 'Tríceps', 'Pecho'],
  Traccion_H: ['Espalda', 'Bíceps', 'Hombro', 'Pecho'],
  Traccion_V: ['Espalda', 'Bíceps', 'Hombro', 'Pecho'],
  Rodilla: ['Cuádriceps', 'Glúteos', 'Core'],
  Cadera: ['Isquiotibiales', 'Glúteos', 'Espalda', 'Cuádriceps', 'Core', 'Hombro'],
  Core: ['Core'],
  General: null,
};

/** Muscles that must never use a squat/hinge pattern slot */
const MUSCLE_PATTERN_MISMATCH = {
  Pantorrillas: ['Rodilla', 'Cadera'],
  Bíceps: ['Rodilla', 'Cadera', 'Empuje_H', 'Empuje_V'],
  Tríceps: ['Rodilla', 'Cadera', 'Traccion_H', 'Traccion_V'],
};

const AUTO_SELECT_EXCLUDE = new Set([
  'Clean_Shrug',
  'Clock_Push-Up',
  'Single-Arm_Push-Up',
]);

const REQUIRED_PATTERNS = ['Empuje_H', 'Traccion_H', 'Rodilla', 'Cadera'];

function loadDocs() {
  const docs = {};
  for (const name of DOCS) {
    docs[name] = JSON.parse(fs.readFileSync(path.join(CURATED_DIR, `${name}.json`), 'utf8'));
  }
  return docs;
}

function main() {
  const docs = loadDocs();
  const entrenamiento = docs.entrenamiento.items ?? [];
  const warnings = [];
  const errors = [];

  for (const ex of entrenamiento) {
    const hints = PATTERN_MUSCLE_HINTS[ex.patronMovimiento];
    if (hints && !hints.includes(ex.parteCuerpo)) {
      warnings.push(`${ex.id}: patrón ${ex.patronMovimiento} con parteCuerpo ${ex.parteCuerpo}`);
    }

    const forbidden = MUSCLE_PATTERN_MISMATCH[ex.parteCuerpo];
    if (forbidden?.includes(ex.patronMovimiento)) {
      errors.push(`${ex.id}: ${ex.parteCuerpo} no debe usar patrón ${ex.patronMovimiento}`);
    }

    if (ex.prioridad === 1 && AUTO_SELECT_EXCLUDE.has(ex.id)) {
      warnings.push(`${ex.id}: prioridad 1 pero excluido de auto-selección`);
    }
  }

  const missingFields = entrenamiento.filter(
    (ex) => !ex.id || !ex.patronMovimiento || !ex.parteCuerpo || !ex.prioridad,
  );
  if (missingFields.length) {
    errors.push(`${missingFields.length} ejercicios con campos obligatorios faltantes`);
  }

  const duplicateIds = entrenamiento
    .map((ex) => ex.id)
    .filter((id, i, arr) => arr.indexOf(id) !== i);
  if (duplicateIds.length) {
    errors.push(`IDs duplicados: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  for (const pattern of REQUIRED_PATTERNS) {
    const priority1 = entrenamiento.filter(
      (ex) => ex.patronMovimiento === pattern && ex.prioridad === 1,
    );
    if (priority1.length < 3) {
      warnings.push(`Cobertura baja patrón ${pattern}: solo ${priority1.length} ejercicios prioridad 1`);
    }
  }

  const calentamiento = docs.calentamiento.items ?? [];
  const sinFase = calentamiento.filter((ex) => !ex.faseRAMP && !ex.faseRamp);
  if (sinFase.length) {
    warnings.push(`${sinFase.length} ejercicios de calentamiento sin faseRAMP`);
  }

  console.log('Auditoría de calidad del catálogo\n');
  console.log(`Total: ${entrenamiento.length + calentamiento.length + (docs.enfriamiento.items?.length ?? 0)} ejercicios`);

  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} advertencias:`);
    warnings.slice(0, 20).forEach((w) => console.log(`  - ${w}`));
    if (warnings.length > 20) console.log(`  ... y ${warnings.length - 20} más`);
  }

  if (errors.length) {
    console.error(`\n❌ ${errors.length} errores`);
    process.exit(1);
  }

  console.log('\n✓ Auditoría completada');
}

main();
