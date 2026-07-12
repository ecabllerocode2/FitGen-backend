/**
 * Curación del catálogo de ejercicios para gimnasio comercial (DDS §6.5).
 * Genera 3 archivos JSON listos para subir a Firestore.
 *
 * Uso: node scripts/curateCatalog.cjs
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '../colecciones/ejercicios-actualizados.json');
const OUT_DIR = path.join(__dirname, '../colecciones/curated');

/** Equipo disponible en gimnasio comercial estándar */
const GYM_EQUIPMENT = new Set([
  'Peso Corporal', 'Barra Olímpica', 'Mancuernas', 'Banco Ajustable', 'Poleas', 'Polea Alta',
  'Rack de Potencia', 'Prensa de Piernas', 'Máquina de Extensión de Piernas',
  'Máquina de Curl de Piernas', 'Smith Machine', 'Barra de Dominadas', 'Kettlebell',
  'Cajón Pliométrico', 'Bandas de Resistencia', 'Mini Loop Bands', 'Foam Roller',
  'Caminadora', 'Bicicleta Estática', 'Escaladora', 'Máquina Elíptica', 'Barra EZ',
  'Máquina de Aperturas Inversas', 'Máquina de Hombros', 'Máquina de abducción',
  'Máquina de aducción', 'Suspension Straps', 'Disco',
]);

const REQUIRED_FIELDS = ['id', 'nombre', 'categoriaBloque', 'patronMovimiento', 'parteCuerpo', 'prioridad'];

/** Aliases conocidos → enum canónico de domain/constants.js */
const PARTE_CUERPO_ALIASES = {
  Hombros: 'Hombro',
};

/** Renombres explícitos de id para colisiones conocidas */
const KNOWN_ID_RENAMES = {
  // calentamiento: encogimientos vs elevación en smith (entrenamiento)
  'Shoulder_Raise@calentamiento': 'Shoulder_Shrug',
  // segundo Box_Squat duplicado (bandas inversas)
  'Box_Squat@Sentadilla a Cajón con Bandas Inversas': 'Box_Squat_Bands',
};

function normalizeEquipo(equipo) {
  if (Array.isArray(equipo)) return equipo;
  if (typeof equipo === 'string' && equipo.trim()) return [equipo];
  return ['Peso Corporal'];
}

