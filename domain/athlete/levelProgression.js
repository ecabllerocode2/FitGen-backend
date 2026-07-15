import { calculateExperienceLevel } from './experienceLevel.js';
import { EXPERIENCE_LEVELS } from '../constants.js';
import { normalizeLoadPerformanceLedger } from './loadPerformanceLedger.js';

/** Minimum calendar training age before early promotion is allowed. */
export const EARLY_PROMOTION_MIN_MONTHS = {
  [EXPERIENCE_LEVELS.NOVATO]: 3,
  [EXPERIENCE_LEVELS.INTERMEDIO]: 12,
};

/** Minimum consistency (completed / planned sessions) in the ending mesocycle. */
export const PROMOTION_MIN_CONSISTENCY = 0.75;

/** Minimum e1RM improvement on compound patterns to accelerate promotion. */
export const PROMOTION_MIN_E1RM_GAIN = 0.05;

const LEVEL_ORDER = [EXPERIENCE_LEVELS.NOVATO, EXPERIENCE_LEVELS.INTERMEDIO, EXPERIENCE_LEVELS.AVANZADO];

function levelIndex(level) {
  return LEVEL_ORDER.indexOf(level);
}

function nextLevel(level) {
  const idx = levelIndex(level);
  return idx >= 0 && idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : null;
}

export function computeCompoundE1rmGain(ledger) {
  const store = normalizeLoadPerformanceLedger(ledger);
  const gains = [];
  for (const entry of Object.values(store.byExerciseId)) {
    if ((entry.priority ?? 2) !== 1 || !entry.previousE1RM || !entry.e1RM) continue;
    gains.push((entry.e1RM - entry.previousE1RM) / entry.previousE1RM);
  }
  if (!gains.length) return 0;
  return gains.reduce((sum, g) => sum + g, 0) / gains.length;
}

/**
 * Hybrid level resolution: time-based baseline + consistency/progress gates.
 * @param {object} params
 * @returns {{ experienceLevel: string, effectiveTrainingAgeMonths: number, promotionReasons: string[], heldBack: boolean }}
 */
export function resolveHybridExperienceLevel({
  trainingAgeMonths = 0,
  currentLevel,
  mesocycleCompletionRate = 1,
  persistentJointPain = false,
  loadPerformanceLedger = null,
  mesocyclesCompleted = 0,
}) {
  const timeLevel = calculateExperienceLevel(trainingAgeMonths);
  let effectiveMonths = trainingAgeMonths;
  const promotionReasons = [];
  let heldBack = false;

  const baseLevel = currentLevel ?? timeLevel;
  const e1rmGain = computeCompoundE1rmGain(loadPerformanceLedger);

  const canEarlyPromote =
    !persistentJointPain &&
    mesocycleCompletionRate >= PROMOTION_MIN_CONSISTENCY &&
    e1rmGain >= PROMOTION_MIN_E1RM_GAIN &&
    trainingAgeMonths >= (EARLY_PROMOTION_MIN_MONTHS[baseLevel] ?? 999);

  if (persistentJointPain || mesocycleCompletionRate < 0.6) {
    heldBack = true;
    if (baseLevel === EXPERIENCE_LEVELS.INTERMEDIO && trainingAgeMonths < 6) {
      effectiveMonths = Math.min(effectiveMonths, 5);
    }
  } else if (canEarlyPromote) {
    const target = nextLevel(baseLevel);
    if (target) {
      const thresholdMonths = target === EXPERIENCE_LEVELS.INTERMEDIO ? 6 : 24;
      if (trainingAgeMonths < thresholdMonths) {
        effectiveMonths = Math.max(effectiveMonths, thresholdMonths);
        promotionReasons.push('Progreso consistente en levantamientos compuestos');
        promotionReasons.push(`${Math.round(mesocycleCompletionRate * 100)}% de sesiones completadas`);
      }
    }
  }

  const experienceLevel = calculateExperienceLevel(effectiveMonths);
  return {
    experienceLevel,
    effectiveTrainingAgeMonths: effectiveMonths,
    promotionReasons,
    heldBack,
    timeLevel,
    progressSignal: {
      mesocycleCompletionRate,
      e1rmGainEstimate: Math.round(e1rmGain * 1000) / 1000,
      canEarlyPromote,
    },
  };
}

export function buildLevelUpgrade(previousLevel, newLevel, promotionReasons = []) {
  if (!previousLevel || !newLevel || previousLevel === newLevel) return null;
  const message =
    promotionReasons.length > 0
      ? `Pasaste de ${previousLevel} a ${newLevel}. ${promotionReasons.join(' · ')}.`
      : `Pasaste de ${previousLevel} a ${newLevel}. Tu plan se adaptará a tu nueva experiencia.`;
  return {
    shouldShowCelebration: true,
    celebrationTitle: `¡Nivel ${newLevel}!`,
    celebrationMessage: message,
    newLevel,
    previousLevel,
    promotionReasons,
  };
}
