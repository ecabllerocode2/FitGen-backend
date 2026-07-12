const RAMP_PHASES = ['Raise', 'Activate', 'Mobilize', 'Potentiate'];

const CARDIO_EQUIPMENT =
  /caminadora|bicicleta|el[ií]ptica|escaladora|elliptical|treadmill/i;

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) % 100000;
  }
  return h;
}

function pickRotated(items, count, seed) {
  if (!items.length) return [];
  const start = seed % items.length;
  const picked = [];
  for (let i = 0; i < Math.min(count, items.length); i += 1) {
    picked.push(items[(start + i) % items.length]);
  }
  return picked;
}

function warmupMatchesSession(ex, phase, patterns, sessionMuscles) {
  const pattern = ex.patronMovimiento ?? 'General';
  const muscle = ex.parteCuerpo;
  const equipo = Array.isArray(ex.equipo) ? ex.equipo.join(' ') : String(ex.equipo ?? '');

  if (patterns?.includes(pattern)) return true;

  if (pattern !== 'General') return false;

  if (phase === 'Raise' && CARDIO_EQUIPMENT.test(equipo)) return true;

  if (!sessionMuscles?.length) return phase === 'Raise';

  return Boolean(muscle && sessionMuscles.includes(muscle));
}

/**
 * DDS 8.4 step 6 — RAMP warmup from calentamiento catalog.
 * @param {string[]} patterns — movement patterns for today's session
 * @param {object[]} warmupCatalog — items from catalogs/calentamiento
 * @param {object} [options]
 * @param {number} [options.weekNumber=1]
 * @param {string} [options.sessionFocus='']
 * @param {string[]} [options.sessionMuscles=[]]
 * @param {string[]} [options.prehab=[]] — injury prehab movement patterns
 * @returns {object[]}
 */
export function generateWarmup(patterns, warmupCatalog, options = {}) {
  const { weekNumber = 1, sessionFocus = '', sessionMuscles = [], prehab = [] } = options;
  const items = warmupCatalog ?? [];
  const warmup = [];
  const seed = hashSeed(`${weekNumber}-${sessionFocus}`);

  for (const phase of RAMP_PHASES) {
    const phaseItems = items.filter((ex) => {
      const exPhase = ex.faseRAMP ?? ex.faseRamp;
      if (exPhase && exPhase !== phase) return false;
      if (!patterns?.length) return true;
      return warmupMatchesSession(ex, phase, patterns, sessionMuscles);
    });

    const pick = pickRotated(phaseItems, 1, seed + phase.length).map((ex) => ({
      exerciseId: ex.id,
      name: ex.nombre,
      phase,
      movementPattern: ex.patronMovimiento ?? 'General',
      durationSeconds: phase === 'Raise' ? 60 : 45,
      sets: 1,
      reps: ex.reps ?? '30s',
    }));

    warmup.push(...pick);
  }

  if (prehab.length) {
    const prehabItems = items.filter((ex) =>
      prehab.includes(ex.patronMovimiento ?? 'General'),
    );
    const prehabPick = pickRotated(prehabItems, 2, seed + 99).map((ex) => ({
      exerciseId: ex.id,
      name: ex.nombre,
      phase: 'Prehab',
      movementPattern: ex.patronMovimiento ?? 'General',
      durationSeconds: 45,
      sets: 1,
      reps: ex.reps ?? '12-15',
      isPrehab: true,
    }));
    warmup.push(...prehabPick);
  }

  if (!warmup.length && items.length) {
    return pickRotated(items, 4, seed).map((ex) => ({
      exerciseId: ex.id,
      name: ex.nombre,
      phase: ex.faseRAMP ?? 'General',
      movementPattern: ex.patronMovimiento ?? 'General',
      durationSeconds: 45,
      sets: 1,
      reps: '30s',
    }));
  }

  return warmup;
}
