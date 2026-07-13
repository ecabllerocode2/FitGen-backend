/**
 * Audit main-block exercise selection + prescription (week 1).
 *
 * Usage:
 *   node scripts/dev/audit-main-block.mjs           # block 1
 *   node scripts/dev/audit-main-block.mjs --block=2
 *   node scripts/dev/audit-main-block.mjs --all
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { generateMesocycle, assignSessionsToSchedule } from '../../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { getWeekPlan } from '../../domain/periodization/microcycle.js';
import { buildSafetyProfile } from '../../domain/athlete/safetyProfile.js';
import { resolvePatternsForSafety } from '../../domain/exerciseSelection/selector.js';
import { computeWeeklyVolumePlan } from '../../domain/periodization/weekVolumePlanner.js';
import {
  SPLIT_SESSIONS,
  REP_RANGES,
  RIR_PROGRESSION,
  countMuscleSessionsPerWeek,
  DAY_ORDER,
} from '../../domain/constants.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, '../colecciones/curated/entrenamiento.json');
const catalogItems = JSON.parse(readFileSync(catalogPath, 'utf8')).items;
const catalogById = Object.fromEntries(catalogItems.map((ex) => [ex.id, ex]));

/** @typedef {'error'|'warn'|'info'} Severity */

/**
 * Bloques de auditoría — semana 1 únicamente.
 * Cada bloque agrupa escenarios por split + objetivo + perfil representativo.
 */
export const AUDIT_BLOCKS = {
  1: {
    id: 1,
    name: 'Full Body · Hipertrofia · Semana 1',
    splitType: 'Full_Body',
    goal: 'Hipertrofia',
    weekNumber: 1,
    profiles: [
      {
        label: 'Intermedio 3d · 75 kg',
        trainingDaysPerWeek: 3,
        trainingAgeMonths: 12,
        currentWeightKg: 75,
        injuriesOrLimitations: [],
      },
      {
        label: 'Principiante 3d · sin peso corporal',
        trainingDaysPerWeek: 3,
        trainingAgeMonths: 3,
        currentWeightKg: undefined,
        injuriesOrLimitations: [],
      },
    ],
  },
  2: {
    id: 2,
    name: 'Torso/Pierna · Hipertrofia · Semana 1',
    splitType: 'Torso_Pierna',
    goal: 'Hipertrofia',
    weekNumber: 1,
    profiles: [{ label: 'Intermedio 4d', trainingDaysPerWeek: 4, trainingAgeMonths: 12, currentWeightKg: 80, injuriesOrLimitations: [] }],
  },
  3: {
    id: 3,
    name: 'Torso/Pierna ondulado · Hipertrofia · Semana 1',
    splitType: 'Torso_Pierna_ondulado',
    goal: 'Hipertrofia',
    weekNumber: 1,
    profiles: [{ label: 'Intermedio 3d', trainingDaysPerWeek: 3, trainingAgeMonths: 12, currentWeightKg: 78, injuriesOrLimitations: [] }],
  },
  4: {
    id: 4,
    name: 'Push/Pull/Legs · Hipertrofia · Semana 1',
    splitType: 'Push_Pull_Legs',
    goal: 'Hipertrofia',
    weekNumber: 1,
    profiles: [{ label: 'Avanzado 6d', trainingDaysPerWeek: 6, trainingAgeMonths: 36, currentWeightKg: 82, injuriesOrLimitations: [] }],
  },
  5: {
    id: 5,
    name: 'PHUL híbrido · Semana 1',
    splitType: 'Hibrido_PHUL',
    goal: 'Hipertrofia',
    weekNumber: 1,
    profiles: [{ label: 'Intermedio 5d', trainingDaysPerWeek: 5, trainingAgeMonths: 18, currentWeightKg: 77, injuriesOrLimitations: [] }],
  },
  6: {
    id: 6,
    name: 'Full Body · Fuerza · Semana 1',
    splitType: 'Full_Body',
    goal: 'Fuerza',
    weekNumber: 1,
    profiles: [{ label: 'Intermedio 3d fuerza', trainingDaysPerWeek: 3, trainingAgeMonths: 12, currentWeightKg: 75, injuriesOrLimitations: [] }],
  },
  7: {
    id: 7,
    name: 'Perfiles con limitaciones · Semana 1',
    splitType: 'Torso_Pierna',
    goal: 'Hipertrofia',
    weekNumber: 1,
    profiles: [
      { label: 'Hombro sensible', trainingDaysPerWeek: 4, trainingAgeMonths: 12, currentWeightKg: 70, injuriesOrLimitations: ['Hombro'] },
      { label: 'Rodilla sensible', trainingDaysPerWeek: 4, trainingAgeMonths: 12, currentWeightKg: 70, injuriesOrLimitations: ['Rodilla'] },
    ],
  },
};

