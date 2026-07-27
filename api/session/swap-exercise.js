import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { loadCatalog } from '../../infrastructure/catalog/catalogRepository.js';
import {
  addExerciseExclusion,
  exerciseEquipmentList,
  getUserExercisePreferences,
  resolveExclusionFilters,
} from '../../domain/athlete/exercisePreferences.js';
import { setContinuityReplacement } from '../../domain/athlete/continuityPreferences.js';
import { applyMainExerciseSwap } from '../../domain/session/applyMainExerciseSwap.js';

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
 * Body: {
 *   exerciseIdToReplace,
 *   reason?: 'unavailable'|'preference',
 *   excludeEquipment?: boolean,
 *   useAsContinuity?: boolean,
 * }
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
      useAsContinuity = false,
    } = req.body ?? {};
    if (!exerciseIdToReplace) {
      return res.status(400).json({ error: 'exerciseIdToReplace requerido' });
    }

    const catalog = await loadCatalog(db);
    const focus = sessionFocus ?? session.sessionFocus;
    const mesocycleId = session.mesocycleId ?? user.currentMesocycle?.mesocycleId ?? null;
    const safetyProfile = user.currentMesocycle?.safetyProfile ?? user.profileData?.safetyProfile ?? {};

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

    const history = await users.getRecentSessions(userId, 30);
    const { excludeIds, unavailableEquipment } = resolveExclusionFilters(exercisePreferences);

    const swapResult = applyMainExerciseSwap({
      session,
      exerciseIdToReplace,
      catalog: catalog.entrenamiento ?? [],
      excludeIds,
      unavailableEquipment,
      safetyProfile,
      history,
      loadPerformanceLedger: user.loadPerformanceLedger,
      bodyWeightKg: user.profileData?.currentWeightKg,
      experienceLevel:
        safetyProfile?.experienceLevel ?? user.profileData?.experienceLevel ?? 'Intermedio',
    });

    if (swapResult.error) {
      return res.status(404).json({ error: swapResult.error });
    }

    const { mainBlock, replacement } = swapResult;
    const updatedSession = { ...session, mainBlock };

    await users.saveSession(userId, updatedSession);

    const userPatch = {};
    if (reason === 'unavailable') {
      userPatch.exercisePreferences = exercisePreferences;
    }
    if (useAsContinuity && mesocycleId && focus) {
      userPatch.continuityOverrides = setContinuityReplacement(
        user.continuityOverrides ?? {},
        mesocycleId,
        focus,
        exerciseIdToReplace,
        replacement,
      );
    }
    if (Object.keys(userPatch).length) {
      await users.saveUser(userId, userPatch);
    }

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
      continuitySaved: Boolean(useAsContinuity),
      exercisePreferences: reason === 'unavailable' ? exercisePreferences : undefined,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/swap-exercise error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
