import { describe, it, expect } from 'vitest';
import {
  createDefaultGamification,
  normalizeGamification,
  getCurrentSeasonId,
} from '../domain/gamification/defaults.js';
import {
  evaluateAchievements,
  mergeAchievementUnlocks,
  buildAchievementViews,
  buildAchievementSections,
  getNextLockedAchievement,
} from '../domain/gamification/achievements.js';
import {
  applySessionCompleteGamification,
  applyMesocycleEvaluateGamification,
  toDayKey,
  daysBetweenDayKeys,
  estimateGamificationFromSessions,
} from '../domain/gamification/updateGamification.js';
import { assessWeekCompletion } from '../domain/gamification/weekCompletion.js';
import { buildGamificationSummary } from '../domain/gamification/summary.js';

describe('gamification defaults', () => {
  it('creates zeroed gamification state', () => {
    const g = createDefaultGamification(new Date('2026-07-15T12:00:00.000Z'), 'UTC');
    expect(g.lifetimeSessionsCompleted).toBe(0);
    expect(g.achievementsUnlocked).toEqual({});
    expect(g.inventory.shareTemplates).toContain('default');
  });

  it('normalizes partial gamification objects', () => {
    const g = normalizeGamification({ lifetimeSessionsCompleted: 5 });
    expect(g.lifetimeSessionsCompleted).toBe(5);
    expect(g.avatar.baseStage).toBe(0);
  });
});

describe('applySessionCompleteGamification', () => {
  it('increments lifetime session counter and awards first session achievement', () => {
    const { gamification, delta } = applySessionCompleteGamification({
      gamification: null,
      completedAt: '2026-07-15T18:00:00.000Z',
      timezone: 'UTC',
      hasPreReadiness: true,
      hasPostFeedback: true,
    });

    expect(gamification.lifetimeSessionsCompleted).toBe(1);
    expect(gamification.lifetimeActiveDays).toBe(1);
    expect(gamification.currentStreakDays).toBe(1);
    expect(delta.seasonPointsEarned).toBe(14);
    expect(delta.fitCoinsEarned).toBe(2);
    expect(delta.newAchievements.some((a) => a.id === 'first-session')).toBe(true);
    expect(gamification.achievementsUnlocked['first-session']).toBeDefined();
  });

  it('does not duplicate active days on same calendar day', () => {
    let state = null;
    ({ gamification: state } = applySessionCompleteGamification({
      gamification: state,
      completedAt: '2026-07-15T10:00:00.000Z',
      timezone: 'UTC',
    }));
    ({ gamification: state } = applySessionCompleteGamification({
      gamification: state,
      completedAt: '2026-07-15T20:00:00.000Z',
      timezone: 'UTC',
    }));

    expect(state.lifetimeSessionsCompleted).toBe(2);
    expect(state.lifetimeActiveDays).toBe(1);
  });

  it('extends streak when gap is within 3 days', () => {
    let state = null;
    ({ gamification: state } = applySessionCompleteGamification({
      gamification: state,
      completedAt: '2026-07-13T10:00:00.000Z',
      timezone: 'UTC',
    }));
    ({ gamification: state } = applySessionCompleteGamification({
      gamification: state,
      completedAt: '2026-07-15T10:00:00.000Z',
      timezone: 'UTC',
    }));

    expect(state.currentStreakDays).toBe(2);
    expect(state.longestStreakDays).toBe(2);
  });

  it('resets streak after long inactivity', () => {
    let state = null;
    ({ gamification: state } = applySessionCompleteGamification({
      gamification: state,
      completedAt: '2026-07-01T10:00:00.000Z',
      timezone: 'UTC',
    }));
    ({ gamification: state } = applySessionCompleteGamification({
      gamification: state,
      completedAt: '2026-07-15T10:00:00.000Z',
      timezone: 'UTC',
    }));

    expect(state.currentStreakDays).toBe(1);
    expect(state.longestStreakDays).toBe(1);
  });

  it('unlocks dedication at 10 sessions without losing prior unlocks', () => {
    let state = createDefaultGamification();
    for (let i = 0; i < 10; i++) {
      const day = String(i + 1).padStart(2, '0');
      ({ gamification: state } = applySessionCompleteGamification({
        gamification: state,
        completedAt: `2026-07-${day}T10:00:00.000Z`,
        timezone: 'UTC',
      }));
    }

    expect(state.lifetimeSessionsCompleted).toBe(10);
    expect(state.achievementsUnlocked['first-session']).toBeDefined();
    expect(state.achievementsUnlocked.dedication).toBeDefined();
  });

  it('awards week perfect bonus when week closes with full adherence', () => {
    const mesocycle = {
      mesocycleId: 'mc-1',
      mesocyclePlan: {
        microcycles: [
          {
            week: 1,
            sessions: [
              { dayOfWeek: 'Lunes', sessionFocus: 'Push' },
              { dayOfWeek: 'Miércoles', sessionFocus: 'Pull' },
            ],
          },
        ],
      },
    };

    const recentSessions = [
      {
        completed: true,
        weekNumber: 1,
        mesocycleId: 'mc-1',
        dayOfWeek: 'Lunes',
        completedAt: '2026-07-07T10:00:00.000Z',
      },
    ];

    const { gamification, delta } = applySessionCompleteGamification({
      gamification: null,
      completedAt: '2026-07-09T10:00:00.000Z',
      timezone: 'UTC',
      weekClosed: true,
      mesocycle,
      weekNumber: 1,
      recentSessions,
      completedSession: {
        completed: true,
        weekNumber: 1,
        mesocycleId: 'mc-1',
        dayOfWeek: 'Miércoles',
        completedAt: '2026-07-09T10:00:00.000Z',
      },
    });

    expect(gamification.lifetimeWeeksPerfect).toBe(1);
    expect(delta.weekPerfectBonus).toBe(true);
    expect(delta.seasonPointsEarned).toBeGreaterThanOrEqual(35);
    expect(gamification.achievementsUnlocked['first-week']).toBeDefined();
  });
});

