import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { verifyFirebaseToken } from '../../infrastructure/firebase/authMiddleware.js';
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/mesocycle/generate
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    if (!user?.profileData) {
      return res.status(400).json({ error: 'Perfil incompleto. Completa el onboarding primero.' });
    }

    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    const mesocycle = generateMesocycle(user.profileData, referenceDate);
    const wrapped = {
      ...mesocycle,
      mesocyclePlan: {
        durationWeeks: mesocycle.durationWeeks,
        mesocycleGoal: mesocycle.goal,
        splitType: mesocycle.splitType,
        microcycles: mesocycle.microcycles,
      },
    };
    wrapped.status = 'activo';
    wrapped.progress = 0;

    await users.saveMesocycle(userId, wrapped);
    await users.saveUser(userId, {
      planStatus: 'active',
      lastMesocycleGeneration: referenceDate.toISOString(),
      currentSession: null,
    });

    return res.status(200).json({
      success: true,
      plan: wrapped,
      mesocycle: wrapped,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('mesocycle/generate error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
