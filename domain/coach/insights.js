/**
 * Coach supervision insights — derived from athlete data + training motor signals.
 * Each insight includes what FitGen already does / will do next (`systemAction`).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(iso, now = new Date()) {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);
}

function adherenceRate(sessions, days, now = new Date()) {
  const cutoff = now.getTime() - days * MS_PER_DAY;
  return sessions.filter(
    (s) => s.completed && s.completedAt && new Date(s.completedAt).getTime() >= cutoff,
  ).length;
}

function flattenMainBlock(session) {
  const main = session?.mainBlock;
  if (!main) return [];
  if (Array.isArray(main)) return main;
  const blocks = main.bloques ?? main.blocks ?? main.estaciones ?? [];
  return blocks.flatMap((block) => block.ejercicios ?? block.exercises ?? []);
}

function performanceRows(session) {
  return Array.isArray(session?.performance) ? session.performance : [];
}

function extractSets(ex) {
  const sets = ex?.sets ?? ex?.actualSets ?? [];
  return Array.isArray(sets) ? sets.filter((s) => s && s.completed !== false) : [];
}

function setRir(set) {
  const v = set?.rir ?? set?.actualRIR ?? set?.reportedRir;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

function exerciseTargetRir(template, performanceEx) {
  const v =
    template?.rirTarget
    ?? performanceEx?.rirTarget
    ?? template?.prescripcion?.rirObjetivo;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

function isCompoundLike(ex) {
  const type = String(ex?.exerciseType ?? '').toLowerCase();
  if (type === 'compound' || type === 'compuesto') return true;
  const priority = Number(ex?.prioridad ?? ex?.priority ?? 3);
  return priority <= 1 || Boolean(ex?.isPriorityLift || ex?.fuerzaMainLift);
}

/**
 * Scan recent completed sessions for motor-relevant load / RIR patterns.
 */
function analyzeRecentPerformance(sessions = []) {
  const completed = sessions.filter((s) => s.completed).slice(0, 5);
  let failureCompoundCount = 0;
  let failureExerciseNames = [];
  let overCount = 0;
  let underCount = 0;
  let comparableCount = 0;
  let volumeMissCount = 0;
  let readinessCutCount = 0;
  let readinessMessages = [];

  for (const session of completed) {
    const templates = flattenMainBlock(session);
    const byId = new Map(templates.map((t) => [t.exerciseId ?? t.id, t]));
    const rows = performanceRows(session).length ? performanceRows(session) : templates;

    let plannedSets = 0;
    let doneSets = 0;

    for (const [index, ex] of rows.entries()) {
      const id = ex.exerciseId ?? ex.id;
      const template = (id && byId.get(id)) || templates[index] || ex;
      const sets = extractSets(ex);
      const prescribedSets =
        typeof template.sets === 'number'
          ? template.sets
          : Array.isArray(template.sets)
            ? template.sets.length
            : Number(template.prescripcion?.series) || sets.length;

      plannedSets += prescribedSets || 0;
      doneSets += sets.length;

      const targetRir = exerciseTargetRir(template, ex);
      const rirs = sets.map(setRir).filter((v) => v != null);
      const minRir = rirs.length ? Math.min(...rirs) : (ex.actualRIR != null ? Number(ex.actualRIR) : null);

      if (
        isCompoundLike(template)
        && minRir != null
        && minRir <= 0
        && (targetRir == null || targetRir >= 1.5)
      ) {
        failureCompoundCount += 1;
        const name = ex.exerciseName ?? ex.nombre ?? template.exerciseName ?? template.nombre;
        if (name && failureExerciseNames.length < 4) failureExerciseNames.push(name);
      }

      const prescribed =
        Number(template.prescribedLoadKg ?? template.suggestedLoadKg ?? ex.prescribedLoadKg);
      const actualLoads = sets
        .map((s) => Number(s.load ?? s.weightKg ?? s.weight))
        .filter((n) => Number.isFinite(n) && n > 0);
      const actual = ex.actualWeightKg != null
        ? Number(ex.actualWeightKg)
        : actualLoads.length
          ? Math.max(...actualLoads)
          : null;

      if (
        Number.isFinite(prescribed)
        && prescribed > 0
        && actual != null
        && !template.isBodyweight
        && template.loadMode !== 'bodyweight'
      ) {
        comparableCount += 1;
        const diff = actual - prescribed;
        if (diff > 1.25) overCount += 1;
        else if (diff < -1.25) underCount += 1;
      }
    }

    if (plannedSets > 0 && doneSets / plannedSets < 0.8) {
      volumeMissCount += 1;
    }

    const readiness = session.readinessAdjustment ?? {};
    if (
      readiness.volumeMultiplierApplied != null
      && Number(readiness.volumeMultiplierApplied) < 0.95
    ) {
      readinessCutCount += 1;
      if (readiness.userMessage) readinessMessages.push(readiness.userMessage);
    }
  }

  return {
    failureCompoundCount,
    failureExerciseNames,
    overCount,
    underCount,
    comparableCount,
    volumeMissCount,
    readinessCutCount,
    readinessMessages,
    sessionsAnalyzed: completed.length,
  };
}

