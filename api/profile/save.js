import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { verifyFirebaseToken } from '../../infrastructure/firebase/authMiddleware.js';
import { normalizeProfileInput } from '../../lib/profileNormalizer.js';
import { calculateExperienceLevel } from '../../domain/athlete/experienceLevel.js';

const users = createUserRepository(db);
const requireAuth = verifyFirebaseToken(auth);

/**
 * POST /api/profile/save
 * Saves profile, auto-approves user for beta (no payment gate).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    let userId = req.body?.userId;
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = await auth.verifyIdToken(token);
      userId = decoded.uid;
    }

    if (!userId) {
      return res.status(400).json({ error: 'userId requerido' });
    }

    const { profileData: rawProfile, userEmail, action } = req.body;
    if (!rawProfile) {
      return res.status(400).json({ error: 'profileData requerido' });
    }

    const profileData = normalizeProfileInput(rawProfile);

    // Auto-aprobación beta: custom claim + status approved
    await auth.setCustomUserClaims(userId, { role: 'approved', access: true });

    const userDoc = {
      userId,
      email: userEmail ?? null,
      status: 'approved',
      plan: 'free',
      profileData,
      lastProfileUpdate: new Date().toISOString(),
      planStatus: action === 'profile_update_and_invalidate_plan' ? 'needs_regeneration' : 'active',
    };

    if (action === 'profile_update_and_invalidate_plan') {
      userDoc.currentMesocycle = null;
      userDoc.currentSession = null;
    }

    await users.saveUser(userId, userDoc);

    return res.status(200).json({
      success: true,
      status: 'approved',
      experienceLevel: profileData.experienceLevel,
      message: 'Perfil guardado. Acceso beta activado.',
    });
  } catch (err) {
    console.error('profile/save error:', err);
    return res.status(500).json({ error: err.message ?? 'Error interno' });
  }
}

export { requireAuth };
