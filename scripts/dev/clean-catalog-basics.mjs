#!/usr/bin/env node
/**
 * Demote niche / high-difficulty exercises so auto-select prefers gym staples.
 * Run: node scripts/dev/clean-catalog-basics.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, '../../colecciones/curated/entrenamiento.json');

const NICHE_PATTERN =
  /one.?arm|single.?arm|handstand|pistol|plyo|olympic|snatch|clean|jerk|clock|renegade|guillotine|depth.?jump|windmill|turkish|deficit|chain|band bench|pin press|muscle snatch|jump squat|spider crawl|side plank|kipping|muscle.up|planche/i;

const STAPLE_IDS = new Set([
  'Barbell_Bench_Press_-_Medium_Grip',
  'Pushups',
  'Push-Up_Wide',
  'Dumbbell_Bench_Press',
  'Incline_Dumbbell_Press',
  'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'Cable_Crossover',
  'Dumbbell_Flyes',
  'Bent_Over_Barbell_Row',
  'Bent_Over_Two-Dumbbell_Row',
  'Lat_Pulldown',
  'Seated_Cable_Rows',
  'Pullups',
  'Chin-Up',
  'Barbell_Squat',
  'Leg_Press',
  'Romanian_Deadlift',
  'Lying_Leg_Curls',
  'Leg_Extensions',
  'Barbell_Deadlift',
  'Barbell_Shoulder_Press',
  'Dumbbell_Shoulder_Press',
  'Lateral_Raise',
  'Face_Pull',
  'Rear_Delt_Fly',
  'Triceps_Pushdown',
  'Cable_Rope_Overhead_Triceps_Extension',
  'Barbell_Curl',
  'Dumbbell_Bicep_Curl',
  'Standing_Calf_Raises',
  'Barbell_Hip_Thrust',
]);

const data = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
let demoted = 0;
let keptP1 = 0;

for (const ex of data.items) {
  if (ex.categoriaBloque !== 'main_block') continue;
  if (ex.prioridad !== 1) continue;

  const text = `${ex.id} ${ex.nombre}`;
  const isNiche = ex.dificultadTecnica === 'Alta' || NICHE_PATTERN.test(text);
  const isStaple = STAPLE_IDS.has(ex.id);

  if (isStaple) {
    keptP1 += 1;
    if (ex.dificultadTecnica === 'Alta') {
      ex.dificultadTecnica = 'Media';
    }
    continue;
  }

  if (isNiche) {
    ex.prioridad = ex.prioridad === 1 ? 2 : ex.prioridad;
    demoted += 1;
  }
}

data.updatedAt = new Date().toISOString();
fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Catalog cleanup: demoted ${demoted} niche p1 exercises, kept ${keptP1} staples at p1.`);
