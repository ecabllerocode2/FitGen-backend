const CARDIO_MACHINE = /caminadora|treadmill|bicicleta|el[ií]ptica|escaladora|elliptical|rowing/i;
const WALKING = /caminata en cinta|caminata en treadmill|incline walk/i;
const JOGGING = /trote|jogging|carrera/i;
const NOT_LISS = /monstruo|araña|spider|monster|crawl|bear crawl|saltos|jump/i;

function labelText(ex) {
  return `${ex.nombre ?? ''} ${ex.descripcion ?? ''}`.toLowerCase();
}

function isWalkingCardio(ex) {
  return WALKING.test(labelText(ex)) || /caminata en cinta/i.test(ex.nombre ?? '');
}

function isLowImpactCardio(ex) {
  if (NOT_LISS.test(labelText(ex))) return false;
  if (JOGGING.test(labelText(ex))) return false;
  return isWalkingCardio(ex) || CARDIO_MACHINE.test(labelText(ex));
}

function pickLissExercise(catalog = [], sessionFocus = '') {
  const pool = catalog.filter(isLowImpactCardio);
  const walking = pool.filter(isWalkingCardio);
  const legDay = /pierna|legs|lower/i.test(sessionFocus);

  const ranked = [...(walking.length ? walking : pool)].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;
    if (isWalkingCardio(a)) scoreA += 10;
    if (isWalkingCardio(b)) scoreB += 10;
    if (/inclin/i.test(labelText(a))) scoreA += 3;
    if (/inclin/i.test(labelText(b))) scoreB += 3;
    if (legDay && /bicicleta|bike/i.test(labelText(a))) scoreA += 2;
    if (legDay && /bicicleta|bike/i.test(labelText(b))) scoreB += 2;
    return scoreB - scoreA;
  });

  return ranked[0] ?? null;
}

/**
 * Optional LISS finisher for fat-loss athletes (post main block).
 * @param {object} params
 * @param {object} params.profile
 * @param {string} params.sessionFocus
 * @param {object[]} params.warmupCatalog
 */
export function generateFatLossFinisher({ profile, sessionFocus, warmupCatalog = [] }) {
  if ((profile?.bodyCompositionGoal ?? 'Mantener') !== 'Perder_Grasa') {
    return null;
  }

  const picked = pickLissExercise(warmupCatalog, sessionFocus);
  const durationMinutes = 12;
  const exerciseName = picked?.nombre ?? 'Caminata en cinta inclinada';
  const instructions =
    picked?.descripcion ??
    'Camina a ritmo constante (RPE 4–5). Debes poder hablar en frases cortas. Inclinación 3–8% si usas cinta.';

  return {
    tipo: 'finisher',
    included: true,
    optional: true,
    nombre: 'Finisher cardio LISS',
    durationMinutes,
    intensityLabel: 'RPE 4–5 · ritmo conversacional',
    exerciseId: picked?.id ?? 'liss_incline_walk',
    exerciseName,
    instrucciones: instructions,
    rationale:
      'Complemento opcional para aumentar gasto calórico sin interferir con la recuperación de la fuerza. Hazlo después del bloque principal o en otro momento del día.',
    coachingTip:
      'No sustituye la dieta ni el entrenamiento de fuerza: ayuda a crear déficit y mejorar adherencia cardiovascular.',
    imageUrl: picked?.url_img_0 ?? picked?.imageUrl ?? null,
  };
}
