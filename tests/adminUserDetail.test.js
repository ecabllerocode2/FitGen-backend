import { describe, expect, it } from 'vitest';
import { buildAdminUserDetail, summarizeSessionLoads } from '../domain/admin/userDetail.js';

describe('summarizeSessionLoads', () => {
  it('compares prescribed vs actual from mainBlock + performance', () => {
    const summary = summarizeSessionLoads({
      id: 's1',
      completedAt: '2026-07-20T12:00:00.000Z',
      sessionFocus: 'Push',
      summary: { totalWeightKg: 4200 },
      mainBlock: [
        { exerciseId: 'bench', exerciseName: 'Press banca', prescribedLoadKg: 60 },
        { exerciseId: 'ohp', exerciseName: 'Press militar', prescribedLoadKg: 40 },
      ],
      performance: [
        { exerciseId: 'bench', actualWeightKg: 62.5 },
        { exerciseId: 'ohp', actualWeightKg: 35 },
      ],
    });

    expect(summary.volumeKg).toBe(4200);
    expect(summary.comparableCount).toBe(2);
    expect(summary.exercises[0].deltaPct).toBeCloseTo(4.2, 0);
    expect(summary.exercises[1].deltaPct).toBeCloseTo(-12.5, 0);
    expect(summary.avgPrescribedKg).toBe(50);
    expect(summary.avgActualKg).toBe(48.8);
  });

  it('skips bodyweight for delta comparison', () => {
    const summary = summarizeSessionLoads({
      mainBlock: [{ exerciseId: 'pullup', prescribedLoadKg: 0, isBodyweight: true }],
      performance: [{ exerciseId: 'pullup', actualWeightKg: 0 }],
    });
    expect(summary.comparableCount).toBe(0);
    expect(summary.exercises[0].deltaPct).toBeNull();
  });
});

describe('buildAdminUserDetail', () => {
  it('aggregates charts and adherence stats', () => {
    const detail = buildAdminUserDetail(
      {
        id: 'u1',
        email: 'a@b.com',
        status: 'approved',
        profileData: { name: 'Ana', experienceLevel: 'Intermedio' },
        gamification: { lifetimeSessionsCompleted: 12, currentStreakDays: 3, fitCoinsBalance: 40 },
        loadPerformanceLedger: {
          byExerciseId: {
            bench: {
              exerciseId: 'bench',
              exerciseName: 'Press banca',
              lastWeightKg: 62.5,
              lastReps: 8,
              e1RM: 80,
              updatedAt: '2026-07-20T12:00:00.000Z',
            },
          },
        },
      },
      [
        {
          id: 's1',
          completedAt: '2026-07-18T12:00:00.000Z',
          sessionFocus: 'A',
          summary: { totalWeightKg: 3000 },
          mainBlock: [{ exerciseId: 'bench', prescribedLoadKg: 60 }],
          performance: [{ exerciseId: 'bench', actualWeightKg: 60 }],
        },
        {
          id: 's2',
          completedAt: '2026-07-20T12:00:00.000Z',
          sessionFocus: 'B',
          summary: { totalWeightKg: 3500 },
          mainBlock: [{ exerciseId: 'bench', prescribedLoadKg: 60 }],
          performance: [{ exerciseId: 'bench', actualWeightKg: 65 }],
        },
      ],
    );

    expect(detail.user.name).toBe('Ana');
    expect(detail.gamification.lifetimeSessionsCompleted).toBe(12);
    expect(detail.stats.archivedSessions).toBe(2);
    expect(detail.stats.totalVolumeKg).toBe(6500);
    expect(detail.charts.volumeBySession).toHaveLength(2);
    expect(detail.ledgerHighlights[0].lastWeightKg).toBe(62.5);
    expect(detail.stats.comparableLifts).toBe(2);
  });
});
