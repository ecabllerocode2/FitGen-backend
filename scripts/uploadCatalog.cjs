/**
 * Sube el catálogo curado a Firestore de producción (3 documentos en catalogs/).
 * Requiere credenciales de Firebase Admin (GOOGLE_APPLICATION_CREDENTIALS o .env).
 *
 * Uso: node scripts/uploadCatalog.cjs [--yes]
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CURATED_DIR = path.join(__dirname, '../colecciones/curated');
const DOCS = ['calentamiento', 'enfriamiento', 'entrenamiento'];

async function confirmOverwrite() {
  if (process.argv.includes('--yes')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      '⚠️  Esto SOBREESCRIBIRÁ catalogs/{calentamiento,enfriamiento,entrenamiento} en Firestore de PRODUCCIÓN. ¿Continuar? (yes/no): ',
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      }
    );
  });
}

async function main() {
  const ok = await confirmOverwrite();
  if (!ok) {
    console.log('Cancelado.');
    process.exit(0);
  }

  // Dynamic import for ESM firebase admin from CJS script
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  for (const docName of DOCS) {
    const filePath = path.join(CURATED_DIR, `${docName}.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`Falta ${filePath}. Ejecuta primero: node scripts/curateCatalog.cjs`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    await db.collection('catalogs').doc(docName).set(data);
    console.log(`✓ catalogs/${docName} → ${data.count} ejercicios`);
  }

  console.log('Catálogo subido correctamente.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error al subir catálogo:', err);
  process.exit(1);
});
