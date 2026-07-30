/**
 * DDS 8.4 step 6 — cooldown from enfriamiento catalog.
 * @param {object[]} cooldownCatalog — items from catalogs/enfriamiento
 * @param {string[]} sessionMuscles — muscles trained today
 * @returns {object[]}
 */

const SIDE_SWITCH_REST_SECONDS = 5;

function prescribeCooldownDose(ex) {
  const unilateral = ex.isUnilateral === true;
  if (unilateral) {
    const perSideSec = 45;
    return {
      durationSeconds: perSideSec * 2,
      perSideSeconds: perSideSec,
      sideSwitchRestSeconds: SIDE_SWITCH_REST_SECONDS,
      reps: `${perSideSec}s por lado`,
      isUnilateral: true,
      unilateralCue: 'Primero un lado, luego el otro.',
    };
  }
  return {
    durationSeconds: 45,
    perSideSeconds: null,
    sideSwitchRestSeconds: null,
    reps: '30-45s',
    isUnilateral: false,
    unilateralCue: null,
  };
}

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

  return selected.map((ex) => {
    const dose = prescribeCooldownDose(ex);
    return {
      exerciseId: ex.id,
      id: ex.id,
      name: ex.nombre,
      nombre: ex.nombre,
      muscleGroup: ex.parteCuerpo ?? 'General',
      durationSeconds: dose.durationSeconds,
      perSideSeconds: dose.perSideSeconds,
      sideSwitchRestSeconds: dose.sideSwitchRestSeconds,
      sets: 1,
      reps: dose.reps,
      tiempo: `${dose.durationSeconds}s`,
      duracion: `${dose.durationSeconds} seg`,
      isUnilateral: dose.isUnilateral,
      unilateralCue: dose.unilateralCue,
      instrucciones: dose.unilateralCue
        ? `${ex.descripcion ?? ''}${ex.descripcion ? ' ' : ''}${dose.unilateralCue}`.trim()
        : ex.descripcion,
      descripcion: ex.descripcion,
      imageUrl: ex.url_img_0 ?? null,
      imageUrl2: ex.url_img_1 ?? null,
    };
  });
}
