import { describe, it, expect } from 'vitest';
import {
  isIncompleteSessionForDate,
  isStaleIncompleteSession,
} from '../domain/session/sessionFreshness.js';

describe('sessionFreshness', () => {
  const referenceDate = new Date('2026-07-15T12:00:00');

  it('accepts incomplete session generated same calendar day', () => {
    const session = {
      completed: false,
      generatedAt: '2026-07-15T08:00:00.000Z',
      dayOfWeek: 'Martes',
      weekNumber: 2,
    };
    expect(isIncompleteSessionForDate(session, referenceDate, 'Martes', 2)).toBe(true);
    expect(isStaleIncompleteSession(session, referenceDate, 'Martes', 2)).toBe(false);
  });

  it('rejects incomplete session generated yesterday even with same dayOfWeek', () => {
    const session = {
      completed: false,
      generatedAt: '2026-07-14T08:00:00.000Z',
      dayOfWeek: 'Martes',
      weekNumber: 2,
    };
    expect(isIncompleteSessionForDate(session, referenceDate, 'Martes', 2)).toBe(false);
    expect(isStaleIncompleteSession(session, referenceDate, 'Martes', 2)).toBe(true);
  });
});
