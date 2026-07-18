const FOCUS_AREA_MUSCLES = {
  General: [],
  Tren_Superior: ['Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps'],
  Tren_Inferior: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'],
  Core: ['Core'],
};

const EMPHASIS_MEV_BONUS = {
  light: 1,
  moderate: 2,
  strong: 3,
};

function applyEmphasis(landmarks, extraMev) {
  const mev = Math.min(landmarks.MEV + extraMev, landmarks.MRV - 1);
  return {
    ...landmarks,
    MEV: mev,
    MAV_actual: mev,
  };
}

/**
 * Boost MEV for focus area and up to 2 explicit muscle priorities.
 * @param {object} profile
 * @param {Record<string, { MEV: number, MRV: number, MAV_actual?: number }>} baseLandmarks
 */
export function buildMuscleEmphasisLandmarks(profile, baseLandmarks) {
  const result = { ...baseLandmarks };
  const priorities = Array.isArray(profile.musclePriorities) ? profile.musclePriorities : [];

  if (!priorities.length && profile.focusArea && profile.focusArea !== 'General') {
    const muscles = FOCUS_AREA_MUSCLES[profile.focusArea] ?? [];
    for (const muscle of muscles) {
      if (result[muscle]) {
        result[muscle] = applyEmphasis(result[muscle], 1);
      }
    }
  }

  for (const item of priorities.slice(0, 2)) {
    const muscle = item?.muscle;
    const intensity = item?.intensity ?? 'moderate';
    const bonus = EMPHASIS_MEV_BONUS[intensity] ?? EMPHASIS_MEV_BONUS.moderate;
    if (muscle && result[muscle]) {
      result[muscle] = applyEmphasis(result[muscle], bonus);
    }
  }

  return result;
}
