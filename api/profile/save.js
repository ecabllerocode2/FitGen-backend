import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { verifyFirebaseToken } from '../../infrastructure/firebase/authMiddleware.js';
import { normalizeProfileInput } from '../../lib/profileNormalizer.js';
import { applyProfileAdaptation } from '../../domain/athlete/applyProfileAdaptation.js';
import { buildProfileCompleteness } from '../../domain/coach/profileCompleteness.js';
import { ACCOUNT_TYPES, ATHLETE_ORIGINS } from '../../domain/coach/constants.js';

const users = createUserRepository(db);
const requireAuth = verifyFirebaseToken(auth);

/**
 * POST /api/profile/save
 * Saves profile, auto-approves user for beta (no payment gate).
 * Profile edits adapt the active mesocycle in-place when possible (DDS §8).
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

    const existingUser = await users.getUser(userId);

    let profileData;
    if (action === 'profile_metadata_update' && existingUser?.profileData) {
      const patch = {};
      if (['soft', 'slender', 'ectomorph'].includes(rawProfile.avatarStartingBuild)) {
        patch.avatarStartingBuild = rawProfile.avatarStartingBuild;
      }
      if (rawProfile.weightUnit === 'kg' || rawProfile.weightUnit === 'lb') {
        patch.weightUnit = rawProfile.weightUnit;
      }
      profileData = { ...existingUser.profileData, ...patch };
    } else {
      profileData = normalizeProfileInput(rawProfile);
    }

    const isProfileEdit = action === 'profile_update_and_invalidate_plan';

    await auth.setCustomUserClaims(userId, { role: 'approved', access: true });

    const profileCompleteness = buildProfileCompleteness(profileData);
    const userPatch = {
      userId,
      email: userEmail ?? existingUser?.email ?? null,
      status: 'approved',
      plan: 'free',
      profileData,
      profileCompleteness,
    };

    if (!existingUser?.accountType) {
      userPatch.accountType = ACCOUNT_TYPES.ATHLETE;
      userPatch.athleteOrigin = ATHLETE_ORIGINS.DIRECT;
    }

    let profileChange = {
      tier: 'metadata_only',
      requiresSessionClear: false,
      message: 'Perfil guardado.',
      details: {},
    };

    if (isProfileEdit) {
      const adaptation = await applyProfileAdaptation({
        users,
        userId,
        existingUser,
        existingProfile: existingUser?.profileData ?? null,
        profileData,
        applyPlanChanges: true,
      });
      profileChange = adaptation.profileChange;
      Object.assign(userPatch, adaptation.userPatch);
    } else {
      userPatch.planStatus = 'active';
      userPatch.lastProfileUpdate = new Date().toISOString();
    }

    await users.saveUser(userId, userPatch);

    return res.status(200).json({
      success: true,
      status: 'approved',
      experienceLevel: profileData.experienceLevel,
      planStatus: userPatch.planStatus,
      profileChange,
      message: profileChange.message,
    });
  } catch (err) {
    console.error('profile/save error:', err);
    return res.status(500).json({ error: err.message ?? 'Error interno' });
  }
}

export { requireAuth };
