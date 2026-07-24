/**
 * Coach supervision insights — derived from existing athlete data, no second motor.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(iso, now = new Date()) {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);
}

function adherenceRate(sessions, days, now = new Date()) {
  const cutoff = now.getTime() - days * MS_PER_DAY;
  const completed = sessions.filter(
    (s) => s.completed && s.completedAt && new Date(s.completedAt).getTime() >= cutoff,
  );
  return completed.length;
}

/**
 * @param {object} params
 * @param {object} params.athleteUser
 * @param {object[]} [params.recentSessions]
 * @param {Date} [params.now]
 */
export function buildClientInsights({ athleteUser, recentSessions = [], now = new Date() }) {
  const insights = [];
  const profile = athleteUser?.profileData ?? {};
  const mesocycle = athleteUser?.currentMesocycle;
  const sessions = recentSessions ?? [];

  const lastCompleted = sessions.find((s) => s.completed && s.completedAt);
  const daysSinceLast = lastCompleted ? daysAgo(lastCompleted.completedAt, now) : null;

  const adherence7 = adherenceRate(sessions, 7, now);
  const adherence28 = adherenceRate(sessions, 28, now);
  const expectedWeekly = profile.trainingDaysPerWeek ?? 3;

  if (daysSinceLast != null && daysSinceLast >= 5) {
    insights.push({
      id: 'inactivity',
      severity: daysSinceLast >= 10 ? 'high' : 'medium',
      title: 'Sin entrenar recientemente',
      message: `Lleva ${daysSinceLast} días sin completar una sesión. Escríbele para retomar adherencia.`,
      suggestion: 'Pregúntale si hay barreras de tiempo, motivación o molestias.',
    });
  }

  if (adherence7 < Math.max(1, expectedWeekly - 1) && (daysSinceLast == null || daysSinceLast < 7)) {
    insights.push({
      id: 'low_adherence_7d',
      severity: 'medium',
      title: 'Adherencia baja esta semana',
      message: `Solo ${adherence7} sesión(es) en los últimos 7 días (esperado ~${expectedWeekly}/sem).`,
      suggestion: 'Revisa si el volumen o los días asignados son realistas para su agenda.',
    });
  }

  const jointPainSessions = sessions
    .slice(0, 5)
    .filter((s) => s.feedback?.jointPain || s.weeklyFeedback?.jointPain);
  if (jointPainSessions.length >= 2) {
    insights.push({
      id: 'joint_pain_repeated',
      severity: 'high',
      title: 'Dolor articular recurrente',
      message: 'Reportó molestia articular en varias sesiones recientes.',
      suggestion: 'Revisa lesiones del perfil y considera excluir ejercicios que carguen la zona.',
    });
  }

  const lowReadiness = sessions
    .slice(0, 3)
    .filter((s) => s.readinessAdjustment?.energyLevel != null && s.readinessAdjustment.energyLevel <= 2);
  if (lowReadiness.length >= 2) {
    insights.push({
      id: 'low_readiness',
      severity: 'medium',
      title: 'Energía baja al entrenar',
      message: 'Varias sesiones recientes con energía muy baja en readiness.',
      suggestion: 'Habla de sueño, estrés y nutrición antes de subir volumen.',
    });
  }

  if (mesocycle?.status === 'evaluacion_pendiente') {
    insights.push({
      id: 'mesocycle_eval_pending',
      severity: 'medium',
      title: 'Mesociclo por evaluar',
      message: 'El cliente debe completar la evaluación de fin de mesociclo en la app.',
      suggestion: 'Recuérdale evaluar el bloque para generar el siguiente ciclo.',
    });
  }

  if (!athleteUser?.currentMesocycle && athleteUser?.profileCompleteness?.readyForMesocycle) {
    insights.push({
      id: 'no_mesocycle',
      severity: 'high',
      title: 'Sin mesociclo activo',
      message: 'El perfil está listo pero no hay mesociclo generado.',
      suggestion: 'Genera el mesociclo desde el panel del cliente.',
    });
  }

  return {
    insights,
    metrics: {
      adherence7,
      adherence28,
      daysSinceLastSession: daysSinceLast,
      expectedSessionsPerWeek: expectedWeekly,
    },
  };
}
