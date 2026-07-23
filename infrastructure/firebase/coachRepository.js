/**
 * Firestore persistence for coach platform entities.
 * @param {import('firebase-admin/firestore').Firestore} db
 */
import {
  COACH_PLANS,
  CLIENT_STATUSES,
  INVITE_STATUSES,
  INVITE_DEFAULT_EXPIRY_DAYS,
  getSeatLimit,
} from '../../domain/coach/constants.js';
import { countConsumedSeats } from '../../domain/coach/seatLedger.js';

export function createCoachRepository(db) {
  const coaches = () => db.collection('coaches');
  const invites = () => db.collection('coachInvites');
  const clients = () => db.collection('coachClients');
  const actions = () => db.collection('coachActions');

  function seatLedgerRef(coachId) {
    return coaches().doc(coachId).collection('seatLedger');
  }

  return {
    async getCoach(coachId) {
      const snap = await coaches().doc(coachId).get();
      if (!snap.exists) return null;
      return { id: coachId, ...snap.data() };
    },

    async saveCoach(coachId, data) {
      await coaches().doc(coachId).set(data, { merge: true });
      return { id: coachId, ...data };
    },

    async createCoach(coachId, { displayName, publicName, bio = '', slug = null, email = null }) {
      const now = new Date().toISOString();
      const plan = COACH_PLANS.FREE;
      const data = {
        userId: coachId,
        displayName,
        publicName: publicName ?? displayName,
        bio,
        slug,
        email,
        plan,
        planStatus: 'active',
        seatLimit: getSeatLimit(plan),
        activeClientCount: 0,
        seatsConsumedLifetime: 0,
        branding: { publicName: publicName ?? displayName },
        createdAt: now,
        updatedAt: now,
      };
      await coaches().doc(coachId).set(data);
      return { id: coachId, ...data };
    },

    async updateCoachPlan(coachId, plan) {
      const seatLimit = getSeatLimit(plan);
      await coaches().doc(coachId).set(
        { plan, seatLimit, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      return this.getCoach(coachId);
    },

    async getInviteByTokenHash(tokenHash) {
      const snap = await invites().where('tokenHash', '==', tokenHash).limit(1).get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    },

    async createInvite(coachId, { tokenHash, maxUses = 1, expiresAt }) {
      const now = new Date().toISOString();
      const ref = invites().doc();
      const data = {
        coachId,
        tokenHash,
        status: INVITE_STATUSES.ACTIVE,
        maxUses,
        usedCount: 0,
        expiresAt,
        createdAt: now,
      };
      await ref.set(data);
      return { id: ref.id, ...data };
    },

    async listInvites(coachId, limit = 20) {
      const snap = await invites()
        .where('coachId', '==', coachId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async incrementInviteUse(inviteId) {
      const ref = invites().doc(inviteId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error('Invite no encontrado'), { status: 404 });
        const data = snap.data();
        const usedCount = (data.usedCount ?? 0) + 1;
        const patch = { usedCount };
        if (usedCount >= (data.maxUses ?? 1)) {
          patch.status = INVITE_STATUSES.EXHAUSTED;
        }
        tx.set(ref, patch, { merge: true });
        return { id: inviteId, ...data, ...patch };
      });
    },

    async revokeInvite(inviteId, coachId) {
      const ref = invites().doc(inviteId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (data.coachId !== coachId) {
        throw Object.assign(new Error('No autorizado'), { status: 403 });
      }
      await ref.set({ status: INVITE_STATUSES.REVOKED }, { merge: true });
      return { id: inviteId, ...data, status: INVITE_STATUSES.REVOKED };
    },

    clientDocId(coachId, athleteId) {
      return `${coachId}_${athleteId}`;
    },

    async getClientRelation(coachId, athleteId) {
      const snap = await clients().doc(this.clientDocId(coachId, athleteId)).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() };
    },

    async saveClientRelation(coachId, athleteId, data) {
      const id = this.clientDocId(coachId, athleteId);
      await clients().doc(id).set({ coachId, athleteId, ...data }, { merge: true });
      return { id, coachId, athleteId, ...data };
    },

    async listClients(coachId, statusFilter = null) {
      let query = clients().where('coachId', '==', coachId);
      if (statusFilter) {
        query = query.where('status', '==', statusFilter);
      }
      const snap = await query.limit(100).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async listActiveClients(coachId) {
      const all = await this.listClients(coachId);
      return all.filter((c) =>
        [CLIENT_STATUSES.ACTIVE, CLIENT_STATUSES.ONBOARDING_COACH, CLIENT_STATUSES.ONBOARDING_CLIENT].includes(
          c.status,
        ),
      );
    },

    async addSeatLedgerEntry(coachId, entry) {
      const ref = seatLedgerRef(coachId).doc();
      const data = { ...entry, createdAt: new Date().toISOString() };
      await ref.set(data);
      await this.refreshCoachSeatCounters(coachId);
      return { id: ref.id, ...data };
    },

    async updateSeatLedgerEntry(coachId, entryId, patch) {
      await seatLedgerRef(coachId).doc(entryId).set(patch, { merge: true });
      await this.refreshCoachSeatCounters(coachId);
    },

    async getSeatLedgerEntries(coachId) {
      const snap = await seatLedgerRef(coachId).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async findSeatEntryByAthlete(coachId, athleteId) {
      const entries = await this.getSeatLedgerEntries(coachId);
      return entries.find((e) => e.athleteId === athleteId) ?? null;
    },

    async refreshCoachSeatCounters(coachId) {
      const entries = await this.getSeatLedgerEntries(coachId);
      const consumed = countConsumedSeats(entries);
      const activeClients = await this.listActiveClients(coachId);
      await coaches().doc(coachId).set(
        {
          seatsConsumedLifetime: consumed,
          activeClientCount: activeClients.length,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      return { seatsConsumedLifetime: consumed, activeClientCount: activeClients.length };
    },

    async logCoachAction({ coachId, athleteId, action, metadata = {} }) {
      const ref = actions().doc();
      const data = {
        coachId,
        athleteId: athleteId ?? null,
        action,
        metadata,
        createdAt: new Date().toISOString(),
      };
      await ref.set(data);
      return { id: ref.id, ...data };
    },

    async getClientNotes(coachId, athleteId) {
      const rel = await this.getClientRelation(coachId, athleteId);
      return rel?.notes ?? [];
    },

    async addClientNote(coachId, athleteId, { text, authorId }) {
      const rel = await this.getClientRelation(coachId, athleteId);
      if (!rel) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
      const note = {
        id: `note_${Date.now()}`,
        text,
        authorId,
        createdAt: new Date().toISOString(),
      };
      const notes = [...(rel.notes ?? []), note];
      await this.saveClientRelation(coachId, athleteId, { notes });
      return note;
    },

    buildInviteExpiry(days = INVITE_DEFAULT_EXPIRY_DAYS) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString();
    },
  };
}
