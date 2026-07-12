import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { loadCatalog } from '../../infrastructure/catalog/catalogRepository.js';
import { replaceWarmupExercise } from '../../domain/session/rampGenerator.js';
import {
  addExerciseExclusion,
  exerciseEquipmentList,
  getUserExercisePreferences,
  resolveExclusionFilters,
} from '../../domain/athlete/exercisePreferences.js';
import { SESSION_FOCUS_PATTERN_MAP } from '../../domain/constants.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

function findCatalogExercise(catalog, exerciseId) {
  return (catalog.calentamiento ?? []).find((ex) => ex.id === exerciseId) ?? null;
}

/**
 * POST /api/session/swap-warmup-exercise
 * Body: { exerciseIdToReplace, reason: 'unavailable'|'preference', excludeEquipment?: boolean }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);
    const session = user?.currentSession;

    if (!session?.warmup?.length) {
      return res.status(400).json({ error: 'No hay calentamiento en la sesión activa' });
    }

    const { exerciseIdToReplace, reason = 'preference', excludeEquipment = false } = req.body ?? {};
    if (!exerciseIdToReplace) {
      return res.status(400).json({ error: 'exerciseIdToReplace requerido' });
    }
    if (!['unavailable', 'preference'].includes(reason)) {
      return res.status(400).json({ error: 'reason debe ser unavailable o preference' });
    }

    const catalog = await loadCatalog(db);
    const mesocycle = user.currentMesocycle ?? {};
    const goal = mesocycle.goal ?? user.profileData?.fitnessGoal ?? 'Hipertrofia';
    const safetyProfile = mesocycle.safetyProfile ?? user.profileData?.safetyProfile ?? {};

    let exercisePreferences = getUserExercisePreferences(user);

    if (reason === 'unavailable') {
      const source = findCatalogExercise(catalog, exerciseIdToReplace);
      const currentItem = session.warmup.find(
        (w) => w.exerciseId === exerciseIdToReplace || w.id === exerciseIdToReplace,
      );
      exercisePreferences = addExerciseExclusion(
        exercisePreferences,
        {
          exerciseId: exerciseIdToReplace,
          nombre: currentItem?.nombre ?? currentItem?.name ?? source?.nombre ?? exerciseIdToReplace,
          reason: 'unavailable',
          scope: 'all',
          equipmentTags: exerciseEquipmentList(source ?? currentItem ?? {}),
        },
        excludeEquipment,
      );
      await users.saveUser(userId, { exercisePreferences });
    }

    const { warmupExcludeIds, unavailableEquipment } = resolveExclusionFilters(exercisePreferences);
    const patterns =
      session.patterns ??
      SESSION_FOCUS_PATTERN_MAP[session.sessionFocus] ??
      [];
    const sessionMuscles = session.sessionMuscles ?? [];

    const result = replaceWarmupExercise(
      session.warmup,
      exerciseIdToReplace,
      catalog.calentamiento ?? [],
      {
        patterns,
        sessionMuscles,
        weekNumber: session.weekNumber ?? 1,
        sessionFocus: session.sessionFocus ?? '',
        prehab: safetyProfile.prehab ?? [],
        readiness: session.readinessAdjustment ?? {},
        goal,
        conservative: safetyProfile.conservative ?? false,
        excludeIds: warmupExcludeIds,
        unavailableEquipment,
      },
    );

    if (!result) {
      return res.status(404).json({ error: 'No hay alternativa de calentamiento para esta fase' });
    }

    const updatedSession = {
      ...session,
      warmup: result.warmup,
      swappedAt: new Date().toISOString(),
    };

    await users.saveSession(userId, updatedSession);

    return res.status(200).json({
      success: true,
      session: updatedSession,
      replacement: result.replacement,
      exercisePreferences: reason === 'unavailable' ? exercisePreferences : undefined,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/swap-warmup-exercise error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
