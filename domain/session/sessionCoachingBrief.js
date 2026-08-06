const FOCUS_AREA_MUSCLES = {
  Tren_Superior: ['Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps'],
  Tren_Inferior: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'],
  Core: ['Core'],
};

const FOCUS_LABELS = {
  Tren_Superior: 'Tren superior',
  Tren_Inferior: 'Tren inferior',
  Core: 'Core',
};

const BODY_GOAL_COPY = {
  Mantener: {
    title: 'Mantener composición',
    message: 'Volumen y RIR estándar para sostener músculo y rendimiento.',
  },
  Perder_Grasa: {
    title: 'Pérdida de grasa',
    message:
      'Volumen semanal moderado y RIR más conservador para recuperarte en déficit. La fuerza preserva músculo; la dieta marca la báscula.',
  },
  Ganar_Musculo: {
    title: 'Ganancia muscular',
    message:
      'Progresión de volumen hacia tu rango efectivo (MEV→MRV). Priorizamos sobrecarga en los músculos que marcaste.',
  },
};

/**
 * Human-readable coaching lines shown in the app for this session.
 */
export function buildSessionCoachingBrief({
  profile = {},
  sessionMuscles = [],
  mainBlock = [],
  finisher = null,
  weekPlan = null,
}) {
  const items = [];
  const bodyCompositionGoal = profile.bodyCompositionGoal ?? 'Mantener';
  const bodyCopy = BODY_GOAL_COPY[bodyCompositionGoal] ?? BODY_GOAL_COPY.Mantener;
  const isDeload = Boolean(weekPlan?.isDeload) || weekPlan?.phase === 'deload';

  if (isDeload) {
    const rir =
      weekPlan?.rirObjetivo != null && !Number.isNaN(Number(weekPlan.rirObjetivo))
        ? Number(weekPlan.rirObjetivo)
        : 3;
    items.push({
      id: 'deload_week',
      type: 'strategy',
      title: 'Semana de descarga',
      message: `Usa el peso prescrito y el rango de reps. Para en RIR ~${rir}: el peso más bajo es a propósito. No cargues más ni busques el fallo — así te recuperas para el siguiente bloque.`,
    });
  }

  items.push({
    id: 'body_goal',
    type: 'body_composition',
    title: bodyCopy.title,
    message: bodyCopy.message,
  });

  if (weekPlan?.rirObjetivo != null && bodyCompositionGoal === 'Perder_Grasa') {
    items.push({
      id: 'rir_strategy',
      type: 'strategy',
      title: `RIR objetivo hoy: ${weekPlan.rirObjetivo}`,
      message: 'Más lejos del fallo que en hipertrofia pura — mejor tolerancia al déficit calórico.',
    });
  }

  const priorities = Array.isArray(profile.musclePriorities) ? profile.musclePriorities : [];
  for (const priority of priorities.slice(0, 2)) {
    const muscle = priority?.muscle;
    if (!muscle || !sessionMuscles.includes(muscle)) continue;

    const emphasized = (mainBlock ?? []).find(
      (ex) => ex.muscleGroup === muscle && ex.emphasisTag === 'priority',
    );
    if (!emphasized) continue;

    const intensity = priority.intensity ?? 'moderate';
    items.push({
      id: `priority_${muscle}`,
      type: 'muscle_priority',
      title: `Prioridad muscular: ${muscle}`,
      message: `+1 serie en ${emphasized.exerciseName ?? muscle} hoy (${intensity === 'strong' ? 'énfasis alto' : intensity === 'light' ? 'énfasis ligero' : 'énfasis moderado'} en tu plan semanal).`,
      muscle,
    });
  }

  if (!priorities.length && profile.focusArea && profile.focusArea !== 'General') {
    const focusMuscles = FOCUS_AREA_MUSCLES[profile.focusArea] ?? [];
    const overlap = sessionMuscles.filter((m) => focusMuscles.includes(m));
    if (overlap.length) {
      items.push({
        id: 'focus_area',
        type: 'focus_area',
        title: `Enfoque: ${FOCUS_LABELS[profile.focusArea] ?? profile.focusArea}`,
        message: `Esta sesión trabaja ${overlap.join(', ')} — parte de tu énfasis en ${FOCUS_LABELS[profile.focusArea]?.toLowerCase() ?? 'tu área'}.`,
      });
    }
  }

  if (finisher?.included) {
    items.push({
      id: 'finisher',
      type: 'finisher',
      title: 'Finisher cardio (opcional)',
      message: `${finisher.durationMinutes} min de ${finisher.exerciseName} · ${finisher.intensityLabel}. ${finisher.coachingTip}`,
    });
  }

  return {
    bodyCompositionGoal,
    items,
  };
}
