import { db } from '../../lib/firebaseAdmin.js';
import { createCoachRepository } from '../../infrastructure/firebase/coachRepository.js';
import { authenticateRequest } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coachPersonalProfileSchema } from '../../schemas/coachSchema.js';
import { hashToken } from '../../domain/coach/tokenUtils.js';
import {
  activateCoachedClient,
  mergeAthleteProfile,
  coaches,
  users,
} from '../../domain/coach/coachService.js';
import { INVITE_STATUSES, CLIENT_STATUSES, ACCOUNT_TYPES } from '../../domain/coach/constants.js';
import { normalizeProfileInput } from '../../lib/profileNormalizer.js';

/**
 * POST /api/join/:token/accept
 * Client accepts invite and submits personal profile.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const token = req.params?.token ?? req.body?.token;
    if (!token) {
      return res.status(400).json({ error: 'Token requerido' });
    }

    const authUser = await authenticateRequest(req);
    const tokenHash = hashToken(token);
    const invite = await coaches.getInviteByTokenHash(tokenHash);

    if (!invite || invite.status !== INVITE_STATUSES.ACTIVE) {
      return res.status(410).json({ error: 'Enlace inválido o no disponible' });
    }

    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Enlace expirado' });
    }

    const existingUser = await users.getUser(authUser.uid);
    if (existingUser?.accountType === ACCOUNT_TYPES.COACH) {
      return res.status(400).json({ error: 'Las cuentas de coach no pueden unirse como cliente.' });
    }

    const existingRelation = await coaches.getClientRelation(invite.coachId, authUser.uid);
    if (!existingRelation) {
      await activateCoachedClient({
        coachId: invite.coachId,
        athleteId: authUser.uid,
        athleteEmail: authUser.email,
        inviteId: invite.id,
      });
      await coaches.incrementInviteUse(invite.id);
    }

    const parsed = coachPersonalProfileSchema.parse(req.body?.profileData ?? req.body ?? {});
    const personalPatch = normalizeProfileInput({
      ...parsed,
      timezone: parsed.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    const { profileData, profileCompleteness } = await mergeAthleteProfile(authUser.uid, personalPatch);

    await coaches.saveClientRelation(invite.coachId, authUser.uid, {
      status: profileCompleteness.personal
        ? CLIENT_STATUSES.ONBOARDING_COACH
        : CLIENT_STATUSES.ONBOARDING_CLIENT,
      clientCompletedAt: new Date().toISOString(),
    });

    await coaches.logCoachAction({
      coachId: invite.coachId,
      athleteId: authUser.uid,
      action: 'client_joined',
      metadata: { inviteId: invite.id },
    });

    const coach = await coaches.getCoach(invite.coachId);

    return res.status(200).json({
      success: true,
      profileData,
      profileCompleteness,
      coach: {
        id: invite.coachId,
        publicName: coach?.branding?.publicName ?? coach?.displayName,
      },
      status: profileCompleteness.personal ? 'onboarding_coach' : 'onboarding_client',
    });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('join/accept error:', err);
    return res.status(status).json({
      error: err.message ?? 'Error interno',
      code: err.code,
      requiresPremium: err.requiresPremium,
    });
  }
}
