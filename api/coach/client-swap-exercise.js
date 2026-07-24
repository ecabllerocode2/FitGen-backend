import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { db } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { loadCatalog } from '../../infrastructure/catalog/catalogRepository.js';
import { selectExercises } from '../../domain/exerciseSelection/selector.js';
import { isBodyweightExercise } from '../../domain/exerciseSelection/bodyweight.js';
import { prescribeLoad, buildLoadHistoryFromSessions } from '../../domain/prescription/loadCalculator.js';
import { EXERCISE_TYPES } from '../../domain/constants.js';
import {
  addExerciseExclusion,
  exerciseEquipmentList,
  getUserExercisePreferences,
  resolveExclusionFilters,
} from '../../domain/athlete/exercisePreferences.js';
import { setContinuityReplacement } from '../../domain/athlete/continuityPreferences.js';
import { coaches } from '../../domain/coach/coachService.js';

const users = createUserRepository(db);

function buildExerciseHistory(history, exerciseId, movementPattern, priority, ledger, experienceLevel) {
  return buildLoadHistoryFromSessions(history, exerciseId, movementPattern, priority, ledger, experienceLevel);
}

/**
 * POST /api/coach/clients/:athleteId/swap-exercise
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const athleteId = req.params?.athleteId ?? req.body?.athleteId;
    if (!athleteId) {
      return res.status(400).json({ error: 'athleteId requerido' });
    }

    await assertClientOwnership(coach.id, athleteId);

    const user = await users.getUser(athleteId);
    const session = user?.currentSession;
    if (!session) {
      return res.status(400).json({ error: 'El cliente no tiene sesión activa' });
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
    const goal = user.currentMesocycle?.goal ?? user.profileData?.fitnessGoal ?? 'Hipertrofia';

    let exercisePreferences = getUserExercisePreferences(user);

    if (reason === 'unavailable') {
      const source =
        (catalog.entrenamiento ?? []).find((ex) => ex.id === exerciseIdToReplace) ??
        (session.mainBlock ?? []).find((ex) => ex.exerciseId === exerciseIdToReplace);
      exercisePreferences = addExerciseExclusion(exercisePreferences, {
        exerciseId: exerciseIdToReplace,
        nombre: source?.nombre ?? source?.exerciseName ?? exerciseIdToReplace,
        reason: 'unavailable',
        scope: 'all',
        equipmentTags: exerciseEquipmentList(source ?? {}),
      }, excludeEquipment);
      await users.saveUser(athleteId, { exercisePreferences });
    }

    const history = await users.getRecentSessions(athleteId, 30);
    const { excludeIds } = resolveExclusionFilters(exercisePreferences);
    const currentIds = (session.mainBlock ?? []).map((e) => e.exerciseId);
    const sessionMuscles = session.sessionMuscles ?? [];

    const alternatives = selectExercises(focus, catalog.entrenamiento ?? [], safetyProfile, history, goal, {
      excludeIds: [...new Set([...currentIds, ...excludeIds])],
      rotationExcludeIds: [],
      weekNumber: session.weekNumber ?? 1,
      sessionMuscles,
      mesocycleId,
      trainingDaysPerWeek: user.profileData?.trainingDaysPerWeek ?? 3,
      continuityOverrides: user.continuityOverrides ?? {},
    });

    const replacement = alternatives.find((e) => e.id !== exerciseIdToReplace) ?? alternatives[0];
    if (!replacement) {
      return res.status(404).json({ error: 'No hay ejercicio alternativo disponible' });
    }

    const mainBlock = (session.mainBlock ?? []).map((ex) => {
      if (ex.exerciseId !== exerciseIdToReplace) return ex;
      const bodyweight = isBodyweightExercise(replacement, catalog.entrenamiento ?? []);
      const exerciseType =
        (replacement.prioridad ?? 2) === 1 ? EXERCISE_TYPES.COMPOUND : EXERCISE_TYPES.ISOLATION;
      const exerciseHistory = buildExerciseHistory(
        history,
        replacement.id,
        replacement.patronMovimiento,
        replacement.prioridad ?? 2,
        user.loadPerformanceLedger,
        safetyProfile?.experienceLevel ?? user.profileData?.experienceLevel ?? 'Intermedio',
      );
      const load = prescribeLoad({
        exerciseType,
        rirTarget: ex.rirTarget ?? 2,
        repRange: ex.repRange ?? '8-12',
        history: exerciseHistory,
        bodyWeightKg: user.profileData?.currentWeightKg,
        movementPattern: replacement.patronMovimiento,
        isBodyweight: bodyweight,
        exerciseId: replacement.id,
        equipo: replacement.equipo,
        isUnilateral: replacement.isUnilateral === true,
      });

      return {
        ...ex,
        exerciseId: replacement.id,
        exerciseName: replacement.nombre,
        muscleGroup: replacement.parteCuerpo,
        movementPattern: replacement.patronMovimiento,
        imageUrl: replacement.url_img_0 ?? null,
        imageUrl2: replacement.url_img_1 ?? null,
        swappedFrom: exerciseIdToReplace,
        isBodyweight: bodyweight,
        equipo: replacement.equipo ?? [],
        isUnilateral: replacement.isUnilateral === true,
        loadMode: load.mode,
        loadConvention: load.loadConvention ?? null,
        prescribedLoadKg: load.prescribedLoadKg ?? null,
        suggestedLoadKg: load.suggestedLoadKg ?? null,
        loadExplanation: load.explanation ?? null,
        priority: replacement.prioridad ?? ex.priority ?? 2,
      };
    });

    const updatedSession = { ...session, mainBlock };
    await users.saveSession(athleteId, updatedSession);

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
      await users.saveUser(athleteId, userPatch);
    }

    await coaches.logCoachAction({
      coachId: coach.id,
      athleteId,
      action: 'swap_exercise',
      metadata: { exerciseIdToReplace, replacementId: replacement.id, reason },
    });

    return res.status(200).json({
      success: true,
      session: updatedSession,
      replacement: { id: replacement.id, nombre: replacement.nombre },
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/swap-exercise error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
