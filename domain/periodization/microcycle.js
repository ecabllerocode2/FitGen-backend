import { DELOAD_VOLUME_MULTIPLIER } from '../constants.js';

/**
 * DDS 8.3 — week plan with volume and RIR progression.
 * @param {object} mesocycle
 * @param {number} weekNumber
 * @param {Record<string, number>} [feedbackModifiers] — per-muscle weekly feedback multiplier from 8.8
 * @returns {object|null}
 */
export function getWeekPlan(mesocycle, weekNumber, feedbackModifiers = {}) {
  const micro = mesocycle.microcycles?.find((m) => m.week === weekNumber);
  if (!micro) return null;

  const accumulationWeeks = mesocycle.durationWeeks - 1;
  const isDeload = weekNumber === mesocycle.durationWeeks;

  const volumeByMuscle = {};
  const previousWeek = mesocycle.microcycles?.find((m) => m.week === weekNumber - 1);

  for (const [muscle, baseVolume] of Object.entries(micro.volumeTargets ?? {})) {
    let sets = baseVolume;

    if (isDeload) {
      sets = applyDeloadVolume(baseVolume);
    } else if (weekNumber > 1 && previousWeek?.volumeTargets?.[muscle] != null) {
      const landmarks = mesocycle.volumeLandmarks[muscle];
      if (landmarks) {
        const increment = calculateWeeklySetIncrement(landmarks.MEV, landmarks.MRV, accumulationWeeks);
        sets = previousWeek.volumeTargets[muscle] + increment;
        if (sets > landmarks.MRV) sets = landmarks.MRV;
      }
    }

    const feedbackMod = feedbackModifiers[muscle] ?? 1.0;
    sets = Math.round(sets * feedbackMod);

    volumeByMuscle[muscle] = Math.max(0, sets);
  }

  return {
    week: weekNumber,
    phase: micro.phase,
    rirObjetivo: micro.rirObjetivo,
    rirObjetivoAccessory: micro.rirObjetivoAccessory ?? micro.rirObjetivo,
    volumeMultiplier: micro.volumeMultiplier ?? 1.0,
    volumeByMuscle,
    sessions: micro.sessions ?? [],
    isDeload,
  };
}

/**
 * DDS 8.3 — additive set increment per muscle per week.
 * @param {number} mev
 * @param {number} mrv
 * @param {number} accumulationWeeks
 * @returns {number}
 */
export function calculateWeeklySetIncrement(mev, mrv, accumulationWeeks) {
  if (accumulationWeeks <= 1) return 0;
  return Math.round((mrv - mev) / (accumulationWeeks - 1));
}

/**
 * Apply deload volume reduction (~50%).
 * @param {number} volume
 * @returns {number}
 */
export function applyDeloadVolume(volume) {
  return Math.round(volume * DELOAD_VOLUME_MULTIPLIER);
}
