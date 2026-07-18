import {
  VOLUME_LANDMARKS,
  MESOCYCLE_DURATION,
  EXPERIENCE_VOLUME_FACTOR,
  SPLIT_SESSIONS,
  RIR_PROGRESSION,
  DELOAD_VOLUME_MULTIPLIER,
  DAY_ORDER,
} from '../constants.js';
import { calculateExperienceLevel } from '../athlete/experienceLevel.js';
import { buildSafetyProfile } from '../athlete/safetyProfile.js';
import { selectSplit, normalizeTrainingDays } from './splitSelector.js';
import { addDays, toISODateString } from '../../lib/dateUtils.js';
import { buildMuscleEmphasisLandmarks } from '../athlete/muscleEmphasis.js';
import {
  applyBodyCompositionToLandmarks,
  applyBodyCompositionToMicrocycles,
} from '../athlete/bodyCompositionStrategy.js';

/**
 * DDS 8.2 — generate full mesocycle object (section 6.2).
 * @param {object} profile — profileData from onboarding
 * @param {Date|string} referenceDate
 * @returns {object} mesocycle
 */
export function generateMesocycle(profile, referenceDate) {
  const experienceLevel =
    profile.experienceLevel ??
    calculateExperienceLevel(profile.trainingAgeMonths ?? 0);
  const goal = profile.fitnessGoal ?? 'Hipertrofia';
  const trainingDays = normalizeTrainingDays(profile.trainingDaysPerWeek ?? 3);
  const safetyProfile = {
    ...buildSafetyProfile(profile),
    experienceLevel,
  };

  const splitType = profile.forcedSplitType ?? selectSplit(trainingDays, goal, experienceLevel);
  const durationWeeks = MESOCYCLE_DURATION[experienceLevel];
  const accumulationWeeks = durationWeeks - 1;
  const factor = EXPERIENCE_VOLUME_FACTOR[experienceLevel];

  const splitSessions = SPLIT_SESSIONS[splitType] ?? SPLIT_SESSIONS.Full_Body;
  const relevantMuscles = musclesFromSplitSessions(splitSessions);

  const volumeLandmarks = {};
  for (const muscle of relevantMuscles) {
    const custom = profile.customVolumeLandmarks?.[muscle];
    if (custom) {
      volumeLandmarks[muscle] = { ...custom };
      continue;
    }
    const base = VOLUME_LANDMARKS[muscle];
    if (!base) continue;
    const mev = Math.round(base.MEV * factor);
    const mrv = Math.round(base.MRV * factor);
    volumeLandmarks[muscle] = {
      MEV: mev,
      MAV_actual: mev,
      MRV: mrv,
    };
  }

  const emphasizedLandmarks = buildMuscleEmphasisLandmarks(profile, volumeLandmarks);
  const bodyCompositionGoal = profile.bodyCompositionGoal ?? 'Mantener';
  const adjustedLandmarks = applyBodyCompositionToLandmarks(
    emphasizedLandmarks,
    bodyCompositionGoal,
  );

  const microcycles = [];
  for (let week = 1; week <= durationWeeks; week += 1) {
    const isDeload = week === durationWeeks;
    const phase = isDeload ? 'deload' : week <= Math.ceil(accumulationWeeks / 2) ? 'acumulacion' : 'intensificacion';

    const rirObjetivo = calculateWeekRIR(goal, week, accumulationWeeks, isDeload);
    const rirObjetivoAccessory =
      goal === 'Fuerza'
        ? calculateWeekRIR(goal, week, accumulationWeeks, isDeload, 'accessory')
        : rirObjetivo;
    const volumeMultiplier = isDeload ? DELOAD_VOLUME_MULTIPLIER : 1.0;

    const volumeTargets = {};
    for (const muscle of relevantMuscles) {
      const landmarks = adjustedLandmarks[muscle];
      if (!landmarks) continue;
      const baseVolume = interpolateVolume(
        landmarks.MEV,
        landmarks.MRV,
        week,
        accumulationWeeks,
        isDeload,
      );
      volumeTargets[muscle] = baseVolume;
    }

    microcycles.push({
      week,
      phase,
      rirObjetivo,
      rirObjetivoAccessory,
      volumeMultiplier,
      volumeTargets,
      sessions: assignSessionsToSchedule(
        profile.weeklyScheduleContext ?? [],
        splitSessions,
        trainingDays,
        { weekNumber: week },
      ),
    });
  }

  const startDate = toISODateString(referenceDate);
  const endDate = toISODateString(addDays(referenceDate, durationWeeks * 7 - 1));

  const finalMicrocycles = applyBodyCompositionToMicrocycles(
    microcycles,
    bodyCompositionGoal,
  );

  return {
    mesocycleId: `mc_${startDate}_${goal}_${splitType}`,
    goal,
    experienceLevel,
    durationWeeks,
    splitType,
    startDate,
    endDate,
    currentWeek: 1,
    status: 'activo',
    volumeLandmarks: adjustedLandmarks,
    safetyProfile,
    microcycles: finalMicrocycles,
  };
}

