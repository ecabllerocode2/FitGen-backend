/**
 * Surgical production catalog patch for the Aug 2026 session bugfixes.
 * Only touches known exercise IDs — does NOT overwrite whole catalog docs.
 *
 * Changes:
 *  - Bodyweight flags (equipo += Peso Corporal) for step-up, inverted row, box jumps
 *  - Vertical_Swing → singular Mancuerna
 *  - Box_Jump_Multiple_Response prioridad → 3
 *  - Move Crossover_Reverse_Lunge: enfriamiento → calentamiento/Activate
 *
 * Usage:
 *   node scripts/dev/patch-catalog-session-bugs.mjs --dry-run
 *   node scripts/dev/patch-catalog-session-bugs.mjs --yes
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const CURATED = path.join(root, 'colecciones/curated');

const dryRun = process.argv.includes('--dry-run');
const yes = process.argv.includes('--yes');

const ENTRENAMIENTO_IDS = [
  'Step-up_with_Knee_Raise',
  'Vertical_Swing',
  'Inverted_Row',
  'Box_Jump_Multiple_Response',
];
const CALENTAMIENTO_IDS = ['Front_Box_Jump', 'Lateral_Box_Jump'];
const MOVE_ID = 'Crossover_Reverse_Lunge';

function loadLocal(docName) {
  return JSON.parse(fs.readFileSync(path.join(CURATED, `${docName}.json`), 'utf8'));
}

function byId(items) {
  return new Map((items ?? []).map((ex) => [ex.id, ex]));
}

function pickPatchFields(localEx) {
  // Only copy the metadata fields we intentionally changed — keep remote extras intact.
  // Firestore rejects explicit `undefined` values.
  const raw = {
    equipo: localEx.equipo,
    isUnilateral: localEx.isUnilateral,
    categoriaBloque: localEx.categoriaBloque,
    faseRAMP: localEx.faseRAMP,
    prioridad: localEx.prioridad,
    isDynamic: localEx.isDynamic,
    descripcion: localEx.descripcion,
    nombre: localEx.nombre,
    correcciones: localEx.correcciones,
    patronMovimiento: localEx.patronMovimiento,
    parteCuerpo: localEx.parteCuerpo,
    dificultadTecnica: localEx.dificultadTecnica,
    url_img_0: localEx.url_img_0,
    url_img_1: localEx.url_img_1,
    subtipoEstimulo: localEx.subtipoEstimulo,
  };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
}

function summarizeDiff(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  for (const k of keys) {
    const a = JSON.stringify(before?.[k] ?? null);
    const b = JSON.stringify(after?.[k] ?? null);
    if (a !== b) changes.push(`${k}: ${a} → ${b}`);
  }
  return changes;
}

async function main() {
  if (!dryRun && !yes) {
    console.error('Usa --dry-run o --yes. Abortando.');
    process.exit(1);
  }

  const { initFirebaseAdmin } = require('../lib/firebaseInit.cjs');
  const db = initFirebaseAdmin().firestore();

  const localEnt = byId(loadLocal('entrenamiento').items);
  const localCal = byId(loadLocal('calentamiento').items);
  const localEnf = byId(loadLocal('enfriamiento').items);

  if (localEnf.has(MOVE_ID)) {
    throw new Error('Local enfriamiento todavía tiene Crossover_Reverse_Lunge — abort');
  }
  if (!localCal.has(MOVE_ID)) {
    throw new Error('Local calentamiento no tiene Crossover_Reverse_Lunge — abort');
  }

  const refs = {
    entrenamiento: db.collection('catalogs').doc('entrenamiento'),
    calentamiento: db.collection('catalogs').doc('calentamiento'),
    enfriamiento: db.collection('catalogs').doc('enfriamiento'),
  };

  const snaps = {};
  for (const [name, ref] of Object.entries(refs)) {
    snaps[name] = await ref.get();
    if (!snaps[name].exists) throw new Error(`Falta catalogs/${name} en producción`);
  }

  const remote = {
    entrenamiento: snaps.entrenamiento.data(),
    calentamiento: snaps.calentamiento.data(),
    enfriamiento: snaps.enfriamiento.data(),
  };

  const plan = [];

  // --- entrenamiento field patches ---
  {
    const items = [...(remote.entrenamiento.items ?? [])];
    const map = byId(items);
    for (const id of ENTRENAMIENTO_IDS) {
      const localEx = localEnt.get(id);
      const remoteEx = map.get(id);
      if (!localEx) throw new Error(`Local missing ${id}`);
      if (!remoteEx) throw new Error(`Remote entrenamiento missing ${id} — abort (no create)`);
      const patched = { ...remoteEx, ...pickPatchFields(localEx), id };
      const changes = summarizeDiff(remoteEx, patched);
      if (changes.length) {
        plan.push({ doc: 'entrenamiento', id, action: 'update', changes });
        map.set(id, patched);
      } else {
        plan.push({ doc: 'entrenamiento', id, action: 'noop', changes: [] });
      }
    }
    remote.entrenamiento.items = Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
    remote.entrenamiento.count = remote.entrenamiento.items.length;
    remote.entrenamiento.updatedAt = new Date().toISOString();
  }

  // --- calentamiento field patches + move-in ---
  {
    const items = [...(remote.calentamiento.items ?? [])];
    const map = byId(items);
    for (const id of CALENTAMIENTO_IDS) {
      const localEx = localCal.get(id);
      const remoteEx = map.get(id);
      if (!localEx) throw new Error(`Local missing ${id}`);
      if (!remoteEx) throw new Error(`Remote calentamiento missing ${id} — abort`);
      const patched = { ...remoteEx, ...pickPatchFields(localEx), id };
      const changes = summarizeDiff(remoteEx, patched);
      if (changes.length) {
        plan.push({ doc: 'calentamiento', id, action: 'update', changes });
        map.set(id, patched);
      } else {
        plan.push({ doc: 'calentamiento', id, action: 'noop', changes: [] });
      }
    }

    const localMove = localCal.get(MOVE_ID);
    const remoteMove = map.get(MOVE_ID);
    const patchedMove = remoteMove
      ? { ...remoteMove, ...pickPatchFields(localMove), id: MOVE_ID }
      : { ...localMove };
    if (!remoteMove) {
      plan.push({
        doc: 'calentamiento',
        id: MOVE_ID,
        action: 'add',
        changes: ['moved from enfriamiento → calentamiento/Activate'],
      });
    } else {
      const changes = summarizeDiff(remoteMove, patchedMove);
      plan.push({
        doc: 'calentamiento',
        id: MOVE_ID,
        action: changes.length ? 'update' : 'noop',
        changes: changes.length ? changes : ['already present'],
      });
    }
    map.set(MOVE_ID, patchedMove);

    remote.calentamiento.items = Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
    remote.calentamiento.count = remote.calentamiento.items.length;
    remote.calentamiento.updatedAt = new Date().toISOString();
  }

  // --- enfriamiento: remove moved exercise ---
  {
    const before = remote.enfriamiento.items?.length ?? 0;
    const filtered = (remote.enfriamiento.items ?? []).filter((ex) => ex.id !== MOVE_ID);
    const removed = before - filtered.length;
    if (removed) {
      plan.push({
        doc: 'enfriamiento',
        id: MOVE_ID,
        action: 'remove',
        changes: [`removed from cooldown (${removed})`],
      });
    } else {
      plan.push({
        doc: 'enfriamiento',
        id: MOVE_ID,
        action: 'noop',
        changes: ['already absent'],
      });
    }
    remote.enfriamiento.items = filtered.sort((a, b) => a.id.localeCompare(b.id));
    remote.enfriamiento.count = remote.enfriamiento.items.length;
    remote.enfriamiento.updatedAt = new Date().toISOString();
  }

  console.log('\nPlan de parche quirúrgico (producción):');
  for (const step of plan) {
    console.log(`  [${step.action}] ${step.doc}/${step.id}`);
    for (const c of step.changes.slice(0, 8)) console.log(`      - ${c}`);
  }

  // Safety asserts before write
  const entMap = byId(remote.entrenamiento.items);
  const calMap = byId(remote.calentamiento.items);
  const enfMap = byId(remote.enfriamiento.items);

  const assertBw = (ex, label) => {
    if (!ex) throw new Error(`Safety: missing ${label}`);
    if (!/peso corporal|bodyweight|corporal/i.test((ex.equipo ?? []).join(' '))) {
      throw new Error(`Safety: ${label} not bodyweight after patch`);
    }
  };
  assertBw(entMap.get('Step-up_with_Knee_Raise'), 'Step-up');
  assertBw(entMap.get('Inverted_Row'), 'Inverted_Row');
  assertBw(entMap.get('Box_Jump_Multiple_Response'), 'Box_Jump');
  assertBw(calMap.get('Front_Box_Jump'), 'Front_Box_Jump');
  assertBw(calMap.get('Lateral_Box_Jump'), 'Lateral_Box_Jump');

  const swing = entMap.get('Vertical_Swing');
  if (!swing || /mancuernas/i.test((swing.equipo ?? []).join(' ')) || !/mancuerna/i.test((swing.equipo ?? []).join(' '))) {
    throw new Error(`Safety: Vertical_Swing equipo bad: ${JSON.stringify(swing?.equipo)}`);
  }
  if (!calMap.has(MOVE_ID) || calMap.get(MOVE_ID).faseRAMP !== 'Activate') {
    throw new Error('Safety: Crossover not in calentamiento/Activate');
  }
  if (enfMap.has(MOVE_ID)) {
    throw new Error('Safety: Crossover still in enfriamiento');
  }

  // Preserve counts roughly — entrenamiento size must not shrink
  const origEnt = snaps.entrenamiento.data().items.length;
  const origCal = snaps.calentamiento.data().items.length;
  const origEnf = snaps.enfriamiento.data().items.length;
  if (remote.entrenamiento.items.length < origEnt) {
    throw new Error(`Safety: entrenamiento shrank ${origEnt} → ${remote.entrenamiento.items.length}`);
  }
  if (remote.calentamiento.items.length < origCal) {
    throw new Error(`Safety: calentamiento shrank ${origCal} → ${remote.calentamiento.items.length}`);
  }
  // enfriamiento should be orig or orig-1 (if crossover removed)
  if (remote.enfriamiento.items.length < origEnf - 1) {
    throw new Error(`Safety: enfriamiento shrank too much ${origEnf} → ${remote.enfriamiento.items.length}`);
  }

  console.log('\nCounts:');
  console.log(`  entrenamiento ${origEnt} → ${remote.entrenamiento.items.length}`);
  console.log(`  calentamiento ${origCal} → ${remote.calentamiento.items.length}`);
  console.log(`  enfriamiento  ${origEnf} → ${remote.enfriamiento.items.length}`);

  if (dryRun) {
    console.log('\nDry-run OK — no writes.');
    return;
  }

  function stripUndefined(value) {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, stripUndefined(v)]),
      );
    }
    return value;
  }

  // Write in a batch for atomicity across the 3 docs
  const batch = db.batch();
  batch.set(refs.entrenamiento, stripUndefined(remote.entrenamiento));
  batch.set(refs.calentamiento, stripUndefined(remote.calentamiento));
  batch.set(refs.enfriamiento, stripUndefined(remote.enfriamiento));
  await batch.commit();

  console.log('\n✓ Parche quirúrgico aplicado en producción.');

  // Re-read verification
  const after = {};
  for (const [name, ref] of Object.entries(refs)) {
    after[name] = (await ref.get()).data();
  }
  const aEnt = byId(after.entrenamiento.items);
  const aCal = byId(after.calentamiento.items);
  const aEnf = byId(after.enfriamiento.items);
  console.log('\nVerificación remota post-write:');
  console.log('  Step-up equipo:', aEnt.get('Step-up_with_Knee_Raise')?.equipo);
  console.log('  Inverted_Row equipo:', aEnt.get('Inverted_Row')?.equipo);
  console.log('  Box_Jump equipo/prio:', aEnt.get('Box_Jump_Multiple_Response')?.equipo, aEnt.get('Box_Jump_Multiple_Response')?.prioridad);
  console.log('  Vertical_Swing equipo:', aEnt.get('Vertical_Swing')?.equipo);
  console.log('  Front_Box_Jump equipo:', aCal.get('Front_Box_Jump')?.equipo);
  console.log('  Crossover in cal:', aCal.get(MOVE_ID)?.faseRAMP, aCal.get(MOVE_ID)?.categoriaBloque);
  console.log('  Crossover in enf:', aEnf.has(MOVE_ID));
  console.log('  counts:', {
    calentamiento: after.calentamiento.count,
    enfriamiento: after.enfriamiento.count,
    entrenamiento: after.entrenamiento.count,
  });
}

main().catch((err) => {
  console.error('ERROR:', err.message || err);
  process.exit(1);
});
