import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { mesocycleEvaluationSchema } from '../../schemas/profileSchema.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
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

    const evaluation = mesocycleEvaluationSchema.parse(req.body.evaluation ?? req.body);
    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    const cycleResult = evaluateCycle(
      evaluation,
      user.currentMesocycle.volumeLandmarks,
      user.profileData,
      referenceDate,
    );

    let profileData = { ...user.profileData };
    if (evaluation.changeGoal && evaluation.newGoal) {
      profileData.fitnessGoal = evaluation.newGoal;
    }
    profileData.customVolumeLandmarks = cycleResult.nextLandmarks;

    const newMesocycle = generateMesocycle(profileData, referenceDate);
    const wrapped = {
      ...newMesocycle,
      status: 'activo',
      mesocyclePlan: {
        durationWeeks: newMesocycle.durationWeeks,
        mesocycleGoal: newMesocycle.goal,
        splitType: newMesocycle.splitType,
        microcycles: newMesocycle.microcycles,
      },
    };

    await users.saveUser(userId, {
      profileData,
      currentMesocycle: wrapped,
      currentSession: null,
      lastMesocycleEvaluation: referenceDate.toISOString(),
      planStatus: 'active',
    });

    return res.status(200).json({
      success: true,
      evaluation: cycleResult,
      mesocycle: wrapped,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('mesocycle/evaluate error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
