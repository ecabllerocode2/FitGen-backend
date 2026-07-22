#!/usr/bin/env node
/**
 * Fictional-athlete audit for load-calibration fixes.
 *
 * Simulates the failure modes found on real user zqq28… and asserts the
 * prescription engine now behaves as expected — no Firebase required.
 *
 * Usage: node scripts/dev/audit-load-calibration.mjs
 * Exit 0 = all checks passed.
 */
import {
  estimateE1RMWithRIR,
  prescribeLoad,
  PATTERN_TRANSFER_E1RM_FACTOR,
} from '../../domain/prescription/loadCalculator.js';
import { updateLoadPerformanceLedger } from '../../domain/athlete/loadPerformanceLedger.js';
import { ledgerEntriesForPrescription } from '../../domain/athlete/loadPerformanceLedger.js';

const ATHLETE = {
  name: 'Ficticio Audit — "Carlos Twin"',
  bodyWeightKg: 70,
  experienceLevel: 'Intermedio',
};

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` · ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` · ${detail}` : ''}`);
  }
}

console.log(`\n=== Load calibration audit · ${ATHLETE.name} ===\n`);

// ---------------------------------------------------------------------------
// Scenario A — high-rep calf blow-up (was e1RM ≈ 1167 kg)
// ---------------------------------------------------------------------------
console.log('A) High-rep e1RM cap (Standing Barbell Calf Raise 35×35 @RIR1)');
{
  const e1rm = estimateE1RMWithRIR(35, 35, 1);
  check('e1RM is finite and human-scale', e1rm > 30 && e1rm < 80, `e1RM=${e1rm?.toFixed(1)} kg`);

  const ledger = updateLoadPerformanceLedger(null, [
    {
      exerciseId: 'Standing_Barbell_Calf_Raise',
      exerciseName: 'Elevación de Talones con Barra de Pie',
      movementPattern: 'Cadera',
      priority: 3,
      equipo: ['Barra'],
      // Inflated client e1RM must be ignored
      e1RM: 1166.7,
      actualWeightKg: 35,
      actualReps: 35,
      actualRIR: 1,
      sets: [
        { load: 30, reps: 15, rir: 2 },
        { load: 35, reps: 16, rir: 2 },
        { load: 35, reps: 35, rir: 1 },
      ],
    },
  ]);
  const entry = ledger.byExerciseId.Standing_Barbell_Calf_Raise;
  check('ledger stores capped e1RM (not 1167)', entry.e1RM < 80, `ledger e1RM=${entry.e1RM}`);

  const next = prescribeLoad({
    exerciseType: 'isolation',
    rirTarget: 2.8,
    repRange: '11-16',
    equipo: ['Barra'],
    history: ledgerEntriesForPrescription(
      ledger,
      'Standing_Barbell_Calf_Raise',
      'Cadera',
      3,
      ATHLETE.experienceLevel,
    ),
  });
  check(
    'next calf prescription is sane',
    next.prescribedLoadKg >= 20 && next.prescribedLoadKg <= 45,
    `prescribed=${next.prescribedLoadKg} kg mode=${next.mode}`,
  );
}

// ---------------------------------------------------------------------------
// Scenario B — incline DB under-prescription (was 9 kg after logging 25)
// ---------------------------------------------------------------------------
console.log('\nB) Incline dumbbell convention (null history convention)');
{
  const load = prescribeLoad({
    exerciseType: 'compound',
    rirTarget: 4.8,
    repRange: '9-13',
    equipo: ['Mancuernas'],
    exerciseId: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
    bodyWeightKg: ATHLETE.bodyWeightKg,
    history: [{ weightKg: 25, reps: 10, rir: 2, loadConvention: null }],
  });
  check('not the old ~9 kg trap', load.prescribedLoadKg !== 9 && load.prescribedLoadKg >= 16, `prescribed=${load.prescribedLoadKg}`);
  check('stays per-hand', load.loadConvention === 'dumbbell_per_hand');
}

