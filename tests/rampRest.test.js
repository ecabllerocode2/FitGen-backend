import { describe, expect, it } from 'vitest';
import { appendFuerzaRampSets } from '../domain/session/rampGenerator.js';

describe('fuerza ramp set rest', () => {
  const mainBlock = [{
    exerciseId: 'Barbell_Bench_Press',
    exerciseName: 'Press banca',
    movementPattern: 'Empuje_H',
    muscleGroup: 'Pecho',
    priority: 1,
    prescribedLoadKg: 100,
    imageUrl: null,
    imageUrl2: null,
  }];

  it('assigns progressive rest after each ramp set', () => {
    const ramp = appendFuerzaRampSets([], mainBlock, 'Fuerza');
    expect(ramp).toHaveLength(3);
    expect(ramp[0].restAfterSeconds).toBe(45);
    expect(ramp[1].restAfterSeconds).toBe(60);
    expect(ramp[2].restAfterSeconds).toBe(90);
    expect(ramp.every((item) => item.isRampSet)).toBe(true);
  });
});
