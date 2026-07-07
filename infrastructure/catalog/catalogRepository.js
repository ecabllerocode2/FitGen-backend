import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = path.join(__dirname, '../../colecciones/curated');

const CATALOG_DOC_IDS = {
  calentamiento: 'calentamiento',
  enfriamiento: 'enfriamiento',
  entrenamiento: 'entrenamiento',
};

/**
 * Load the 3 Firestore catalog documents (DDS 6.5).
 * Falls back to local curated JSON if Firestore doc missing.
 */
export async function loadCatalog(db) {
  if (!db) {
    return loadCatalogFromDisk();
  }

  if (typeof db.getCatalog === 'function') {
    return db.getCatalog();
  }

  const results = {};

  for (const [key, docId] of Object.entries(CATALOG_DOC_IDS)) {
    const doc = await fetchCatalogDoc(db, docId);
    const items = normalizeItems(doc);
    results[key] = items.length ? items : loadLocalDoc(docId);
  }

  return results;
}

export function loadCatalogFromDisk() {
  const results = {};
  for (const docId of Object.values(CATALOG_DOC_IDS)) {
    results[docId] = loadLocalDoc(docId);
  }
  return Promise.resolve(results);
}

function loadLocalDoc(docId) {
  const filePath = path.join(CURATED_DIR, `${docId}.json`);
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return normalizeItems(data);
}

async function fetchCatalogDoc(db, docId) {
  if (typeof db.collection === 'function') {
    const snap = await db.collection('catalogs').doc(docId).get();
    if (!snap.exists) return { items: [] };
    return snap.data();
  }

  if (typeof db.doc === 'function') {
    const snap = await db.doc(`catalogs/${docId}`).get();
    if (snap.exists === false || (snap.exists && !snap.data)) return { items: [] };
    return typeof snap.data === 'function' ? snap.data() : snap;
  }

  throw new Error('Unsupported db interface for loadCatalog');
}

function normalizeItems(doc) {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc;
  if (Array.isArray(doc.items)) return doc.items;
  return [];
}

export { CATALOG_DOC_IDS };
