/**
 * Idempotent billing event claims (webhook dedupe) — in-memory for tests/local.
 */
export function createMemoryBillingEventStore() {
  const map = new Map();
  return {
    async tryClaim(eventId, payload = {}) {
      if (!eventId) return { claimed: false, reason: 'missing_event_id' };
      if (map.has(eventId)) {
        return { claimed: false, reason: 'duplicate', existing: map.get(eventId) };
      }
      const record = {
        ...payload,
        eventId,
        processedAt: new Date().toISOString(),
      };
      map.set(eventId, record);
      return { claimed: true, record };
    },
    async get(eventId) {
      return map.get(eventId) ?? null;
    },
    size() {
      return map.size;
    },
  };
}
