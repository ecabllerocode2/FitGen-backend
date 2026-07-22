import { FieldValue } from 'firebase-admin/firestore';
import { db, auth } from '../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { verifyFirebaseToken } from '../../infrastructure/firebase/authMiddleware.js';
import { normalizeProfileInput } from '../../lib/profileNormalizer.js';
import { classifyProfileChanges } from '../../domain/athlete/profileChangeImpact.js';
import { adaptMesocycleToProfile } from '../../domain/periodization/adaptMesocycleToProfile.js';

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
      profileData = { ...existingUser.profileData, ...patch };
    } else {
      profileData = normalizeProfileInput(rawProfile);
    }

    const isProfileEdit = action === 'profile_update_and_invalidate_plan';
    const existingMesocycle = existingUser?.currentMesocycle ?? null;

    await auth.setCustomUserClaims(userId, { role: 'approved', access: true });

    let profileChange = {
      tier: 'metadata_only',
      requiresSessionClear: false,
      message: 'Perfil guardado.',
      details: {},
    };

    let planStatus = existingUser?.planStatus ?? 'active';
    let pendingProfileAdaptation = existingUser?.pendingProfileAdaptation ?? null;
    const userPatch = {
      userId,
      email: userEmail ?? existingUser?.email ?? null,
      status: 'approved',
      plan: 'free',
      profileData,
      lastProfileUpdate: new Date().toISOString(),
    };

    if (isProfileEdit && existingMesocycle) {
      profileChange = classifyProfileChanges(
        existingUser?.profileData ?? null,
        profileData,
        existingMesocycle,
      );

      if (profileChange.tier === 'periodization_deferred') {
        const currentWeek =
          existingMesocycle.currentWeek ??
          1;
        pendingProfileAdaptation = {
          type: 'periodization',
          effectiveFromWeek: currentWeek + 1,
          appliedAt: null,
          goal: profileData.fitnessGoal,
          experienceLevel: profileData.experienceLevel,
          trainingAgeMonths: profileData.trainingAgeMonths,
        };
        planStatus = 'active';
      } else if (
        profileChange.tier === 'schedule_remap' ||
        profileChange.tier === 'safety_update' ||
        profileChange.tier === 'partial_regeneration'
      ) {
        const adapted = adaptMesocycleToProfile(
          existingMesocycle,
          profileData,
          profileChange,
          new Date(),
        );
        await users.saveMesocycle(userId, adapted);
        planStatus = 'active';
        pendingProfileAdaptation = null;

        if (profileChange.requiresSessionClear) {
          userPatch.currentSession = FieldValue.delete();
        }
      } else {
        planStatus = 'active';
      }
    } else if (isProfileEdit && !existingMesocycle) {
      planStatus = 'needs_regeneration';
    } else {
      planStatus = 'active';
    }

    userPatch.planStatus = planStatus;
    if (pendingProfileAdaptation) {
      userPatch.pendingProfileAdaptation = pendingProfileAdaptation;
    } else if (isProfileEdit) {
      userPatch.pendingProfileAdaptation = FieldValue.delete();
    }

    await users.saveUser(userId, userPatch);

    return res.status(200).json({
      success: true,
      status: 'approved',
      experienceLevel: profileData.experienceLevel,
      planStatus,
      profileChange,
      message: profileChange.message,
    });
  } catch (err) {
    console.error('profile/save error:', err);
    return res.status(500).json({ error: err.message ?? 'Error interno' });
  }
}

export { requireAuth };