function normalizeNombreKey(nombre) {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function fixFieldTypos(exercise) {
  if (exercise.dificultarTecnica != null && exercise.dificultadTecnica == null) {
    exercise.dificultadTecnica = exercise.dificultarTecnica;
    delete exercise.dificultarTecnica;
  }
  return exercise;
}

function normalizeParteCuerpo(parteCuerpo) {
  return PARTE_CUERPO_ALIASES[parteCuerpo] ?? parteCuerpo;
}

function completenessScore(exercise) {
  let score = 0;
  if (exercise.descripcion) score += exercise.descripcion.length;
  if (Array.isArray(exercise.correcciones) && exercise.correcciones.length) score += 50;
  if (exercise.url_img_0) score += 25;
  if (exercise.url_img_1) score += 25;
  if (exercise.dificultadTecnica) score += 5;
  return score;
}

function isGymViable(exercise) {
  const equipo = normalizeEquipo(exercise.equipo);
  if (exercise.categoriaBloque === 'calentamiento' || exercise.categoriaBloque === 'enfriamiento') {
    return true;
  }
  return equipo.some((e) => GYM_EQUIPMENT.has(e));
}

/** Combinaciones válidas patrón ↔ músculo (incluye sinergistas reales) */
const ALLOWED_MUSCLES_BY_PATTERN = {
  Empuje_H: new Set(['Pecho', 'Tríceps', 'Hombro']),
  Empuje_V: new Set(['Hombro', 'Tríceps', 'Pecho']),
  Traccion_H: new Set(['Espalda', 'Bíceps', 'Hombro', 'Pecho']),
  Traccion_V: new Set(['Espalda', 'Bíceps', 'Hombro', 'Pecho']),
  Rodilla: new Set(['Cuádriceps', 'Glúteos', 'Core', 'Pantorrillas']),
  Cadera: new Set(['Isquiotibiales', 'Glúteos', 'Espalda', 'Cuádriceps', 'Core', 'Hombro']),
  Core: new Set(['Core']),
  General: null,
};

const PRIMARY_MUSCLE_BY_PATTERN = {
  Empuje_H: 'Pecho',
  Empuje_V: 'Hombro',
  Traccion_H: 'Espalda',
  Traccion_V: 'Espalda',
  Rodilla: 'Cuádriceps',
  Cadera: 'Isquiotibiales',
  Core: 'Core',
};

/** Correcciones explícitas de patrón por id o heurística de nombre */
function normalizeMovementPattern(exercise) {
  const name = String(exercise.nombre ?? '').toLowerCase();

  if (/elevaci[oó]n lateral|lateral raise|front raise|upright row|remo al ment[oó]n/i.test(name)) {
    if (exercise.patronMovimiento === 'Traccion_V' || exercise.patronMovimiento === 'Traccion_H') {
      return 'Empuje_V';
    }
  }

  if (/pullover/i.test(name) && exercise.parteCuerpo === 'Pecho') {
    return 'Empuje_V';
  }

  if (/face pull|rear delt|delt posterior|p[aá]jaros/i.test(name) && exercise.parteCuerpo === 'Hombro') {
    return 'Traccion_H';
  }

  if (/curl de muñeca|wrist curl|muñeca prono|muñeca supino/i.test(name)) {
    return 'General';
  }

  if (/gemelo|pantorrilla|calf raise|elevaci[oó]n.*tal[oó]n|prensa de pantorrilla/i.test(name)) {
    return 'Rodilla';
  }

  return exercise.patronMovimiento;
}

function normalizeSemantics(exercise) {
  exercise.patronMovimiento = normalizeMovementPattern(exercise);

  if (exercise.categoriaBloque === 'calentamiento' && !exercise.faseRAMP && !exercise.faseRamp) {
    exercise.faseRAMP = 'Raise';
  }

  const name = String(exercise.nombre ?? '').toLowerCase();

  if (/curl de muñeca|wrist curl|muñeca prono|muñeca supino/i.test(name)) {
    return null;
  }

  const allowed = ALLOWED_MUSCLES_BY_PATTERN[exercise.patronMovimiento];
  if (allowed && !allowed.has(exercise.parteCuerpo)) {
    exercise.parteCuerpo =
      PRIMARY_MUSCLE_BY_PATTERN[exercise.patronMovimiento] ?? exercise.parteCuerpo;
  }

  if (
    exercise.parteCuerpo === 'Pantorrillas' &&
    !/gemelo|pantorrilla|calf|tal[oó]n|soleus|elevaci[oó]n.*tal[oó]n/i.test(name)
  ) {
    exercise.parteCuerpo = PRIMARY_MUSCLE_BY_PATTERN[exercise.patronMovimiento] ?? exercise.parteCuerpo;
  }

  return exercise;
}

function curateExercise(raw) {
  let exercise = { ...raw, equipo: normalizeEquipo(raw.equipo) };
  exercise = fixFieldTypos(exercise);
  exercise.parteCuerpo = normalizeParteCuerpo(exercise.parteCuerpo);
  exercise = normalizeSemantics(exercise);
  if (!exercise) return null;

  for (const field of REQUIRED_FIELDS) {
    if (exercise[field] === undefined || exercise[field] === null || exercise[field] === '') {
      return null;
    }
  }
  if (!isGymViable(exercise)) return null;
  return exercise;
}

function deduplicateByNombre(items) {
  const byName = new Map();
  const removed = [];

  for (const ex of items) {
    const key = normalizeNombreKey(ex.nombre);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, ex);
      continue;
    }
    if (completenessScore(ex) > completenessScore(existing)) {
      removed.push(existing);
      byName.set(key, ex);
    } else {
      removed.push(ex);
    }
  }

  if (removed.length) {
    console.log(`  Deduplicados por nombre: ${removed.length} ejercicios descartados`);
    for (const ex of removed) {
      console.log(`    - ${ex.nombre} (${ex.id})`);
    }
  }

  return [...byName.values()];
}

