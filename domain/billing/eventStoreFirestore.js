/**
 * Firestore-backed idempotent billing event claims.
 * @param {FirebaseFirestore.Firestore} db
 */
export function createFirestoreBillingEventStore(db) {
  return {
    async tryClaim(eventId, payload = {}) {
      if (!eventId) return { claimed: false, reason: 'missing_event_id' };
      const ref = db.collection('billingEvents').doc(eventId);
      try {
        await ref.create({
          ...payload,
          eventId,
          processedAt: new Date().toISOString(),
        });
        return { claimed: true };
      } catch (err) {
        const code = err.code;
        if (code === 6 || code === 'already-exists' || /already exists/i.test(err.message || '')) {
          const snap = await ref.get();
          return {
            claimed: false,
            reason: 'duplicate',
            existing: snap.exists ? snap.data() : null,
          };
        }
        throw err;
      }
    },
    async get(eventId) {
      const snap = await db.collection('billingEvents').doc(eventId).get();
      return snap.exists ? snap.data() : null;
    },
  };
}