const SCHEDULE_3D = [
  { day: 'Lunes', canTrain: true },
  { day: 'Martes', canTrain: false },
  { day: 'Miércoles', canTrain: true },
  { day: 'Jueves', canTrain: false },
  { day: 'Viernes', canTrain: true },
  { day: 'Sábado', canTrain: false },
  { day: 'Domingo', canTrain: false },
];

function buildSchedule(trainingDays) {
  const indices = {
    1: [0],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
  }[trainingDays] ?? [0, 2, 4];
  return DAY_ORDER.map((day, index) => ({
    day,
    canTrain: indices.includes(index),
  }));
}

function referenceDateForDay(dayName) {
  const monday = new Date('2026-07-06T12:00:00Z');
  const offset = DAY_ORDER.indexOf(dayName);
  const date = new Date(monday);
  date.setUTCDate(monday.getUTCDate() + Math.max(0, offset));
  return date.toISOString();
}

const QUALITY_FLAGS = [
  {
    code: 'selection.questionable_vertical_pull',
    test: (ex) =>
      ex.movementPattern === 'Traccion_V'
      && /encogimiento|shrug|clean/i.test(ex.exerciseName),
    severity: 'warn',
    message: 'Ejercicio poco típico para tracción vertical',
  },
  {
    code: 'selection.questionable_chest_accessory',
    test: (ex) =>
      ex.muscleGroup === 'Pecho'
      && /reloj|clock/i.test(ex.exerciseName),
    severity: 'warn',
    message: 'Accesorio de pecho poco convencional',
  },
  {
    code: 'selection.hip_hinge_mislabeled',
    test: (ex) =>
      ex.muscleGroup === 'Isquiotibiales'
      && ex.movementPattern === 'Cadera'
      && /buenos d[ií]as/i.test(ex.exerciseName),
    severity: 'info',
    message: 'Buenos días como bisagra de cadera (revisar si es intencional)',
  },
];

function buildProfile(scenario, goal, splitType) {
  return {
    fitnessGoal: goal,
    trainingDaysPerWeek: scenario.trainingDaysPerWeek,
    trainingAgeMonths: scenario.trainingAgeMonths,
    currentWeightKg: scenario.currentWeightKg,
    injuriesOrLimitations: scenario.injuriesOrLimitations ?? [],
    weeklyScheduleContext: buildSchedule(scenario.trainingDaysPerWeek ?? 3),
    forcedSplitType: splitType,
  };
}

function expectedRir(goal, weekNumber, isAccessory) {
  if (goal === 'Fuerza') {
    const cfg = isAccessory ? RIR_PROGRESSION.Fuerza.accessory : RIR_PROGRESSION.Fuerza.main;
    return weekNumber === 1 ? cfg.week1 : cfg.accumulationEnd;
  }
  return weekNumber === 1 ? RIR_PROGRESSION.Hipertrofia.week1 : RIR_PROGRESSION.Hipertrofia.accumulationEnd;
}

function expectedRepRange(goal, priority, movementPattern) {
  const ranges = REP_RANGES[goal] ?? REP_RANGES.Hipertrofia;
  if (movementPattern === 'Core') return ranges.core ?? ranges.isolation;
  if (priority === 1) return ranges.compound;
  return ranges.isolation;
}

