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
 * Always backfills missing url_img_* from local curated files by exercise id.
 */
export async function loadCatalog(db) {
  if (!db) {
    return loadCatalogFromDisk();
  }

  if (typeof db.getCatalog === 'function') {
    const remote = await db.getCatalog();
    return enrichCatalogWithLocalImages(remote);
  }

  const results = {};

  for (const [key, docId] of Object.entries(CATALOG_DOC_IDS)) {
    const doc = await fetchCatalogDoc(db, docId);
    const items = normalizeItems(doc);
    results[key] = items.length ? items : loadLocalDoc(docId);
  }

  return enrichCatalogWithLocalImages(results);
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

/**
 * Firestore entrenamiento docs sometimes lack media fields (or were uploaded without them).
 * Local curated JSON is the source of truth for url_img_0/1.
 */
function enrichCatalogWithLocalImages(catalog = {}) {
  const enriched = { ...catalog };
  for (const docId of Object.values(CATALOG_DOC_IDS)) {
    const remoteItems = Array.isArray(enriched[docId]) ? enriched[docId] : [];
    const localById = new Map(
      loadLocalDoc(docId)
        .filter((ex) => ex?.id)
        .map((ex) => [String(ex.id), ex]),
    );
    if (!localById.size) {
      enriched[docId] = remoteItems;
      continue;
    }
    if (!remoteItems.length) {
      enriched[docId] = [...localById.values()];
      continue;
    }

    let repaired = 0;
    enriched[docId] = remoteItems.map((ex) => {
      const local = localById.get(String(ex.id));
      if (!local) return ex;
      const needs0 = !stringOrNull(ex.url_img_0) && !stringOrNull(ex.imageUrl);
      const needs1 = !stringOrNull(ex.url_img_1) && !stringOrNull(ex.imageUrl2);
      const needsDescription = !stringOrNull(ex.descripcion) && !stringOrNull(ex.instrucciones);
      const needsCorrecciones = !Array.isArray(ex.correcciones) || ex.correcciones.length === 0;
      if (!needs0 && !needs1 && !needsDescription && !needsCorrecciones) return ex;
      repaired += 1;
      return {
        ...ex,
        descripcion: stringOrNull(ex.descripcion) || stringOrNull(local.descripcion) || null,
        instrucciones:
          stringOrNull(ex.instrucciones)
          || stringOrNull(ex.descripcion)
          || stringOrNull(local.instrucciones)
          || stringOrNull(local.descripcion)
          || null,
        correcciones:
          Array.isArray(ex.correcciones) && ex.correcciones.length
            ? ex.correcciones
            : Array.isArray(local.correcciones)
              ? local.correcciones
              : [],
        url_img_0: stringOrNull(ex.url_img_0) || stringOrNull(ex.imageUrl) || local.url_img_0 || null,
        url_img_1: stringOrNull(ex.url_img_1) || stringOrNull(ex.imageUrl2) || local.url_img_1 || null,
        imageUrl: stringOrNull(ex.imageUrl) || stringOrNull(ex.url_img_0) || local.url_img_0 || null,
        imageUrl2: stringOrNull(ex.imageUrl2) || stringOrNull(ex.url_img_1) || local.url_img_1 || null,
      };
    });
    if (repaired > 0) {
      console.info(`[catalog] repaired media fields for ${repaired} ${docId} exercises from local curated JSON`);
    }
  }
  return enriched;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
