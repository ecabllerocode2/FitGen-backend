import { getCheckinStatus, analyzeBodyTrend } from '../athlete/bodyMetrics.js';
import { RECENT_SESSIONS_MAX } from '../athlete/loadPerformanceLedger.js';
import { buildClientInsights } from './insights.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export { RECENT_SESSIONS_MAX };

export function computeBmi(weightKg, heightCm) {
  if (!weightKg || !heightCm || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Math.round(bmi * 10) / 10;
}

export function bmiCategory(bmi) {
  if (bmi == null) return null;
  if (bmi < 18.5) return 'Bajo peso';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Sobrepeso';
  return 'Obesidad';
}

export function buildCheckinReminderMessage(clientName = 'atleta') {
  return `Hola ${clientName}, necesito que actualices tu peso y medidas en FitGen (check-in de composición corporal). Con esos datos puedo orientar mejor tu nutrición y los ajustes de tu plan. ¿Lo puedes hacer hoy?`;
}

function flattenMainBlockExercises(session) {
  const main = session?.mainBlock;
  if (!main) return [];
  if (Array.isArray(main)) return main;
  const blocks = main.bloques ?? main.blocks ?? main.estaciones ?? [];
  return blocks.flatMap((block) => block.ejercicios ?? block.exercises ?? []);
}

function exerciseName(ex) {
  return ex.exerciseName ?? ex.nombre ?? ex.name ?? 'Ejercicio';
}

function prescribedLoadKg(ex) {
  const load = ex.prescribedLoadKg ?? ex.suggestedLoadKg ?? ex.prescripcion?.pesoSugerido;
  return load != null && Number.isFinite(Number(load)) ? Number(load) : null;
}

function countPrescribedSets(ex) {
  if (Array.isArray(ex.sets)) return ex.sets.length;
  if (typeof ex.sets === 'number') return ex.sets;
  if (ex.prescripcion?.series) return Number(ex.prescripcion.series) || 0;
  return 0;
}

function extractPerformanceSets(ex) {
  const sets = ex.sets ?? ex.actualSets ?? [];
  if (!Array.isArray(sets)) return [];
  return sets.filter((s) => s && s.completed !== false);
}

function bestActualLoadKg(ex) {
  if (ex.actualWeightKg != null) return Number(ex.actualWeightKg);
  const completed = extractPerformanceSets(ex);
  const loads = completed
    .map((s) => s.load ?? s.weightKg ?? s.weight)
    .filter((v) => v != null && Number.isFinite(Number(v)));
  return loads.length ? Math.max(...loads.map(Number)) : null;
}

function loadComparison(prescribed, actual) {
  if (prescribed == null || actual == null) return 'na';
  const diff = actual - prescribed;
  if (Math.abs(diff) <= 1.25) return 'on_target';
  if (diff < 0) return 'under';
  return 'over';
}

export function summarizeSessionExercises(session, { completed = false } = {}) {
  const source = completed && session.performance
    ? (Array.isArray(session.performance) ? session.performance : [])
    : flattenMainBlockExercises(session);

  return source.map((ex, index) => {
    const template = !completed
      ? ex
      : flattenMainBlockExercises(session).find(
          (t) => (t.exerciseId ?? t.id) === (ex.exerciseId ?? ex.id),
        ) ?? flattenMainBlockExercises(session)[index];

    const prescribed = prescribedLoadKg(template ?? ex);
    const actual = completed ? bestActualLoadKg(ex) : null;
    const setsPrescribed = countPrescribedSets(template ?? ex);
    const setsCompleted = completed ? extractPerformanceSets(ex).length : 0;

    return {
      exerciseId: ex.exerciseId ?? ex.id ?? `ex_${index}`,
      name: exerciseName(ex),
      muscleGroup: ex.muscleGroup ?? ex.parteCuerpo ?? null,
      prescribedLoadKg: prescribed,
      actualLoadKg: actual,
      setsPrescribed,
      setsCompleted,
      loadComparison: completed ? loadComparison(prescribed, actual) : 'na',
      completed: setsCompleted > 0,
    };
  });
}

export function buildLiveSessionView(currentSession) {
  if (!currentSession || currentSession.completed) return null;

  const exercises = summarizeSessionExercises(currentSession, { completed: false });
  const totalSets = exercises.reduce((sum, ex) => sum + ex.setsPrescribed, 0);

  return {
    isLive: true,
    sessionId: currentSession.sessionId ?? currentSession.id ?? null,
    sessionFocus: currentSession.sessionFocus ?? 'Sesión',
    weekNumber: currentSession.weekNumber ?? null,
    dayOfWeek: currentSession.dayOfWeek ?? null,
    phase: currentSession.phase ?? null,
    totalExercises: exercises.length,
    totalSetsPlanned: totalSets,
    exercises,
    note:
      'Sesión iniciada en el dispositivo del atleta. Los pesos registrados se sincronizan al completar la sesión.',
  };
}

export function buildMesocycleOverview(mesocycle, referenceDate = new Date()) {
  if (!mesocycle) return null;

  const microcycles = mesocycle.microcycles ?? mesocycle.mesocyclePlan?.microcycles ?? [];
  const durationWeeks = mesocycle.durationWeeks ?? microcycles.length ?? 0;
  let currentWeek = mesocycle.currentWeek ?? 1;

  if (mesocycle.startDate) {
    const start = new Date(mesocycle.startDate);
    if (!Number.isNaN(start.getTime())) {
      const weeks = Math.floor((referenceDate.getTime() - start.getTime()) / (7 * MS_PER_DAY)) + 1;
      currentWeek = Math.min(Math.max(1, weeks), durationWeeks || weeks);
    }
  }

  const weekIndex = Math.min(Math.max(0, currentWeek - 1), Math.max(0, microcycles.length - 1));
  const activeMicro = microcycles[weekIndex] ?? microcycles[0];
  const weeklySplit = (activeMicro?.sessions ?? []).map((s) => ({
    day: s.dayOfWeek,
    focus: s.sessionFocus,
    isRest: Boolean(s.isRestDay || s.sessionFocus === 'Descanso'),
  }));

  return {
    goal: mesocycle.goal ?? mesocycle.mesocyclePlan?.mesocycleGoal ?? null,
    splitType: mesocycle.splitType ?? null,
    durationWeeks,
    currentWeek,
    progressPercent: durationWeeks ? Math.round((currentWeek / durationWeeks) * 100) : 0,
    status: mesocycle.status ?? 'activo',
    weeklySplit,
  };
}

export function buildAnthropometrics(profileData = {}, bodyMetrics = {}) {
  const profileWeight = profileData.currentWeightKg ?? profileData.initialWeight ?? null;
  const latestWeight = bodyMetrics.latest?.weightKg ?? null;
  const weightKg = latestWeight ?? profileWeight;
  const heightCm = profileData.heightCm ?? null;
  const bmi = computeBmi(weightKg, heightCm);

  return {
    weightKg,
    profileWeightKg: profileWeight,
    heightCm,
    bmi,
    bmiCategory: bmiCategory(bmi),
    age: profileData.age ?? null,
    gender: profileData.gender ?? null,
  };
}

export function buildCheckinSummary(bodyMetrics = {}, clientName = 'atleta') {
  const status = getCheckinStatus(bodyMetrics);
  const trend = analyzeBodyTrend(bodyMetrics.entries ?? []);
  const needsCheckin = status.due || status.overdue || !status.lastCheckinAt;

  return {
    ...status,
    needsCheckin,
    intervalDays: 14,
    recentEntries: (bodyMetrics.entries ?? []).slice(-6).reverse(),
    trend,
    reminderMessage: buildCheckinReminderMessage(clientName),
  };
}

function collectSessionRirs(session) {
  const rows = Array.isArray(session?.performance) ? session.performance : [];
  const rirs = [];
  for (const ex of rows) {
    if (ex.actualRIR != null && Number.isFinite(Number(ex.actualRIR))) {
      rirs.push(Number(ex.actualRIR));
    }
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    for (const set of sets) {
      if (set?.completed === false) continue;
      const rir = set?.rir ?? set?.actualRIR;
      if (rir != null && Number.isFinite(Number(rir))) rirs.push(Number(rir));
    }
  }
  return rirs;
}

export function summarizeSessionHistoryEntry(session) {
  const exercises = summarizeSessionExercises(session, { completed: true });
  const completedSets = exercises.reduce((sum, ex) => sum + ex.setsCompleted, 0);
  const prescribedSets = exercises.reduce((sum, ex) => sum + ex.setsPrescribed, 0);
  const rirs = collectSessionRirs(session);
  const avgRir = rirs.length
    ? Math.round((rirs.reduce((s, v) => s + v, 0) / rirs.length) * 10) / 10
    : null;
  const failureSets = rirs.filter((r) => r <= 0).length;
  const readiness = session.readinessAdjustment ?? {};

  return {
    id: session.id,
    sessionFocus: session.sessionFocus ?? 'Sesión',
    weekNumber: session.weekNumber ?? null,
    dayOfWeek: session.dayOfWeek ?? null,
    completed: Boolean(session.completed),
    completedAt: session.completedAt ?? session.archivedAt ?? null,
    durationLabel: session.summary?.durationLabel ?? session.summary?.duracionEstimada ?? null,
    exerciseCount: exercises.length,
    setsCompleted: completedSets,
    setsPrescribed: prescribedSets,
    readinessEnergy: readiness.energyLevel ?? session.sessionFeedback?.energyLevel ?? null,
    readinessVolumeMultiplier: readiness.volumeMultiplierApplied ?? null,
    jointPain: Boolean(session.feedback?.jointPain ?? session.sessionFeedback?.jointPain ?? session.weeklyFeedback?.jointPain),
    totalVolumeKg: session.summary?.totalWeightKg ?? null,
    avgRir,
    failureSetCount: failureSets,
    exercises,
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Progress series for coach charts: volume, load adherence, RIR, body metrics.
 */
export function buildCoachProgressCharts({ recentSessions = [], bodyMetrics = {} } = {}) {
  const completed = [...recentSessions]
    .filter((s) => s.completed && (s.completedAt || s.archivedAt))
    .sort(
      (a, b) =>
        new Date(a.completedAt ?? a.archivedAt).getTime()
        - new Date(b.completedAt ?? b.archivedAt).getTime(),
    )
    .slice(-16);

  const volumeBySession = completed.map((session) => {
    const summary = summarizeSessionHistoryEntry(session);
    const comparable = summary.exercises.filter((e) => e.loadComparison !== 'na');
    const over = comparable.filter((e) => e.loadComparison === 'over').length;
    const under = comparable.filter((e) => e.loadComparison === 'under').length;
    const onTarget = comparable.filter((e) => e.loadComparison === 'on_target').length;
    return {
      date: summary.completedAt,
      label: summary.sessionFocus,
      volumeKg: summary.totalVolumeKg,
      avgRir: summary.avgRir,
      failureSetCount: summary.failureSetCount,
      setsCompleted: summary.setsCompleted,
      setsPrescribed: summary.setsPrescribed,
      completionRate:
        summary.setsPrescribed > 0
          ? round1(summary.setsCompleted / summary.setsPrescribed)
          : null,
      loadOver: over,
      loadUnder: under,
      loadOnTarget: onTarget,
    };
  });

  const weightHistory = (bodyMetrics.entries ?? [])
    .filter((e) => e?.recordedAt && e.weightKg != null)
    .slice(-12)
    .map((e) => ({
      date: e.recordedAt,
      weightKg: Number(e.weightKg),
      waistCm: e.waistCm != null ? Number(e.waistCm) : null,
      hipCm: e.hipCm != null ? Number(e.hipCm) : null,
    }));

  const strengthHighlights = [];
  // filled by caller if ledger available — keep shape stable

  return {
    volumeBySession,
    weightHistory,
    strengthHighlights,
  };
}

export function buildClientListFlags(athlete) {
  const checkin = buildCheckinSummary(athlete?.bodyMetrics ?? {}, athlete?.profileData?.name);
  const isTrainingNow = Boolean(athlete?.currentSession && !athlete.currentSession.completed);

  return {
    isTrainingNow,
    checkinDue: checkin.needsCheckin,
    checkinOverdue: checkin.overdue,
    currentSessionFocus: isTrainingNow ? athlete.currentSession.sessionFocus ?? null : null,
  };
}

/**
 * Full coach client dashboard payload.
 */
export function buildClientDashboard({ athleteUser, recentSessions = [], now = new Date() }) {
  const profile = athleteUser?.profileData ?? {};
  const bodyMetrics = athleteUser?.bodyMetrics ?? {};
  const clientName = profile.name ?? 'Cliente';
  const { insights, metrics } = buildClientInsights({ athleteUser, recentSessions, now });

  const liveSession = buildLiveSessionView(athleteUser?.currentSession);
  const mesocycle = buildMesocycleOverview(athleteUser?.currentMesocycle, now);
  const anthropometrics = buildAnthropometrics(profile, bodyMetrics);
  const checkin = buildCheckinSummary(bodyMetrics, clientName);

  const sessionHistory = recentSessions.map(summarizeSessionHistoryEntry);
  const lastCompleted = sessionHistory.find((s) => s.completed && s.completedAt);
  const charts = buildCoachProgressCharts({
    recentSessions,
    bodyMetrics,
  });

  const ledger = athleteUser?.loadPerformanceLedger;
  const ledgerEntries = Array.isArray(ledger?.entries)
    ? ledger.entries
    : Object.values(ledger?.byExerciseId ?? {});
  charts.strengthHighlights = ledgerEntries
    .filter((e) => e?.e1RM != null)
    .sort((a, b) => Number(b.e1RM) - Number(a.e1RM))
    .slice(0, 6)
    .map((e) => ({
      exerciseId: e.exerciseId ?? null,
      name: e.exerciseName ?? e.exerciseId ?? 'Ejercicio',
      e1RM: e.e1RM,
      previousE1RM: e.previousE1RM ?? null,
      lastWeightKg: e.lastWeightKg ?? null,
      lastRir: e.lastRir ?? null,
      updatedAt: e.updatedAt ?? null,
    }));

  return {
    anthropometrics,
    checkin,
    mesocycle,
    liveSession,
    lastCompletedSession: lastCompleted ?? null,
    sessionHistory,
    sessionHistoryLimit: RECENT_SESSIONS_MAX,
    sessionHistoryCount: sessionHistory.length,
    insights,
    metrics,
    charts,
    trainingProfile: {
      fitnessGoal: profile.fitnessGoal ?? null,
      trainingDaysPerWeek: profile.trainingDaysPerWeek ?? null,
      trainingAgeMonths: profile.trainingAgeMonths ?? null,
      bodyCompositionGoal: profile.bodyCompositionGoal ?? null,
      focusArea: profile.focusArea ?? null,
      injuriesOrLimitations: profile.injuriesOrLimitations ?? [],
      musclePriorities: profile.musclePriorities ?? [],
    },
  };
}
