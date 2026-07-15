/**
 * Assess whether a microcycle week was fully completed.
 */

function trainingSessionsInMicrocycle(microcycle) {
  if (!microcycle?.sessions?.length) return 0;
  return microcycle.sessions.filter(
    (s) => !s.isRestDay && s.sessionFocus !== 'Descanso',
  ).length;
}

function findMicrocycle(mesocycle, weekNumber) {
  const microcycles =
    mesocycle?.microcycles ?? mesocycle?.mesocyclePlan?.microcycles ?? [];
  return microcycles.find((m) => m.week === weekNumber) ?? null;
}

/**
 * @param {object} mesocycle
 * @param {number} weekNumber
 * @param {object[]} recentSessions
 * @param {object|null} completedSession — session being archived now (not yet in recentSessions)
 */
export function assessWeekCompletion(mesocycle, weekNumber, recentSessions = [], completedSession = null) {
  const micro = findMicrocycle(mesocycle, weekNumber);
  const planned = trainingSessionsInMicrocycle(micro);
  if (!planned) {
    return { planned: 0, done: 0, isPerfect: false };
  }

  const mesocycleId = mesocycle?.mesocycleId ?? null;
  const candidates = [...recentSessions];
  if (completedSession) candidates.push(completedSession);

  const seen = new Set();
  let done = 0;

  for (const session of candidates) {
    if (session.completed === false) continue;
    if (session.weekNumber !== weekNumber) continue;
    if (mesocycleId && session.mesocycleId && session.mesocycleId !== mesocycleId) continue;

    const dayKey = session.dayOfWeek ?? session.id ?? `${session.completedAt}`;
    if (seen.has(dayKey)) continue;
    seen.add(dayKey);
    done += 1;
  }

  return {
    planned,
    done,
    isPerfect: done >= planned,
  };
}