function auditSession(session, ctx) {
  const issues = [];
  const { template, goal, weekNumber, profile, weekPlan, splitType, safetyProfile } = ctx;
  const main = session.mainBlock ?? [];
  const requiredPatterns = resolvePatternsForSafety(template.patterns ?? [], safetyProfile);
  const sessionMuscles = template.muscles ?? [];
  const repRanges = REP_RANGES[goal] ?? REP_RANGES.Hipertrofia;

  // --- Selección ---
  for (const pattern of requiredPatterns) {
    const count = main.filter((e) => e.movementPattern === pattern).length;
    if (count === 0) {
      issues.push({
        severity: 'error',
        code: 'selection.pattern_missing',
        message: `Patrón requerido sin ejercicios: ${pattern}`,
      });
    }
    if (count > 2) {
      issues.push({
        severity: 'error',
        code: 'selection.too_many_per_pattern',
        message: `Patrón ${pattern} tiene ${count} ejercicios (máx 2)`,
      });
    }
  }

  for (const muscle of sessionMuscles) {
    if (!muscle) continue;
    const covered = main.some((e) => e.muscleGroup === muscle);
    if (!covered) {
      issues.push({
        severity: 'error',
        code: 'selection.muscle_missing',
        message: `Músculo planificado sin ejercicio directo: ${muscle}`,
      });
    }
  }

  const ids = main.map((e) => e.exerciseId);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length) {
    issues.push({
      severity: 'error',
      code: 'selection.duplicate_exercise',
      message: `Ejercicio repetido en la misma sesión: ${[...new Set(dupIds)].join(', ')}`,
    });
  }

  if (main.length === 0) {
    issues.push({ severity: 'error', code: 'selection.empty_block', message: 'Bloque principal vacío' });
  }

  for (const ex of main) {
    for (const flag of QUALITY_FLAGS) {
      if (flag.test(ex)) {
        issues.push({
          severity: flag.severity,
          code: flag.code,
          message: `${flag.message}: ${ex.exerciseName}`,
        });
      }
    }

    const cat = catalogById[ex.exerciseId];
    if (cat && cat.categoriaBloque !== 'main_block' && cat.categoriaBloque !== 'core') {
      issues.push({
        severity: 'warn',
        code: 'selection.non_main_catalog',
        message: `Ejercicio fuera de main_block: ${ex.exerciseName}`,
      });
    }
  }

  // --- Series / reps / prescripción ---
  for (const ex of main) {
    const priority = ex.priority ?? 2;
    const isCompound = priority === 1;
    const expReps = ex.repRangeOverride ?? expectedRepRange(goal, priority, ex.movementPattern);
    const expRir = expectedRir(goal, weekNumber, !isCompound && goal === 'Fuerza');

    if (!ex.sets || ex.sets < 1) {
      issues.push({
        severity: 'error',
        code: 'volume.sets_invalid',
        message: `${ex.exerciseName}: series inválidas (${ex.sets})`,
      });
    }

    if (ex.sets > 6) {
      issues.push({
        severity: 'warn',
        code: 'volume.sets_very_high',
        message: `${ex.exerciseName}: ${ex.sets} series en un solo ejercicio (posible concentración de volumen)`,
      });
    } else if (!isCompound && ex.sets > 4) {
      issues.push({
        severity: 'warn',
        code: 'volume.isolation_high_sets',
        message: `${ex.exerciseName}: ${ex.sets} series para aislamiento/accesorio`,
      });
    }

    if (ex.repRange !== expReps && !ex.repRangeOverride) {
      issues.push({
        severity: 'warn',
        code: 'prescription.rep_range_mismatch',
        message: `${ex.exerciseName}: repRange ${ex.repRange} (esperado ${expReps})`,
      });
    }

    if (Math.abs((ex.rirTarget ?? 0) - expRir) > 0.15) {
      issues.push({
        severity: 'warn',
        code: 'prescription.rir_mismatch',
        message: `${ex.exerciseName}: RIR ${ex.rirTarget} (esperado ${expRir} en S${weekNumber})`,
      });
    }

    if (weekNumber === 1) {
      if (ex.loadMode !== 'exploratory') {
        issues.push({
          severity: 'error',
          code: 'prescription.week1_not_exploratory',
          message: `${ex.exerciseName}: loadMode=${ex.loadMode} (esperado exploratory)`,
        });
      }
      if (ex.prescribedLoadKg != null) {
        issues.push({
          severity: 'error',
          code: 'prescription.week1_prescribed_load',
          message: `${ex.exerciseName}: prescribedLoadKg debería ser null en S1`,
        });
      }
    }

    if (profile.currentWeightKg && ex.movementPattern !== 'Core') {
      if (ex.suggestedLoadKg == null) {
        issues.push({
          severity: 'info',
          code: 'prescription.no_suggested_load',
          message: `${ex.exerciseName}: sin suggestedLoadKg pese a tener peso corporal`,
        });
      } else if (ex.suggestedLoadKg % 2.5 !== 0) {
        issues.push({
          severity: 'warn',
          code: 'prescription.load_rounding',
          message: `${ex.exerciseName}: suggestedLoadKg ${ex.suggestedLoadKg} no múltiplo de 2.5`,
        });
      }
    }

    if (!ex.restSeconds || ex.restSeconds < 60) {
      issues.push({
        severity: 'warn',
        code: 'prescription.rest_low',
        message: `${ex.exerciseName}: descanso ${ex.restSeconds}s`,
      });
    }

    if (!ex.tempo) {
      issues.push({
        severity: 'info',
        code: 'prescription.tempo_missing',
        message: `${ex.exerciseName}: sin tempo`,
      });
    }
  }

  // Core rep range when catalog marks isolation-like
  for (const ex of main.filter((e) => e.movementPattern === 'Core')) {
    const cat = catalogById[ex.exerciseId];
    const p = cat?.prioridad ?? ex.priority ?? 2;
    if (p !== 1 && ex.repRange === repRanges.compound) {
      issues.push({
        severity: 'info',
        code: 'prescription.core_uses_compound_reps',
        message: `${ex.exerciseName}: core con repRange de compuesto (${ex.repRange})`,
      });
    }
  }

  return { session, issues, main };
}

