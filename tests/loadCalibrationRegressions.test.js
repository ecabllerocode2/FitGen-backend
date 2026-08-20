import { describe, expect, it } from 'vitest';
import {
  estimateE1RM,
  estimateE1RMWithRIR,
  prescribeLoad,
  E1RM_MAX_EFFECTIVE_REPS,
  PATTERN_TRANSFER_E1RM_FACTOR,
} from '../domain/prescription/loadCalculator.js';
import { updateLoadPerformanceLedger, ledgerEntriesForPrescription } from '../domain/athlete/loadPerformanceLedger.js';
import { resolveLoadConvention } from '../domain/prescription/loadConvention.js';

/**
 * Regression suite for the Carlos Alberto audit findings (UID zqq28…).
 * Each case mirrors a real prescription failure and asserts the fix.
 */
describe('load calibration regressions (audit fixes)', () => {
  it('caps Brzycki e1RM so 35×35 cannot explode to thousands of kg', () => {
    const uncappedLegacy = 35 / (1.0278 - 0.0278 * 36); // ≈ absurd
    expect(uncappedLegacy).toBeGreaterThan(500);

    const e1rm = estimateE1RMWithRIR(35, 35, 1);
    expect(e1rm).toBeLessThan(80);
    expect(e1rm).toBeGreaterThan(30);
    expect(E1RM_MAX_EFFECTIVE_REPS).toBe(12);
    // Same result as capping failure-reps at 12
    expect(e1rm).toBeCloseTo(estimateE1RM(35, 12), 5);
  });

  it('does not under-prescribe incline DB when ledger omits loadConvention', () => {
    // Repro: history logged 25 kg/hand but null convention → old code assumed barbell ×0.45 → ~9 kg
    const load = prescribeLoad({
      exerciseType: 'compound',
      rirTarget: 4.8,
      repRange: '9-13',
      equipo: ['Mancuernas'],
      exerciseId: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
      history: [
        {
          weightKg: 25,
          reps: 10,
          rir: 2,
          loadConvention: null, // missing — must NOT default to barbell_total
        },
      ],
    });

    expect(load.loadConvention).toBe('dumbbell_per_hand');
    expect(load.mode).toBe('calculated');
    expect(load.prescribedLoadKg).toBeGreaterThanOrEqual(16);
    expect(load.prescribedLoadKg).toBeLessThanOrEqual(25);
  });

  it('does not under-prescribe unilateral calf when history convention is missing', () => {
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

    expect(load.loadConvention).toBe('unilateral');
    expect(load.prescribedLoadKg).toBeGreaterThanOrEqual(10);
    expect(load.prescribedLoadKg).not.toBe(6);
  });

  // Repro: swap-exercise wrote suggestedLoadKg: undefined → Firestore reject
  // (currentSession.mainBlock.N.suggestedLoadKg) when prescribeLoad was in calculated mode.
  it('never returns undefined suggestedLoadKg (Firestore-safe)', () => {
    const calculated = prescribeLoad({
      exerciseType: 'isolation',
      rirTarget: 2.8,
      repRange: '11-16',
      isUnilateral: true,
      exerciseId: 'Dumbbell_Seated_One-Leg_Calf_Raise',
      exerciseName: 'Elevación de Talón Sentado a una Pierna',
      equipo: ['Mancuernas'],
      history: [{ weightKg: 15, reps: 13, rir: 2, loadConvention: null }],
    });
    expect(calculated.mode).toBe('calculated');
    expect(calculated).toHaveProperty('suggestedLoadKg');
    expect(calculated.suggestedLoadKg).toBeNull();

    const exploratory = prescribeLoad({
      exerciseType: 'isolation',
      rirTarget: 2,
      repRange: '10-12',
      history: [],
      bodyWeightKg: null,
      movementPattern: 'Cadera',
    });
    expect(exploratory.mode).toBe('exploratory');
    expect(exploratory).toHaveProperty('suggestedLoadKg');
    expect(exploratory.suggestedLoadKg).toBeNull();
  });

  it('applies a stronger conservative bias on pattern_transfer (−15%)', () => {
    const exact = prescribeLoad({
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

    expect(transfer.mode).toBe('pattern_transfer');
    expect(PATTERN_TRANSFER_E1RM_FACTOR).toBe(0.85);
    expect(transfer.e1rm).toBeLessThan(exact.e1rm);
    expect(transfer.e1rm / exact.e1rm).toBeCloseTo(0.85, 2);
    // Plate snapping can equalize kg at low loads; bias is guaranteed on e1RM.
    expect(transfer.prescribedLoadKg).toBeLessThanOrEqual(exact.prescribedLoadKg);
  });

  it('persists loadConvention and picks best working set into the ledger', () => {
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
          { load: 18, reps: 12, rir: 2 },
        ],
      },
    ]);

    const entry = ledger.byExerciseId.Incline_Dumbbell_Bench_With_Palms_Facing_In;
    expect(entry.lastWeightKg).toBe(25);
    expect(entry.loadConvention).toBe('dumbbell_per_hand');
    expect(entry.e1RM).toBeLessThan(80);
  });

  it('infers unilateral from one-leg naming', () => {
    expect(
      resolveLoadConvention({
        exerciseId: 'Dumbbell_Seated_One-Leg_Calf_Raise',
        exerciseName: 'Elevación de Talón Sentado a una Pierna',
        equipo: ['Mancuernas'],
      }),
    ).toBe('unilateral');
  });

  it('machine iso-row uses machine_stack even when catalog marks isUnilateral', () => {
    expect(
      resolveLoadConvention({
        exerciseId: 'Leverage_Iso_Row',
        exerciseName: 'Remo Isolateral en Máquina',
        equipo: ['Máquina'],
        isUnilateral: true,
      }),
    ).toBe('machine_stack');
  });

  it('does not under-prescribe new mesocycle machine row from pattern transfer (Carlos audit)', () => {
    const ledger = {
      byExerciseId: {},
      byPattern: {
        'Traccion_H:basic': {
          e1RM: 58.3,
          lastWeightKg: 35,
          loadConvention: 'barbell_total',
          updatedAt: new Date().toISOString(),
        },
        'Traccion_H:accessory': {
          e1RM: 25.9,
          lastWeightKg: 20,
          loadConvention: 'machine_stack',
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const history = ledgerEntriesForPrescription(
      ledger,
      'Leverage_Iso_Row',
      'Traccion_H',
      2,
      'Intermedio',
    );
    const load = prescribeLoad({
      exerciseType: 'isolation',
      rirTarget: 2,
      repRange: '9-13',
      history,
      bodyWeightKg: 70,
      movementPattern: 'Traccion_H',
      exerciseId: 'Leverage_Iso_Row',
      exerciseName: 'Remo Isolateral en Máquina',
      equipo: ['Máquina'],
      isUnilateral: false,
      loadConvention: 'machine_stack',
    });

    expect(load.mode).toBe('pattern_transfer');
    expect(load.loadConvention).toBe('machine_stack');
    expect(load.prescribedLoadKg).toBeGreaterThanOrEqual(15);
    expect(load.prescribedLoadKg).not.toBe(6);
  });

  it('does not under-prescribe new mesocycle incline machine from weak accessory pattern', () => {
    const ledger = {
      byExerciseId: {},
      byPattern: {
        'Empuje_H:basic': {
          e1RM: 51.9,
          lastWeightKg: 40,
          loadConvention: 'barbell_total',
          updatedAt: new Date().toISOString(),
        },
        'Empuje_H:accessory': {
          e1RM: 38.9,
          lastWeightKg: 30,
          loadConvention: 'machine_stack',
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const history = ledgerEntriesForPrescription(
      ledger,
      'Leverage_Incline_Chest_Press',
      'Empuje_H',
      2,
      'Intermedio',
    );
    const load = prescribeLoad({
      exerciseType: 'isolation',
      rirTarget: 2,
      repRange: '9-13',
      history,
      bodyWeightKg: 70,
      movementPattern: 'Empuje_H',
      exerciseId: 'Leverage_Incline_Chest_Press',
      exerciseName: 'Press de Pecho Inclinado en Máquina',
      equipo: ['Máquina'],
      loadConvention: 'machine_stack',
    });

    expect(load.prescribedLoadKg).toBeGreaterThanOrEqual(25);
    expect(load.prescribedLoadKg).not.toBe(15);
  });
});
