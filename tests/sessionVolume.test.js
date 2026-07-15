import { describe, it, expect } from 'vitest';
import {
  computeMainBlockVolumeKg,
  computeMainBlockVolumeFromLogs,
  isBodyweightPerformanceExercise,
} from '../domain/session/sessionVolume.js';
import {
  getBodyweightEffectiveLoadFactor,
  getBodyweightBaseLoadKg,
} from '../domain/session/bodyweightEffectiveLoad.js';

describe('bodyweightEffectiveLoad', () => {
  it('uses 65% for horizontal push (flexiones)', () => {
    expect(getBodyweightEffectiveLoadFactor({ movementPattern: 'Empuje_H' })).toBe(0.65);
    expect(getBodyweightBaseLoadKg({ movementPattern: 'Empuje_H' }, 70)).toBe(45.5);
  });

  it('uses 100% for vertical pull (dominadas)', () => {
    expect(getBodyweightEffectiveLoadFactor({ movementPattern: 'Traccion_V' })).toBe(1);
    expect(getBodyweightBaseLoadKg({ movementPattern: 'Traccion_V' }, 70)).toBe(70);
  });
});

describe('sessionVolume', () => {
  it('sums load × reps for completed sets', () => {
    const total = computeMainBlockVolumeKg([
      {
        sets: [
          { completed: true, load: 60, reps: 10 },
          { completed: true, load: 60, reps: 8 },
        ],
      },
      {
        sets: [{ completed: true, load: 40, reps: 12 }],
      },
    ]);
    expect(total).toBe(60 * 10 + 60 * 8 + 40 * 12);
  });

  it('returns null when no weighted sets', () => {
    expect(
      computeMainBlockVolumeKg([{ sets: [{ completed: true, load: null, reps: 10 }] }]),
    ).toBeNull();
  });

  it('includes bodyweight effective load when bodyWeightKg is provided', () => {
    const total = computeMainBlockVolumeKg(
      [
        {
          isBodyweight: true,
          movementPattern: 'Empuje_H',
          sets: [{ completed: true, reps: 15 }, { completed: true, reps: 15 }, { completed: true, reps: 15 }],
        },
        { sets: [{ completed: true, load: 20, reps: 10 }] },
      ],
      { bodyWeightKg: 70 },
    );
    // 70 × 0.65 × 15 × 3 + 200
    expect(total).toBe(Math.round(70 * 0.65 * 15 * 3) + 200);
  });

  it('skips bodyweight sets without profile weight', () => {
    const total = computeMainBlockVolumeKg([
      { isBodyweight: true, movementPattern: 'Empuje_H', sets: [{ completed: true, reps: 15 }] },
      { sets: [{ completed: true, load: 20, reps: 10 }] },
    ]);
    expect(total).toBe(200);
  });

  it('adds logged load to bodyweight effective base (lastre)', () => {
    const total = computeMainBlockVolumeKg(
      [
        {
          isBodyweight: true,
          movementPattern: 'Traccion_V',
          sets: [{ completed: true, load: 10, reps: 8 }],
        },
      ],
      { bodyWeightKg: 70 },
    );
    // (70 + 10) × 8
    expect(total).toBe(640);
  });

  it('matches real upper session tonnage for pIJ user snapshot', () => {
    const performance = [
      { exerciseName: 'Press Inclinado', sets: [{ load: 25, reps: 10 }, { load: 25, reps: 10 }, { load: 25, reps: 10 }] },
      { exerciseName: 'Smith Press', sets: [{ load: 25, reps: 10 }, { load: 25, reps: 10 }, { load: 25, reps: 10 }] },
      { exerciseName: 'Jalón', sets: [{ load: 22.5, reps: 10 }, { load: 22.5, reps: 10 }, { load: 22.5, reps: 10 }] },
      { exerciseName: 'Press militar', sets: [{ load: 20, reps: 10 }, { load: 20, reps: 10 }, { load: 20, reps: 10 }] },
      { exerciseName: 'Lateral', sets: [{ load: 20, reps: 13 }, { load: 20, reps: 13 }] },
      { exerciseName: 'Curl', sets: [{ load: 27.5, reps: 13 }, { load: 27.5, reps: 13 }, { load: 27.5, reps: 13 }, { load: 27.5, reps: 13 }] },
      { exerciseName: 'Extensión tríceps', sets: [{ load: 30, reps: 13 }, { load: 30, reps: 13 }, { load: 30, reps: 13 }, { load: 30, reps: 13 }] },
    ];
    expect(computeMainBlockVolumeKg(performance)).toBe(6285);
  });

  it('computes volume only from main block logs', () => {
    const total = computeMainBlockVolumeFromLogs({
      mainBlock: [{ exerciseId: 'a' }, { exerciseId: 'b' }],
      exerciseLogs: {
        a: [{ weight: 50, reps: 10 }],
        b: [{ weight: 20, reps: 12 }],
        warmup: [{ weight: 20, reps: 15 }],
      },
      isBodyweight: () => false,
    });
    expect(total).toBe(500 + 240);
  });

  it('computes bodyweight volume from logs with movement pattern', () => {
    const total = computeMainBlockVolumeFromLogs({
      mainBlock: [{ exerciseId: 'push', movementPattern: 'Empuje_H' }],
      exerciseLogs: { push: [{ reps: 12 }, { reps: 12 }] },
      isBodyweight: (ex) => ex.exerciseId === 'push',
      bodyWeightKg: 80,
    });
    expect(total).toBe(Math.round(80 * 0.65 * 12 * 2));
  });
});

describe('isBodyweightPerformanceExercise', () => {
  it('detects bodyweight flag', () => {
    expect(isBodyweightPerformanceExercise({ isBodyweight: true })).toBe(true);
    expect(isBodyweightPerformanceExercise({ loadMode: 'bodyweight' })).toBe(true);
    expect(isBodyweightPerformanceExercise({})).toBe(false);
  });
});
