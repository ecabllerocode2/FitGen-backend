import { describe, it, expect } from 'vitest';
import {
  countConsumedSeats,
  canConsumeSeat,
  isSeatRecyclable,
  buildSeatLedgerEntry,
  releaseSeatLedgerEntry,
} from '../domain/coach/seatLedger.js';
import { COACH_PLANS } from '../domain/coach/constants.js';

describe('coachSeatLedger', () => {
  it('counts lifetime consumed seats', () => {
    const entries = [
      buildSeatLedgerEntry({ athleteId: 'a1', emailHash: 'h1' }),
      { ...buildSeatLedgerEntry({ athleteId: 'a2', emailHash: 'h2' }), releasedAt: '2026-01-01' },
    ];
    expect(countConsumedSeats(entries)).toBe(2);
  });

  it('does not count recyclable failed invites', () => {
    const now = new Date('2026-04-01');
    const entry = releaseSeatLedgerEntry(
      buildSeatLedgerEntry({ athleteId: 'a1', emailHash: 'h1', activatedAt: '2026-03-01' }),
      0,
      new Date('2026-03-03'),
    );
    entry.recyclableAfter = '2026-03-01';
    expect(isSeatRecyclable(entry, now)).toBe(true);
    expect(countConsumedSeats([entry], now)).toBe(0);
  });

  it('blocks 4th seat on free plan', () => {
    const entries = [
      buildSeatLedgerEntry({ athleteId: 'a1', emailHash: 'h1' }),
      buildSeatLedgerEntry({ athleteId: 'a2', emailHash: 'h2' }),
      buildSeatLedgerEntry({ athleteId: 'a3', emailHash: 'h3' }),
    ];
    const result = canConsumeSeat({
      plan: COACH_PLANS.FREE,
      ledgerEntries: entries,
      emailHash: 'h4',
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresPremium).toBe(true);
  });

  it('blocks same email hash from re-consuming free seat', () => {
    const entries = [
      releaseSeatLedgerEntry(
        buildSeatLedgerEntry({ athleteId: 'a1', emailHash: 'same' }),
        5,
        new Date('2026-02-01'),
      ),
    ];
    const result = canConsumeSeat({
      plan: COACH_PLANS.FREE,
      ledgerEntries: entries,
      emailHash: 'same',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('email_already_used');
  });

  it('allows premium up to 50 seats', () => {
    const entries = Array.from({ length: 49 }, (_, i) =>
      buildSeatLedgerEntry({ athleteId: `a${i}`, emailHash: `h${i}` }),
    );
    const result = canConsumeSeat({
      plan: COACH_PLANS.PREMIUM,
      ledgerEntries: entries,
      emailHash: 'new',
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(50);
  });
});
