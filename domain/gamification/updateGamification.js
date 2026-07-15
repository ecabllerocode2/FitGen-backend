import {
  normalizeGamification,
  getCurrentSeasonId,
  createDefaultGamification,
} from './defaults.js';
import {
  evaluateAchievements,
  mergeAchievementUnlocks,
} from './achievements.js';
import { assessWeekCompletion } from './weekCompletion.js';

const SESSION_POINTS = 10;
const SESSION_FITCOINS = 2;
const FEEDBACK_POINTS = 2;
const WEEK_PERFECT_POINTS = 25;
const WEEK_PERFECT_FITCOINS = 5;
const STREAK_GAP_DAYS = 3;

/**
 * Calendar day key in user timezone (yyyy-MM-dd).
 * @param {string|Date} isoDate
 * @param {string} timezone
 */
export function toDayKey(isoDate, timezone = 'UTC') {
  const date = isoDate instanceof Date ? isoDate : new Date(isoDate);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * Whole calendar days between two day keys.
 */
export function daysBetweenDayKeys(earlierKey, laterKey) {
  const start = new Date(`${earlierKey}T12:00:00.000Z`);
  const end = new Date(`${laterKey}T12:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Lazy season rollover when month changes.
 */
export function applySeasonRollover(gamification, referenceDate, timezone) {
  const next = { ...gamification };
  const seasonId = getCurrentSeasonId(referenceDate, timezone);
  if (next.currentSeasonId === seasonId) return next;

  next.currentSeasonId = seasonId;
  next.seasonPoints = 0;
  next.seasonSessionsCompleted = 0;
  next.seasonWeeksPerfect = 0;
  return next;
}

/**
 * Apply gamification updates after session complete.
 * @param {object} params
 */
export function applySessionCompleteGamification({
  gamification,
  completedAt,
  timezone = 'America/Mexico_City',
  weekClosed = false,
  mesocycle = null,
  weekNumber = 1,
  recentSessions = [],
  completedSession = null,
  hasFeedback = true,
}) {
  const referenceDate = new Date(completedAt);
  let next = normalizeGamification(gamification, referenceDate, timezone);
  next = applySeasonRollover(next, referenceDate, timezone);

  const dayKey = toDayKey(completedAt, timezone);
  let seasonPointsEarned = SESSION_POINTS;
  let fitCoinsEarned = SESSION_FITCOINS;

  if (hasFeedback) seasonPointsEarned += FEEDBACK_POINTS;

  next.lifetimeSessionsCompleted += 1;
  next.seasonSessionsCompleted += 1;

  if (next.lastActiveDayKey !== dayKey) {
    next.lifetimeActiveDays += 1;

    if (next.lastActiveDayKey) {
      const gap = daysBetweenDayKeys(next.lastActiveDayKey, dayKey);
      if (gap > 0 && gap <= STREAK_GAP_DAYS) {
        next.currentStreakDays += 1;
      } else if (gap > STREAK_GAP_DAYS) {
        next.currentStreakDays = 1;
      }
    } else {
      next.currentStreakDays = 1;
    }

    next.lastActiveDayKey = dayKey;
  }

  next.longestStreakDays = Math.max(next.longestStreakDays, next.currentStreakDays);

  let weekPerfectBonus = false;
  if (weekClosed && mesocycle) {
    const { isPerfect } = assessWeekCompletion(
      mesocycle,
      weekNumber,
      recentSessions,
      completedSession,
    );
    if (isPerfect) {
      next.lifetimeWeeksPerfect += 1;
      next.seasonWeeksPerfect += 1;
      seasonPointsEarned += WEEK_PERFECT_POINTS;
      fitCoinsEarned += WEEK_PERFECT_FITCOINS;
      weekPerfectBonus = true;
    }
  }

  next.seasonPoints += seasonPointsEarned;
  next.fitCoinsBalance += fitCoinsEarned;
  next.updatedAt = referenceDate.toISOString();

  const newlyUnlocked = evaluateAchievements(next);
  next = mergeAchievementUnlocks(next, newlyUnlocked);

  return {
    gamification: next,
    delta: {
      seasonPointsEarned,
      fitCoinsEarned,
      newAchievements: newlyUnlocked.map(({ id, title, description, unlockedAt }) => ({
        id,
        title,
        description,
        unlockedAt,
      })),
      avatarStageUp: false,
      currentStreakDays: next.currentStreakDays,
      weekPerfectBonus,
      lifetimeSessionsCompleted: next.lifetimeSessionsCompleted,
    },
  };
}

/**
 * Estimate gamification from recent sessions (backfill only).
 * @param {object[]} sessions — completed sessions sorted any order
 * @param {string} timezone
 */
export function estimateGamificationFromSessions(sessions = [], timezone = 'America/Mexico_City') {
  const base = createDefaultGamification(new Date(), timezone);
  if (!sessions.length) return base;

  const completed = sessions
    .filter((s) => s.completed !== false)
    .map((s) => ({
      ...s,
      _at: s.completedAt ?? s.archivedAt ?? s.generatedAt,
    }))
    .filter((s) => s._at)
    .sort((a, b) => new Date(a._at).getTime() - new Date(b._at).getTime());

  let gamification = { ...base };

  for (const session of completed) {
    const result = applySessionCompleteGamification({
      gamification,
      completedAt: session._at,
      timezone,
      weekClosed: false,
      mesocycle: null,
      weekNumber: session.weekNumber ?? 1,
      recentSessions: [],
      completedSession: session,
      hasFeedback: true,
    });
    gamification = result.gamification;
  }

  return {
    ...gamification,
    _backfillNote: 'partial-from-recent-only',
  };
}
