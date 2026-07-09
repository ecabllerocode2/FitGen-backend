/** DDS invariant checker for simulated training history */

import { getWeekPlan } from '../../domain/periodization/microcycle.js';

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

  return violations;
}
