import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import {
  celebrationExpiresAt,
  isCelebrationStorageConfigured,
  uploadCelebrationPng,
} from '../../infrastructure/r2/celebrationStorage.js';

const users = createUserRepository(db);

async function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return decoded.uid;
}

/**
 * POST /api/session/celebration-card
 * Body: { archivedSessionId, imageBase64 }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const userId = await authenticate(req);
    const { archivedSessionId, imageBase64 } = req.body ?? {};

    if (!archivedSessionId || !imageBase64) {
      return res.status(400).json({ error: 'archivedSessionId e imageBase64 son requeridos' });
    }

    const session = await users.getRecentSession(userId, archivedSessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sesión archivada no encontrada' });
    }

    if (!isCelebrationStorageConfigured()) {
      return res.status(200).json({
        success: true,
        stored: false,
        message: 'Almacenamiento R2 no configurado; tarjeta solo disponible localmente.',
      });
    }

    const base64Data = String(imageBase64).replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) {
      return res.status(400).json({ error: 'Imagen inválida' });
    }

    const celebrationCardUrl = await uploadCelebrationPng(userId, archivedSessionId, buffer);
    if (!celebrationCardUrl) {
      return res.status(503).json({ error: 'No se pudo subir la tarjeta de celebración' });
    }

    const celebrationCardExpiresAt = celebrationExpiresAt();
    await users.updateRecentSession(userId, archivedSessionId, {
      celebrationCardUrl,
      celebrationCardExpiresAt,
      celebrationSummary: {
        sessionFocus: session.sessionFocus ?? session.sessionName ?? 'Entrenamiento',
        durationLabel: session.summary?.duracionEstimada ?? '—',
        exerciseCount: session.summary?.ejerciciosTotales ?? 0,
        totalSets: session.summary?.seriesTotales ?? 0,
        muscles: session.summary?.musculosTrabajos ?? session.sessionMuscles ?? [],
        completedAt: session.completedAt ?? session.archivedAt,
      },
    });

    return res.status(200).json({
      success: true,
      stored: true,
      celebrationCardUrl,
      celebrationCardExpiresAt,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('session/celebration-card error:', err);
    return res.status(status).json({ error: err.message ?? 'Error interno' });
  }
}
