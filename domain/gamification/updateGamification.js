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
const READINESS_POINTS = 2;
const FEEDBACK_POINTS = 2;
const E1RM_PR_POINTS = 5;
const E1RM_PR_MAX_PER_SESSION = 3;
const WEEK_PERFECT_POINTS = 25;
const WEEK_PERFECT_FITCOINS = 5;
const STREAK_GAP_DAYS = 3;
const WEEKLY_POINTS_CAP = 120;

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
 * Monday-based week key in user timezone (yyyy-MM-dd).
 */
export function toWeekKey(isoDate, timezone = 'UTC') {
  const date = isoDate instanceof Date ? isoDate : new Date(isoDate);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '01');

  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const mondayOffset = weekdayIndex === 0 ? -6 : 1 - weekdayIndex;
  const monday = new Date(Date.UTC(Number(year), Number(month) - 1, day + mondayOffset, 12));
  const mondayYear = monday.getUTCFullYear();
  const mondayMonth = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const mondayDay = String(monday.getUTCDate()).padStart(2, '0');
  return `${mondayYear}-${mondayMonth}-${mondayDay}`;
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

function syncWeekPointsBucket(gamification, referenceDate, timezone) {
  const next = { ...gamification };
  const weekKey = toWeekKey(referenceDate, timezone);
  if (next.weekPointsKey !== weekKey) {
    next.weekPointsKey = weekKey;
    next.weekPointsEarned = 0;
  }
  return next;
}

/**
 * Apply weekly cap and mutate gamification counters.
 * @returns {{ appliedPoints: number, cappedByWeeklyLimit: boolean }}
 */
function applySeasonPoints(gamification, pointsToAdd, referenceDate, timezone) {
  const synced = syncWeekPointsBucket(gamification, referenceDate, timezone);
  const remaining = Math.max(0, WEEKLY_POINTS_CAP - (synced.weekPointsEarned ?? 0));
  const appliedPoints = Math.min(pointsToAdd, remaining);

  synced.weekPointsEarned = (synced.weekPointsEarned ?? 0) + appliedPoints;
  synced.seasonPoints = (synced.seasonPoints ?? 0) + appliedPoints;

  return {
    gamification: synced,
    appliedPoints,
    cappedByWeeklyLimit: appliedPoints < pointsToAdd,
  };
}

function buildBreakdownEntry(label, points = 0, fitCoins = 0) {
  return { label, points, fitCoins };
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
  hasPreReadiness = false,
  hasPostFeedback = false,
  volumeMetTarget = true,
  e1rmRecords = [],
}) {
  const referenceDate = new Date(completedAt);
  let next = normalizeGamification(gamification, referenceDate, timezone);
  next = applySeasonRollover(next, referenceDate, timezone);

  const dayKey = toDayKey(completedAt, timezone);
  let seasonPointsEarned = 0;
  let fitCoinsEarned = 0;
  const breakdown = [];
  let weeklyCapHit = false;

  if (volumeMetTarget) {
    seasonPointsEarned += SESSION_POINTS;
    fitCoinsEarned += SESSION_FITCOINS;
    breakdown.push(buildBreakdownEntry('Sesión completada', SESSION_POINTS, SESSION_FITCOINS));
  }

  if (hasPreReadiness) {
    seasonPointsEarned += READINESS_POINTS;
    breakdown.push(buildBreakdownEntry('Readiness pre-entreno', READINESS_POINTS, 0));
  }

  if (hasPostFeedback) {
    seasonPointsEarned += FEEDBACK_POINTS;
    breakdown.push(buildBreakdownEntry('Feedback post-entreno', FEEDBACK_POINTS, 0));
  }

  const prs = (e1rmRecords ?? []).slice(0, E1RM_PR_MAX_PER_SESSION);
  for (const pr of prs) {
    seasonPointsEarned += E1RM_PR_POINTS;
    breakdown.push(
      buildBreakdownEntry(`Récord e1RM · ${pr.exerciseName ?? pr.exerciseId}`, E1RM_PR_POINTS, 0),
    );
  }

  if (volumeMetTarget) {
    next.lifetimeSessionsCompleted += 1;
    next.seasonSessionsCompleted += 1;
  }

  if (volumeMetTarget && next.lastActiveDayKey !== dayKey) {
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
      breakdown.push(
        buildBreakdownEntry('Semana perfecta', WEEK_PERFECT_POINTS, WEEK_PERFECT_FITCOINS),
      );
    }
  }

  const pointsResult = applySeasonPoints(next, seasonPointsEarned, referenceDate, timezone);
  next = pointsResult.gamification;
  weeklyCapHit = pointsResult.cappedByWeeklyLimit;
  seasonPointsEarned = pointsResult.appliedPoints;

  next.fitCoinsBalance += fitCoinsEarned;
  next.updatedAt = referenceDate.toISOString();

  const newlyUnlocked = evaluateAchievements(next);
  next = mergeAchievementUnlocks(next, newlyUnlocked);

  return {
    gamification: next,
    delta: {
      seasonPointsEarned,
      fitCoinsEarned,
      newAchievements: newlyUnlocked.map(({ id, title, description, milestone, unlockedAt }) => ({
        id,
        title,
        description,
        milestone: milestone ?? false,
        unlockedAt,
      })),
      avatarStageUp: false,
      currentStreakDays: next.currentStreakDays,
      weekPerfectBonus,
      volumeMetTarget,
      weeklyCapHit,
      e1rmRecords: prs.map(({ exerciseId, exerciseName, previousE1RM, newE1RM }) => ({
        exerciseId,
        exerciseName,
        previousE1RM,
        newE1RM,
      })),
      breakdown,
      newSeasonPointsTotal: next.seasonPoints,
      newFitCoinsTotal: next.fitCoinsBalance,
      lifetimeSessionsCompleted: next.lifetimeSessionsCompleted,
    },
  };
}

