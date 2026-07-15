import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { calculateExperienceLevel } from '../../domain/athlete/experienceLevel.js';
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

function buildLevelUpgrade(previousLevel, newLevel) {
  if (!previousLevel || !newLevel || previousLevel === newLevel) return null;
  return {
    shouldShowCelebration: true,
    celebrationTitle: `¡Nivel ${newLevel}!`,
    celebrationMessage: `Pasaste de ${previousLevel} a ${newLevel}. Tu plan se adaptará a tu nueva experiencia.`,
    newLevel,
    previousLevel,
  };
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

    const previousLevel =
      user.profileData?.experienceLevel ??
      calculateExperienceLevel(user.profileData?.trainingAgeMonths ?? 0);

    const durationWeeks =
      user.currentMesocycle.durationWeeks ??
      user.currentMesocycle.mesocyclePlan?.durationWeeks ??
      4;
    const monthsGained = Math.max(1, Math.round(durationWeeks / 4));
    const profileForEval = {
      ...user.profileData,
      trainingAgeMonths: (user.profileData?.trainingAgeMonths ?? 0) + monthsGained,
    };

    const cycleResult = evaluateCycle(
      evaluation,
      user.currentMesocycle.volumeLandmarks,
      profileForEval,
      referenceDate,
    );

    const newLevel = cycleResult.updatedProfile.experienceLevel;
    const levelUpgrade = buildLevelUpgrade(previousLevel, newLevel);

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

    await users.saveUser(userId, {
      profileData,
      currentMesocycle: wrapped,
      currentSession: null,
      lastMesocycleEvaluation: referenceDate.toISOString(),
      planStatus: 'active',
      weeklyFeedbackModifiers: {},
    });

    return res.status(200).json({
      success: true,
      evaluation: cycleResult,
      mesocycle: wrapped,
      landmarkAdjustments: cycleResult.updatedLandmarks,
      levelUpgrade,
      trainingAgeMonths: profileData.trainingAgeMonths,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('mesocycle/evaluate error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