describe('achievements engine', () => {
  it('is idempotent when achievements already unlocked', () => {
    const gamification = normalizeGamification({
      lifetimeSessionsCompleted: 50,
      achievementsUnlocked: {
        legend: { unlockedAt: '2026-01-01T00:00:00.000Z' },
      },
    });

    const newly = evaluateAchievements(gamification);
    expect(newly.some((a) => a.id === 'legend')).toBe(false);
  });

  it('returns next locked achievement in catalog order', () => {
    const gamification = normalizeGamification({ lifetimeSessionsCompleted: 5 });
    const next = getNextLockedAchievement(gamification);
    expect(next?.id).toBe('dedication');
  });

  it('shows progress toward sessions-75 after legend tier', () => {
    const views = buildAchievementViews(
      normalizeGamification({ lifetimeSessionsCompleted: 60 }),
    );
    const sessions75 = views.find((v) => v.id === 'sessions-75');
    expect(sessions75?.progress).toBe(60);
    expect(sessions75?.target).toBe(75);
    expect(sessions75?.unlocked).toBe(false);
  });

  it('builds achievement sections by category', () => {
    const sections = buildAchievementSections(
      normalizeGamification({ lifetimeSessionsCompleted: 25, lifetimeWeeksPerfect: 1 }),
    );
    expect(sections.some((s) => s.category === 'sessions')).toBe(true);
    expect(sections.some((s) => s.category === 'consistency')).toBe(true);
    expect(sections.some((s) => s.category === 'mesocycles')).toBe(true);
  });

  it('builds achievement views with progress', () => {
    const views = buildAchievementViews(
      normalizeGamification({ lifetimeSessionsCompleted: 7 }),
    );
    const dedication = views.find((v) => v.id === 'dedication');
    expect(dedication?.progress).toBe(7);
    expect(dedication?.target).toBe(10);
    expect(dedication?.unlocked).toBe(false);
  });
});

describe('week completion assessment', () => {
  it('detects incomplete week', () => {
    const mesocycle = {
      mesocyclePlan: {
        microcycles: [
          {
            week: 2,
            sessions: [
              { dayOfWeek: 'Lunes', sessionFocus: 'Legs' },
              { dayOfWeek: 'Viernes', sessionFocus: 'Upper' },
            ],
          },
        ],
      },
    };

    const result = assessWeekCompletion(mesocycle, 2, [
      { completed: true, weekNumber: 2, dayOfWeek: 'Lunes' },
    ]);

    expect(result.planned).toBe(2);
    expect(result.done).toBe(1);
    expect(result.isPerfect).toBe(false);
  });
});

