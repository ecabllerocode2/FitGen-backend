/**
 * QA mesociclo end-to-end — setup usuario, simula semanas, reporta métricas.
 *
 * Uso:
 *   node scripts/dev/qa-mesocycle.mjs --user <uid>
 *   node scripts/dev/qa-mesocycle.mjs --user <uid> --weeks 5
 */
import { createRequire } from 'module';
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { getWeekPlan } from '../../domain/periodization/microcycle.js';
import { getTodaySessionPlan, getCurrentWeek, isMesocycleComplete } from '../../lib/mesocycleUtils.js';
import { loadCatalog } from '../../infrastructure/catalog/catalogRepository.js';
import { createUserRepository } from '../../infrastructure/firebase/userRepository.js';
import { evaluateCycle } from '../../domain/progression/cycleEvaluation.js';
import { countMuscleSessionsPerWeek } from '../../domain/constants.js';

const require = createRequire(import.meta.url);
const { initFirebaseAdmin } = require('../lib/firebaseInit.cjs');

const args = process.argv.slice(2);
const userIdx = args.indexOf('--user');
const weeksIdx = args.indexOf('--weeks');
const userId = userIdx >= 0 ? args[userIdx + 1] : null;
const maxWeeks = weeksIdx >= 0 ? parseInt(args[weeksIdx + 1], 10) : null;

if (!userId) {
  console.error('Uso: node scripts/dev/qa-mesocycle.mjs --user <uid> [--weeks N]');
  process.exit(1);
}

const admin = initFirebaseAdmin();
const db = admin.firestore();
const users = createUserRepository(db);

const testProfile = {
  name: 'QA Tester',
  age: 28,
  gender: 'M',
  heightCm: 175,
  currentWeightKg: 75,
  trainingAgeMonths: 12,
  fitnessGoal: 'Hipertrofia',
  trainingDaysPerWeek: 3,
  weeklyScheduleContext: [
    { day: 'Lunes', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Martes', canTrain: false, externalLoad: 'ninguna' },
    { day: 'Miércoles', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Jueves', canTrain: false, externalLoad: 'ninguna' },
    { day: 'Viernes', canTrain: true, externalLoad: 'ninguna' },
    { day: 'Sábado', canTrain: false, externalLoad: 'ninguna' },
    { day: 'Domingo', canTrain: false, externalLoad: 'ninguna' },
  ],
  injuriesOrLimitations: [],
  timezone: 'America/Mexico_City',
  experienceLevel: 'Intermedio',
};

const report = {
  userId,
  startedAt: new Date().toISOString(),
  weeks: [],
  evaluation: null,
  issues: [],
};

async function shiftDates(user, days) {
  function shiftIso(iso, deltaDays) {
    if (!iso) return null;
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() - deltaDays);
    return d.toISOString();
  }
  function shiftDate(isoDate, deltaDays) {
    if (!isoDate) return null;
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - deltaDays);
    return d.toISOString().slice(0, 10);
  }
  const data = user;
  const updates = {};
  if (data.currentMesocycle?.startDate) {
    updates['currentMesocycle.startDate'] = shiftDate(data.currentMesocycle.startDate, days);
  }
  if (data.currentMesocycle?.endDate) {
    updates['currentMesocycle.endDate'] = shiftDate(data.currentMesocycle.endDate, days);
  }
  if (data.lastWorkoutDate) {
    updates.lastWorkoutDate = shiftIso(data.lastWorkoutDate, days);
  }
  await db.collection('users').doc(userId).update(updates);
}

function sumWeeklySetsFromSessions(sessions, muscle) {
  return sessions.reduce((sum, s) => {
    const exSets = (s.mainBlock ?? [])
      .filter((e) => e.muscleGroup === muscle)
      .reduce((acc, e) => acc + (e.sets ?? 0), 0);
    return sum + exSets;
  }, 0);
}

