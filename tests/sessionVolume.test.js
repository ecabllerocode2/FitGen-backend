import { describe, it, expect } from 'vitest';
import { computeTotalWeightKg } from '../domain/session/sessionVolume.js';

describe('sessionVolume', () => {
  it('sums load × reps for completed sets', () => {
    const total = computeTotalWeightKg([
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
    expect(computeTotalWeightKg([{ sets: [{ completed: true, load: null, reps: 10 }] }])).toBeNull();
  });
});
