import { normalizeGamification } from './defaults.js';
import {
  buildAchievementViews,
  buildAchievementSections,
  getNextLockedAchievement,
} from './achievements.js';

/**
 * Build API summary payload from user gamification state.
 * @param {object|null|undefined} rawGamification
 * @param {object} [options]
 */
export function buildGamificationSummary(rawGamification, options = {}) {
  const timezone = options.timezone ?? 'America/Mexico_City';
  const gamification = normalizeGamification(rawGamification, new Date(), timezone);
  const context = {
    experienceLevel: options.experienceLevel ?? null,
  };
  const achievements = buildAchievementViews(gamification, context);
  const achievementSections = buildAchievementSections(gamification, context);
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return {
    counters: {
      lifetimeSessionsCompleted: gamification.lifetimeSessionsCompleted,
      lifetimeActiveDays: gamification.lifetimeActiveDays,
      lifetimeWeeksPerfect: gamification.lifetimeWeeksPerfect,
      lifetimeMesocyclesCompleted: gamification.lifetimeMesocyclesCompleted,
      currentStreakDays: gamification.currentStreakDays,
      longestStreakDays: gamification.longestStreakDays,
      seasonPoints: gamification.seasonPoints,
      seasonSessionsCompleted: gamification.seasonSessionsCompleted,
      seasonWeeksPerfect: gamification.seasonWeeksPerfect,
      fitCoinsBalance: gamification.fitCoinsBalance,
      currentSeasonId: gamification.currentSeasonId,
    },
    avatar: gamification.avatar,
    achievements,
    achievementSections,
    unlockedCount,
    nextAchievement: getNextLockedAchievement(gamification, context),
    preferences: {
      showInLeaderboard: gamification.showInLeaderboard === true,
      publicDisplayName: gamification.publicDisplayName ?? null,
    },
    inventory: gamification.inventory,
    updatedAt: gamification.updatedAt,
  };
}
