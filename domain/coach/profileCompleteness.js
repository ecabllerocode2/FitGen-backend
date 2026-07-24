/**
 * Profile completeness for hybrid coached onboarding.
 * Direct athletes need both personal + training; coached clients can split the flow.
 */

export function isPersonalProfileComplete(profileData) {
  if (!profileData) return false;
  const weight = profileData.currentWeightKg ?? profileData.initialWeight;
  return Boolean(
    profileData.name?.trim() &&
      profileData.age >= 13 &&
      profileData.gender &&
      profileData.heightCm > 0 &&
      weight > 0,
  );
}

export function isTrainingProfileComplete(profileData) {
  if (!profileData) return false;
  const trainDays = profileData.trainingDaysPerWeek ?? 0;
  const schedule = profileData.weeklyScheduleContext ?? [];
  const trainableDays = schedule.filter((d) => d.canTrain).length;
  return Boolean(
    profileData.fitnessGoal &&
      profileData.trainingAgeMonths != null &&
      profileData.trainingAgeMonths >= 0 &&
      trainDays >= 2 &&
      trainableDays >= 2 &&
      schedule.length > 0,
  );
}

export function buildProfileCompleteness(profileData) {
  const personal = isPersonalProfileComplete(profileData);
  const training = isTrainingProfileComplete(profileData);
  return {
    personal,
    training,
    readyForMesocycle: personal && training,
  };
}
