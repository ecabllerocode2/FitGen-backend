/**
 * Achievement definitions — Phase 2 (extended tiers + mesocycles + level).
 */

/** @typedef {{ id: string, title: string, description: string, category: string, target?: number, milestone?: boolean, progress: (g: object, ctx?: object) => number, evaluate: (g: object, ctx?: object) => boolean }} AchievementDefinition */

export const ACHIEVEMENT_CATEGORY_ORDER = [
  'sessions',
  'consistency',
  'mesocycles',
  'streak',
  'level',
];

export const ACHIEVEMENT_CATEGORY_LABELS = {
  sessions: 'Sesiones',
  consistency: 'Consistencia',
  mesocycles: 'Mesociclos',
  streak: 'Rachas',
  level: 'Nivel',
};

/** @type {Set<string>} */
export const MILESTONE_ACHIEVEMENT_IDS = new Set([
  'sessions-100',
  'sessions-365',
  'sessions-500',
]);

function sessionTier(id, target, title, description, milestone = false) {
  return {
    id,
    title,
    description,
    category: 'sessions',
    target,
    milestone,
    progress: (g) => g.lifetimeSessionsCompleted,
    evaluate: (g) => g.lifetimeSessionsCompleted >= target,
  };
}

function weeksPerfectTier(id, target, title, description) {
  return {
    id,
    title,
    description,
    category: 'consistency',
    target,
    progress: (g) => g.lifetimeWeeksPerfect,
    evaluate: (g) => g.lifetimeWeeksPerfect >= target,
  };
}

function streakTier(id, target, title, description) {
  const streakValue = (g) => Math.max(g.longestStreakDays, g.currentStreakDays);
  return {
    id,
    title,
    description,
    category: 'streak',
    target,
    progress: streakValue,
    evaluate: (g) => streakValue(g) >= target,
  };
}

function mesocycleTier(id, target, title, description) {
  return {
    id,
    title,
    description,
    category: 'mesocycles',
    target,
    progress: (g) => g.lifetimeMesocyclesCompleted,
    evaluate: (g) => g.lifetimeMesocyclesCompleted >= target,
  };
}

function levelTier(id, levelName, title, description) {
  const levelsAtOrAbove = levelName === 'Intermedio'
    ? ['Intermedio', 'Avanzado']
    : ['Avanzado'];
  return {
    id,
    title,
    description,
    category: 'level',
    target: 1,
    progress: (_g, ctx = {}) => {
      const level = ctx.experienceLevel ?? ctx.newExperienceLevel;
      return levelsAtOrAbove.includes(level) ? 1 : 0;
    },
    evaluate: (_g, ctx = {}) => {
      const level = ctx.experienceLevel ?? ctx.newExperienceLevel;
      return levelsAtOrAbove.includes(level);
    },
  };
}