async function main() {
  console.log(`\n🔬 QA Mesociclo — usuario ${userId}\n`);

  await users.saveUser(userId, {
    userId,
    status: 'approved',
    plan: 'free',
    profileData: testProfile,
    planStatus: 'active',
  });

  const referenceDate = new Date('2026-07-07T10:00:00Z');
  const mesocycle = generateMesocycle(testProfile, referenceDate);
  mesocycle.status = 'activo';
  await users.saveMesocycle(userId, mesocycle);

  const catalog = await loadCatalog(db);
  const muscleFreq = countMuscleSessionsPerWeek(mesocycle.splitType);
  const weeksToRun = maxWeeks ?? mesocycle.durationWeeks;

  let archivedSessions = [];

  for (let w = 1; w <= weeksToRun; w += 1) {
    const refDate = new Date(referenceDate);
    refDate.setUTCDate(refDate.getUTCDate() + (w - 1) * 7);

    let user = await users.getUser(userId);
    const weekPlan = getWeekPlan(user.currentMesocycle, w);
    const weekSessions = [];

    const micro = user.currentMesocycle.microcycles.find((m) => m.week === w);
    const trainingDays = (micro?.sessions ?? []).filter((s) => !s.isRestDay);

    for (const dayPlan of trainingDays) {
      const session = generateSession({
        profile: testProfile,
        mesocycle: user.currentMesocycle,
        weekNumber: w,
        sessionFocus: dayPlan.sessionFocus,
        sessionMuscles: dayPlan.muscles,
        patterns: dayPlan.patterns,
        readiness: { energyLevel: 3, sorenessLevel: 2, sleepQuality: 3, stressLevel: 3 },
        feedbackModifiers: user.weeklyFeedbackModifiers ?? {},
        catalog,
        history: archivedSessions,
        referenceDate: refDate,
      });

      weekSessions.push(session);
      archivedSessions.unshift({
        ...session,
        completed: true,
        sessionFeedback: {
          pumpQuality: 3,
          sorenessTiming: 'sanó a tiempo',
          perceivedWorkload: 3,
          jointPain: false,
        },
        performance: session.mainBlock,
      });
    }

    const weekReport = {
      week: w,
      phase: micro?.phase,
      volumeTargets: weekPlan.volumeByMuscle,
      rirObjetivo: weekPlan.rirObjetivo,
      sessionsCompleted: weekSessions.length,
      actualWeeklySets: {},
    };

    for (const muscle of Object.keys(weekPlan.volumeByMuscle)) {
      const actual = sumWeeklySetsFromSessions(weekSessions, muscle);
      const target = weekPlan.volumeByMuscle[muscle];
      const freq = muscleFreq[muscle] || 1;
      weekReport.actualWeeklySets[muscle] = { actual, target, sessionsPerWeek: freq };
      if (actual > target * 1.5) {
        report.issues.push(`Semana ${w}: ${muscle} actual=${actual} >> target=${target}`);
      }
    }

    report.weeks.push(weekReport);
    console.log(`  Semana ${w} (${micro?.phase}): ${weekSessions.length} sesiones`);

    if (w < weeksToRun) {
      await shiftDates(user, 7);
    }
  }

  const finalUser = await users.getUser(userId);
  const endRef = new Date(referenceDate);
  endRef.setUTCDate(endRef.getUTCDate() + weeksToRun * 7);
  const complete = isMesocycleComplete(finalUser.currentMesocycle, endRef);

  if (complete) {
    const evalResult = evaluateCycle(
      { generalDifficulty: 2, persistentJointPain: false },
      finalUser.currentMesocycle.volumeLandmarks,
      testProfile,
      endRef,
    );
    report.evaluation = {
      mesocycleComplete: true,
      landmarkSample: Object.entries(evalResult.updatedLandmarks).slice(0, 2),
      nextMesocycleWeeks: evalResult.nextMesocycle.durationWeeks,
    };
  }

  report.finishedAt = new Date().toISOString();
  console.log('\n📊 Reporte QA:\n');
  console.log(JSON.stringify(report, null, 2));

  if (report.issues.length) {
    console.warn(`\n⚠️  ${report.issues.length} issue(s) detectados`);
    process.exit(1);
  }
  console.log('\n✅ QA mesociclo OK\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