function auditWeeklyVolume(sessions, ctx) {
  const issues = [];
  const { weekPlan, splitType } = ctx;
  const targets = weekPlan?.volumeByMuscle ?? {};
  const freq = countMuscleSessionsPerWeek(splitType);
  const totals = {};

  for (const { main } of sessions) {
    for (const ex of main) {
      totals[ex.muscleGroup] = (totals[ex.muscleGroup] ?? 0) + ex.sets;
    }
  }

  for (const [muscle, target] of Object.entries(targets)) {
    const actual = totals[muscle] ?? 0;
    if (target > 0 && actual === 0) {
      issues.push({
        severity: 'error',
        code: 'volume.muscle_zero_week',
        message: `${muscle}: 0 series en la semana (objetivo ${target})`,
      });
    } else if (target > 0 && actual < target * 0.75) {
      issues.push({
        severity: 'warn',
        code: 'volume.weekly_under',
        message: `${muscle}: ${actual}/${target} series semanales (<75% del objetivo)`,
      });
    } else if (target > 0 && actual > target * 1.25) {
      issues.push({
        severity: 'warn',
        code: 'volume.weekly_over',
        message: `${muscle}: ${actual}/${target} series semanales (>125% del objetivo)`,
      });
    }
  }

  for (const muscle of Object.keys(totals)) {
    if (!(muscle in targets) && totals[muscle] > 0) {
      issues.push({
        severity: 'warn',
        code: 'volume.muscle_no_landmark',
        message: `${muscle}: ${totals[muscle]} series pero sin volumeTarget en mesociclo`,
      });
    }
  }

  return { totals, targets, freq, issues };
}

function formatExerciseLine(ex) {
  const load =
    ex.loadMode === 'exploratory'
      ? `exploratorio${ex.suggestedLoadKg != null ? ` ~${ex.suggestedLoadKg}kg` : ''}`
      : `${ex.prescribedLoadKg ?? '?'}kg`;
  return `  • ${ex.exerciseName} [${ex.muscleGroup}/${ex.movementPattern}] ${ex.sets}×${ex.repRange} RIR${ex.rirTarget} · ${load}`;
}

