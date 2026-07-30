import { describe, expect, it } from 'vitest';
import {
  evaluateRetentionMilestones,
  buildAthleteStrengthHighlights,
} from '../domain/retention/milestones.js';

describe('retention milestones', () => {
  const mesocycle = {
    mesocycleId: 'mc_test',
    startDate: '2026-07-01',
    durationWeeks: 4,
    microcycles: [{ week: 1 }, { week: 2 }, { week: 3 }, { week: 4 }],
  };

  it('creates midpoint milestone at week 2', () => {
    const { milestones, retentionFeed } = evaluateRetentionMilestones({
      mesocycle,
      weekNumber: 2,
      completedAt: '2026-07-14T12:00:00.000Z',
      retentionFeed: [],
    });
    expect(milestones).toHaveLength(1);
    expect(milestones[0].type).toBe('mesocycle_midpoint');
    expect(retentionFeed).toHaveLength(1);
  });

  it('creates e1rm gain milestone when compound lift improves enough', () => {
    const { milestones } = evaluateRetentionMilestones({
      mesocycle,
      weekNumber: 1,
      e1rmRecords: [{
        exerciseId: 'Barbell_Bench_Press',
        exerciseName: 'Press banca',
        previousE1RM: 100,
        newE1RM: 105,
      }],
      loadPerformanceLedger: {
        byExerciseId: {
          Barbell_Bench_Press: {
            exerciseId: 'Barbell_Bench_Press',
            exerciseName: 'Press banca',
            movementPattern: 'Empuje_H',
            priority: 1,
            e1RM: 105,
            previousE1RM: 100,
          },
        },
      },
      retentionFeed: [],
    });
    expect(milestones).toHaveLength(1);
    expect(milestones[0].type).toBe('e1rm_gain');
    expect(milestones[0].body).toMatch(/5%/);
  });

  it('dedupes midpoint milestone for same week', () => {
    const first = evaluateRetentionMilestones({
      mesocycle,
      weekNumber: 2,
      retentionFeed: [],
    });
    const second = evaluateRetentionMilestones({
      mesocycle,
      weekNumber: 2,
      retentionFeed: first.retentionFeed,
    });
    expect(second.milestones).toHaveLength(0);
  });
});

describe('athlete strength highlights', () => {
  it('prioritizes compound lifts', () => {
    const highlights = buildAthleteStrengthHighlights({
      byExerciseId: {
        curl: {
          exerciseId: 'curl',
          exerciseName: 'Curl',
          movementPattern: 'General',
          priority: 3,
          e1RM: 40,
        },
        bench: {
          exerciseId: 'bench',
          exerciseName: 'Press banca',
          movementPattern: 'Empuje_H',
          priority: 1,
          e1RM: 100,
        },
      },
    });
    expect(highlights[0].exerciseId).toBe('bench');
  });
});