describe('mesocycle evaluate gamification', () => {
  it('increments mesocycle counter and unlocks mesocycle-1', () => {
    const { gamification, delta } = applyMesocycleEvaluateGamification({
      gamification: null,
      evaluatedAt: '2026-07-15T12:00:00.000Z',
      mesocycleCompletionRate: 0.8,
      previousExperienceLevel: 'Novato',
      newExperienceLevel: 'Intermedio',
    });

    expect(gamification.lifetimeMesocyclesCompleted).toBe(1);
    expect(delta.mesocycleCounted).toBe(true);
    expect(delta.seasonPointsEarned).toBe(50);
    expect(gamification.achievementsUnlocked['mesocycle-1']).toBeDefined();
    expect(delta.newAchievements.some((a) => a.id === 'level-intermediate')).toBe(true);
  });

  it('skips mesocycle counter below 75% adherence', () => {
    const { gamification, delta } = applyMesocycleEvaluateGamification({
      gamification: null,
      evaluatedAt: '2026-07-15T12:00:00.000Z',
      mesocycleCompletionRate: 0.5,
      previousExperienceLevel: 'Intermedio',
      newExperienceLevel: 'Intermedio',
    });

    expect(gamification.lifetimeMesocyclesCompleted).toBe(0);
    expect(delta.mesocycleCounted).toBe(false);
    expect(gamification.achievementsUnlocked['mesocycle-1']).toBeUndefined();
  });
});

describe('gamification summary', () => {
  it('returns counters and achievements for API', () => {
    const summary = buildGamificationSummary({
      lifetimeSessionsCompleted: 25,
      achievementsUnlocked: {
        dedication: { unlockedAt: '2026-07-01T00:00:00.000Z' },
      },
    });

    expect(summary.counters.lifetimeSessionsCompleted).toBe(25);
    expect(summary.unlockedCount).toBeGreaterThanOrEqual(1);
    expect(summary.achievements.length).toBeGreaterThan(20);
    expect(summary.achievementSections?.length).toBeGreaterThan(0);
  });

  it('rolls season points to 0 on read when month changes (Aug 1)', () => {
    const summary = buildGamificationSummary(
      {
        currentSeasonId: '2026-07',
        seasonPoints: 340,
        seasonSessionsCompleted: 12,
        seasonWeeksPerfect: 2,
        lifetimeSessionsCompleted: 40,
      },
      {
        timezone: 'UTC',
        referenceDate: new Date('2026-08-01T12:00:00.000Z'),
      },
    );

    expect(summary.seasonRolledOver).toBe(true);
    expect(summary.counters.currentSeasonId).toBe('2026-08');
    expect(summary.counters.seasonPoints).toBe(0);
    expect(summary.counters.seasonSessionsCompleted).toBe(0);
    expect(summary.counters.seasonWeeksPerfect).toBe(0);
    expect(summary.counters.lifetimeSessionsCompleted).toBe(40);
    expect(summary.gamificationState.currentSeasonId).toBe('2026-08');
  });

  it('does not roll over within the same month', () => {
    const summary = buildGamificationSummary(
      {
        currentSeasonId: '2026-08',
        seasonPoints: 40,
      },
      {
        timezone: 'UTC',
        referenceDate: new Date('2026-08-15T12:00:00.000Z'),
      },
    );

    expect(summary.seasonRolledOver).toBe(false);
    expect(summary.counters.seasonPoints).toBe(40);
    expect(summary.counters.currentSeasonId).toBe('2026-08');
  });
});

describe('backfill estimation', () => {
  it('estimates counters from archived sessions', () => {
    const estimated = estimateGamificationFromSessions([
      { completed: true, completedAt: '2026-07-01T10:00:00.000Z' },
      { completed: true, completedAt: '2026-07-03T10:00:00.000Z' },
    ]);

    expect(estimated.lifetimeSessionsCompleted).toBe(2);
    expect(estimated.lifetimeActiveDays).toBe(2);
    expect(estimated._backfillNote).toBe('partial-from-recent-only');
  });
});

describe('day key helpers', () => {
  it('formats day key in timezone', () => {
    expect(toDayKey('2026-07-15T06:00:00.000Z', 'America/Mexico_City')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('computes day gaps', () => {
    expect(daysBetweenDayKeys('2026-07-13', '2026-07-15')).toBe(2);
  });

  it('resolves season id', () => {
    expect(getCurrentSeasonId(new Date('2026-07-15T12:00:00.000Z'), 'UTC')).toBe('2026-07');
  });
});
