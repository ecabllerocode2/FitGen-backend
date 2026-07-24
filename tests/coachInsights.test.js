import { describe, it, expect } from 'vitest';
import { buildClientInsights } from '../domain/coach/insights.js';

describe('coach motor insights', () => {
  it('flags RIR 0 cluster on compounds when target RIR asks for reserves', () => {
    const { insights } = buildClientInsights({
      athleteUser: {
        profileData: { name: 'Stela', trainingDaysPerWeek: 5 },
        profileCompleteness: { readyForMesocycle: true },
        currentMesocycle: { status: 'activo', currentWeek: 1, durationWeeks: 4 },
      },
      recentSessions: [
        {
          completed: true,
          completedAt: new Date().toISOString(),
          mainBlock: [
            {
              exerciseId: 'bench',
              exerciseName: 'Press banca',
              exerciseType: 'compound',
              prioridad: 1,
              sets: 3,
              prescribedLoadKg: 40,
              rirTarget: 2,
            },
            {
              exerciseId: 'row',
              exerciseName: 'Remo',
              exerciseType: 'compound',
              prioridad: 1,
              sets: 3,
              prescribedLoadKg: 35,
              rirTarget: 2,
            },
          ],
          performance: [
            {
              exerciseId: 'bench',
              exerciseName: 'Press banca',
              sets: [
                { load: 45, reps: 8, rir: 0, completed: true },
                { load: 45, reps: 7, rir: 0, completed: true },
              ],
            },
            {
              exerciseId: 'row',
              exerciseName: 'Remo',
              sets: [
                { load: 40, reps: 8, rir: 0, completed: true },
                { load: 40, reps: 8, rir: 0, completed: true },
              ],
            },
          ],
        },
      ],
    });

    const failure = insights.find((i) => i.id === 'rir_failure_cluster');
    expect(failure).toBeTruthy();
    expect(failure?.severity).toBe('high');
    expect(failure?.systemAction).toMatch(/e1RM/i);
  });

  it('surfaces weekly joint-pain volume cut with system action', () => {
    const { insights } = buildClientInsights({
      athleteUser: {
        profileData: { trainingDaysPerWeek: 4 },
        weeklyFeedbackModifiers: { Pecho: 0.7 },
        currentMesocycle: { status: 'activo' },
      },
      recentSessions: [],
    });

    const cut = insights.find((i) => i.id.startsWith('weekly_volume_cut_joint_'));
    expect(cut).toBeTruthy();
    expect(cut?.systemAction).toMatch(/0\.7|30%/);
  });
});
