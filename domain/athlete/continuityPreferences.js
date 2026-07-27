/**
 * User-chosen continuity replacements (swap → use in future sessions of this mesocycle).
 */

export function normalizeContinuityOverrides(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

export function getSessionContinuityReplacements(overrides, mesocycleId, sessionFocus) {
  if (!mesocycleId || !sessionFocus) return {};
  return normalizeContinuityOverrides(overrides)[mesocycleId]?.[sessionFocus] ?? {};
}

export function applyContinuityReplacements(stubs, replacements) {
  if (!replacements || !Object.keys(replacements).length) return stubs;
  return stubs.map((stub) => {
    const rep = replacements[stub.id];
    if (!rep) return stub;

    const repPattern = rep.patronMovimiento ?? rep.movementPattern;
    const stubPattern = stub.patronMovimiento ?? stub.movementPattern;
    // Ignore corrupted continuity that crossed movement patterns (e.g. pull → press).
    if (repPattern && stubPattern && repPattern !== stubPattern) {
      return stub;
    }

    const exerciseId = rep.exerciseId ?? rep.id;
    return {
      ...stub,
      id: exerciseId,
      nombre: rep.nombre ?? rep.exerciseName ?? stub.nombre,
      patronMovimiento: repPattern ?? stub.patronMovimiento,
      parteCuerpo: rep.parteCuerpo ?? rep.muscleGroup ?? stub.parteCuerpo,
      prioridad: rep.prioridad ?? rep.priority ?? stub.prioridad ?? 2,
      equipo: rep.equipo ?? stub.equipo ?? [],
      swappedFromUser: stub.id,
    };
  });
}

export function setContinuityReplacement(
  overrides,
  mesocycleId,
  sessionFocus,
  oldExerciseId,
  replacement,
) {
  const next = { ...normalizeContinuityOverrides(overrides) };
  if (!next[mesocycleId]) next[mesocycleId] = {};
  if (!next[mesocycleId][sessionFocus]) next[mesocycleId][sessionFocus] = {};
  next[mesocycleId][sessionFocus][oldExerciseId] = {
    exerciseId: replacement.id,
    id: replacement.id,
    nombre: replacement.nombre,
    patronMovimiento: replacement.patronMovimiento,
    parteCuerpo: replacement.parteCuerpo,
    prioridad: replacement.prioridad ?? 2,
    equipo: replacement.equipo ?? [],
    replacedAt: new Date().toISOString(),
  };
  return next;
}
