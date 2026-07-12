/**
 * Exhaustive calendar audit: all C(7,k) schedules for k=3..7 × 3 levels.
 * Usage: node scripts/dev/audit-calendars.mjs [--json]
 */
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { evaluateSplitQuality } from '../../domain/periodization/splitQuality.js';
import { DAY_ORDER } from '../../domain/constants.js';
import { calculateExperienceLevel } from '../../domain/athlete/experienceLevel.js';

const LEVELS = [
  { label: 'Novato', months: 3 },
  { label: 'Intermedio', months: 12 },
  { label: 'Avanzado', months: 36 },
];
const GOALS = ['Hipertrofia', 'Fuerza'];
const TRAINING_MONTHS = { Novato: 3, Intermedio: 12, Avanzado: 36 };

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (!arr.length) return [];
  const [head, ...tail] = arr;
  return [
    ...combinations(tail, k - 1).map((c) => [head, ...c]),
    ...combinations(tail, k),
  ];
}

function makeSchedule(trainDayNames) {
  return DAY_ORDER.map((day) => ({
    day,
    canTrain: trainDayNames.includes(day),
  }));
}

function calendarLabel(days) {
  return days.map((d) => d.slice(0, 2)).join('');
}

const results = [];
let worst = [];
let excellent = 0;
let veryGood = 0;
let acceptable = 0;
let poor = 0;

for (const k of [3, 4, 5, 6, 7]) {
  const allCalendars = combinations([...DAY_ORDER], k);
  for (const cal of allCalendars) {
    for (const level of LEVELS) {
      for (const goal of GOALS) {
        const profile = {
          fitnessGoal: goal,
          trainingDaysPerWeek: k,
          trainingAgeMonths: level.months,
          experienceLevel: level.label,
          weeklyScheduleContext: makeSchedule(cal),
          injuriesOrLimitations: [],
        };
        const mc = generateMesocycle(profile, '2026-07-07');
        const week1 = mc.microcycles[0].sessions.filter((s) => !s.isRestDay);
        const quality = evaluateSplitQuality({
          splitType: mc.splitType,
          goal,
          experienceLevel: level.label,
          trainingDaysPerWeek: k,
          effectiveTrainingDays: week1.length,
          sessions: week1,
        });

        const entry = {
          days: k,
          calendar: calendarLabel(cal),
          level: level.label,
          goal,
          splitType: mc.splitType,
          grade: quality.grade,
          score: quality.score,
          issues: quality.issues,
          sessionSequence: week1.map((s) => s.sessionFocus),
        };
        results.push(entry);

        if (quality.grade === 'excelente') excellent += 1;
        else if (quality.grade === 'muy_bien') veryGood += 1;
        else if (quality.grade === 'aceptable') acceptable += 1;
        else poor += 1;

        if (quality.score < 70) worst.push(entry);
      }
    }
  }
}

const total = results.length;
console.log('=== AUDITORÍA EXHAUSTIVA DE CALENDARIOS ===');
console.log(`Escenarios: ${total} (${[3, 4, 5, 6, 7].map((k) => `C(7,${k})`).join(' + ')}) × 3 niveles × 2 objetivos`);
console.log('');
console.log('Distribución de calificaciones:');
console.log(`  Excelente:  ${excellent} (${((excellent / total) * 100).toFixed(1)}%)`);
console.log(`  Muy bien:   ${veryGood} (${((veryGood / total) * 100).toFixed(1)}%)`);
console.log(`  Aceptable:  ${acceptable} (${((acceptable / total) * 100).toFixed(1)}%)`);
console.log(`  Insuficiente: ${poor} (${((poor / total) * 100).toFixed(1)}%)`);
console.log('');

for (const k of [3, 4, 5, 6, 7]) {
  const subset = results.filter((r) => r.days === k);
  const grades = { excelente: 0, muy_bien: 0, aceptable: 0, insuficiente: 0 };
  for (const r of subset) grades[r.grade] += 1;
  console.log(
    `${k} días: excelente=${grades.excelente} muy_bien=${grades.muy_bien} aceptable=${grades.aceptable} insuficiente=${grades.insuficiente}`,
  );
}

if (worst.length) {
  console.log('\n=== PEORES ESCENARIOS (score < 70) ===');
  worst
    .sort((a, b) => a.score - b.score)
    .slice(0, 20)
    .forEach((w) => {
      console.log(
        `  ${w.days}d ${w.calendar} ${w.level} ${w.goal} → ${w.splitType} [${w.score}] ${w.issues.join('; ')}`,
      );
    });
}

const issueFreq = {};
for (const r of results) {
  for (const issue of r.issues) {
    issueFreq[issue] = (issueFreq[issue] ?? 0) + 1;
  }
}
console.log('\n=== ISSUES MÁS FRECUENTES ===');
Object.entries(issueFreq)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([issue, count]) => console.log(`  ${count}× ${issue}`));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary: { excellent, veryGood, acceptable, poor, total }, results }, null, 2));
}
