/**
 * DDS 8.4 step 6 — cooldown from enfriamiento catalog.
 * @param {object[]} cooldownCatalog — items from catalogs/enfriamiento
 * @param {string[]} sessionMuscles — muscles trained today
 * @returns {object[]}
 */
export function generateCooldown(cooldownCatalog, sessionMuscles) {
  const items = cooldownCatalog ?? [];
  const muscles = new Set((sessionMuscles ?? []).map((m) => m.toLowerCase()));

  const relevant = items.filter((ex) => {
    const bodyPart = (ex.parteCuerpo ?? '').toLowerCase();
    if (!bodyPart || bodyPart === 'general') return true;
    return [...muscles].some(
      (m) => bodyPart.includes(m) || m.includes(bodyPart),
    );
  });

  const selected = (relevant.length ? relevant : items).slice(0, 4);

  return selected.map((ex) => ({
    exerciseId: ex.id,
    name: ex.nombre,
    muscleGroup: ex.parteCuerpo ?? 'General',
    durationSeconds: 45,
    sets: 1,
    reps: '30-45s',
  }));
}