function runBlock(block) {
  const splitSessions = SPLIT_SESSIONS[block.splitType] ?? [];
  const allIssues = [];
  const profileResults = [];

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`BLOQUE ${block.id}: ${block.name}`);
  console.log(`Split: ${block.splitType} | Semana: ${block.weekNumber}`);
  console.log(`${'═'.repeat(72)}`);

  for (const scenario of block.profiles) {
    const profile = buildProfile(scenario, block.goal, block.splitType);
    const mesocycle = generateMesocycle(profile, '2026-07-07');
    mesocycle.goal = block.goal;
    const safetyProfile = buildSafetyProfile(profile);

    const weekPlan = getWeekPlan(mesocycle, block.weekNumber);
    const sessionResults = [];

    const schedule = assignSessionsToSchedule(
      profile.weeklyScheduleContext,
      splitSessions,
      profile.trainingDaysPerWeek,
      { weekNumber: block.weekNumber },
    );
    const trainingSlots = schedule.filter((s) => !s.isRestDay);

    const weeklyVolumePlan = computeWeeklyVolumePlan({
      splitType: block.splitType,
      trainingDays: profile.trainingDaysPerWeek,
      weeklyScheduleContext: profile.weeklyScheduleContext,
      catalog: catalogItems,
      safetyProfile,
      goal: block.goal,
      weekNumber: block.weekNumber,
      scheduleWeekNumber: block.weekNumber,
    });

    const sessionHistory = [];

    console.log(`\n── Perfil: ${scenario.label} ──`);
    console.log(`RIR objetivo S1: ${weekPlan?.rirObjetivo} | Volumen:`, weekPlan?.volumeByMuscle);
    console.log(`Sesiones en semana: ${trainingSlots.map((s) => s.sessionFocus).join(' → ')}`);

    for (const slot of trainingSlots) {
      const template = {
        sessionFocus: slot.sessionFocus,
        muscles: slot.muscles,
        patterns: slot.patterns,
      };
      const session = generateSession({
        profile,
        mesocycle,
        weekNumber: block.weekNumber,
        sessionFocus: slot.sessionFocus,
        sessionMuscles: slot.muscles,
        patterns: slot.patterns,
        readiness: { energyLevel: 3, sorenessLevel: 2, sleepQuality: 3, stressLevel: 2 },
        catalog: { entrenamiento: catalogItems, calentamiento: [], enfriamiento: [] },
        history: sessionHistory,
        weeklyVolumePlan,
        referenceDate: referenceDateForDay(slot.dayOfWeek),
      });
      sessionHistory.push(session);

      const ctx = { template, goal: block.goal, weekNumber: block.weekNumber, profile, weekPlan, splitType: block.splitType, safetyProfile };
      const audited = auditSession(session, ctx);
      sessionResults.push(audited);

      console.log(`\n[${slot.dayOfWeek} · ${slot.sessionFocus}] ${audited.main.length} ejercicios`);
      audited.main.forEach((ex) => console.log(formatExerciseLine(ex)));

      if (audited.issues.length) {
        console.log('  Hallazgos:');
        for (const issue of audited.issues) {
          const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warn' ? '⚠' : '·';
          console.log(`    ${icon} [${issue.code}] ${issue.message}`);
          allIssues.push({ ...issue, profile: scenario.label, session: `${slot.dayOfWeek} · ${slot.sessionFocus}` });
        }
      } else {
        console.log('  ✓ Sin hallazgos en esta sesión');
      }
    }

    const weekly = auditWeeklyVolume(sessionResults, { weekPlan, splitType: block.splitType });
    console.log(`\n── Volumen semanal agregado (${scenario.label}) ──`);
    for (const [muscle, sets] of Object.entries(weekly.totals).sort((a, b) => b[1] - a[1])) {
      const target = weekly.targets[muscle];
      const f = weekly.freq[muscle] ?? '?';
      console.log(`  ${muscle}: ${sets} series (obj ${target ?? '—'}, ${f} ses/sem)`);
    }
    if (weekly.issues.length) {
      console.log('  Hallazgos volumen:');
      for (const issue of weekly.issues) {
        const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warn' ? '⚠' : '·';
        console.log(`    ${icon} [${issue.code}] ${issue.message}`);
        allIssues.push({ ...issue, profile: scenario.label, session: '(semana)' });
      }
    }

    profileResults.push({ scenario: scenario.label, sessionResults, weekly });
  }

  const errors = allIssues.filter((i) => i.severity === 'error').length;
  const warns = allIssues.filter((i) => i.severity === 'warn').length;
  const infos = allIssues.filter((i) => i.severity === 'info').length;

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`Resumen bloque ${block.id}: ${errors} errores, ${warns} advertencias, ${infos} info`);
  console.log(`${'─'.repeat(72)}`);

  return { block, allIssues, profileResults, summary: { errors, warns, infos } };
}

function parseArgs() {
  const all = process.argv.includes('--all');
  const blockArg = process.argv.find((a) => a.startsWith('--block='));
  const blockId = blockArg ? Number(blockArg.split('=')[1]) : 1;
  return { all, blockId };
}

const { all, blockId } = parseArgs();
const blocksToRun = all ? Object.values(AUDIT_BLOCKS) : [AUDIT_BLOCKS[blockId]].filter(Boolean);

if (!blocksToRun.length) {
  console.error(`Bloque ${blockId} no definido. Bloques: ${Object.keys(AUDIT_BLOCKS).join(', ')}`);
  process.exit(1);
}

let totalErrors = 0;
let totalWarns = 0;

for (const block of blocksToRun) {
  const result = runBlock(block);
  totalErrors += result.summary.errors;
  totalWarns += result.summary.warns;
}

if (blocksToRun.length > 1) {
  console.log(`\nTOTAL: ${totalErrors} errores, ${totalWarns} advertencias en ${blocksToRun.length} bloques`);
}

process.exit(totalErrors > 0 ? 1 : 0);
