import { getCurrentSeasonId } from './defaults.js';

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export function leaderboardCollection(db, seasonId) {
  return db.collection('leaderboards').doc(seasonId).collection('entries');
}

export function buildLeaderboardEntry({
  userId,
  gamification,
  profileData = {},
}) {
  const displayName =
    gamification.publicDisplayName ??
    profileData.name ??
    'Atleta FitGen';

  return {
    userId,
    displayName: String(displayName).trim().slice(0, 40) || 'Atleta FitGen',
    avatarStage: gamification.avatar?.baseStage ?? 0,
    seasonPoints: gamification.seasonPoints ?? 0,
    seasonSessionsCompleted: gamification.seasonSessionsCompleted ?? 0,
    showInLeaderboard: gamification.showInLeaderboard === true,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function upsertLeaderboardEntry(db, {
  userId,
  gamification,
  profileData,
  timezone = 'America/Mexico_City',
}) {
  if (!gamification?.showInLeaderboard) return null;

  const seasonId = gamification.currentSeasonId ?? getCurrentSeasonId(new Date(), timezone);
  const entry = buildLeaderboardEntry({ userId, gamification, profileData });
  const ref = leaderboardCollection(db, seasonId).doc(userId);
  await ref.set(entry, { merge: true });

  const metaRef = db.collection('leaderboards').doc(seasonId);
  await metaRef.set(
    {
      seasonId,
      lastUpdatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return { seasonId, entry };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 */
export async function fetchCurrentLeaderboard(db, {
  seasonId,
  userId = null,
  limit = 50,
}) {
  const entriesRef = leaderboardCollection(db, seasonId);
  const snap = await entriesRef.orderBy('seasonPoints', 'desc').limit(limit).get();

  const entries = snap.docs.map((doc, index) => ({
    rank: index + 1,
    userId: doc.id,
    ...doc.data(),
  }));

  let myEntry = null;
  if (userId) {
    myEntry = entries.find((entry) => entry.userId === userId) ?? null;
    if (!myEntry) {
      const mine = await entriesRef.doc(userId).get();
      if (mine.exists) {
        const data = mine.data();
        myEntry = {
          userId,
          rank: null,
          ...data,
        };
      }
    }
  }

  const metaSnap = await db.collection('leaderboards').doc(seasonId).get();
  const meta = metaSnap.exists ? metaSnap.data() : { seasonId };

  return {
    seasonId,
    meta,
    entries,
    myEntry,
    daysRemaining: null,
  };
}
