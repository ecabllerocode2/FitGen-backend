import { normalizeGamification } from './defaults.js';
import {
  buildAchievementViews,
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
  const achievements = buildAchievementViews(gamification);
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
      fitCoinsBalance: gamification.fitCoinsBalance,
      currentSeasonId: gamification.currentSeasonId,
    },
    avatar: gamification.avatar,
    achievements,
    unlockedCount,
    nextAchievement: getNextLockedAchievement(gamification),
    updatedAt: gamification.updatedAt,
  };
}
