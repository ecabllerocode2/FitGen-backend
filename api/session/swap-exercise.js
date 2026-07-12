import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { loadCatalog } from '../../infrastructure/catalog/catalogRepository.js';
import { selectExercises } from '../../domain/exerciseSelection/selector.js';
import {
  addExerciseExclusion,
  exerciseEquipmentList,
  getUserExercisePreferences,
  resolveExclusionFilters,
} from '../../domain/athlete/exercisePreferences.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/session/swap-exercise
 * Body: { exerciseIdToReplace, reason?: 'unavailable'|'preference', excludeEquipment?: boolean }
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
      return res.status(400).json({ error: 'No hay sesión activa' });
    }

    const {
      exerciseIdToReplace,
      sessionFocus,
      reason = 'preference',
      excludeEquipment = false,
    } = req.body ?? {};
    if (!exerciseIdToReplace) {
      return res.status(400).json({ error: 'exerciseIdToReplace requerido' });
    }

    const catalog = await loadCatalog(db);
    const focus = sessionFocus ?? session.sessionFocus;
    const safetyProfile = user.currentMesocycle?.safetyProfile ?? user.profileData?.safetyProfile ?? {};
    const goal = user.currentMesocycle?.goal ?? user.profileData?.fitnessGoal ?? 'Hipertrofia';

    let exercisePreferences = getUserExercisePreferences(user);

    if (reason === 'unavailable') {
      const source =
        (catalog.entrenamiento ?? []).find((ex) => ex.id === exerciseIdToReplace) ??
        (session.mainBlock ?? []).find((ex) => ex.exerciseId === exerciseIdToReplace);
      exercisePreferences = addExerciseExclusion(
        exercisePreferences,
        {
          exerciseId: exerciseIdToReplace,
          nombre: source?.nombre ?? source?.exerciseName ?? exerciseIdToReplace,
          reason: 'unavailable',
          scope: 'all',
          equipmentTags: exerciseEquipmentList(source ?? {}),
        },
        excludeEquipment,
      );
      await users.saveUser(userId, { exercisePreferences });
    }

    const { excludeIds } = resolveExclusionFilters(exercisePreferences);
    const currentIds = (session.mainBlock ?? []).map((e) => e.exerciseId);
    const alternatives = selectExercises(
      focus,
      catalog.entrenamiento ?? [],
      safetyProfile,
      [],
      goal,
      { excludeIds: [...new Set([...currentIds, ...excludeIds])], weekNumber: session.weekNumber },
    );

    const replacement = alternatives.find((e) => e.id !== exerciseIdToReplace) ?? alternatives[0];
    if (!replacement) {
      return res.status(404).json({ error: 'No hay ejercicio alternativo disponible' });
    }

    const mainBlock = (session.mainBlock ?? []).map((ex) => {
      if (ex.exerciseId !== exerciseIdToReplace) return ex;
      return {
        ...ex,
        exerciseId: replacement.id,
        exerciseName: replacement.nombre,
        muscleGroup: replacement.parteCuerpo,
        movementPattern: replacement.patronMovimiento,
        swappedFrom: exerciseIdToReplace,
      };
    });

    const updatedSession = { ...session, mainBlock, swappedAt: new Date().toISOString() };
    await users.saveSession(userId, updatedSession);

    return res.status(200).json({
      success: true,
      session: updatedSession,
      replacement: {
        id: replacement.id,
        nombre: replacement.nombre,
      },
      newExercise: {
        id: replacement.id,
        nombre: replacement.nombre,
        parteCuerpo: replacement.parteCuerpo,
        patronMovimiento: replacement.patronMovimiento,
      },
      exercisePreferences: reason === 'unavailable' ? exercisePreferences : undefined,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/swap-exercise error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
