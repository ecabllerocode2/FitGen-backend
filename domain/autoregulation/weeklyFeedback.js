/**
 * DDS 8.8 — weekly structural feedback modifier per muscle.
 * @param {object} feedback
 * @param {number} [feedback.pumpQuality] — 1-5
 * @param {string} [feedback.sorenessTiming] — "no llegó a doler"|"sanó a tiempo"|"aún dolía al entrenar de nuevo"
 * @param {boolean} [feedback.jointPain]
 * @param {number} [feedback.perceivedWorkload] — 1-5
 * @param {string} muscle — muscle group name (for message context)
 * @returns {{ modifier: number, message: string|null }}
 */
export function applyWeeklyFeedback(feedback, muscle) {
  if (!feedback) {
    return { modifier: 1.0, message: null };
  }

  const {
    pumpQuality = 3,
    sorenessTiming = 'sanó a tiempo',
    jointPain = false,
    perceivedWorkload = 3,
  } = feedback;

  if (jointPain) {
    return {
      modifier: 0.7,
      message: `Dolor articular reportado en ${muscle}: reducimos volumen de forma preventiva`,
    };
  }

  if (
    pumpQuality <= 2 &&
    sorenessTiming === 'no llegó a doler' &&
    perceivedWorkload <= 2
  ) {
    return {
      modifier: 1.15,
      message: `${muscle}: tienes margen para más volumen la próxima semana`,
    };
  }

  if (
    pumpQuality >= 4 &&
    sorenessTiming === 'aún dolía al entrenar de nuevo' &&
    perceivedWorkload >= 4
  ) {
    return {
      modifier: 0.85,
      message: `${muscle}: señales de acercarte al MRV antes de lo previsto`,
    };
  }

  return { modifier: 1.0, message: null };
}

/**
 * Aggregate feedback for multiple muscles.
 * @param {Record<string, object>} feedbackByMuscle
 * @returns {Record<string, number>}
 */
export function buildFeedbackModifiers(feedbackByMuscle) {
  const modifiers = {};
  for (const [muscle, feedback] of Object.entries(feedbackByMuscle ?? {})) {
    modifiers[muscle] = applyWeeklyFeedback(feedback, muscle).modifier;
  }
  return modifiers;
}
