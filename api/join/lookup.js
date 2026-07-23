import { db } from '../../lib/firebaseAdmin.js';
import { createCoachRepository } from '../../infrastructure/firebase/coachRepository.js';
import { hashToken } from '../../domain/coach/tokenUtils.js';
import { INVITE_STATUSES } from '../../domain/coach/constants.js';

const coaches = createCoachRepository(db);

/**
 * GET /api/join/:token
 * Public lookup — returns coach branding, no secrets.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const token = req.params?.token ?? req.query?.token;
    if (!token) {
      return res.status(400).json({ error: 'Token requerido' });
    }

    const tokenHash = hashToken(token);
    const invite = await coaches.getInviteByTokenHash(tokenHash);
    if (!invite) {
      return res.status(404).json({ error: 'Enlace inválido o expirado' });
    }

    if (invite.status !== INVITE_STATUSES.ACTIVE) {
      return res.status(410).json({ error: 'Este enlace ya no está disponible' });
    }

    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Este enlace ha expirado' });
    }

    const coach = await coaches.getCoach(invite.coachId);
    if (!coach) {
      return res.status(404).json({ error: 'Coach no encontrado' });
    }

    return res.status(200).json({
      success: true,
      invite: {
        id: invite.id,
        expiresAt: invite.expiresAt,
      },
      coach: {
        publicName: coach.branding?.publicName ?? coach.publicName ?? coach.displayName,
        displayName: coach.displayName,
        bio: coach.bio ?? '',
      },
    });
  } catch (err) {
    console.error('join/lookup error:', err);
    return res.status(500).json({ error: err.message ?? 'Error interno' });
  }
}
