/**
 * Build admin-facing detail for a single user: session history,
 * prescribed vs actual loads, and simple aggregates for charts.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function avg(values) {
  if (!values.length) return null;
  return round1(values.reduce((s, v) => s + v, 0) / values.length);
}

/**
 * Resolve actual working weight for an exercise from performance row.
 */
function resolveActualWeightKg(ex) {
  const direct = num(ex?.actualWeightKg ?? ex?.load ?? ex?.weightKg);
  if (direct != null) return direct;

  const sets = ex?.sets ?? ex?.actualSets ?? [];
  const loads = sets
    .filter((s) => s?.completed !== false)
    .map((s) => num(s?.load ?? s?.weightKg ?? s?.actualWeightKg))
    .filter((v) => v != null && v > 0);
  if (!loads.length) return null;
  return round1(Math.max(...loads));
}

function resolvePrescribedWeightKg(template, performanceEx) {
  return num(
    template?.prescribedLoadKg ??
      template?.suggestedLoadKg ??
      performanceEx?.prescribedLoadKg ??
      performanceEx?.suggestedLoadKg,
  );
}

/**
 * Compare prescribed vs actual loads for one archived session.
 */
export function summarizeSessionLoads(session) {
  const mainBlock = Array.isArray(session?.mainBlock) ? session.mainBlock : [];
  const performance = Array.isArray(session?.performance) ? session.performance : [];

  const byId = new Map();
  for (const ex of mainBlock) {
    const id = ex.exerciseId ?? ex.id;
    if (id) byId.set(id, ex);
  }

  const exercises = [];
  const source = performance.length ? performance : mainBlock;

  for (const [index, ex] of source.entries()) {
    const id = ex.exerciseId ?? ex.id;
    const template =
      (id && byId.get(id)) ||
      mainBlock.find((m) => (m.exerciseId ?? m.id) === id) ||
      mainBlock[index] ||
      null;

    const prescribedKg = resolvePrescribedWeightKg(template, ex);
    const actualKg = resolveActualWeightKg(ex);
    const isBodyweight = Boolean(template?.isBodyweight ?? ex?.isBodyweight);
    const loadMode = template?.loadMode ?? ex?.loadMode ?? null;

    let deltaKg = null;
    let deltaPct = null;
    if (prescribedKg != null && actualKg != null && prescribedKg > 0 && !isBodyweight) {
      deltaKg = round1(actualKg - prescribedKg);
      deltaPct = round1(((actualKg - prescribedKg) / prescribedKg) * 100);
    }

    exercises.push({
      exerciseId: id ?? null,
      exerciseName: ex.exerciseName ?? ex.nombre ?? template?.exerciseName ?? template?.nombre ?? id ?? 'Ejercicio',
      muscleGroup: ex.muscleGroup ?? ex.parteCuerpo ?? template?.muscleGroup ?? null,
      prescribedKg,
      actualKg,
      deltaKg,
      deltaPct,
      isBodyweight,
      loadMode,
    });
  }

  const comparable = exercises.filter((e) => e.deltaPct != null);
  const volumeKg = num(session?.summary?.totalWeightKg);

  return {
    sessionId: session?.id ?? null,
    completedAt: session?.completedAt ?? session?.archivedAt ?? null,
    sessionFocus: session?.sessionFocus ?? 'Entrenamiento',
    weekNumber: session?.weekNumber ?? null,
    dayOfWeek: session?.dayOfWeek ?? null,
    durationLabel: session?.summary?.durationLabel ?? session?.summary?.duracionEstimada ?? null,
    volumeKg,
    exerciseCount: exercises.length,
    comparableCount: comparable.length,
    avgDeltaPct: avg(comparable.map((e) => e.deltaPct)),
    avgPrescribedKg: avg(comparable.map((e) => e.prescribedKg).filter((v) => v != null)),
    avgActualKg: avg(comparable.map((e) => e.actualKg).filter((v) => v != null)),
    exercises,
  };
}

function buildVolumeSeries(sessionSummaries) {
  return [...sessionSummaries]
    .filter((s) => s.completedAt)
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime())
    .map((s) => ({
      date: s.completedAt,
      label: s.sessionFocus,
      volumeKg: s.volumeKg,
      avgPrescribedKg: s.avgPrescribedKg,
      avgActualKg: s.avgActualKg,
      avgDeltaPct: s.avgDeltaPct,
    }));
}

