import { FieldValue } from 'firebase-admin/firestore';
import { classifyProfileChanges } from './profileChangeImpact.js';
import { adaptMesocycleToProfile } from '../periodization/adaptMesocycleToProfile.js';

/**
 * Applies the same mesocycle adaptation rules as POST /api/profile/save
 * when an athlete edits training profile with an active plan.
 *
 * @param {object} params
 * @param {import('../infrastructure/firebase/userRepository.js').createUserRepository} params.users
 * @param {string} params.userId
 * @param {object|null} params.existingUser
 * @param {object} params.existingProfile
 * @param {object} params.profileData normalized profile after merge
 * @param {boolean} [params.applyPlanChanges=true] when false, only saves profile fields
 */
export async function applyProfileAdaptation({
  users,
  userId,
  existingUser,
  existingProfile,
  profileData,
  applyPlanChanges = true,
}) {
  const existingMesocycle = existingUser?.currentMesocycle ?? null;

  let profileChange = {
    tier: 'metadata_only',
    requiresSessionClear: false,
    message: 'Perfil guardado.',
    details: {},
  };
  let planStatus = existingUser?.planStatus ?? 'active';
  let pendingProfileAdaptation = existingUser?.pendingProfileAdaptation ?? null;
  const userPatch = {
    lastProfileUpdate: new Date().toISOString(),
  };

  if (applyPlanChanges && existingMesocycle) {
    profileChange = classifyProfileChanges(existingProfile, profileData, existingMesocycle);

    if (profileChange.tier === 'periodization_deferred') {
      const currentWeek = existingMesocycle.currentWeek ?? 1;
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
  } else if (applyPlanChanges && !existingMesocycle) {
    planStatus = 'needs_regeneration';
  } else {
    planStatus = existingUser?.planStatus ?? 'active';
  }

  userPatch.planStatus = planStatus;
  if (pendingProfileAdaptation) {
    userPatch.pendingProfileAdaptation = pendingProfileAdaptation;
  } else if (applyPlanChanges) {
    userPatch.pendingProfileAdaptation = FieldValue.delete();
  }

  return { profileChange, userPatch, planStatus, pendingProfileAdaptation };
}
