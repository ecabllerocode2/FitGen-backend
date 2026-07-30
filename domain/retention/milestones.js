import { getCurrentWeek } from '../../lib/mesocycleUtils.js';

const MAX_FEED_ITEMS = 50;
const E1RM_GAIN_THRESHOLD_PCT = 3;

const COMPOUND_PATTERNS = new Set([
  'Empuje_H',
  'Empuje_V',
  'Traccion_H',
  'Traccion_V',
  'Rodilla',
  'Cadera',
]);

function roundPct(delta, previous) {
  if (!previous || previous <= 0) return null;
  return Math.round((delta / previous) * 100);
}

function pickTopCompoundGain(e1rmRecords = [], ledger = {}) {
  const byExerciseId = ledger?.byExerciseId ?? {};
  const compound = e1rmRecords
    .map((r) => {
      const ledgerEntry = byExerciseId[r.exerciseId] ?? {};
      const previousE1RM = r.previousE1RM ?? ledgerEntry.previousE1RM ?? null;
      const e1RM = r.newE1RM ?? r.e1RM ?? ledgerEntry.e1RM ?? null;
      const movementPattern = r.movementPattern ?? ledgerEntry.movementPattern;
      const priority = r.priority ?? ledgerEntry.priority ?? 2;
      return {
        ...r,
        previousE1RM,
        e1RM,
        movementPattern,
        priority,
        gainPct: roundPct((e1RM ?? 0) - (previousE1RM ?? 0), previousE1RM),
      };
    })
    .filter((r) => {
      const pattern = r.movementPattern;
      return COMPOUND_PATTERNS.has(pattern) || r.priority === 1;
    })
    .filter((r) => r.gainPct != null && r.gainPct >= E1RM_GAIN_THRESHOLD_PCT)
    .sort((a, b) => (b.gainPct ?? 0) - (a.gainPct ?? 0));

  return compound[0] ?? null;
}

function hasFeedItem(feed = [], dedupeKey) {
  return feed.some((item) => item.dedupeKey === dedupeKey);
}

function buildMilestone({ type, title, body, dedupeKey, meta = {} }) {
  const now = new Date().toISOString();
  return {
    id: `${type}-${dedupeKey}-${Date.now()}`,
    type,
    title,
    body,
    dedupeKey,
    createdAt: now,
    readAt: null,
    meta,
  };
}

/**
 * Evaluate retention milestones after session complete.
 * Returns new items to append (max 1 per session for anti-spam).
 * @param {object} params
 * @returns {{ milestones: object[], retentionFeed: object[] }}
 */
