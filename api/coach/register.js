import { coachRegisterSchema } from '../../schemas/coachSchema.js';
import { authenticateRequest } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { syncCoachClaims } from '../../lib/coachClaims.js';
import { ACCOUNT_TYPES } from '../../domain/coach/constants.js';
import { coaches, users } from '../../domain/coach/coachService.js';

/**
 * POST /api/coach/register
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const authUser = await authenticateRequest(req);
    const parsed = coachRegisterSchema.parse(req.body ?? {});

    const existingCoach = await coaches.getCoach(authUser.uid);
    if (existingCoach) {
      return res.status(200).json({ success: true, coach: existingCoach, alreadyRegistered: true });
    }

    const existingUser = await users.getUser(authUser.uid);
    if (existingUser?.accountType === ACCOUNT_TYPES.ATHLETE && existingUser?.currentMesocycle) {
      return res.status(400).json({
        error: 'Esta cuenta ya es de atleta. Usa otra cuenta para registrarte como coach.',
      });
    }

    const coach = await coaches.createCoach(authUser.uid, {
      displayName: parsed.displayName,
      publicName: parsed.publicName ?? parsed.displayName,
      bio: parsed.bio,
      slug: parsed.slug ?? null,
      email: authUser.email,
    });

    await users.saveUser(authUser.uid, {
      accountType: ACCOUNT_TYPES.COACH,
      status: 'approved',
      email: authUser.email,
      coachProfile: {
        displayName: parsed.displayName,
        publicName: parsed.publicName ?? parsed.displayName,
        bio: parsed.bio,
      },
    });

    await syncCoachClaims(authUser.uid, { plan: coach.plan });

    return res.status(201).json({ success: true, coach });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('coach/register error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
