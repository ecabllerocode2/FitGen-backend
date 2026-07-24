/**
 * Gamification defaults and normalization.
 */

export function getCurrentSeasonId(date = new Date(), timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date));

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export function createDefaultGamification(referenceDate = new Date(), timezone = 'UTC') {
  return {
    lifetimeSessionsCompleted: 0,
    lifetimeActiveDays: 0,
    lifetimeWeeksPerfect: 0,
    lifetimeMesocyclesCompleted: 0,
    longestStreakDays: 0,
    currentStreakDays: 0,
    lastActiveDayKey: null,
    achievementsUnlocked: {},
    currentSeasonId: getCurrentSeasonId(referenceDate, timezone),
    seasonPoints: 0,
    seasonSessionsCompleted: 0,
    seasonWeeksPerfect: 0,
    fitCoinsBalance: 0,
    avatar: {
      baseStage: 0,
      equippedFrameId: null,
      equippedCelebrationId: null,
      equippedShareTemplateId: null,
    },
    inventory: {
      frames: [],
      celebrations: [],
      shareTemplates: ['default'],
    },
    lastSeasonRank: null,
    lastSeasonLeague: null,
    weekPointsKey: null,
    weekPointsEarned: 0,
    showInLeaderboard: false,
    publicDisplayName: null,
    premiumRedemptionsThisYear: 0,
    premiumRedemptionYear: null,
    updatedAt: new Date(referenceDate).toISOString(),
  };
}

export function normalizeGamification(raw, referenceDate = new Date(), timezone = 'UTC') {
  if (!raw || typeof raw !== 'object') {
    return createDefaultGamification(referenceDate, timezone);
  }

  const defaults = createDefaultGamification(referenceDate, timezone);

  return {
    ...defaults,
    ...raw,
    achievementsUnlocked:
      raw.achievementsUnlocked && typeof raw.achievementsUnlocked === 'object'
        ? { ...raw.achievementsUnlocked }
        : {},
    avatar: { ...defaults.avatar, ...(raw.avatar ?? {}) },
    inventory: {
      frames: Array.isArray(raw.inventory?.frames) ? [...raw.inventory.frames] : [],
      celebrations: Array.isArray(raw.inventory?.celebrations) ? [...raw.inventory.celebrations] : [],
      shareTemplates: Array.isArray(raw.inventory?.shareTemplates)
        ? [...raw.inventory.shareTemplates]
        : defaults.inventory.shareTemplates,
    },
    currentSeasonId: raw.currentSeasonId ?? defaults.currentSeasonId,
    weekPointsKey: raw.weekPointsKey ?? defaults.weekPointsKey,
    weekPointsEarned: raw.weekPointsEarned ?? defaults.weekPointsEarned,
    showInLeaderboard: raw.showInLeaderboard ?? defaults.showInLeaderboard,
    publicDisplayName: raw.publicDisplayName ?? defaults.publicDisplayName,
    premiumRedemptionsThisYear: raw.premiumRedemptionsThisYear ?? defaults.premiumRedemptionsThisYear,
    premiumRedemptionYear: raw.premiumRedemptionYear ?? defaults.premiumRedemptionYear,
    updatedAt: raw.updatedAt ?? defaults.updatedAt,
  };
}
