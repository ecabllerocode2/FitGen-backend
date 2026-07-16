/**
 * Firestore user/session repository — thin persistence layer.
 * @param {import('firebase-admin/firestore').Firestore} db
 */
import { RECENT_SESSIONS_MAX } from '../../domain/athlete/loadPerformanceLedger.js';

export function createUserRepository(db) {
  const users = () => db.collection('users');

  return {
    async getUser(userId) {
      const snap = await users().doc(userId).get();
      if (!snap.exists) return null;
      return { id: userId, ...snap.data() };
    },

    async saveUser(userId, data) {
      await users().doc(userId).set(data, { merge: true });
      return { id: userId, ...data };
    },

    async getProfile(userId) {
      const user = await this.getUser(userId);
      return user?.profileData ?? null;
    },

    async saveProfile(userId, profileData) {
      await users().doc(userId).set({ profileData }, { merge: true });
      return profileData;
    },

    async getMesocycle(userId) {
      const user = await this.getUser(userId);
      return user?.currentMesocycle ?? null;
    },

    async saveMesocycle(userId, mesocycle) {
      await users().doc(userId).set({ currentMesocycle: mesocycle }, { merge: true });
      return mesocycle;
    },

    async getCurrentSession(userId) {
      const user = await this.getUser(userId);
      return user?.currentSession ?? null;
    },

    async saveSession(userId, session) {
      await users().doc(userId).set({ currentSession: session }, { merge: true });
      return session;
    },

    async archiveSession(userId, session) {
      const ref = users().doc(userId).collection('recentSessions');
      const docRef = await ref.add({ ...session, archivedAt: new Date().toISOString() });
      await this.trimRecentSessions(userId, RECENT_SESSIONS_MAX);
      return { id: docRef.id, ...session, archivedAt: new Date().toISOString() };
    },

    async trimRecentSessions(userId, maxKeep = RECENT_SESSIONS_MAX) {
      const ref = users().doc(userId).collection('recentSessions');
      const snap = await ref.orderBy('archivedAt', 'desc').get();
      if (snap.size <= maxKeep) return snap.size;
      const toDelete = snap.docs.slice(maxKeep);
      const batch = db.batch();
      for (const doc of toDelete) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      return maxKeep;
    },

    async getRecentSession(userId, sessionId) {
      const snap = await users().doc(userId).collection('recentSessions').doc(sessionId).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() };
    },

    async updateRecentSession(userId, sessionId, data) {
      await users().doc(userId).collection('recentSessions').doc(sessionId).set(data, { merge: true });
      return { id: sessionId, ...data };
    },

    async getRecentSessions(userId, limit = 20) {
      const snap = await users()
        .doc(userId)
        .collection('recentSessions')
        .orderBy('archivedAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listAllUsers(limit = 300) {
      const snap = await users().limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async getRecentCelebrations(userId, limit = 20) {
      const now = Date.now();
      const sessions = await this.getRecentSessions(userId, limit);
      return sessions
        .filter(
          (s) =>
            s.celebrationCardUrl &&
            (!s.celebrationCardExpiresAt || new Date(s.celebrationCardExpiresAt).getTime() > now),
        )
        .map((s) => ({
          id: s.id,
          celebrationCardUrl: s.celebrationCardUrl,
          celebrationCardExpiresAt: s.celebrationCardExpiresAt,
          celebrationSummary: s.celebrationSummary ?? {
            sessionFocus: s.sessionFocus ?? 'Entrenamiento',
            durationLabel: s.summary?.duracionEstimada ?? '—',
            exerciseCount: s.summary?.ejerciciosTotales ?? 0,
            totalSets: s.summary?.seriesTotales ?? 0,
            muscles: s.summary?.musculosTrabajos ?? s.sessionMuscles ?? [],
            completedAt: s.completedAt ?? s.archivedAt,
          },
        }));
    },
  };
}
