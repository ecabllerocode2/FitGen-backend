import { requireCoach } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { coaches } from '../../domain/coach/coachService.js';
import { generateInviteToken, hashToken } from '../../domain/coach/tokenUtils.js';
import { canConsumeSeat } from '../../domain/coach/seatLedger.js';
import { INVITE_STATUSES } from '../../domain/coach/constants.js';

/**
 * GET /api/coach/invites — list
 * POST /api/coach/invites — create
 */
export default async function handler(req, res) {
  try {
    const { coach, authUser } = await requireCoach(req);

    if (req.method === 'GET') {
      const list = await coaches.listInvites(coach.id);
      return res.status(200).json({ success: true, invites: list });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    const ledgerEntries = await coaches.getSeatLedgerEntries(coach.id);
    const seatCheck = canConsumeSeat({
      plan: coach.plan,
      ledgerEntries,
      emailHash: null,
    });

    if (!seatCheck.allowed) {
      return res.status(402).json({
        error: 'Límite de clientes alcanzado. Pasa a Premium para agregar más.',
        code: 'seat_limit_reached',
        requiresPremium: true,
        consumed: seatCheck.consumed,
        limit: seatCheck.limit,
      });
    }

    const token = generateInviteToken();
    const tokenHash = hashToken(token);
    const expiresAt = coaches.buildInviteExpiry();

    const invite = await coaches.createInvite(coach.id, {
      tokenHash,
      maxUses: 1,
      expiresAt,
    });

    await coaches.logCoachAction({
      coachId: coach.id,
      action: 'invite_created',
      metadata: { inviteId: invite.id },
    });

    const joinPath = `/join/${token}`;
    return res.status(201).json({
      success: true,
      invite: {
        id: invite.id,
        expiresAt: invite.expiresAt,
        joinPath,
        joinUrl: joinPath,
      },
      token,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('coach/invites error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
