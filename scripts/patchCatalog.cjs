/**
 * Parchea documentos de catalogs/ en Firestore fusionando items por id.
 * Preserva ejercicios remotos que no estén en el archivo local.
 *
 * Uso:
 *   node scripts/patchCatalog.cjs calentamiento [--yes]
 *   node scripts/patchCatalog.cjs --all [--yes]
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CURATED_DIR = path.join(__dirname, '../colecciones/curated');
const ALL_DOCS = ['calentamiento', 'enfriamiento', 'entrenamiento'];
const useEmulator = process.argv.includes('--emulator');

function parseDocNames() {
  if (process.argv.includes('--all')) return ALL_DOCS;
  const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return names.length ? names : ['calentamiento'];
}

async function confirmPatch(docNames) {
  if (process.argv.includes('--yes')) return true;
  const target = useEmulator ? 'EMULADOR LOCAL' : 'PRODUCCIÓN';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `Parchear catalogs/{${docNames.join(',')}} en Firestore (${target}) — fusiona por id, no borra items remotos. ¿Continuar? (yes/no): `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      },
    );
  });
}

const { initFirebaseAdmin } = require('./lib/firebaseInit.cjs');

function mergeCatalogDoc(remote, local, docName) {
  const remoteItems = Array.isArray(remote?.items) ? remote.items : [];
  const localItems = Array.isArray(local?.items) ? local.items : [];
  const byId = new Map(remoteItems.map((item) => [item.id, item]));

  let updated = 0;
  let added = 0;

  for (const item of localItems) {
    if (!item?.id) continue;
    if (byId.has(item.id)) {
      byId.set(item.id, { ...byId.get(item.id), ...item });
      updated += 1;
    } else {
      byId.set(item.id, item);
      added += 1;
    }
  }

  const items = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));

  return {
    doc: {
      ...remote,
      id: docName,
      updatedAt: new Date().toISOString(),
      count: items.length,
      items,
    },
    stats: { updated, added, preserved: items.length - added, total: items.length },
  };
}

async function main() {
  const docNames = parseDocNames();
  const ok = await confirmPatch(docNames);
  if (!ok) {
    console.log('Cancelado.');
    process.exit(0);
  }

  const db = initFirebaseAdmin({ emulator: useEmulator }).firestore();

  for (const docName of docNames) {
    const filePath = path.join(CURATED_DIR, `${docName}.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`Falta ${filePath}`);
      process.exit(1);
    }

    const local = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ref = db.collection('catalogs').doc(docName);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set(local);
      console.log(`✓ catalogs/${docName} creado → ${local.count} ejercicios`);
      continue;
    }

    const { doc, stats } = mergeCatalogDoc(snap.data(), local, docName);
    await ref.set(doc);
    console.log(
      `✓ catalogs/${docName} parcheado → ${stats.total} items (+${stats.added} nuevos, ~${stats.updated} actualizados)`,
    );
  }

  console.log(`Catálogo parcheado correctamente${useEmulator ? ' (emulador)' : ''}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error al parchear catálogo:', err);
  process.exit(1);
});