export function evaluateRetentionMilestones({
  mesocycle = null,
  weekNumber = 1,
  completedAt = new Date().toISOString(),
  e1rmRecords = [],
  retentionFeed = [],
  mesocycleId = null,
  loadPerformanceLedger = null,
} = {}) {
  const feed = Array.isArray(retentionFeed) ? [...retentionFeed] : [];
  const candidates = [];
  const mcId = mesocycleId ?? mesocycle?.mesocycleId ?? 'current';
  const durationWeeks = mesocycle?.durationWeeks ?? 4;
  const currentWeek = mesocycle
    ? getCurrentWeek(mesocycle, completedAt)
    : weekNumber;
  const midWeek = Math.ceil(durationWeeks / 2);

  if (currentWeek === midWeek || (durationWeeks >= 4 && (currentWeek === 2 || currentWeek === 3))) {
    const dedupeKey = `meso-mid-${mcId}-w${currentWeek}`;
    if (!hasFeedItem(feed, dedupeKey)) {
      candidates.push(
        buildMilestone({
          type: 'mesocycle_midpoint',
          title: '¡A mitad del mesociclo!',
          body: `Semana ${currentWeek} de ${durationWeeks}. Sigue así — el progreso acumulado se nota en tus números.`,
          dedupeKey,
          meta: { weekNumber: currentWeek, durationWeeks },
        }),
      );
    }
  }

  const topGain = pickTopCompoundGain(e1rmRecords, loadPerformanceLedger);
  if (topGain) {
    const dedupeKey = `e1rm-gain-${topGain.exerciseId}-${mcId}-w${currentWeek}`;
    if (!hasFeedItem(feed, dedupeKey)) {
      const name = topGain.exerciseName ?? topGain.exerciseId ?? 'tu lift';
      candidates.push(
        buildMilestone({
          type: 'e1rm_gain',
          title: 'Tu fuerza está subiendo',
          body: `Tus números en ${name} subieron un ${topGain.gainPct}%. Eso es progreso real.`,
          dedupeKey,
          meta: {
            exerciseId: topGain.exerciseId,
            exerciseName: topGain.exerciseName,
            gainPct: topGain.gainPct,
            e1RM: topGain.e1RM,
            previousE1RM: topGain.previousE1RM,
          },
        }),
      );
    }
  }

  if (e1rmRecords.length > 0) {
    const pr = e1rmRecords[0];
    const dedupeKey = `e1rm-pr-${pr.exerciseId}-${completedAt.slice(0, 10)}`;
    if (!hasFeedItem(feed, dedupeKey)) {
      const name = pr.exerciseName ?? pr.exerciseId ?? 'un ejercicio';
      const prE1RM = pr.newE1RM ?? pr.e1RM;
      candidates.push(
        buildMilestone({
          type: 'e1rm_pr',
          title: 'Nuevo récord personal',
          body: `Récord e1RM en ${name}. Revisa tu gráfica de progreso en el GYM.`,
          dedupeKey,
          meta: {
            exerciseId: pr.exerciseId,
            exerciseName: pr.exerciseName,
            e1RM: prE1RM,
          },
        }),
      );
    }
  }

  // Max 1 milestone per session — pick highest priority
  const priority = { e1rm_gain: 3, mesocycle_midpoint: 2, e1rm_pr: 1 };
  const selected = candidates.sort(
    (a, b) => (priority[b.type] ?? 0) - (priority[a.type] ?? 0),
  )[0];

  if (!selected) {
    return { milestones: [], retentionFeed: feed };
  }

  const nextFeed = [...feed, selected].slice(-MAX_FEED_ITEMS);
  return { milestones: [selected], retentionFeed: nextFeed };
}

/**
 * Mark retention feed items as read.
 */
export function markRetentionFeedRead(feed = [], ids = []) {
  const idSet = new Set(ids);
  return feed.map((item) => (
    idSet.has(item.id) ? { ...item, readAt: new Date().toISOString() } : item
  ));
}

/**
 * Build strength highlights for athlete hub from ledger.
 */
export function buildAthleteStrengthHighlights(ledger = {}, limit = 4) {
  const byExerciseId = ledger?.byExerciseId ?? {};
  return Object.values(byExerciseId)
    .filter((e) => e?.e1RM != null)
    .sort((a, b) => {
      const aCompound = COMPOUND_PATTERNS.has(a.movementPattern) || a.priority === 1 ? 1 : 0;
      const bCompound = COMPOUND_PATTERNS.has(b.movementPattern) || b.priority === 1 ? 1 : 0;
      if (bCompound !== aCompound) return bCompound - aCompound;
      return Number(b.e1RM) - Number(a.e1RM);
    })
    .slice(0, limit)
    .map((e) => ({
      exerciseId: e.exerciseId,
      name: e.exerciseName ?? e.exerciseId,
      e1RM: Number(e.e1RM),
      previousE1RM: e.previousE1RM != null ? Number(e.previousE1RM) : null,
      movementPattern: e.movementPattern,
      lastWeightKg: e.lastWeightKg,
      updatedAt: e.updatedAt,
    }));
}

/**
 * Future hook: enqueue push from retention milestone (no-op until FCM/VAPID).
 */
export function enqueueRetentionPush(_userId, _milestone) {
  // Reserved for Web Push / FCM integration.
}
