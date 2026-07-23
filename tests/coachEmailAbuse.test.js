import { describe, it, expect } from 'vitest';
import { hashEmail, emailsAreEquivalent } from '../domain/coach/tokenUtils.js';

describe('email abuse normalization', () => {
  it('treats gmail plus aliases as equivalent', () => {
    expect(emailsAreEquivalent('coach@gmail.com', 'coach+cliente@gmail.com')).toBe(true);
    expect(hashEmail('coach@gmail.com')).toBe(hashEmail('coach+test@gmail.com'));
  });

  it('treats gmail dot variants as equivalent', () => {
    expect(emailsAreEquivalent('c.o.a.c.h@gmail.com', 'coach@gmail.com')).toBe(true);
  });

  it('does not equate different emails', () => {
    expect(emailsAreEquivalent('coach@gmail.com', 'otro@outlook.com')).toBe(false);
  });
});
