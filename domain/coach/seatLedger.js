import {
  COACH_PLANS,
  FAILED_INVITE_MAX_DAYS,
  FAILED_INVITE_MAX_SESSIONS,
  SEAT_RECYCLE_AFTER_DAYS,
  getSeatLimit,
} from './constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {Date|string} a
 * @param {Date|string} b
 */
function daysBetween(a, b) {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  return Math.floor((end - start) / MS_PER_DAY);
}

/**
 * Entry is recyclable when invite failed (short tenure, no sessions) and cooldown elapsed.
 * @param {object} entry
 * @param {Date} [now]
 */
export function isSeatRecyclable(entry, now = new Date()) {
  if (!entry?.countsAgainstFreeQuota) return false;
  if (!entry.releasedAt) return false;
  if (!entry.recyclableAfter) return false;

  const tenureDays = daysBetween(entry.activatedAt, entry.releasedAt);
  const sessionCount = entry.sessionCountAtRelease ?? 0;
  const failedInvite =
    tenureDays < FAILED_INVITE_MAX_DAYS && sessionCount <= FAILED_INVITE_MAX_SESSIONS;

  if (!failedInvite) return false;
  return new Date(entry.recyclableAfter).getTime() <= now.getTime();
}

/**
 * Count seats that consume quota (non-recycled lifetime entries).
 * @param {object[]} entries
 * @param {Date} [now]
 */
export function countConsumedSeats(entries, now = new Date()) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter((entry) => {
    if (!entry.countsAgainstFreeQuota) return false;
    if (isSeatRecyclable(entry, now)) return false;
    return true;
  }).length;
}

/**
 * @param {object} params
 * @param {string} params.plan
 * @param {object[]} params.ledgerEntries
 * @param {string|null} params.emailHash
 * @param {Date} [params.now]
 */
export function canConsumeSeat({ plan, ledgerEntries, emailHash, now = new Date() }) {
  const limit = getSeatLimit(plan);
  const consumed = countConsumedSeats(ledgerEntries, now);

  if (consumed >= limit) {
    return {
      allowed: false,
      reason: 'seat_limit_reached',
      consumed,
      limit,
      requiresPremium: plan === COACH_PLANS.FREE,
    };
  }

  if (emailHash) {
    const duplicate = (ledgerEntries ?? []).some(
      (entry) =>
        entry.emailHash === emailHash &&
        entry.countsAgainstFreeQuota &&
        !isSeatRecyclable(entry, now),
    );
    if (duplicate) {
      return {
        allowed: false,
        reason: 'email_already_used',
        consumed,
        limit,
        requiresPremium: false,
      };
    }
  }

  return { allowed: true, consumed, limit, requiresPremium: false };
}

/**
 * Build ledger entry when a coached client is activated.
 */
export function buildSeatLedgerEntry({
  athleteId,
  emailHash,
  activatedAt = new Date().toISOString(),
}) {
  return {
    athleteId,
    emailHash,
    activatedAt,
    releasedAt: null,
    sessionCountAtRelease: null,
    countsAgainstFreeQuota: true,
    recyclableAfter: null,
  };
}

/**
 * Mark ledger entry released; set recycle date for failed invites.
 */
export function releaseSeatLedgerEntry(entry, sessionCount = 0, now = new Date()) {
  const releasedAt = now.toISOString();
  const tenureDays = daysBetween(entry.activatedAt, releasedAt);
  const failedInvite =
    tenureDays < FAILED_INVITE_MAX_DAYS && sessionCount <= FAILED_INVITE_MAX_SESSIONS;

  const recyclableAfter = failedInvite
    ? new Date(now.getTime() + SEAT_RECYCLE_AFTER_DAYS * MS_PER_DAY).toISOString()
    : null;

  return {
    ...entry,
    releasedAt,
    sessionCountAtRelease: sessionCount,
    recyclableAfter,
  };
}
