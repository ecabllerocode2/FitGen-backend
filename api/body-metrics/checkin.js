import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import {
  appendBodyMetricEntry,
  getCheckinStatus,
  normalizeBodyMetricsEntry,
} from '../../domain/athlete/bodyMetrics.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/body-metrics/checkin
 * GET  /api/body-metrics/checkin — status + recent history
 */
export default async function handler(req, res) {
  try {
    const userId = await authenticate(req);
    const user = await users.getUser(userId);

    if (req.method === 'GET') {
      const bodyMetrics = user?.bodyMetrics ?? { entries: [] };
      const status = getCheckinStatus(bodyMetrics);
      const recent = (bodyMetrics.entries ?? []).slice(-24).reverse();
      return res.status(200).json({
        success: true,
        status,
        recent,
        latest: bodyMetrics.latest ?? null,
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    const raw = req.body?.metrics ?? req.body ?? {};
    const kind = raw.kind === 'full' ? 'full' : 'light';
    const weightKg = raw.weightKg ?? raw.weight;
    const waistCm = raw.waistCm ?? raw.waist;

    if (weightKg == null || !Number.isFinite(Number(weightKg))) {
      return res.status(400).json({ error: 'weightKg es requerido' });
    }
    if (kind === 'light' && (waistCm == null || !Number.isFinite(Number(waistCm)))) {
      return res.status(400).json({ error: 'waistCm es requerido en check-in ligero' });
    }

    const entry = normalizeBodyMetricsEntry({
      ...raw,
      weightKg: Number(weightKg),
      waistCm: waistCm != null ? Number(waistCm) : null,
      hipCm: raw.hipCm != null ? Number(raw.hipCm) : null,
      armCm: raw.armCm != null ? Number(raw.armCm) : null,
      thighCm: raw.thighCm != null ? Number(raw.thighCm) : null,
      kind,
      source: raw.source ?? 'app',
    });

    const bodyMetrics = appendBodyMetricEntry(user?.bodyMetrics ?? {}, entry);
    const profileData = {
      ...(user?.profileData ?? {}),
      currentWeightKg: entry.weightKg,
    };

    await users.saveUser(userId, { bodyMetrics, profileData });

    return res.status(200).json({
      success: true,
      entry,
      status: getCheckinStatus(bodyMetrics),
      bodyMetrics,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('body-metrics/checkin error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
