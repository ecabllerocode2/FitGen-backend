/**
 * Verifica el catálogo curado local o en Firestore.
 *
 * Uso:
 *   node scripts/verifyCatalog.cjs           # solo archivos locales
 *   node scripts/verifyCatalog.cjs --remote  # lee de Firestore producción
 *   node scripts/verifyCatalog.cjs --emulator
 */
const fs = require('fs');
const path = require('path');

const CURATED_DIR = path.join(__dirname, '../colecciones/curated');
const DOCS = ['calentamiento', 'enfriamiento', 'entrenamiento'];
const useRemote = process.argv.includes('--remote');
const useEmulator = process.argv.includes('--emulator');

async function loadLocalDocs() {
  const results = {};
  for (const docName of DOCS) {
    const filePath = path.join(CURATED_DIR, `${docName}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Falta archivo local: ${filePath}`);
    }
    results[docName] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return results;
}

async function loadRemoteDocs() {
  if (useEmulator) {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  }

  const { initFirebaseAdmin } = require('./lib/firebaseInit.cjs');
  const admin = initFirebaseAdmin({ emulator: useEmulator });
  const db = admin.firestore();
  const results = {};
  for (const docName of DOCS) {
    const snap = await db.collection('catalogs').doc(docName).get();
    if (!snap.exists) {
      throw new Error(`Documento Firestore ausente: catalogs/${docName}`);
    }
    results[docName] = snap.data();
  }
  return results;
}

function normalizeNombreKey(nombre) {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function verify(docs, muscleGroups, movementPatterns) {
  const muscleSet = new Set(muscleGroups);
  const patternSet = new Set(movementPatterns);
  const globalIds = new Map();
  const globalNames = new Map();
  let total = 0;
  const errors = [];

  for (const docName of DOCS) {
    const doc = docs[docName];
    const items = doc.items ?? [];
    total += items.length;

    if (doc.count !== items.length) {
      errors.push(`${docName}: count=${doc.count} pero items.length=${items.length}`);
    }

    for (const ex of items) {
      if (!muscleSet.has(ex.parteCuerpo)) {
        errors.push(`${ex.id}: parteCuerpo inválido "${ex.parteCuerpo}"`);
      }
      if (!patternSet.has(ex.patronMovimiento)) {
        errors.push(`${ex.id}: patronMovimiento inválido "${ex.patronMovimiento}"`);
      }
      if (!Array.isArray(ex.equipo)) {
        errors.push(`${ex.id}: equipo no es array`);
      }

      if (docName === 'calentamiento' && !ex.faseRAMP && !ex.faseRamp) {
        errors.push(`${ex.id}: calentamiento sin faseRAMP`);
      }
      if (docName === 'entrenamiento' && ex.categoriaBloque == null) {
        errors.push(`${ex.id}: entrenamiento sin categoriaBloque`);
      }

      if (globalIds.has(ex.id)) {
        errors.push(`id duplicado global "${ex.id}" en ${globalIds.get(ex.id)} y ${docName}`);
      } else {
        globalIds.set(ex.id, docName);
      }

      const nameKey = normalizeNombreKey(ex.nombre);
      const nameLoc = `${docName}/${ex.id}`;
      if (globalNames.has(nameKey)) {
        errors.push(`nombre duplicado "${ex.nombre}" en ${globalNames.get(nameKey)} y ${nameLoc}`);
      } else {
        globalNames.set(nameKey, nameLoc);
      }
    }
  }

  console.log(`Total ejercicios: ${total}`);
  for (const docName of DOCS) {
    console.log(`  ${docName}: ${docs[docName].count} (updatedAt: ${docs[docName].updatedAt ?? 'n/a'})`);
  }

  if (errors.length) {
    console.error('\nVerificación FALLÓ:');
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  console.log('\n✓ Catálogo verificado correctamente.');
}

async function main() {
  const { MUSCLE_GROUPS, MOVEMENT_PATTERNS } = await import('../domain/constants.js');
  const docs = useRemote || useEmulator ? await loadRemoteDocs() : await loadLocalDocs();
  const source = useEmulator ? 'Firestore emulador' : useRemote ? 'Firestore producción' : 'archivos locales';
  console.log(`Verificando catálogo (${source})...\n`);
  await verify(docs, MUSCLE_GROUPS, MOVEMENT_PATTERNS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
