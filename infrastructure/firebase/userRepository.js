/**
 * Firestore user/session repository — thin persistence layer.
 * @param {import('firebase-admin/firestore').Firestore} db
 */
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
      await ref.add({ ...session, archivedAt: new Date().toISOString() });
      return session;
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
  };
}