/**
 * Linear interpolation MEV → MRV across accumulation weeks; deload = 50%.
 */
function interpolateVolume(mev, mrv, week, accumulationWeeks, isDeload) {
  if (isDeload) {
    // Volumen de referencia = última semana de acumulación; el 50% se aplica una sola vez en getWeekPlan
    return mrv;
  }
  if (accumulationWeeks <= 1) return mev;
  const t = (week - 1) / (accumulationWeeks - 1);
  return Math.round(mev + t * (mrv - mev));
}

/**
 * RIR progression per DDS 8.2 table.
 */
function calculateWeekRIR(goal, week, accumulationWeeks, isDeload, liftType = 'main') {
  const prog =
    goal === 'Fuerza'
      ? RIR_PROGRESSION.Fuerza[liftType] ?? RIR_PROGRESSION.Fuerza.main
      : RIR_PROGRESSION.Hipertrofia;

  if (isDeload) {
    const lastAccumRIR = interpolateRIR(prog.week1, prog.accumulationEnd, accumulationWeeks, accumulationWeeks);
    return Math.round((lastAccumRIR + prog.deloadDelta) * 10) / 10;
  }
  return interpolateRIR(prog.week1, prog.accumulationEnd, week, accumulationWeeks);
}

function interpolateRIR(start, end, week, totalWeeks) {
  if (totalWeeks <= 1) return start;
  const t = (week - 1) / (totalWeeks - 1);
  return Math.round((start + t * (end - start)) * 10) / 10;
}

/**
 * Map split sessions onto user's available training days.
 * Reorders templates to avoid same dominant pattern or consecutive leg days when possible.
 * @param {object[]} scheduleContext
 * @param {object[]} splitSessions
 * @param {number} trainingDays
 * @param {object} [options]
 * @param {number} [options.weekNumber=1]
 */
export function assignSessionsToSchedule(scheduleContext, splitSessions, trainingDays, options = {}) {
  const { weekNumber = 1 } = options;
  const trainableDays = DAY_ORDER.filter((day) => {
    const ctx = scheduleContext.find((s) => s.day === day);
    return ctx ? ctx.canTrain !== false : true;
  });

  const selectedDays = trainableDays.slice(0, trainingDays);
  const orderedTemplates = orderTemplatesAvoidingConsecutivePatterns(splitSessions, trainingDays);
  const templatesForWeek =
    trainingDays === 1
      ? [splitSessions[(weekNumber - 1) % splitSessions.length]]
      : orderedTemplates;
  const sessions = [];

  for (let i = 0; i < 7; i += 1) {
    const day = DAY_ORDER[i];
    const dayIndex = selectedDays.indexOf(day);
    const canTrain = dayIndex !== -1 && dayIndex < trainingDays;

    if (canTrain) {
      const template = templatesForWeek[dayIndex % templatesForWeek.length];
      sessions.push({
        dayOfWeek: day,
        sessionFocus: template.sessionFocus,
        muscles: template.muscles,
        patterns: template.patterns,
        isRestDay: false,
      });
    } else {
      sessions.push({
        dayOfWeek: day,
        sessionFocus: 'Descanso',
        isRestDay: true,
      });
    }
  }

  return sessions;
}

function isLegTemplate(template) {
  return (template.patterns ?? []).some((p) => p === 'Rodilla' || p === 'Cadera');
}

function dominantPattern(patterns = []) {
  return patterns[0] ?? 'General';
}

function orderTemplatesAvoidingConsecutivePatterns(templates, count) {
  const needed = Math.min(count, templates.length);
  const pool = [...templates];
  const ordered = [];

  for (let i = 0; i < needed; i += 1) {
    if (!pool.length) break;
    const prev = ordered[ordered.length - 1];
    const prevPattern = prev ? dominantPattern(prev.patterns) : null;
    const prevLeg = prev ? isLegTemplate(prev) : false;

    let pickIdx = pool.findIndex(
      (t) =>
        dominantPattern(t.patterns) !== prevPattern && !(prevLeg && isLegTemplate(t)),
    );
    if (pickIdx === -1) {
      pickIdx = pool.findIndex((t) => dominantPattern(t.patterns) !== prevPattern);
    }
    if (pickIdx === -1) pickIdx = 0;

    ordered.push(pool[pickIdx]);
    pool.splice(pickIdx, 1);
  }

  while (ordered.length < needed && templates.length) {
    ordered.push(templates[ordered.length % templates.length]);
  }

  return ordered.length ? ordered : templates;
}

function musclesFromSplitSessions(sessions) {
  const muscles = new Set();
  for (const session of sessions) {
    for (const muscle of session.muscles ?? []) {
      if (muscle) muscles.add(muscle);
    }
    if (session.patterns?.includes('Core')) {
      muscles.add('Core');
    }
  }
  return [...muscles];
}
