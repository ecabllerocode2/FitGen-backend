import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coaches } from '../../domain/coach/coachService.js';

/**
 * POST /api/coach/invites/revoke
 * Body: { inviteId }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { coach } = await requireCoach(req);
    const { inviteId } = req.body ?? {};
    if (!inviteId) {
      return res.status(400).json({ error: 'inviteId requerido' });
    }

    const revoked = await coaches.revokeInvite(inviteId, coach.id);
    if (!revoked) {
      return res.status(404).json({ error: 'Invite no encontrado' });
    }

    await coaches.logCoachAction({
      coachId: coach.id,
      action: 'invite_revoked',
      metadata: { inviteId },
    });

    return res.status(200).json({ success: true, invite: revoked });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/invites/revoke error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
