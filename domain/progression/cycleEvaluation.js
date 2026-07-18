import { calculateExperienceLevel } from '../athlete/experienceLevel.js';
import { analyzeBodyTrend, applyTrendToLandmarks } from '../athlete/bodyMetrics.js';
import { generateMesocycle } from '../periodization/mesocycleGenerator.js';

/**
 * DDS 8.10 — evaluate end of mesocycle and prepare next cycle landmarks.
 * @param {object} feedback — aggregated mesocycle evaluation form
 * @param {Record<string, { MEV: number, MRV: number }>} currentLandmarks
 * @param {object} profile — athlete profile (may include updated trainingAgeMonths)
 * @param {Date|string} referenceDate
 * @returns {object}
 */
export function evaluateCycle(feedback, currentLandmarks, profile, referenceDate) {
  const {
    generalDifficulty = 3,
    persistentJointPain = false,
    changeGoal = false,
    newGoal = null,
    newBodyCompositionGoal = null,
    bodyMetricsEntries = [],
  } = feedback;

  const updatedLandmarks = {};
  const landmarkMessages = [];

  for (const [muscle, landmarks] of Object.entries(currentLandmarks ?? {})) {
    let newMEV = landmarks.MEV;

    if (generalDifficulty <= 2 && !persistentJointPain) {
      newMEV = Math.round(landmarks.MEV * 1.1);
      landmarkMessages.push(`${muscle}: subimos MEV de partida (+10%) por mesociclo fácil`);
    } else if (generalDifficulty >= 4 || persistentJointPain) {
      newMEV = Math.round(landmarks.MEV * 0.9);
      landmarkMessages.push(`${muscle}: bajamos MEV de partida (-10%) por fatiga o dolor`);
    }

    updatedLandmarks[muscle] = {
      ...landmarks,
      MEV: newMEV,
      MAV_actual: newMEV,
    };
  }

  const updatedProfile = { ...profile };
  if (changeGoal && newGoal) {
    updatedProfile.fitnessGoal = newGoal;
  }
  if (newBodyCompositionGoal) {
    updatedProfile.bodyCompositionGoal = newBodyCompositionGoal;
  }

  const bodyCompositionGoal =
    updatedProfile.bodyCompositionGoal ?? profile.bodyCompositionGoal ?? 'Mantener';
  const trend = analyzeBodyTrend(bodyMetricsEntries);
  const trendAdjustment = applyTrendToLandmarks(
    updatedLandmarks,
    trend,
    bodyCompositionGoal,
  );
  Object.assign(updatedLandmarks, trendAdjustment.landmarks);
  landmarkMessages.push(...trendAdjustment.messages);

  updatedProfile.experienceLevel = calculateExperienceLevel(
    updatedProfile.trainingAgeMonths ?? 0,
  );

  const nextMesocycle = generateMesocycle(
    {
      ...updatedProfile,
      customVolumeLandmarks: updatedLandmarks,
    },
    referenceDate,
  );

  if (updatedLandmarks && Object.keys(updatedLandmarks).length) {
    nextMesocycle.volumeLandmarks = {
      ...nextMesocycle.volumeLandmarks,
      ...updatedLandmarks,
    };
  }

  return {
    updatedLandmarks,
    updatedProfile,
    nextMesocycle,
    preserveE1RMHistory: true,
    messages: landmarkMessages,
    goalChanged: Boolean(changeGoal && newGoal),
    bodyCompositionChanged: Boolean(newBodyCompositionGoal),
    bodyTrend: trend,
  };
}
