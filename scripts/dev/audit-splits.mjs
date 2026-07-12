/**
 * Audit split selection + weekly scheduling across scenarios.
 * Usage: node scripts/dev/audit-splits.mjs
 */
import { selectSplit } from '../../domain/periodization/splitSelector.js';
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { countMuscleSessionsPerWeek, SPLIT_SESSIONS, DAY_ORDER } from '../../domain/constants.js';
import { calculateExperienceLevel } from '../../domain/athlete/experienceLevel.js';

const LEVELS = ['Novato', 'Intermedio', 'Avanzado'];
const GOALS = ['Hipertrofia', 'Fuerza'];
const TRAINING_MONTHS = { Novato: 3, Intermedio: 12, Avanzado: 36 };

function makeSchedule(trainDays) {
  const days = [...DAY_ORDER];
  return days.map((day, i) => ({ day, canTrain: i < trainDays }));
}

function makeScheduleExplicit(trainDayNames) {
  return DAY_ORDER.map((day) => ({
    day,
    canTrain: trainDayNames.includes(day),
  }));
}

function summarizeWeek(mesocycle) {
  const week = mesocycle.microcycles[0].sessions.filter((s) => !s.isRestDay);
  const freq = countMuscleSessionsPerWeek(mesocycle.splitType);
  return {
    splitType: mesocycle.splitType,
    durationWeeks: mesocycle.durationWeeks,
    sessions: week.map((s) => ({
      day: s.dayOfWeek,
      focus: s.sessionFocus,
      muscles: s.muscles,
    })),
    muscleFrequency: freq,
    templateCount: (SPLIT_SESSIONS[mesocycle.splitType] ?? []).length,
  };
}

console.log('=== MATRIZ: splitType por días × nivel × objetivo ===\n');
const matrix = {};
for (const days of [1, 2, 3, 4, 5, 6, 7]) {
  matrix[days] = {};
  for (const level of LEVELS) {
    matrix[days][level] = {};
    for (const goal of GOALS) {
      matrix[days][level][goal] = selectSplit(days, goal, level);
    }
  }
}
console.table(
  Object.fromEntries(
    Object.entries(matrix).map(([days, byLevel]) => [
      `${days}d`,
      Object.fromEntries(
        LEVELS.flatMap((lvl) =>
          GOALS.map((g) => [`${lvl.slice(0, 3)}/${g.slice(0, 3)}`, byLevel[lvl][g]]),
        ),
      ),
    ]),
  ),
);

console.log('\n=== FRECUENCIA MUSCULAR POR SPLIT ===\n');
for (const [split, sessions] of Object.entries(SPLIT_SESSIONS)) {
  const freq = countMuscleSessionsPerWeek(split);
  console.log(`\n${split} (${sessions.length} plantillas):`);
  console.log(
    Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .map(([m, f]) => `${m}:${f}×`)
      .join(' | '),
  );
}

console.log('\n=== ESCENARIOS DE CALENDARIO (4 días, Intermedio, Hipertrofia) ===\n');
const calendarScenarios = [
  { label: 'Lun-Jue consecutivos', days: ['Lunes', 'Martes', 'Miércoles', 'Jueves'] },
  { label: 'Lun/Mié/Vie/Sáb alternados', days: ['Lunes', 'Miércoles', 'Viernes', 'Sábado'] },
  { label: 'Mar/Jue/Sáb/Dom', days: ['Martes', 'Jueves', 'Sábado', 'Domingo'] },
  { label: 'Fin de semana pesado', days: ['Viernes', 'Sábado', 'Domingo', 'Lunes'] },
  { label: 'Solo fines de semana + 2', days: ['Sábado', 'Domingo', 'Martes', 'Jueves'] },
];