function ledgerRegressions(ledger) {
  const entries = Array.isArray(ledger?.entries)
    ? ledger.entries
    : Array.isArray(ledger)
      ? ledger
      : Object.values(ledger?.byExerciseId ?? {});
  const drops = [];
  for (const entry of entries) {
    const e1 = Number(entry?.e1RM);
    const prev = Number(entry?.previousE1RM);
    if (!Number.isFinite(e1) || !Number.isFinite(prev) || prev <= 0) continue;
    const dropPct = ((prev - e1) / prev) * 100;
    if (dropPct >= 5) {
      drops.push({
        name: entry.exerciseName ?? entry.exerciseId ?? 'Ejercicio',
        dropPct: Math.round(dropPct),
      });
    }
  }
  return drops.slice(0, 4);
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
  const bodyMetrics = athleteUser?.bodyMetrics ?? {};

  const lastCompleted = sessions.find((s) => s.completed && s.completedAt);
  const daysSinceLast = lastCompleted ? daysAgo(lastCompleted.completedAt, now) : null;

  const adherence7 = adherenceRate(sessions, 7, now);
  const adherence28 = adherenceRate(sessions, 28, now);
  const expectedWeekly = profile.trainingDaysPerWeek ?? 3;
  const perf = analyzeRecentPerformance(sessions);

  if (daysSinceLast != null && daysSinceLast >= 5) {
    insights.push({
      id: 'inactivity',
      severity: daysSinceLast >= 10 ? 'high' : 'medium',
      category: 'adherence',
      title: 'Sin entrenar recientemente',
      message: `Lleva ${daysSinceLast} días sin completar una sesión.`,
      suggestion: 'Escríbele para retomar adherencia y detectar barreras de tiempo, motivación o molestias.',
      systemAction:
        'Al volver, FitGen conserva su historial de cargas (e1RM). Si el descanso es largo, puede usar cargas exploratorias antes de subir intensidad.',
    });
  }

  if (adherence7 < Math.max(1, expectedWeekly - 1) && (daysSinceLast == null || daysSinceLast < 7)) {
    insights.push({
      id: 'low_adherence_7d',
      severity: 'medium',
      category: 'adherence',
      title: 'Adherencia baja esta semana',
      message: `Solo ${adherence7} sesión(es) en los últimos 7 días (esperado ~${expectedWeekly}/sem).`,
      suggestion: 'Revisa si los días asignados encajan con su agenda real.',
      systemAction:
        'Puedes remapear días en el perfil técnico: FitGen reasigna el split al calendario sin regenerar el mesociclo completo (schedule_remap).',
    });
  }

  const jointPainSessions = sessions
    .slice(0, 5)
    .filter((s) => s.feedback?.jointPain || s.weeklyFeedback?.jointPain || s.sessionFeedback?.jointPain);
  if (jointPainSessions.length >= 2) {
    insights.push({
      id: 'joint_pain_repeated',
      severity: 'high',
      category: 'safety',
      title: 'Dolor articular recurrente',
      message: `Reportó molestia articular en ${jointPainSessions.length} de las últimas sesiones.`,
      suggestion: 'Actualiza lesiones/limitaciones y excluye patrones que carguen la zona.',
      systemAction:
        'Al cerrar la semana con dolor articular, FitGen aplica ~−30% de volumen (modificador 0.7) en el músculo afectado. Un cambio de lesiones dispara safety_update y filtra patrones de riesgo en la siguiente sesión.',
    });
  }

  const lowReadiness = sessions
    .slice(0, 3)
    .filter((s) => s.readinessAdjustment?.energyLevel != null && s.readinessAdjustment.energyLevel <= 2);
  if (lowReadiness.length >= 2) {
    insights.push({
      id: 'low_readiness',
      severity: 'medium',
      category: 'recovery',
      title: 'Energía baja al entrenar',
      message: 'Varias sesiones recientes con energía muy baja en readiness.',
      suggestion: 'Habla de sueño, estrés y nutrición antes de pedir más volumen.',
      systemAction:
        'FitGen ya reduce volumen y sube RIR en esas sesiones (readiness). Nunca aumenta la demanda por readiness bajo.',
    });
  }

  if (perf.readinessCutCount >= 1) {
    insights.push({
      id: 'readiness_session_cut',
      severity: 'low',
      category: 'recovery',
      title: 'Sesión auto-reducida por readiness',
      message:
        perf.readinessMessages[0]
        ?? `FitGen redujo volumen en ${perf.readinessCutCount} sesión(es) reciente(s) por fatiga/sueño/estrés.`,
      suggestion: 'No fuerces volumen extra el mismo día: la sesión ya viene atenuada.',
      systemAction:
        'El ajuste es solo de esa sesión. En la siguiente, si el readiness mejora, vuelve a la dosis planificada del microciclo.',
    });
  }

  if (perf.failureCompoundCount >= 2) {
    insights.push({
      id: 'rir_failure_cluster',
      severity: 'high',
      category: 'load',
      title: 'Fallo muscular cuando el plan pedía reservas',
      message:
        `Registró RIR 0 en ${perf.failureCompoundCount} levantamientos compuestos`
        + (perf.failureExerciseNames.length
          ? ` (${perf.failureExerciseNames.join(', ')})`
          : '')
        + ' con un RIR objetivo ≥ 1.5. Suele indicar que la carga usada fue demasiado alta para el estímulo planeado.',
      suggestion:
        'Confirma técnica y honestidad del RIR. Si el fallo fue intencional, bájale la carga en la próxima sesión o deja que el motor recalibre.',
      systemAction:
        'FitGen recalibra el e1RM con ese fallo y aplica topes semanales de progresión (compuestos ~+5%/semana). La siguiente prescripción sale más conservadora a partir del nuevo e1RM, sin saltos bruscos.',
    });
  } else if (perf.failureCompoundCount === 1) {
    insights.push({
      id: 'rir_failure_single',
      severity: 'medium',
      category: 'load',
      title: 'Fallo (RIR 0) en un compuesto',
      message:
        `Hubo al menos un levantamiento compuesto a RIR 0`
        + (perf.failureExerciseNames[0] ? ` (${perf.failureExerciseNames[0]})` : '')
        + ' cuando el plan pedía dejar repeticiones en reserva.',
      suggestion: 'Vigila si se repite: un fallo aislado puede ser fatiga del día.',
      systemAction:
        'El e1RM de ese ejercicio se actualiza con el set a fallo; la próxima carga se prescribe desde ese ancla con límites de progresión.',
    });
  }

  if (perf.comparableCount >= 3 && perf.overCount >= Math.ceil(perf.comparableCount * 0.5)) {
    insights.push({
      id: 'load_over_prescribed',
      severity: 'medium',
      category: 'load',
      title: 'Cargas por encima de lo prescrito',
      message: `En las últimas sesiones, ${perf.overCount}/${perf.comparableCount} ejercicios usaron más peso del prescrito.`,
      suggestion: 'Verifica si entiende la convención (kg/mano vs total) o si está forzando el ego-lifting.',
      systemAction:
        'El ledger puede inflar el e1RM. FitGen seguirá topeando subidas semanales; si el RIR real fue bajo, la recalibración bajará la dosis en próximas sesiones.',
    });
  }

  if (perf.comparableCount >= 3 && perf.underCount >= Math.ceil(perf.comparableCount * 0.5)) {
    insights.push({
      id: 'load_under_prescribed',
      severity: 'medium',
      category: 'load',
      title: 'Cargas por debajo de lo prescrito',
      message: `En las últimas sesiones, ${perf.underCount}/${perf.comparableCount} ejercicios usaron menos peso del prescrito.`,
      suggestion: 'Pregunta por dolor, miedo a la carga o falta de equipo antes de subir el plan.',
      systemAction:
        'El e1RM baja con lo realmente levantado; la siguiente sesión se prescribe desde esa realidad (no desde el peso teórico).',
    });
  }

  if (perf.volumeMissCount >= 2) {
    insights.push({
      id: 'volume_gate_miss',
      severity: 'medium',
      category: 'adherence',
      title: 'Volumen incompleto reiterado',
      message: `Completó <80% de las series planeadas en ${perf.volumeMissCount} sesiones recientes.`,
      suggestion: 'Detecta si el problema es tiempo, fatiga o plan sobrecargado.',
      systemAction:
        'Esas sesiones no cumplen el umbral de estímulo para recompensas. El motor no sube volumen automáticamente; el progreso de fuerza se basa en series realmente logueadas.',
    });
  }

  const modifiers = athleteUser?.weeklyFeedbackModifiers ?? {};
  const modifierEntries = Object.entries(modifiers).filter(([, v]) => typeof v === 'number' && v !== 1);
  for (const [muscle, mod] of modifierEntries.slice(0, 4)) {
    if (mod <= 0.75) {
      insights.push({
        id: `weekly_volume_cut_joint_${muscle}`,
        severity: 'high',
        category: 'autoregulation',
        title: `Volumen reducido: ${muscle}`,
        message: `Feedback semanal aplica ×${mod} en ${muscle} (típico tras dolor articular).`,
        suggestion: 'Revisa molestias y posibles exclusiones de ejercicios.',
        systemAction:
          'FitGen ya bajó ~30% el volumen de esa musculatura en la próxima semana. El modificador se consume al generar la siguiente sesión.',
      });
    } else if (mod < 1) {
      insights.push({
        id: `weekly_volume_cut_mrv_${muscle}`,
        severity: 'medium',
        category: 'autoregulation',
        title: `Acercándose a MRV: ${muscle}`,
        message: `Señales de fatiga alta → volumen ×${mod} en ${muscle}.`,
        suggestion: 'No añadas trabajo extra; deja que el deload planificado haga su trabajo.',
        systemAction:
          'FitGen ya atenuó ~15% el volumen. En la semana de deload del mesociclo el volumen cae ~50% con RIR más alto.',
      });
    } else if (mod > 1) {
      insights.push({
        id: `weekly_volume_boost_${muscle}`,
        severity: 'low',
        category: 'autoregulation',
        title: `Capacidad extra: ${muscle}`,
        message: `Recuperación favorable → volumen ×${mod} en ${muscle}.`,
        suggestion: 'Confirma que la recuperación sigue bien antes de empujar más fuera del plan.',
        systemAction:
          'FitGen ya subió ~15% el volumen de esa musculatura para la próxima semana generada.',
      });
    }
  }

  const microcycles = mesocycle?.microcycles ?? mesocycle?.mesocyclePlan?.microcycles ?? [];
  const weekIndex = Math.min(
    Math.max(0, (mesocycle?.currentWeek ?? 1) - 1),
    Math.max(0, microcycles.length - 1),
  );
  const activeMicro = microcycles[weekIndex];
  if (activeMicro?.phase === 'deload' || activeMicro?.isDeload) {
    insights.push({
      id: 'deload_week_active',
      severity: 'low',
      category: 'periodization',
      title: 'Semana de deload activa',
      message: 'El microciclo actual es de recuperación planificada.',
      suggestion: 'Espera volumen más bajo; no es falta de progreso.',
      systemAction:
        'FitGen reduce el volumen ~50% y eleva el RIR objetivo esta semana. Después retoma la progresión del bloque.',
    });
  }

  const checkinAt = bodyMetrics.lastCheckinAt ?? bodyMetrics.latest?.recordedAt;
  const daysSinceCheckin = checkinAt ? daysAgo(checkinAt, now) : null;
  if (daysSinceCheckin == null || daysSinceCheckin >= 14) {
    insights.push({
      id: 'checkin_overdue',
      severity: daysSinceCheckin == null || daysSinceCheckin >= 17 ? 'medium' : 'low',
      category: 'body',
      title: daysSinceCheckin == null ? 'Sin check-in de medidas' : 'Check-in de composición atrasado',
      message:
        daysSinceCheckin == null
          ? 'Aún no registra peso ni medidas en FitGen.'
          : `Último check-in hace ${daysSinceCheckin} días (intervalo objetivo: 14).`,
      suggestion: 'Pídele actualizar peso y cintura; puedes copiar el mensaje de WhatsApp del panel.',
      systemAction:
        'Las tendencias de peso/cintura alimentan los landmarks del próximo mesociclo (MEV/MRV). Sin datos recientes, el ajuste de composición se basa en señales incompletas.',
    });
  }

  const regressions = ledgerRegressions(athleteUser?.loadPerformanceLedger);
  if (regressions.length >= 1) {
    insights.push({
      id: 'e1rm_regression',
      severity: 'medium',
      category: 'strength',
      title: 'Caída de fuerza estimada (e1RM)',
      message: regressions
        .map((r) => `${r.name} (−${r.dropPct}%)`)
        .join(' · '),
      suggestion: 'Revisa sueño, dolor, déficit calórico o técnica antes de insistir en subir kilos.',
      systemAction:
        'Las próximas prescritas siguen el e1RM nuevo (más bajo). Los topes de progresión evitan rebotes agresivos hasta que recupere el nivel previo.',
    });
  }

  if (mesocycle?.status === 'evaluacion_pendiente') {
    insights.push({
      id: 'mesocycle_eval_pending',
      severity: 'medium',
      category: 'periodization',
      title: 'Mesociclo por evaluar',
      message: 'Debe completar la evaluación de fin de bloque en la app.',
      suggestion: 'Recuérdale evaluar para desbloquear el siguiente ciclo.',
      systemAction:
        'Tras la evaluación, FitGen ajusta MEV (±10% según dificultad) y landmarks de composición corporal para el próximo mesociclo.',
    });
  }

  if (!athleteUser?.currentMesocycle && athleteUser?.profileCompleteness?.readyForMesocycle) {
    insights.push({
      id: 'no_mesocycle',
      severity: 'high',
      category: 'periodization',
      title: 'Sin mesociclo activo',
      message: 'El perfil está listo pero no hay mesociclo generado.',
      suggestion: 'Genera el mesociclo desde el panel del cliente.',
      systemAction:
        'Sin mesociclo no hay prescripción ni autoregulación semanal. Al generarlo, FitGen arma split, volumen y progresión desde su perfil actual.',
    });
  }

  if (athleteUser?.pendingProfileAdaptation?.type === 'periodization') {
    insights.push({
      id: 'periodization_deferred',
      severity: 'low',
      category: 'periodization',
      title: 'Cambio de objetivo diferido',
      message: 'Hay un cambio de periodización pendiente para la próxima semana.',
      suggestion: 'No hace falta regenerar a mano: el motor lo aplicará al avanzar de microciclo.',
      systemAction:
        'FitGen mantiene el plan actual esta semana y aplica el nuevo objetivo/experiencia desde effectiveFromWeek.',
    });
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

  return {
    insights,
    metrics: {
      adherence7,
      adherence28,
      daysSinceLastSession: daysSinceLast,
      expectedSessionsPerWeek: expectedWeekly,
      failureCompoundCount: perf.failureCompoundCount,
      loadOverCount: perf.overCount,
      loadUnderCount: perf.underCount,
    },
  };
}