function applyKnownIdRenames(exercise) {
  const calKey = `${exercise.id}@${exercise.categoriaBloque}`;
  if (exercise.categoriaBloque === 'calentamiento' && KNOWN_ID_RENAMES['Shoulder_Raise@calentamiento'] && exercise.id === 'Shoulder_Raise') {
    exercise.id = KNOWN_ID_RENAMES['Shoulder_Raise@calentamiento'];
    return exercise;
  }
  const nameKey = `${exercise.id}@${exercise.nombre}`;
  if (KNOWN_ID_RENAMES[nameKey]) {
    exercise.id = KNOWN_ID_RENAMES[nameKey];
  }
  return exercise;
}

function ensureUniqueIds(items) {
  const seen = new Map();
  const renamed = [];

  for (const ex of items) {
    applyKnownIdRenames(ex);

    if (!seen.has(ex.id)) {
      seen.set(ex.id, ex);
      continue;
    }

    const existing = seen.get(ex.id);
    let suffix = 2;
    let newId = `${ex.id}_${suffix}`;
    while (seen.has(newId)) {
      suffix += 1;
      newId = `${ex.id}_${suffix}`;
    }
    console.warn(`  Colisión de id "${ex.id}": renombrando "${ex.nombre}" → ${newId}`);
    ex.id = newId;
    renamed.push(ex);
    seen.set(ex.id, ex);
    void existing;
  }

  return items;
}

function validateEnums(items, muscleGroups, movementPatterns) {
  const muscleSet = new Set(muscleGroups);
  const patternSet = new Set(movementPatterns);
  const errors = [];

  for (const ex of items) {
    if (!muscleSet.has(ex.parteCuerpo)) {
      errors.push(`${ex.id}: parteCuerpo inválido "${ex.parteCuerpo}"`);
    }
    if (!patternSet.has(ex.patronMovimiento)) {
      errors.push(`${ex.id}: patronMovimiento inválido "${ex.patronMovimiento}"`);
    }
  }

  if (errors.length) {
    console.error('Validación de enums falló:');
    for (const err of errors.slice(0, 20)) console.error(`  - ${err}`);
    if (errors.length > 20) console.error(`  ... y ${errors.length - 20} más`);
    process.exit(1);
  }
}

async function main() {
  const { MUSCLE_GROUPS, MOVEMENT_PATTERNS } = await import('../domain/constants.js');

  const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const sourceItems = Array.isArray(raw) ? raw : raw.items || [];

  let curated = sourceItems.map(curateExercise).filter(Boolean);
  console.log(`Curación base: ${sourceItems.length} → ${curated.length}`);

  curated = deduplicateByNombre(curated);
  curated = ensureUniqueIds(curated);
  validateEnums(curated, MUSCLE_GROUPS, MOVEMENT_PATTERNS);

  const calentamiento = curated.filter((e) => e.categoriaBloque === 'calentamiento');
  const enfriamiento = curated.filter((e) => e.categoriaBloque === 'enfriamiento');
  const entrenamiento = curated.filter((e) =>
    e.categoriaBloque === 'main_block' || e.categoriaBloque === 'core'
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const writeDoc = (name, docItems) => {
    const doc = {
      id: name,
      updatedAt: new Date().toISOString(),
      count: docItems.length,
      items: docItems,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(doc, null, 2));
  };

  writeDoc('calentamiento', calentamiento);
  writeDoc('enfriamiento', enfriamiento);
  writeDoc('entrenamiento', entrenamiento);

  fs.writeFileSync(
    path.join(__dirname, '../colecciones/ejercicios-gym.json'),
    JSON.stringify(curated, null, 2)
  );

  console.log('\nCuración completada:');
  console.log(`  Original: ${sourceItems.length}`);
  console.log(`  Curado:   ${curated.length}`);
  console.log(`  calentamiento: ${calentamiento.length}`);
  console.log(`  enfriamiento:  ${enfriamiento.length}`);
  console.log(`  entrenamiento: ${entrenamiento.length}`);
  console.log(`  Salida: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
