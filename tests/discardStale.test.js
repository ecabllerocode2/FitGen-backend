import { describe, it, expect } from 'vitest';
import { isStaleIncompleteSession } from '../domain/session/sessionFreshness.js';

describe('discard-stale session policy', () => {
  const referenceDate = new Date('2026-07-15T12:00:00');

  it('clears incomplete session generated on a previous calendar day', () => {
    const session = {
      completed: false,
      generatedAt: '2026-07-14T08:00:00.000Z',
      dayOfWeek: 'Miércoles',
      weekNumber: 1,
    };
    expect(isStaleIncompleteSession(session, referenceDate, 'Miércoles', 1)).toBe(true);
  });

  it('keeps incomplete session generated today for the same slot', () => {
    const session = {
      completed: false,
      generatedAt: '2026-07-15T08:00:00.000Z',
      dayOfWeek: 'Miércoles',
      weekNumber: 1,
    };
    expect(isStaleIncompleteSession(session, referenceDate, 'Miércoles', 1)).toBe(false);
  });
});
