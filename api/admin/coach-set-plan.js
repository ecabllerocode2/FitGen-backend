import { coachSetPlanSchema } from '../../schemas/coachSchema.js';
import { coaches } from '../../domain/coach/coachService.js';
import { syncCoachClaims } from '../../lib/coachClaims.js';
import { authenticateRequest } from '../../infrastructure/firebase/coachAuthMiddleware.js';

/**
 * POST /api/admin/coach-set-plan
 * Manual premium flag — no payment gateway v1.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    await authenticateRequest(req);
    const parsed = coachSetPlanSchema.parse(req.body ?? {});

    const coach = await coaches.updateCoachPlan(parsed.coachId, parsed.plan);
    if (!coach) {
      return res.status(404).json({ error: 'Coach no encontrado' });
    }

    await syncCoachClaims(parsed.coachId, { plan: parsed.plan });
    await coaches.logCoachAction({
      coachId: parsed.coachId,
      action: 'plan_updated',
      metadata: { plan: parsed.plan },
    });

    return res.status(200).json({ success: true, coach });
  } catch (err) {
    const status = err.status ?? (err.name === 'ZodError' ? 400 : 500);
    console.error('admin/coach-set-plan error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
