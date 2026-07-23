import { requireCoach, assertClientOwnership } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coachNoteSchema } from '../../schemas/coachSchema.js';
import { coaches } from '../../domain/coach/coachService.js';

/**
 * GET /api/coach/clients/:athleteId/notes
 * POST /api/coach/clients/:athleteId/notes
 */
export default async function handler(req, res) {
  try {
    const { coach, authUser } = await requireCoach(req);
    const athleteId = req.params?.athleteId ?? req.body?.athleteId;
    if (!athleteId) {
      return res.status(400).json({ error: 'athleteId requerido' });
    }

    await assertClientOwnership(coach.id, athleteId);

    if (req.method === 'GET') {
      const notes = await coaches.getClientNotes(coach.id, athleteId);
      return res.status(200).json({ success: true, notes });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    const parsed = coachNoteSchema.parse(req.body ?? {});
    const note = await coaches.addClientNote(coach.id, athleteId, {
      text: parsed.text,
      authorId: authUser.uid,
    });

    await coaches.logCoachAction({
      coachId: coach.id,
      athleteId,
      action: 'note_added',
    });

    return res.status(201).json({ success: true, note });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('coach/notes error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
