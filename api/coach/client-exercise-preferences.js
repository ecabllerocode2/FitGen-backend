import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { db } from '../../lib/firebaseAdmin.js';
import {
  getUserExercisePreferences,
  addExerciseExclusion,
  restoreExerciseExclusion,
} from '../../domain/athlete/exercisePreferences.js';
import { coaches } from '../../domain/coach/coachService.js';

const users = createUserRepository(db);

/**
 * POST /api/coach/clients/:athleteId/exercise-preferences
 * Body: { action: 'exclude'|'restore', exerciseId?, equipment?, nombre?, reason? }
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
    const { action, exerciseId, equipment, nombre, reason = 'coach_preference' } = req.body ?? {};

    let exercisePreferences = getUserExercisePreferences(user);

    if (action === 'exclude' && exerciseId) {
      exercisePreferences = addExerciseExclusion(exercisePreferences, {
        exerciseId,
        nombre: nombre ?? exerciseId,
        reason,
        scope: 'all',
        equipmentTags: equipment ? [equipment] : [],
      }, Boolean(equipment));
    } else if (action === 'restore') {
      exercisePreferences = restoreExerciseExclusion(exercisePreferences, { exerciseId, equipment });
    } else {
      return res.status(400).json({ error: 'action no soportada' });
    }

    await users.saveUser(athleteId, { exercisePreferences });

    await coaches.logCoachAction({
      coachId: coach.id,
      athleteId,
      action: 'exercise_preferences',
      metadata: { action, exerciseId, equipment },
    });

    return res.status(200).json({ success: true, exercisePreferences });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/exercise-preferences error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
