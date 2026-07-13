/** DDS invariant checker for simulated training history */

import { getWeekPlan } from '../../domain/periodization/microcycle.js';
import {
  validateMuscleStimulusCoverage,
  MUSCLE_STIMULUS_CONFIG,
} from '../../domain/exerciseSelection/stimulusCoverage.js';

export function validateInvariants({ history, mesocycles, persona }) {
  const violations = [];

  for (const mesocycle of mesocycles) {
  // Last week must be deload
    const lastWeek = mesocycle.microcycles?.[mesocycle.microcycles.length - 1];
    if (lastWeek && lastWeek.phase !== 'deload') {
      violations.push(`Mesociclo ${mesocycle.mesocycleId}: última semana no es deload`);
    }

    // RIR should not increase within accumulation block (except deload)
    const accum = mesocycle.microcycles?.filter((m) => m.phase !== 'deload') ?? [];
    for (let i = 1; i < accum.length; i += 1) {
      if (accum[i].rirObjetivo > accum[i - 1].rirObjetivo + 0.1) {
        violations.push(`RIR subió entre semana ${accum[i - 1].week} y ${accum[i].week}`);
      }
    }

    // Volume targets should not exceed MRV
    for (const micro of mesocycle.microcycles ?? []) {
      for (const [muscle, vol] of Object.entries(micro.volumeTargets ?? {})) {
        const mrv = mesocycle.volumeLandmarks?.[muscle]?.MRV;
        if (mrv && vol > mrv + 1) {
          violations.push(`Volumen ${vol} excede MRV ${mrv} para ${muscle} semana ${micro.week}`);
        }
      }
    }

    // Deload week volume plan should be ~50% of last accumulation week (getWeekPlan)
    const accumWeeks = mesocycle.microcycles?.filter((m) => m.phase !== 'deload') ?? [];
    const deloadWeek = mesocycle.microcycles?.find((m) => m.phase === 'deload');
    const lastAccum = accumWeeks[accumWeeks.length - 1];
    if (deloadWeek && lastAccum) {
      const lastPlan = getWeekPlan(mesocycle, lastAccum.week);
      const deloadPlan = getWeekPlan(mesocycle, deloadWeek.week);
      for (const muscle of Object.keys(lastPlan?.volumeByMuscle ?? {})) {
        const lastVol = lastPlan.volumeByMuscle[muscle];
        const deloadVol = deloadPlan.volumeByMuscle[muscle];
        const expected = Math.round(lastVol * 0.5);
        if (Math.abs(deloadVol - expected) > 1) {
          violations.push(
            `Deload volumen ${deloadVol} != ~50% de ${lastVol} para ${muscle} (esperado ${expected})`,
          );
        }
      }
    }
  }

  // Persona with shoulder pain should never get avoided patterns
  if (persona.id === 'shoulder_pain') {
    for (const session of history) {
      for (const ex of session.mainBlock ?? []) {
        if (ex.movementPattern === 'Empuje_V') {
          violations.push(`Ejercicio ${ex.exerciseId} con patrón Empuje_V para persona con dolor de hombro`);
        }
      }
    }
  }

  // Readiness never increased volume above plan (multiplier <= 1)
  for (const session of history) {
    const mult = session.readinessAdjustment?.volumeMultiplierApplied;
    if (mult != null && mult > 1.0) {
      violations.push(`Readiness aumentó volumen (${mult}) en sesión ${session.sessionId}`);
    }
  }

  // Intra-mesocycle: same sessionFocus reuses main exercise IDs from week 1 anchor
  for (const mesocycle of mesocycles) {
    const mcSessions = history.filter((s) => s.mesocycleId === mesocycle.mesocycleId);
    const focuses = [...new Set(mcSessions.map((s) => s.sessionFocus))];

    for (const focus of focuses) {
      const anchor = mcSessions.find((s) => s.sessionFocus === focus && s.weekNumber === 1);
      if (!anchor?.mainBlock?.length) continue;

      const anchorIds = anchor.mainBlock
        .filter((e) => (e.priority ?? 2) === 1)
        .map((e) => e.exerciseId);
      for (const session of mcSessions.filter((s) => s.sessionFocus === focus && s.weekNumber > 1)) {
        const weekIds = new Set((session.mainBlock ?? []).map((e) => e.exerciseId));
        const missing = anchorIds.filter((id) => !weekIds.has(id));
        if (missing.length) {
          violations.push(
            `Continuidad rota: ${focus} semana ${session.weekNumber} perdió ejercicios ancla`,
          );
        }
      }
    }
  }

  // Inter-mesocycle: first week of a new mesocycle should rotate at least one exercise per focus
  if (mesocycles.length >= 2) {
    for (let i = 1; i < mesocycles.length; i += 1) {
      const prevMc = mesocycles[i - 1];
      const nextMc = mesocycles[i];
      const prevWeek1 = history.filter(
        (s) => s.mesocycleId === prevMc.mesocycleId && s.weekNumber === 1,
      );
      const nextWeek1 = history.filter(
        (s) => s.mesocycleId === nextMc.mesocycleId && s.weekNumber === 1,
      );

      for (const nextSession of nextWeek1) {
        const prevSession = prevWeek1.find((s) => s.sessionFocus === nextSession.sessionFocus);
        if (!prevSession?.mainBlock?.length || !nextSession.mainBlock?.length) continue;

        const prevIds = new Set(prevSession.mainBlock.map((e) => e.exerciseId));
        const nextIds = nextSession.mainBlock.map((e) => e.exerciseId);
        const newCount = nextIds.filter((id) => !prevIds.has(id)).length;
        if (newCount === 0 && nextIds.length > 0) {
          violations.push(
            `Sin rotación inter-mesociclo: ${nextSession.sessionFocus} repite todos los ejercicios`,
          );
        }
      }
    }
  }

  // Stimulus diversity: muscles with 2+ main-block exercises need distinct subtypes
  for (const session of history) {
    for (const muscle of Object.keys(MUSCLE_STIMULUS_CONFIG)) {
      const muscleCount = (session.mainBlock ?? []).filter((e) => e.muscleGroup === muscle).length;
      if (muscleCount < 2) continue;
      const check = validateMuscleStimulusCoverage(
        (session.mainBlock ?? []).map((e) => ({
          parteCuerpo: e.muscleGroup,
          nombre: e.exerciseName,
          patronMovimiento: e.movementPattern,
        })),
        muscle,
      );
      if (!check.ok) {
        violations.push(`${session.sessionId}: ${check.message}`);
      }
    }
  }

  return violations;
}