for (const sc of calendarScenarios) {
  const profile = {
    fitnessGoal: 'Hipertrofia',
    trainingDaysPerWeek: 4,
    trainingAgeMonths: TRAINING_MONTHS.Intermedio,
    experienceLevel: 'Intermedio',
    weeklyScheduleContext: makeScheduleExplicit(sc.days),
    injuriesOrLimitations: [],
  };
  const mc = generateMesocycle(profile, '2026-07-07');
  const sum = summarizeWeek(mc);
  console.log(`--- ${sc.label} ---`);
  for (const s of sum.sessions) {
    console.log(`  ${s.day}: ${s.focus}`);
  }
}

console.log('\n=== ESCENARIOS POR NIVEL Y DÍAS (calendario Lun→ primeros N días) ===\n');
for (const level of LEVELS) {
  for (const days of [2, 3, 4, 5, 6, 7]) {
    for (const goal of GOALS) {
      const profile = {
        fitnessGoal: goal,
        trainingDaysPerWeek: days,
        trainingAgeMonths: TRAINING_MONTHS[level],
        experienceLevel: level,
        weeklyScheduleContext: makeSchedule(days),
        injuriesOrLimitations: [],
      };
      const mc = generateMesocycle(profile, '2026-07-07');
      const sum = summarizeWeek(mc);
      const pecho = sum.muscleFrequency.Pecho ?? 0;
      const pierna =
        (sum.muscleFrequency.Cuádriceps ?? 0) + (sum.muscleFrequency.Isquiotibiales ?? 0);
      const sessionLine = sum.sessions.map((s) => `${s.day[0]}:${s.focus.split(' ')[0]}`).join(' → ');
      console.log(
        `${level.padEnd(11)} ${days}d ${goal.padEnd(11)} | ${sum.splitType.padEnd(22)} | Pecho ${pecho}× | Pierna ${pierna}× ses | ${sessionLine}`,
      );
    }
  }
}

console.log('\n=== ANOMALÍAS DETECTADAS ===\n');
const issues = [];

for (const days of [1, 2, 3, 4, 5, 6, 7]) {
  for (const level of LEVELS) {
    const h = selectSplit(days, 'Hipertrofia', level);
    const f = selectSplit(days, 'Fuerza', level);
    if (h !== f) issues.push(`Objetivo cambia split: ${days}d ${level} Hipertrofia=${h} vs Fuerza=${f}`);
  }
}

for (const days of [5, 6, 7]) {
  const profile = {
    fitnessGoal: 'Hipertrofia',
    trainingDaysPerWeek: days,
    trainingAgeMonths: 12,
    experienceLevel: 'Intermedio',
    weeklyScheduleContext: makeSchedule(days),
    injuriesOrLimitations: [],
  };
  const mc = generateMesocycle(profile, '2026-07-07');
  const templates = SPLIT_SESSIONS[mc.splitType].length;
  if (days > templates) {
    issues.push(
      `${days} días con split ${mc.splitType} (${templates} plantillas) → repite sesiones en la semana`,
    );
  }
}

for (const level of LEVELS) {
  const profile = {
    fitnessGoal: 'Hipertrofia',
    trainingDaysPerWeek: 3,
    trainingAgeMonths: TRAINING_MONTHS[level],
    experienceLevel: level,
    weeklyScheduleContext: makeSchedule(3),
    injuriesOrLimitations: [],
  };
  const mc = generateMesocycle(profile, '2026-07-07');
  const week = mc.microcycles[0].sessions.filter((s) => !s.isRestDay);
  for (let i = 1; i < week.length; i += 1) {
    const prev = week[i - 1].patterns?.[0];
    const curr = week[i].patterns?.[0];
    if (prev && curr && prev === curr) {
      issues.push(`Patrón consecutivo ${prev} en 3d ${level}: ${week[i - 1].sessionFocus} → ${week[i].sessionFocus}`);
    }
  }
}

if (!issues.length) console.log('Ninguna anomalía en checks automáticos.');
else issues.forEach((i) => console.log(`- ${i}`));

console.log('\n=== EXPERIENCE LEVEL THRESHOLDS ===');
for (const m of [0, 5, 6, 24, 25, 60]) {
  console.log(`  ${m} meses → ${calculateExperienceLevel(m)}`);
}
