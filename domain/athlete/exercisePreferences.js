/**
 * User-level exercise exclusions (equipment unavailable vs session-only swaps).
 */

export function emptyExercisePreferences() {
  return { excluded: [], unavailableEquipment: [] };
}

export function normalizeExercisePreferences(raw) {
  if (!raw || typeof raw !== 'object') return emptyExercisePreferences();
  return {
    excluded: Array.isArray(raw.excluded) ? raw.excluded : [],
    unavailableEquipment: Array.isArray(raw.unavailableEquipment) ? raw.unavailableEquipment : [],
  };
}

export function getUserExercisePreferences(user) {
  return normalizeExercisePreferences(user?.exercisePreferences ?? user?.profileData?.exercisePreferences);
}

export function resolveExclusionFilters(preferences) {
  const prefs = normalizeExercisePreferences(preferences);
  const excludeIds = [
    ...new Set(
      prefs.excluded
        .filter((row) => row.scope !== 'warmup_only')
        .map((row) => row.exerciseId)
        .filter(Boolean),
    ),
  ];
  const warmupExcludeIds = [
    ...new Set(prefs.excluded.map((row) => row.exerciseId).filter(Boolean)),
  ];
  return {
    excludeIds,
    warmupExcludeIds,
    unavailableEquipment: [...new Set(prefs.unavailableEquipment.filter(Boolean))],
  };
}

export function exerciseEquipmentList(ex) {
  if (!ex) return [];
  if (Array.isArray(ex.equipo)) return ex.equipo.filter(Boolean);
  if (typeof ex.equipo === 'string' && ex.equipo.trim()) return [ex.equipo];
  return [];
}

export function isExerciseBlocked(ex, filters = {}) {
  const { excludeIds = [], unavailableEquipment = [] } = filters;
  const id = ex?.id ?? ex?.exerciseId;
  if (id && excludeIds.includes(id)) return true;
  if (!unavailableEquipment.length) return false;
  const equipo = exerciseEquipmentList(ex);
  return unavailableEquipment.some((tag) => equipo.includes(tag));
}

/**
 * @param {object} preferences
 * @param {object} entry
 * @param {boolean} [excludeEquipmentTags]
 */
export function addExerciseExclusion(preferences, entry, excludeEquipmentTags = false) {
  const prefs = normalizeExercisePreferences(preferences);
  const next = { ...prefs, excluded: [...prefs.excluded] };
  const equipmentTags = entry.equipmentTags ?? [];

  next.excluded = next.excluded.filter((row) => row.exerciseId !== entry.exerciseId);
  next.excluded.push({
    exerciseId: entry.exerciseId,
    nombre: entry.nombre ?? entry.exerciseId,
    reason: entry.reason ?? 'unavailable',
    scope: entry.scope ?? 'all',
    excludedAt: new Date().toISOString(),
    equipmentTags,
  });

  if (excludeEquipmentTags && equipmentTags.length) {
    next.unavailableEquipment = [
      ...new Set([...next.unavailableEquipment, ...equipmentTags]),
    ];
  }

  return next;
}

export function restoreExerciseExclusion(preferences, { exerciseId, equipment } = {}) {
  const prefs = normalizeExercisePreferences(preferences);
  let excluded = [...prefs.excluded];
  let unavailableEquipment = [...prefs.unavailableEquipment];

  if (exerciseId) {
    const removed = excluded.filter((row) => row.exerciseId === exerciseId);
    excluded = excluded.filter((row) => row.exerciseId !== exerciseId);
    for (const row of removed) {
      for (const tag of row.equipmentTags ?? []) {
        const stillUsed = excluded.some((r) => (r.equipmentTags ?? []).includes(tag));
        if (!stillUsed && unavailableEquipment.includes(tag)) {
          unavailableEquipment = unavailableEquipment.filter((t) => t !== tag);
        }
      }
    }
  }

  if (equipment) {
    unavailableEquipment = unavailableEquipment.filter((t) => t !== equipment);
    excluded = excluded.filter((row) => !(row.equipmentTags ?? []).includes(equipment));
  }

  return { excluded, unavailableEquipment };
}
