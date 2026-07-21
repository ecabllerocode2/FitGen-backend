import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { loadCatalog } from '../../infrastructure/catalog/catalogRepository.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { getTodaySessionPlan, isMesocycleComplete } from '../../lib/mesocycleUtils.js';
import { isStaleIncompleteSession } from '../../domain/session/sessionFreshness.js';
import { hasCompletedScheduledSessionToday } from '../../domain/session/sameDayCompletion.js';
import { validateReadiness } from '../../schemas/profileSchema.js';

const LOAD_TO_SCHEMA = {
  none: 'ninguna',
  low: 'ligera',
  light: 'ligera',
  moderate: 'moderada',
  medium: 'moderada',
  high: 'alta',
  extreme: 'alta',
};

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/session/generateV2
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);

    if (!user?.profileData) {
      return res.status(400).json({ error: 'Perfil no encontrado' });
    }
    if (!user.currentMesocycle) {
      return res.status(400).json({ error: 'No hay mesociclo activo. Genera un plan primero.' });
    }

    const referenceDate = req.body?.referenceDate
      ? new Date(req.body.referenceDate)
      : new Date();

    if (isMesocycleComplete(user.currentMesocycle, referenceDate)) {
      if (user.currentMesocycle.status !== 'evaluacion_pendiente') {
        await users.saveUser(userId, {
          currentMesocycle: { ...user.currentMesocycle, status: 'evaluacion_pendiente' },
        });
      }
      return res.status(200).json({
        success: true,
        requiresEvaluation: true,
        message: 'Tu mesociclo terminó. Completa la evaluación para continuar.',
      });
    }

    const readiness = validateReadiness({
      energyLevel: req.body.energyLevel ?? 3,
      sorenessLevel: req.body.sorenessLevel ?? 2,
      sorenessZone: req.body.sorenessArea ?? req.body.sorenessZone,
      sleepQuality: req.body.sleepQuality ?? 3,
      stressLevel: req.body.stressLevel ?? 3,
      externalLoad: LOAD_TO_SCHEMA[req.body.externalFatigue ?? req.body.externalLoad] ?? 'ninguna',
    });

    const { weekNumber, session: sessionPlan, isRestDay, dayOfWeek } = getTodaySessionPlan(
      user.currentMesocycle,
      referenceDate,
      user.profileData.timezone,
    );

    if (isRestDay || !sessionPlan) {
      return res.status(200).json({
        success: true,
        isRestDay: true,
        dayOfWeek,
        message: 'Día de descanso programado.',
      });
    }

    const existing = user.currentSession;
    if (
      isStaleIncompleteSession(existing, referenceDate, dayOfWeek, weekNumber)
    ) {
      await users.saveSession(userId, null);
    }

    const catalog = await loadCatalog(db);
    const history = await users.getRecentSessions(userId, 30);
    const timezone = user.profileData?.timezone ?? 'UTC';

    if (
      hasCompletedScheduledSessionToday({
        user,
        history,
        dayOfWeek,
        weekNumber,
        referenceDate,
        timezone,
      })
    ) {
      return res.status(409).json({
        error: 'Ya completaste la sesión de hoy. Vuelve mañana para la siguiente.',
        alreadyCompletedToday: true,
        dayOfWeek,
        weekNumber,
      });
    }

    const feedbackModifiers =
      weekNumber > 1 ? (user.weeklyFeedbackModifiers ?? {}) : {};

    const session = generateSession({
      profile: user.profileData,
      mesocycle: user.currentMesocycle,
      weekNumber,
      sessionFocus: sessionPlan.sessionFocus,
      sessionMuscles: sessionPlan.muscles ?? [],
      patterns: sessionPlan.patterns ?? [],
      readiness,
      feedbackModifiers,
      catalog,
      history,
      referenceDate,
      exercisePreferences: user.exercisePreferences ?? {},
      continuityOverrides: user.continuityOverrides ?? {},
      loadPerformanceLedger: user.loadPerformanceLedger ?? null,
      mesocycleExerciseIndex: user.mesocycleExerciseIndex ?? [],
    });

    session.version = '3.0.0';
    session.userId = userId;
    session.completed = false;

    await users.saveSession(userId, session);

    if (weekNumber > 1 && Object.keys(feedbackModifiers).length) {
      await users.saveUser(userId, { weeklyFeedbackModifiers: {} });
    }

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('session/generateV2 error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
