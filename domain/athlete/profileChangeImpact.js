import { selectSplit, normalizeTrainingDays } from '../periodization/splitSelector.js';
import { DAY_ORDER } from '../constants.js';

const METADATA_FIELDS = ['name', 'age', 'gender', 'heightCm', 'currentWeightKg', 'timezone'];

/**
 * Build a stable key for weekly schedule comparison (all 7 days).
 * @param {object[]} scheduleContext
 */
export function scheduleFingerprint(scheduleContext = []) {
  return DAY_ORDER.map((day) => {
    const entry = scheduleContext.find((s) => s.day === day);
    const canTrain = entry ? entry.canTrain !== false : false;
    return `${day}:${canTrain ? 1 : 0}`;
  }).join('|');
}

function injuriesFingerprint(injuries = []) {
  const list = Array.isArray(injuries) ? injuries : injuries ? [injuries] : [];
  return [...list].filter(Boolean).sort().join('|');
}

function effectiveTrainingDays(profile) {
  const fromSchedule = (profile.weeklyScheduleContext ?? []).filter((d) => d.canTrain !== false).length;
  return fromSchedule || normalizeTrainingDays(profile.trainingDaysPerWeek ?? 3);
}

/**
 * Classify profile edits for mesocycle adaptation (DDS §8.2–8.3, RP continuity).
 * @param {object|null} oldProfile
 * @param {object} newProfile
 * @param {object|null} [currentMesocycle]
 * @returns {{ tier: string, requiresSessionClear: boolean, message: string, details: object }}
 */
export function classifyProfileChanges(oldProfile, newProfile, currentMesocycle = null) {
  if (!oldProfile || !currentMesocycle) {
    return {
      tier: 'metadata_only',
      requiresSessionClear: false,
      message: 'Perfil guardado.',
      details: {},
    };
  }

  const details = {
    metadataChanged: false,
    scheduleChanged: false,
    safetyChanged: false,
    periodizationChanged: false,
    structuralChanged: false,
    oldSplit: currentMesocycle.splitType ?? currentMesocycle.mesocyclePlan?.splitType,
    newSplit: null,
    oldTrainingDays: effectiveTrainingDays(oldProfile),
    newTrainingDays: effectiveTrainingDays(newProfile),
  };

  for (const field of METADATA_FIELDS) {
    if (oldProfile[field] !== newProfile[field]) {
      details.metadataChanged = true;
      break;
    }
  }

  if (scheduleFingerprint(oldProfile.weeklyScheduleContext) !== scheduleFingerprint(newProfile.weeklyScheduleContext)) {
    details.scheduleChanged = true;
  }
  if (details.oldTrainingDays !== details.newTrainingDays) {
    details.scheduleChanged = true;
  }

  if (injuriesFingerprint(oldProfile.injuriesOrLimitations) !== injuriesFingerprint(newProfile.injuriesOrLimitations)) {
    details.safetyChanged = true;
  }
  if ((oldProfile.focusArea ?? 'General') !== (newProfile.focusArea ?? 'General')) {
    details.safetyChanged = true;
  }

  if (oldProfile.fitnessGoal !== newProfile.fitnessGoal) {
    details.periodizationChanged = true;
  }
  if (oldProfile.trainingAgeMonths !== newProfile.trainingAgeMonths) {
    details.periodizationChanged = true;
  }
  if (oldProfile.experienceLevel !== newProfile.experienceLevel) {
    details.periodizationChanged = true;
  }

  const oldSplit = selectSplit(
    details.oldTrainingDays,
    oldProfile.fitnessGoal ?? 'Hipertrofia',
    oldProfile.experienceLevel ?? 'Intermedio',
  );
  const newSplit = selectSplit(
    details.newTrainingDays,
    newProfile.fitnessGoal ?? 'Hipertrofia',
    newProfile.experienceLevel ?? 'Intermedio',
  );
  details.oldSplit = oldSplit;
  details.newSplit = newSplit;

  if (oldSplit !== newSplit) {
    details.structuralChanged = true;
  }

  const hasPlanImpact =
    details.scheduleChanged ||
    details.safetyChanged ||
    details.periodizationChanged ||
    details.structuralChanged;

  if (!hasPlanImpact) {
    return {
      tier: 'metadata_only',
      requiresSessionClear: false,
      message: 'Datos personales actualizados. Tu plan de entrenamiento no cambia.',
      details,
    };
  }

  if (details.structuralChanged) {
    return {
      tier: 'partial_regeneration',
      requiresSessionClear: true,
      message:
        `Tu disponibilidad u objetivo requiere un split distinto (${oldSplit} → ${newSplit}). ` +
        'Recalibramos las semanas restantes del mesociclo sin borrar tu historial ni las semanas ya completadas.',
      details,
    };
  }

  if (details.periodizationChanged && !details.scheduleChanged) {
    return {
      tier: 'periodization_deferred',
      requiresSessionClear: false,
      message:
        'Objetivo o nivel actualizados. Los ajustes de volumen e intensidad se aplicarán desde la próxima semana del mesociclo (continuidad de ejercicios DDS §8.4).',
      details,
    };
  }

  if (details.scheduleChanged) {
    return {
      tier: 'schedule_remap',
      requiresSessionClear: true,
      message:
        'Calendario actualizado. Reasignamos tus sesiones a los nuevos días manteniendo el mismo split, volumen y progresión de la semana.',
      details,
    };
  }

  if (details.safetyChanged) {
    return {
      tier: 'safety_update',
      requiresSessionClear: true,
      message:
        'Perfil de seguridad actualizado. Las próximas sesiones respetarán tus nuevas limitaciones; el volumen acumulado del mesociclo se mantiene.',
      details,
    };
  }

  return {
    tier: 'metadata_only',
    requiresSessionClear: false,
    message: 'Perfil guardado.',
    details,
  };
}
