export const CHECKIN_INTERVAL_DAYS = 14;

/**
 * @param {object} raw
 */
export function normalizeBodyMetricsEntry(raw) {
  const weightKg = raw.weightKg != null ? Number(raw.weightKg) : null;
  const waistCm = raw.waistCm != null ? Number(raw.waistCm) : null;
  const hipCm = raw.hipCm != null ? Number(raw.hipCm) : null;
  const armCm = raw.armCm != null ? Number(raw.armCm) : null;
  const thighCm = raw.thighCm != null ? Number(raw.thighCm) : null;

  return {
    id: raw.id ?? `bm_${Date.now()}`,
    recordedAt: raw.recordedAt ?? new Date().toISOString(),
    weightKg: Number.isFinite(weightKg) ? weightKg : null,
    waistCm: Number.isFinite(waistCm) ? waistCm : null,
    hipCm: Number.isFinite(hipCm) ? hipCm : null,
    armCm: Number.isFinite(armCm) ? armCm : null,
    thighCm: Number.isFinite(thighCm) ? thighCm : null,
    source: raw.source ?? 'manual',
    kind: raw.kind === 'full' ? 'full' : 'light',
  };
}

/**
 * @param {object} [existing]
 * @param {object} entry
 */
export function appendBodyMetricEntry(existing = {}, entry) {
  const normalized = normalizeBodyMetricsEntry(entry);
  const entries = [...(existing.entries ?? []), normalized].slice(-120);

  return {
    entries,
    latest: normalized,
    lastCheckinAt: normalized.recordedAt,
    lastFullCheckinAt:
      normalized.kind === 'full'
        ? normalized.recordedAt
        : existing.lastFullCheckinAt ?? null,
    nextCheckinDueAt: computeNextCheckinDue(normalized.recordedAt),
  };
}

export function computeNextCheckinDue(fromIso) {
  const base = fromIso ? new Date(fromIso) : new Date();
  const due = new Date(base);
  due.setDate(due.getDate() + CHECKIN_INTERVAL_DAYS);
  return due.toISOString();
}

/**
 * @param {object} [bodyMetrics]
 */
export function getCheckinStatus(bodyMetrics = {}) {
  const last = bodyMetrics.lastCheckinAt ?? bodyMetrics.latest?.recordedAt ?? null;
  if (!last) {
    return {
      due: true,
      overdue: false,
      daysSince: null,
      daysUntilDue: 0,
      kind: 'light',
      lastCheckinAt: null,
      nextCheckinDueAt: null,
    };
  }

  const daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
  const due = daysSince >= CHECKIN_INTERVAL_DAYS;
  const overdue = daysSince >= CHECKIN_INTERVAL_DAYS + 3;
  const daysUntilDue = Math.max(0, CHECKIN_INTERVAL_DAYS - daysSince);

  return {
    due,
    overdue,
    daysSince,
    daysUntilDue,
    kind: 'light',
    lastCheckinAt: last,
    nextCheckinDueAt: bodyMetrics.nextCheckinDueAt ?? computeNextCheckinDue(last),
  };
}

/**
 * Linear trend over recent entries (kg/cm per week).
 * @param {object[]} entries
 * @param {'weightKg'|'waistCm'} field
 * @param {number} windowDays
 */
function linearTrendPerWeek(entries, field, windowDays = 28) {
  const cutoff = Date.now() - windowDays * 86400000;
  const points = entries
    .filter((e) => e[field] != null && new Date(e.recordedAt).getTime() >= cutoff)
    .map((e) => ({
      t: new Date(e.recordedAt).getTime(),
      v: e[field],
    }))
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) return 0;

  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / (7 * 86400000));
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * @param {object[]} entries
 * @param {number} [windowDays]
 */
export function analyzeBodyTrend(entries = [], windowDays = 28) {
  const weightTrendKgPerWeek = linearTrendPerWeek(entries, 'weightKg', windowDays);
  const waistTrendCmPerWeek = linearTrendPerWeek(entries, 'waistCm', windowDays);

  const messages = [];
  if (Math.abs(weightTrendKgPerWeek) >= 0.15) {
    messages.push(
      weightTrendKgPerWeek > 0
        ? `Peso subiendo ~${weightTrendKgPerWeek.toFixed(1)} kg/semana`
        : `Peso bajando ~${Math.abs(weightTrendKgPerWeek).toFixed(1)} kg/semana`,
    );
  }
  if (Math.abs(waistTrendCmPerWeek) >= 0.2) {
    messages.push(
      waistTrendCmPerWeek > 0
        ? `Cintura subiendo ~${waistTrendCmPerWeek.toFixed(1)} cm/semana`
        : `Cintura bajando ~${Math.abs(waistTrendCmPerWeek).toFixed(1)} cm/semana`,
    );
  }

  return {
    weightTrendKgPerWeek,
    waistTrendCmPerWeek,
    messages,
    sampleSize: (entries ?? []).length,
  };
}

/**
 * Adjust landmarks from body-composition trends at mesocycle end.
 * @param {Record<string, { MEV: number, MRV: number, MAV_actual?: number }>} landmarks
 * @param {object} trend
 * @param {string} [bodyCompositionGoal]
 */
export function applyTrendToLandmarks(landmarks, trend, bodyCompositionGoal = 'Mantener') {
  const updated = {};
  const messages = [];
  const { weightTrendKgPerWeek = 0, waistTrendCmPerWeek = 0 } = trend ?? {};

  for (const [muscle, lm] of Object.entries(landmarks ?? {})) {
    let mev = lm.MEV;
    let mrv = lm.MRV;

    if (bodyCompositionGoal === 'Perder_Grasa') {
      if (weightTrendKgPerWeek > 0.2 || waistTrendCmPerWeek > 0.25) {
        mev = Math.max(1, Math.round(mev * 0.95));
        mrv = Math.max(mev + 2, Math.round(mrv * 0.95));
        messages.push(`${muscle}: volumen conservador por tendencia de grasa`);
      } else if (weightTrendKgPerWeek < -0.8) {
        mev = Math.round(mev * 1.03);
        messages.push(`${muscle}: leve aumento MEV — pérdida muy rápida`);
      }
    } else if (bodyCompositionGoal === 'Ganar_Musculo') {
      if (weightTrendKgPerWeek < 0.05 && waistTrendCmPerWeek <= 0.1) {
        mev = Math.round(mev * 1.05);
        messages.push(`${muscle}: subimos MEV por estancamiento de masa`);
      }
    }

    updated[muscle] = { ...lm, MEV: mev, MRV: mrv, MAV_actual: mev };
  }

  return { landmarks: updated, messages };
}
