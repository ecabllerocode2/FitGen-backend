export const BODY_COMPOSITION_GOALS = ['Mantener', 'Perder_Grasa', 'Ganar_Musculo'];

/**
 * Cap MRV ramp for fat loss — stay closer to MAV.
 * @param {Record<string, { MEV: number, MRV: number, MAV_actual?: number }>} landmarks
 * @param {string} [bodyCompositionGoal]
 */
export function applyBodyCompositionToLandmarks(landmarks, bodyCompositionGoal = 'Mantener') {
  if (!bodyCompositionGoal || bodyCompositionGoal === 'Mantener') {
    return { ...landmarks };
  }

  const result = {};
  for (const [muscle, lm] of Object.entries(landmarks ?? {})) {
    if (bodyCompositionGoal === 'Perder_Grasa') {
      const mavMid = Math.round((lm.MEV + lm.MRV) / 2);
      const cappedMrv = Math.min(lm.MRV, mavMid + 2);
      result[muscle] = { ...lm, MRV: Math.max(lm.MEV + 2, cappedMrv) };
    } else {
      result[muscle] = { ...lm };
    }
  }
  return result;
}

/**
 * Slightly conservative RIR/volume during accumulation for fat loss.
 * @param {object[]} microcycles
 * @param {string} [bodyCompositionGoal]
 */
export function applyBodyCompositionToMicrocycles(microcycles, bodyCompositionGoal = 'Mantener') {
  if (bodyCompositionGoal !== 'Perder_Grasa') return microcycles;

  return microcycles.map((mc) => {
    if (mc.phase === 'deload') return mc;

    const volumeTargets = {};
    for (const [muscle, sets] of Object.entries(mc.volumeTargets ?? {})) {
      volumeTargets[muscle] = Math.max(1, Math.round(sets * 0.92));
    }

    return {
      ...mc,
      rirObjetivo: Math.min(4, Math.round(((mc.rirObjetivo ?? 2) + 0.5) * 10) / 10),
      rirObjetivoAccessory:
        mc.rirObjetivoAccessory != null
          ? Math.min(4, Math.round((mc.rirObjetivoAccessory + 0.5) * 10) / 10)
          : mc.rirObjetivoAccessory,
      volumeTargets,
    };
  });
}
