import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { applyWeeklyFeedback } from '../../domain/autoregulation/weeklyFeedback.js';
import { estimateE1RMWithRIR, pickBestHistoryEntry } from '../../domain/prescription/loadCalculator.js';
import { weeklyFeedbackSchema } from '../../schemas/profileSchema.js';
import { isMesocycleComplete, isLastSessionOfWeek } from '../../lib/mesocycleUtils.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

function musclesWorkedInSession(session) {
  const muscles = new Set();
  for (const ex of session.mainBlock ?? []) {
    if (ex.muscleGroup) muscles.add(ex.muscleGroup);
  }
  return [...muscles];
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

    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    if (isMesocycleComplete(user.currentMesocycle, referenceDate)) {
      const mesocycle = {
        ...user.currentMesocycle,
        status: 'evaluacion_pendiente',
      };
      await users.saveUser(userId, { currentMesocycle: mesocycle });
      return res.status(200).json({
        success: true,
        requiresEvaluation: true,
        message: 'Mesociclo completado. Evalúa tu bloque para generar el siguiente.',
      });
    }

    const {
      sessionFeedback: rawFeedback = {},
      performanceData = {},
      exercises = performanceData.exercises,
    } = req.body;

    const sessionFeedback = weeklyFeedbackSchema.parse(rawFeedback);

    const completedSession = {
      ...session,
      completed: true,
      completedAt: new Date().toISOString(),
      sessionFeedback,
      performance: exercises ?? req.body.mainBlock ?? session.mainBlock,
    };

    if (Array.isArray(completedSession.performance)) {
      completedSession.performance = completedSession.performance.map((ex) => {
        const sets = ex.sets ?? ex.actualSets ?? [];
        const completedSets = sets.filter((s) => s.completed !== false);
        const best = pickBestHistoryEntry(
          completedSets.map((s) => ({
            weightKg: s.load ?? s.weightKg,
            reps: s.reps,
            rir: s.rir,
          })),
        );
        if (!best?.weightKg) return ex;
        const { weightKg: weight, reps, rir = 2 } = best;
        return {
          ...ex,
          e1RM: estimateE1RMWithRIR(weight, reps, rir),
          actualWeightKg: weight,
          actualReps: reps,
          actualRIR: rir,
        };
      });
    }

    const muscles = musclesWorkedInSession(session);
    const pendingWeeklyFeedback = { ...(user.pendingWeeklyFeedback ?? {}) };
    for (const muscle of muscles) {
      pendingWeeklyFeedback[muscle] = sessionFeedback;
    }

    const weekNumber = session.weekNumber ?? 1;
    const dayOfWeek = session.dayOfWeek;
    const weekClosed = isLastSessionOfWeek(
      user.currentMesocycle,
      weekNumber,
      dayOfWeek,
    );

    const weeklyFeedbackModifiers = { ...(user.weeklyFeedbackModifiers ?? {}) };
    const weeklyAdjustment = {};

    if (weekClosed) {
      for (const [muscle, feedback] of Object.entries(pendingWeeklyFeedback)) {
        const { modifier, message } = applyWeeklyFeedback(feedback, muscle);
        if (modifier !== 1.0) {
          weeklyFeedbackModifiers[muscle] = modifier;
          weeklyAdjustment[muscle] = { modifier, message };
        }
      }
    }

    const userUpdates = {
      lastWorkoutDate: completedSession.completedAt,
      lastSessionFeedback: sessionFeedback,
      pendingWeeklyFeedback: weekClosed ? {} : pendingWeeklyFeedback,
      weeklyFeedbackModifiers: weekClosed ? weeklyFeedbackModifiers : user.weeklyFeedbackModifiers ?? {},
    };

    const archived = await users.archiveSession(userId, completedSession);
    await users.saveSession(userId, null);
    await users.saveUser(userId, userUpdates);

    return res.status(200).json({
      success: true,
      message: 'Sesión completada y archivada.',
      archivedSessionId: archived.id,
      celebrationSummary: {
        sessionFocus: session.sessionFocus ?? 'Entrenamiento',
        durationLabel: session.summary?.duracionEstimada ?? '—',
        exerciseCount: session.summary?.ejerciciosTotales ?? 0,
        totalSets: session.summary?.seriesTotales ?? 0,
        muscles: session.summary?.musculosTrabajos ?? session.sessionMuscles ?? [],
      },
      weeklyAdjustment,
      weekClosed,
      requiresEvaluation: false,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('session/complete error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
