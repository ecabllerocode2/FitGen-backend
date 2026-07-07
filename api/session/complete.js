import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { applyWeeklyFeedback } from '../../domain/autoregulation/weeklyFeedback.js';
import { estimateE1RMWithRIR } from '../../domain/prescription/loadCalculator.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/session/complete
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    const session = user?.currentSession;

    if (!session) {
      return res.status(400).json({ error: 'No hay sesión activa para completar' });
    }

    const {
      sessionFeedback = {},
      performanceData = {},
      exercises = performanceData.exercises,
    } = req.body;

    const completedSession = {
      ...session,
      completed: true,
      completedAt: new Date().toISOString(),
      sessionFeedback,
      performance: exercises ?? req.body.mainBlock ?? session.mainBlock,
    };

    // Enrich with e1RM estimates for progression
    if (Array.isArray(completedSession.performance)) {
      completedSession.performance = completedSession.performance.map((ex) => {
        const sets = ex.sets ?? ex.actualSets ?? [];
        const best = sets.find((s) => s.completed !== false) ?? sets[0];
        if (!best?.load && !best?.weightKg) return ex;
        const weight = best.load ?? best.weightKg;
        const reps = best.reps ?? 8;
        const rir = best.rir ?? 2;
        return {
          ...ex,
          e1RM: estimateE1RMWithRIR(weight, reps, rir),
          actualWeightKg: weight,
          actualReps: reps,
          actualRIR: rir,
        };
      });
    }

    await users.archiveSession(userId, completedSession);
    await users.saveSession(userId, null);
    await users.saveUser(userId, {
      lastWorkoutDate: completedSession.completedAt,
      lastSessionFeedback: sessionFeedback,
    });

    return res.status(200).json({
      success: true,
      message: 'Sesión completada y archivada.',
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/complete error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
