/**
 * Sube el catálogo curado a Firestore (3 documentos en catalogs/).
 * Requiere credenciales de Firebase Admin (FIREBASE_SERVICE_ACCOUNT o GOOGLE_APPLICATION_CREDENTIALS).
 *
 * Uso:
 *   node scripts/uploadCatalog.cjs [--yes]
 *   node scripts/uploadCatalog.cjs --emulator [--yes]
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CURATED_DIR = path.join(__dirname, '../colecciones/curated');
const DOCS = ['calentamiento', 'enfriamiento', 'entrenamiento'];
const useEmulator = process.argv.includes('--emulator');

async function confirmOverwrite() {
  if (process.argv.includes('--yes')) return true;
  const target = useEmulator ? 'EMULADOR LOCAL' : 'PRODUCCIÓN';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `⚠️  Esto SOBREESCRIBIRÁ catalogs/{calentamiento,enfriamiento,entrenamiento} en Firestore (${target}). ¿Continuar? (yes/no): `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      },
    );
  });
}

const { initFirebaseAdmin } = require('./lib/firebaseInit.cjs');

function getFirestore() {
  const admin = initFirebaseAdmin({ emulator: useEmulator });
  return admin.firestore();
}

async function main() {
  const ok = await confirmOverwrite();
  if (!ok) {
    console.log('Cancelado.');
    process.exit(0);
  }

  const db = getFirestore();

  for (const docName of DOCS) {
    const filePath = path.join(CURATED_DIR, `${docName}.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`Falta ${filePath}. Ejecuta primero: npm run curate-catalog`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    await db.collection('catalogs').doc(docName).set(data);
    console.log(`✓ catalogs/${docName} → ${data.count} ejercicios`);
  }

  console.log(`Catálogo subido correctamente${useEmulator ? ' (emulador)' : ''}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error al subir catálogo:', err);
  process.exit(1);
});