const MESOCYCLE_POINTS = 50;
const MESOCYCLE_FITCOINS = 15;
const MESOCYCLE_MIN_COMPLETION_RATE = 0.75;

/**
 * Apply gamification updates after mesocycle evaluation.
 * @param {object} params
 */
export function applyMesocycleEvaluateGamification({
  gamification,
  evaluatedAt,
  timezone = 'America/Mexico_City',
  mesocycleCompletionRate = 1,
  previousExperienceLevel,
  newExperienceLevel,
}) {
  const referenceDate = new Date(evaluatedAt);
  let next = normalizeGamification(gamification, referenceDate, timezone);
  next = applySeasonRollover(next, referenceDate, timezone);

  let seasonPointsEarned = 0;
  let fitCoinsEarned = 0;
  let mesocycleCounted = false;
  const breakdown = [];

  if (mesocycleCompletionRate >= MESOCYCLE_MIN_COMPLETION_RATE) {
    next.lifetimeMesocyclesCompleted += 1;
    seasonPointsEarned += MESOCYCLE_POINTS;
    fitCoinsEarned += MESOCYCLE_FITCOINS;
    mesocycleCounted = true;
    breakdown.push(
      buildBreakdownEntry('Mesociclo evaluado', MESOCYCLE_POINTS, MESOCYCLE_FITCOINS),
    );
  }

  const pointsResult = applySeasonPoints(next, seasonPointsEarned, referenceDate, timezone);
  next = pointsResult.gamification;
  seasonPointsEarned = pointsResult.appliedPoints;

  next.fitCoinsBalance += fitCoinsEarned;
  next.updatedAt = referenceDate.toISOString();

  const achievementContext = {
    previousExperienceLevel,
    newExperienceLevel,
    experienceLevel: newExperienceLevel,
  };
  const newlyUnlocked = evaluateAchievements(next, achievementContext);
  next = mergeAchievementUnlocks(next, newlyUnlocked);

  return {
    gamification: next,
    delta: {
      seasonPointsEarned,
      fitCoinsEarned,
      newAchievements: newlyUnlocked.map(({ id, title, description, milestone, unlockedAt }) => ({
        id,
        title,
        description,
        milestone: milestone ?? false,
        unlockedAt,
      })),
      avatarStageUp: false,
      mesocycleCounted,
      breakdown,
      newSeasonPointsTotal: next.seasonPoints,
      newFitCoinsTotal: next.fitCoinsBalance,
      lifetimeMesocyclesCompleted: next.lifetimeMesocyclesCompleted,
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
      hasPreReadiness: true,
      hasPostFeedback: true,
      volumeMetTarget: true,
      e1rmRecords: [],
    });
    gamification = result.gamification;
  }

  return {
    ...gamification,
    _backfillNote: 'partial-from-recent-only',
  };
}