// ---------------------------------------------------------------------------
// Scenario C — unilateral seated calf (was 6 kg after logging 15)
// ---------------------------------------------------------------------------
console.log('\nC) Unilateral seated calf (null history convention)');
{
  const load = prescribeLoad({
    exerciseType: 'isolation',
    rirTarget: 2.8,
    repRange: '11-16',
    isUnilateral: true,
    exerciseId: 'Dumbbell_Seated_One-Leg_Calf_Raise',
    exerciseName: 'Elevación de Talón Sentado a una Pierna',
    equipo: ['Mancuernas'],
    history: [{ weightKg: 15, reps: 13, rir: 2, loadConvention: null }],
  });
  check('not the old 6 kg trap', load.prescribedLoadKg !== 6 && load.prescribedLoadKg >= 10, `prescribed=${load.prescribedLoadKg}`);
  check('convention unilateral', load.loadConvention === 'unilateral');
}

// ---------------------------------------------------------------------------
// Scenario D — pattern_transfer curl overestimate (was −35% actual vs presc)
// ---------------------------------------------------------------------------
console.log('\nD) Pattern-transfer conservatism (curl from similar pattern)');
{
  const donor = prescribeLoad({
    exerciseType: 'isolation',
    rirTarget: 2.8,
    repRange: '11-16',
    equipo: ['Barra'],
    history: [{ weightKg: 20, reps: 10, rir: 2, loadConvention: 'barbell_total' }],
  });
  const transfer = prescribeLoad({
    exerciseType: 'isolation',
    rirTarget: 2.8,
    repRange: '11-16',
    equipo: ['Barra'],
    history: [
      {
        weightKg: 20,
        reps: 10,
        rir: 2,
        loadConvention: 'barbell_total',
        fromPatternFallback: true,
      },
    ],
  });
  check('mode is pattern_transfer', transfer.mode === 'pattern_transfer');
  check(
    `bias is ${PATTERN_TRANSFER_E1RM_FACTOR} (−15%)`,
    Math.abs(transfer.e1rm / donor.e1rm - PATTERN_TRANSFER_E1RM_FACTOR) < 0.02,
    `transfer e1RM=${transfer.e1rm} vs exact=${donor.e1rm}`,
  );
  check(
    'transfer e1RM strictly below exact-exercise e1RM',
    transfer.e1rm < donor.e1rm,
    `transfer=${transfer.e1rm} exact=${donor.e1rm}`,
  );
  check(
    'prescribed load ≤ exact-exercise path (snap may equalize kg)',
    transfer.prescribedLoadKg <= donor.prescribedLoadKg,
    `transfer=${transfer.prescribedLoadKg} exact=${donor.prescribedLoadKg}`,
  );
}

// ---------------------------------------------------------------------------
// Scenario E — end-to-end: explore → log mixed sets → prescribe
// ---------------------------------------------------------------------------
console.log('\nE) End-to-end fictional microcycle (Push → ledger → Push)');
{
  const exploratory = prescribeLoad({
    exerciseType: 'compound',
    rirTarget: 4,
    repRange: '8-12',
    equipo: ['Mancuernas'],
    exerciseId: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
    bodyWeightKg: ATHLETE.bodyWeightKg,
    movementPattern: 'Empuje_H',
    history: [],
  });
  check('week-1 incline is exploratory', exploratory.mode === 'exploratory');

  const ledger = updateLoadPerformanceLedger(null, [
    {
      exerciseId: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
      exerciseName: 'Press Inclinado con Mancuernas Agarre Neutro',
      movementPattern: 'Empuje_H',
      priority: 2,
      equipo: ['Mancuernas'],
      sets: [
        { load: 10, reps: 10, rir: 2 },
        { load: 25, reps: 10, rir: 2 },
      ],
    },
  ]);
  const history = ledgerEntriesForPrescription(
    ledger,
    'Incline_Dumbbell_Bench_With_Palms_Facing_In',
    'Empuje_H',
    2,
    ATHLETE.experienceLevel,
  );
  check('ledger anchored on best set (25 kg)', history[0]?.weightKg === 25, `weight=${history[0]?.weightKg}`);
  check('ledger kept dumbbell convention', history[0]?.loadConvention === 'dumbbell_per_hand');

  const week2 = prescribeLoad({
    exerciseType: 'compound',
    rirTarget: 2.8,
    repRange: '8-12',
    equipo: ['Mancuernas'],
    exerciseId: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
    history,
  });
  check(
    'week-2 prescription near working weight',
    week2.mode === 'calculated' && week2.prescribedLoadKg >= 18 && week2.prescribedLoadKg <= 26,
    `prescribed=${week2.prescribedLoadKg} kg`,
  );
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
