import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { calculateExperienceLevel } from '../../domain/athlete/experienceLevel.js';
import {
  resolveHybridExperienceLevel,
  buildLevelUpgrade,
} from '../../domain/athlete/levelProgression.js';
import { normalizeLoadPerformanceLedger } from '../../domain/athlete/loadPerformanceLedger.js';
import { applyMesocycleEvaluateGamification } from '../../domain/gamification/updateGamification.js';
import { mesocycleEvaluationSchema } from '../../schemas/profileSchema.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

function parseEvaluationBody(body = {}) {
  const raw = body.evaluation ?? body;
  const painAreas = raw.painAreas ?? raw.painZones ?? [];
  return mesocycleEvaluationSchema.parse({
    generalDifficulty: raw.generalDifficulty ?? raw.difficultyScore ?? 3,
    persistentJointPain:
      raw.persistentJointPain ??
      (Array.isArray(painAreas) && painAreas.length > 0 && !painAreas.includes('none')),
    changeGoal: raw.changeGoal ?? Boolean(raw.nextGoalPreference),
    newGoal: raw.newGoal ?? raw.nextGoalPreference ?? undefined,
    painZones: Array.isArray(painAreas) ? painAreas.filter((p) => p !== 'none') : [],
  });
}

function buildLevelUpgradeResponse(previousLevel, newLevel, promotionReasons) {
  return buildLevelUpgrade(previousLevel, newLevel, promotionReasons);
}

function countMesocycleCompletionRate(mesocycle, history) {
  const mesocycleId = mesocycle?.mesocycleId;
  if (!mesocycleId) return 1;
  const planned =
    (mesocycle.mesocyclePlan?.microcycles ?? []).reduce(
      (sum, mc) => sum + (mc.sessions?.length ?? 0),
      0,
    ) ||
    (mesocycle.durationWeeks ?? 4) * (mesocycle.trainingDaysPerWeek ?? 3);
  const completed = (history ?? []).filter(
    (s) => s.mesocycleId === mesocycleId && s.completed,
  ).length;
  if (!planned) return 1;
  return Math.min(1, completed / planned);
}

/**
 * POST /api/mesocycle/evaluate
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);

    if (!user?.currentMesocycle) {
      return res.status(400).json({ error: 'No hay mesociclo para evaluar' });
    }

    const evaluation = parseEvaluationBody(req.body);
    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    const history = await users.getRecentSessions(userId, 40);
    const previousLevel =
      user.profileData?.experienceLevel ??
      calculateExperienceLevel(user.profileData?.trainingAgeMonths ?? 0);

    const durationWeeks =
      user.currentMesocycle.durationWeeks ??
      user.currentMesocycle.mesocyclePlan?.durationWeeks ??
      4;
    const monthsGained = Math.max(1, Math.round(durationWeeks / 4));
    const trainingAgeMonths = (user.profileData?.trainingAgeMonths ?? 0) + monthsGained;

    const mesocycleCompletionRate = countMesocycleCompletionRate(user.currentMesocycle, history);
    const hybrid = resolveHybridExperienceLevel({
      trainingAgeMonths,
      currentLevel: previousLevel,
      mesocycleCompletionRate,
      persistentJointPain: evaluation.persistentJointPain,
      loadPerformanceLedger: normalizeLoadPerformanceLedger(user.loadPerformanceLedger),
      mesocyclesCompleted: (user.mesocycleExerciseIndex ?? []).length,
    });

    const profileForEval = {
      ...user.profileData,
      trainingAgeMonths,
    };

    const cycleResult = evaluateCycle(
      evaluation,
      user.currentMesocycle.volumeLandmarks,
      profileForEval,
      referenceDate,
    );

    cycleResult.updatedProfile.trainingAgeMonths = trainingAgeMonths;
    cycleResult.updatedProfile.experienceLevel = hybrid.experienceLevel;

    const newLevel = cycleResult.updatedProfile.experienceLevel;
    const levelUpgrade = buildLevelUpgradeResponse(previousLevel, newLevel, hybrid.promotionReasons);

    const profileData = cycleResult.updatedProfile;
    const wrapped = {
      ...cycleResult.nextMesocycle,
      status: 'activo',
      mesocyclePlan: {
        durationWeeks: cycleResult.nextMesocycle.durationWeeks,
        mesocycleGoal: cycleResult.nextMesocycle.goal,
        splitType: cycleResult.nextMesocycle.splitType,
        microcycles: cycleResult.nextMesocycle.microcycles,
      },
    };

    const timezone = user.profileData?.timezone ?? 'America/Mexico_City';
    const { gamification, delta: gamificationDelta } = applyMesocycleEvaluateGamification({
      gamification: user.gamification,
      evaluatedAt: referenceDate.toISOString(),
      timezone,
      mesocycleCompletionRate,
      previousExperienceLevel: previousLevel,
      newExperienceLevel: newLevel,
    });

    await users.saveUser(userId, {
      profileData,
      currentMesocycle: wrapped,
      currentSession: null,
      lastMesocycleEvaluation: referenceDate.toISOString(),
      planStatus: 'active',
      weeklyFeedbackModifiers: {},
      gamification,
    });

    return res.status(200).json({
      success: true,
      evaluation: cycleResult,
      mesocycle: wrapped,
      landmarkAdjustments: cycleResult.updatedLandmarks,
      levelUpgrade,
      trainingAgeMonths: profileData.trainingAgeMonths,
      levelProgression: hybrid.progressSignal,
      gamificationDelta,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('mesocycle/evaluate error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
