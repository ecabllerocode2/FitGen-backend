/**
 * Achievement definitions — Phase 1 tier (sessions, streak, consistency, week/month milestones).
 */

/** @typedef {{ id: string, title: string, description: string, category: string, target?: number, progress: (g: object) => number, evaluate: (g: object) => boolean }} AchievementDefinition */

/** @type {AchievementDefinition[]} */
export const ACHIEVEMENT_DEFINITIONS = [
  {
    id: 'first-session',
    title: 'Primera sesión',
    description: 'Completaste tu primera sesión de entrenamiento',
    category: 'sessions',
    target: 1,
    progress: (g) => g.lifetimeSessionsCompleted,
    evaluate: (g) => g.lifetimeSessionsCompleted >= 1,
  },
  {
    id: 'first-week',
    title: 'Primera semana',
    description: 'Completaste todas las sesiones programadas en una semana',
    category: 'consistency',
    target: 1,
    progress: (g) => g.lifetimeWeeksPerfect,
    evaluate: (g) => g.lifetimeWeeksPerfect >= 1,
  },
  {
    id: 'first-month',
    title: 'Primer mesociclo',
    description: 'Completaste al menos 14 sesiones en total',
    category: 'sessions',
    target: 14,
    progress: (g) => g.lifetimeSessionsCompleted,
    evaluate: (g) => g.lifetimeSessionsCompleted >= 14,
  },
  {
    id: 'streak-7',
    title: 'Racha de 7 días',
    description: 'Mantuviste una racha de 7 días activos',
    category: 'streak',
    target: 7,
    progress: (g) => Math.max(g.longestStreakDays, g.currentStreakDays),
    evaluate: (g) => Math.max(g.longestStreakDays, g.currentStreakDays) >= 7,
  },
  {
    id: 'dedication',
    title: 'Dedicación',
    description: 'Completaste 10 sesiones de entrenamiento',
    category: 'sessions',
    target: 10,
    progress: (g) => g.lifetimeSessionsCompleted,
    evaluate: (g) => g.lifetimeSessionsCompleted >= 10,
  },
  {
    id: 'warrior',
    title: 'Guerrero del fitness',
    description: 'Completaste 25 sesiones de entrenamiento',
    category: 'sessions',
    target: 25,
    progress: (g) => g.lifetimeSessionsCompleted,
    evaluate: (g) => g.lifetimeSessionsCompleted >= 25,
  },
  {
    id: 'legend',
    title: 'Leyenda del gimnasio',
    description: 'Completaste 50 sesiones de entrenamiento',
    category: 'sessions',
    target: 50,
    progress: (g) => g.lifetimeSessionsCompleted,
    evaluate: (g) => g.lifetimeSessionsCompleted >= 50,
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
];

/**
 * @param {object} gamification
 * @returns {{ id: string, title: string, description: string, category: string, unlockedAt: string }[]}
 */
export function evaluateAchievements(gamification) {
  const newlyUnlocked = [];
  const now = new Date().toISOString();

  for (const def of ACHIEVEMENT_DEFINITIONS) {
    if (gamification.achievementsUnlocked?.[def.id]) continue;
    if (def.evaluate(gamification)) {
      newlyUnlocked.push({
        id: def.id,
        title: def.title,
        description: def.description,
        category: def.category,
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
 * Build achievement list for API with progress.
 * @param {object} gamification
 */
export function buildAchievementViews(gamification) {
  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const persisted = gamification.achievementsUnlocked?.[def.id];
    const unlocked = Boolean(persisted) || def.evaluate(gamification);
    const rawProgress = def.progress(gamification);
    const target = def.target ?? 1;
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      category: def.category,
      unlocked,
      unlockedAt: persisted?.unlockedAt ?? null,
      progress: Math.min(rawProgress, target),
      target,
    };
  });
}

/**
 * Next locked achievement by definition order.
 * @param {object} gamification
 */
export function getNextLockedAchievement(gamification) {
  const views = buildAchievementViews(gamification);
  return views.find((v) => !v.unlocked) ?? null;
}