function buildLedgerHighlights(ledger, limit = 12) {
  const entries = Object.values(ledger?.byExerciseId ?? {});
  return entries
    .filter((e) => e?.lastWeightKg != null || e?.e1RM != null)
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((e) => ({
      exerciseId: e.exerciseId,
      exerciseName: e.exerciseName ?? e.exerciseId,
      muscleGroup: e.muscleGroup ?? null,
      lastWeightKg: e.lastWeightKg ?? null,
      lastReps: e.lastReps ?? null,
      e1RM: e.e1RM ?? null,
      previousE1RM: e.previousE1RM ?? null,
      updatedAt: e.updatedAt ?? null,
    }));
}

/**
 * @param {object} user — Firestore user doc (+ id)
 * @param {object[]} recentSessions — archived sessions
 */
export function buildAdminUserDetail(user, recentSessions = []) {
  if (!user) return null;

  const gamification = user.gamification ?? {};
  const profile = user.profileData ?? {};
  const sessionSummaries = recentSessions.map(summarizeSessionLoads);

  const comparableDeltas = sessionSummaries
    .flatMap((s) => s.exercises)
    .filter((e) => e.deltaPct != null)
    .map((e) => e.deltaPct);

  const volumes = sessionSummaries.map((s) => s.volumeKg).filter((v) => v != null);
  const heavierThanPrescribed = comparableDeltas.filter((d) => d > 0).length;
  const lighterThanPrescribed = comparableDeltas.filter((d) => d < 0).length;
  const onTarget = comparableDeltas.filter((d) => Math.abs(d) <= 5).length;

  const volumeSeries = buildVolumeSeries(sessionSummaries);
  const loadSeries = volumeSeries.filter((p) => p.avgPrescribedKg != null || p.avgActualKg != null);

  return {
    user: {
      uid: user.id,
      name: profile.name ?? user.name ?? 'Sin nombre',
      email: user.email ?? null,
      status: user.status ?? 'unknown',
      experienceLevel: profile.experienceLevel ?? null,
      currentWeightKg: profile.currentWeightKg ?? null,
      timezone: profile.timezone ?? 'America/Mexico_City',
      createdAt: user.createdAt ?? null,
      lastSessionAt: user.lastWorkoutDate ?? null,
      hasActiveSession: Boolean(user.currentSession),
      hasActiveMesocycle: Boolean(user.currentMesocycle),
      mesocycleStatus: user.currentMesocycle?.status ?? null,
    },
    gamification: {
      lifetimeSessionsCompleted: gamification.lifetimeSessionsCompleted ?? 0,
      currentStreakDays: gamification.currentStreakDays ?? 0,
      longestStreakDays: gamification.longestStreakDays ?? 0,
      fitCoinsBalance: gamification.fitCoinsBalance ?? 0,
      seasonPoints: gamification.seasonPoints ?? 0,
      seasonSessionsCompleted: gamification.seasonSessionsCompleted ?? 0,
      lifetimeWeeksPerfect: gamification.lifetimeWeeksPerfect ?? 0,
      lifetimeMesocyclesCompleted: gamification.lifetimeMesocyclesCompleted ?? 0,
    },
    stats: {
      archivedSessions: sessionSummaries.length,
      totalVolumeKg: volumes.length ? round1(volumes.reduce((s, v) => s + v, 0)) : 0,
      avgVolumeKg: avg(volumes),
      comparableLifts: comparableDeltas.length,
      avgLoadDeltaPct: avg(comparableDeltas),
      heavierThanPrescribed,
      lighterThanPrescribed,
      onTargetWithin5Pct: onTarget,
      adherenceRatePct:
        comparableDeltas.length > 0
          ? round1((onTarget / comparableDeltas.length) * 100)
          : null,
    },
    charts: {
      volumeBySession: volumeSeries,
      loadBySession: loadSeries,
    },
    ledgerHighlights: buildLedgerHighlights(user.loadPerformanceLedger),
    sessions: sessionSummaries
      .slice()
      .sort((a, b) => {
        const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return bTime - aTime;
      }),
  };
}
