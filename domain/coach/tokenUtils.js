import crypto from 'crypto';

export function generateInviteToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmailForAbuseCheck(email) {
  const raw = (email ?? '').trim().toLowerCase();
  const [local, domain] = raw.split('@');
  if (!local || !domain) return raw;

  let normalizedLocal = local;
  const plusIdx = normalizedLocal.indexOf('+');
  if (plusIdx >= 0) normalizedLocal = normalizedLocal.slice(0, plusIdx);

  const normalizedDomain = domain === 'googlemail.com' ? 'gmail.com' : domain;
  if (normalizedDomain === 'gmail.com') {
    normalizedLocal = normalizedLocal.replace(/\./g, '');
  }

  return `${normalizedLocal}@${normalizedDomain}`;
}

export function hashEmail(email) {
  const normalized = normalizeEmailForAbuseCheck(email);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function emailsAreEquivalent(a, b) {
  if (!a || !b) return false;
  return normalizeEmailForAbuseCheck(a) === normalizeEmailForAbuseCheck(b);
}
