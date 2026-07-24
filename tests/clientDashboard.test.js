import { describe, it, expect } from 'vitest';
import {
  buildClientDashboard,
  buildCheckinReminderMessage,
  computeBmi,
  summarizeSessionExercises,
  RECENT_SESSIONS_MAX,
} from '../domain/coach/clientDashboard.js';

describe('clientDashboard', () => {
  it('exposes recent session cap of 36', () => {
    expect(RECENT_SESSIONS_MAX).toBe(36);
  });

  it('computes BMI', () => {
    expect(computeBmi(80, 180)).toBe(24.7);
  });

  it('normalizes external load in session summaries for completed sessions', () => {
    const exercises = summarizeSessionExercises(
      {
        mainBlock: [
          {
            exerciseId: 'bench',
            exerciseName: 'Press banca',
            sets: 3,
            prescribedLoadKg: 60,
          },
        ],
        performance: [
          {
            exerciseId: 'bench',
            exerciseName: 'Press banca',
            sets: [
              { load: 57.5, reps: 8, completed: true },
              { load: 60, reps: 8, completed: true },
            ],
          },
        ],
      },
      { completed: true },
    );

    expect(exercises[0].prescribedLoadKg).toBe(60);
    expect(exercises[0].actualLoadKg).toBe(60);
    expect(exercises[0].loadComparison).toBe('on_target');
  });

  it('builds check-in reminder copy', () => {
    const msg = buildCheckinReminderMessage('Ana');
    expect(msg).toMatch(/Ana/);
    expect(msg).toMatch(/check-in/i);
  });

  it('flags live session and check-in due', () => {
    const dashboard = buildClientDashboard({
      athleteUser: {
        profileData: {
          name: 'Luis',
          heightCm: 175,
          currentWeightKg: 78,
          fitnessGoal: 'Hipertrofia',
          trainingDaysPerWeek: 4,
        },
        bodyMetrics: { entries: [] },
        currentSession: {
          sessionFocus: 'Pecho',
          weekNumber: 2,
          completed: false,
          mainBlock: [{ exerciseName: 'Press', sets: 3, prescribedLoadKg: 50 }],
        },
        currentMesocycle: {
          goal: 'Hipertrofia',
          splitType: 'upper_lower',
          durationWeeks: 4,
          currentWeek: 2,
          microcycles: [
            {
              sessions: [
                { dayOfWeek: 'Lunes', sessionFocus: 'Pecho', isRestDay: false },
                { dayOfWeek: 'Martes', sessionFocus: 'Descanso', isRestDay: true },
              ],
            },
          ],
        },
      },
      recentSessions: [],
    });

    expect(dashboard.liveSession?.isLive).toBe(true);
    expect(dashboard.checkin.needsCheckin).toBe(true);
    expect(dashboard.anthropometrics.bmi).toBe(25.5);
    expect(dashboard.mesocycle?.weeklySplit.length).toBeGreaterThanOrEqual(1);
  });
});
