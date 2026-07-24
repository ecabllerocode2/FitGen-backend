import { authenticateRequest } from '../../infrastructure/firebase/coachAuthMiddleware.js';
import { users, coaches } from '../../domain/coach/coachService.js';
import { isPremiumPlan } from '../../domain/coach/constants.js';

/**
 * GET /api/athlete/share-branding
 * Returns share card footer branding for coached athletes.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const authUser = await authenticateRequest(req);
    const athlete = await users.getUser(authUser.uid);

    if (athlete?.athleteOrigin !== 'coached' || !athlete?.coachId) {
      return res.status(200).json({
        success: true,
        branding: { footer: 'default' },
        footerText: 'Entrenamiento completado con FitGen',
      });
    }

    const coach = await coaches.getCoach(athlete.coachId);
    const publicName = coach?.branding?.publicName ?? coach?.publicName ?? coach?.displayName ?? 'Coach';

    if (isPremiumPlan(coach?.plan)) {
      return res.status(200).json({
        success: true,
        branding: { footer: 'coached_premium', coachName: publicName },
        footerText: `Coached by ${publicName} · Powered by FitGen`,
      });
    }

    return res.status(200).json({
      success: true,
      branding: { footer: 'coached_free' },
      footerText: 'Powered by FitGen',
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('athlete/share-branding error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