/** @type {AchievementDefinition[]} */
export const ACHIEVEMENT_DEFINITIONS = [
  sessionTier('first-session', 1, 'Primera sesión', 'Completaste tu primera sesión de entrenamiento'),
  sessionTier('dedication', 10, 'Dedicación', 'Completaste 10 sesiones de entrenamiento'),
  sessionTier('first-month', 14, 'Primer bloque', 'Completaste 14 sesiones de entrenamiento'),
  sessionTier('warrior', 25, 'Guerrero del fitness', 'Completaste 25 sesiones de entrenamiento'),
  sessionTier('legend', 50, 'Leyenda del gimnasio', 'Completaste 50 sesiones de entrenamiento'),
  sessionTier('sessions-75', 75, 'Constante', 'Completaste 75 sesiones de entrenamiento'),
  sessionTier('sessions-100', 100, 'Centenario', 'Completaste 100 sesiones de entrenamiento', true),
  sessionTier('sessions-150', 150, 'Imparable', 'Completaste 150 sesiones de entrenamiento'),
  sessionTier('sessions-200', 200, 'Veterano activo', 'Completaste 200 sesiones de entrenamiento'),
  sessionTier('sessions-365', 365, 'Un año de hierro', 'Completaste 365 sesiones de entrenamiento', true),
  sessionTier('sessions-500', 500, 'Medio milenio', 'Completaste 500 sesiones de entrenamiento', true),
  sessionTier('sessions-1000', 1000, 'Máquina de entrenar', 'Completaste 1000 sesiones de entrenamiento'),

  {
    id: 'first-week',
    title: 'Primera semana perfecta',
    description: 'Completaste todas las sesiones programadas en una semana',
    category: 'consistency',
    target: 1,
    progress: (g) => g.lifetimeWeeksPerfect,
    evaluate: (g) => g.lifetimeWeeksPerfect >= 1,
  },
  {
    id: 'consistency',
    title: 'Consistencia',
    description: 'Entrenaste en 10 días distintos',
    category: 'consistency',
    target: 10,
    progress: (g) => g.lifetimeActiveDays,
    evaluate: (g) => g.lifetimeActiveDays >= 10,
  },
  weeksPerfectTier('weeks-perfect-4', 4, 'Mes consistente', 'Completaste 4 semanas perfectas'),
  weeksPerfectTier('weeks-perfect-12', 12, 'Trimestre sólido', 'Completaste 12 semanas perfectas'),
  weeksPerfectTier('weeks-perfect-26', 26, 'Medio año perfecto', 'Completaste 26 semanas perfectas'),
  weeksPerfectTier('weeks-perfect-52', 52, 'Año impecable', 'Completaste 52 semanas perfectas'),

  mesocycleTier('mesocycle-1', 1, 'Primer mesociclo', 'Completaste tu primer mesociclo evaluado'),
  mesocycleTier('mesocycle-3', 3, 'Bloques encadenados', 'Completaste 3 mesociclos evaluados'),
  mesocycleTier('mesocycle-6', 6, 'Planificador', 'Completaste 6 mesociclos evaluados'),
  mesocycleTier('mesocycle-12', 12, 'Arquitecto del progreso', 'Completaste 12 mesociclos evaluados'),

  streakTier('streak-7', 7, 'Racha de 7 días', 'Mantuviste una racha de 7 días activos'),
  streakTier('streak-14', 14, 'Racha de 14 días', 'Mantuviste una racha de 14 días activos'),
  streakTier('streak-30', 30, 'Racha de 30 días', 'Mantuviste una racha de 30 días activos'),
  streakTier('streak-60', 60, 'Racha de 60 días', 'Mantuviste una racha de 60 días activos'),

  levelTier('level-intermediate', 'Intermedio', 'Nivel Intermedio', 'Alcanzaste el nivel Intermedio'),
  levelTier('level-advanced', 'Avanzado', 'Nivel Avanzado', 'Alcanzaste el nivel Avanzado'),
];

/**
 * @param {object} gamification
 * @param {object} [context]
 * @returns {{ id: string, title: string, description: string, category: string, milestone?: boolean, unlockedAt: string }[]}
 */
export function evaluateAchievements(gamification, context = {}) {
  const newlyUnlocked = [];
  const now = new Date().toISOString();

  for (const def of ACHIEVEMENT_DEFINITIONS) {
    if (gamification.achievementsUnlocked?.[def.id]) continue;
    if (def.evaluate(gamification, context)) {
      newlyUnlocked.push({
        id: def.id,
        title: def.title,
        description: def.description,
        category: def.category,
        milestone: def.milestone ?? false,
        unlockedAt: now,
      });
    }
  }

  return newlyUnlocked;
}

/**
 * @param {object} gamification
 * @param {{ id: string, unlockedAt: string }[]} newlyUnlocked
 */
export function mergeAchievementUnlocks(gamification, newlyUnlocked) {
  const achievementsUnlocked = { ...(gamification.achievementsUnlocked ?? {}) };
  for (const unlock of newlyUnlocked) {
    achievementsUnlocked[unlock.id] = { unlockedAt: unlock.unlockedAt };
  }
  return { ...gamification, achievementsUnlocked };
}

/**
 * @param {object} gamification
 * @param {object} [context]
 */
export function buildAchievementViews(gamification, context = {}) {
  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const persisted = gamification.achievementsUnlocked?.[def.id];
    const unlocked = Boolean(persisted) || def.evaluate(gamification, context);
    const rawProgress = def.progress(gamification, context);
    const target = def.target ?? 1;
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      category: def.category,
      milestone: def.milestone ?? false,
      unlocked,
      unlockedAt: persisted?.unlockedAt ?? null,
      progress: Math.min(rawProgress, target),
      target,
    };
  });
}

/**
 * @param {object} gamification
 * @param {object} [context]
 */
export function buildAchievementSections(gamification, context = {}) {
  const views = buildAchievementViews(gamification, context);
  return ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const achievements = views.filter((v) => v.category === category);
    if (!achievements.length) return null;
    return {
      category,
      label: ACHIEVEMENT_CATEGORY_LABELS[category] ?? category,
      achievements,
      nextLocked: achievements.find((v) => !v.unlocked) ?? null,
    };
  }).filter(Boolean);
}

/**
 * Next locked achievement by definition order.
 * @param {object} gamification
 * @param {object} [context]
 */
export function getNextLockedAchievement(gamification, context = {}) {
  const views = buildAchievementViews(gamification, context);
  return views.find((v) => !v.unlocked) ?? null;
}

export function isMilestoneAchievement(id) {
  return MILESTONE_ACHIEVEMENT_IDS.has(id);
}
