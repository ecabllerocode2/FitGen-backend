const RAMP_PHASES = ['Raise', 'Activate', 'Mobilize', 'Potentiate'];

/**
 * DDS 8.4 step 6 — RAMP warmup from calentamiento catalog.
 * @param {string[]} patterns — movement patterns for today's session
 * @param {object[]} warmupCatalog — items from catalogs/calentamiento
 * @returns {object[]}
 */
export function generateWarmup(patterns, warmupCatalog) {
  const items = warmupCatalog ?? [];
  const warmup = [];

  for (const phase of RAMP_PHASES) {
    const phaseItems = items.filter((ex) => {
      const exPhase = ex.faseRAMP ?? ex.faseRamp;
      if (exPhase && exPhase !== phase) return false;
      if (!patterns?.length) return true;
      const pattern = ex.patronMovimiento ?? 'General';
      return pattern === 'General' || patterns.includes(pattern);
    });

    const pick = phaseItems.slice(0, 2).map((ex) => ({
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

  if (!warmup.length && items.length) {
    return items.slice(0, 4).map((ex) => ({
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
