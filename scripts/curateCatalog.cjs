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

function normalizeEquipo(equipo) {
  if (Array.isArray(equipo)) return equipo;
  if (typeof equipo === 'string' && equipo.trim()) return [equipo];
  return ['Peso Corporal'];
}

function isGymViable(exercise) {
  const equipo = normalizeEquipo(exercise.equipo);
  // Calentamiento y enfriamiento: conservar si tienen sentido fisiológico (no filtrar por equipo)
  if (exercise.categoriaBloque === 'calentamiento' || exercise.categoriaBloque === 'enfriamiento') {
    return true;
  }
  // main_block y core: al menos un equipo debe ser de gimnasio
  return equipo.some((e) => GYM_EQUIPMENT.has(e));
}

function curateExercise(raw) {
  const exercise = { ...raw, equipo: normalizeEquipo(raw.equipo) };
  for (const field of REQUIRED_FIELDS) {
    if (exercise[field] === undefined || exercise[field] === null || exercise[field] === '') {
      return null;
    }
  }
  if (!isGymViable(exercise)) return null;
  return exercise;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const items = Array.isArray(raw) ? raw : raw.items || [];

  const curated = items.map(curateExercise).filter(Boolean);

  const calentamiento = curated.filter((e) => e.categoriaBloque === 'calentamiento');
  const enfriamiento = curated.filter((e) => e.categoriaBloque === 'enfriamiento');
  const entrenamiento = curated.filter((e) =>
    e.categoriaBloque === 'main_block' || e.categoriaBloque === 'core'
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const writeDoc = (name, items) => {
    const doc = {
      id: name,
      updatedAt: new Date().toISOString(),
      count: items.length,
      items,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(doc, null, 2));
  };

  writeDoc('calentamiento', calentamiento);
  writeDoc('enfriamiento', enfriamiento);
  writeDoc('entrenamiento', entrenamiento);

  // Actualizar fuente única depurada
  fs.writeFileSync(
    path.join(__dirname, '../colecciones/ejercicios-gym.json'),
    JSON.stringify(curated, null, 2)
  );

  console.log('Curación completada:');
  console.log(`  Original: ${items.length}`);
  console.log(`  Curado:   ${curated.length}`);
  console.log(`  calentamiento: ${calentamiento.length}`);
  console.log(`  enfriamiento:  ${enfriamiento.length}`);
  console.log(`  entrenamiento: ${entrenamiento.length}`);
  console.log(`  Salida: ${OUT_DIR}`);
}

main();
