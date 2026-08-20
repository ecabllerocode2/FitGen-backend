import { describe, it, expect } from 'vitest';
import {
  updateLoadPerformanceLedger,
  pruneLoadPerformanceLedger,
  ledgerEntriesForPrescription,
  LEDGER_MAX_AGE_MONTHS,
  RECENT_SESSIONS_MAX,
} from '../domain/athlete/loadPerformanceLedger.js';
import {
  upsertMesocycleExerciseIndex,
  getRotationIdsFromIndex,
} from '../domain/athlete/mesocycleExerciseIndex.js';
import {
  resolveHybridExperienceLevel,
  computeCompoundE1rmGain,
  EARLY_PROMOTION_MIN_MONTHS,
} from '../domain/athlete/levelProgression.js';
import { buildLoadHistoryFromSessions } from '../domain/prescription/loadCalculator.js';

describe('loadPerformanceLedger', () => {
  it('stores best e1RM per exercise and pattern tier', () => {
    const ledger = updateLoadPerformanceLedger(null, [
      {
        exerciseId: 'Barbell_Bench_Press',
        movementPattern: 'Empuje_H',
        priority: 1,
        actualWeightKg: 60,
        actualReps: 8,
        actualRIR: 2,
      },
    ]);

    expect(ledger.byExerciseId.Barbell_Bench_Press.e1RM).toBeGreaterThan(70);
    expect(ledger.byPattern['Empuje_H:basic'].exerciseId).toBe('Barbell_Bench_Press');
  });

  it('applies recency adjustment when exercise returns after months away', () => {
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 4);
    const ledger = {
      byExerciseId: {
        Barbell_Squat: {
          e1RM: 100,
          lastWeightKg: 80,
          lastReps: 5,
          lastRir: 2,
          updatedAt: oldDate.toISOString(),
          priority: 1,
        },
      },
      byPattern: {},
    };

    const [entry] = ledgerEntriesForPrescription(
      ledger,
      'Barbell_Squat',
      'Rodilla',
      1,
      'Intermedio',
    );
    expect(entry.e1RM).toBeGreaterThan(100);
    expect(entry.fromLedger).toBe(true);
  });

  it('falls back to pattern tier when exact exercise is missing', () => {
    const ledger = {
      byExerciseId: {},
      byPattern: {
        'Empuje_H:basic': {
          e1RM: 90,
          lastWeightKg: 70,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const [entry] = ledgerEntriesForPrescription(
      ledger,
      'Incline_Barbell_Bench_Press',
      'Empuje_H',
      1,
      'Intermedio',
    );
    expect(entry.fromPatternFallback).toBe(true);
    expect(entry.e1RM).toBeGreaterThan(80);
  });

  it('prefers basic-tier pattern for priority-2 compounds over weak accessory history', () => {
    const ledger = {
      byExerciseId: {},
      byPattern: {
        'Empuje_H:basic': {
          e1RM: 52,
          lastWeightKg: 40,
          loadConvention: 'barbell_total',
          updatedAt: new Date().toISOString(),
        },
        'Empuje_H:accessory': {
          e1RM: 26,
          lastWeightKg: 15,
          loadConvention: 'machine_stack',
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const [entry] = ledgerEntriesForPrescription(
      ledger,
      'Leverage_Incline_Chest_Press',
      'Empuje_H',
      2,
      'Intermedio',
    );
    expect(entry.fromPatternFallback).toBe(true);
    expect(entry.e1RM).toBeGreaterThan(50);
  });

  it('prefers accessory-tier pattern for priority-3 isolations', () => {
    const ledger = {
      byExerciseId: {},
      byPattern: {
        'Empuje_V:basic': {
          e1RM: 40,
          lastWeightKg: 30,
          updatedAt: new Date().toISOString(),
        },
        'Empuje_V:accessory': {
          e1RM: 22,
          lastWeightKg: 12,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const [entry] = ledgerEntriesForPrescription(
      ledger,
      'Triceps_Pushdown',
      'Empuje_V',
      3,
      'Intermedio',
    );
    expect(entry.e1RM).toBeLessThan(25);
  });

  it('prunes entries older than LEDGER_MAX_AGE_MONTHS', () => {
    const stale = new Date();
    stale.setMonth(stale.getMonth() - (LEDGER_MAX_AGE_MONTHS + 2));
    const pruned = pruneLoadPerformanceLedger({
      byExerciseId: {
        old: { e1RM: 50, updatedAt: stale.toISOString() },
      },
      byPattern: {},
    });
    expect(pruned.byExerciseId.old).toBeUndefined();
  });

  it('prefers ledger over archived sessions in buildLoadHistoryFromSessions', () => {
    const ledger = updateLoadPerformanceLedger(null, [
      {
        exerciseId: 'Lat_Pulldown',
        movementPattern: 'Traccion_V',
        priority: 1,
        actualWeightKg: 50,
        actualReps: 10,
        actualRIR: 2,
      },
    ]);

    const history = buildLoadHistoryFromSessions(
      [],
      'Lat_Pulldown',
      'Traccion_V',
      1,
      ledger,
      'Intermedio',
    );
    expect(history[0].fromLedger).toBe(true);
  });
});

describe('mesocycleExerciseIndex', () => {
  it('records week-1 anchors and excludes them on future mesocycles', () => {
    const index = upsertMesocycleExerciseIndex([], {
      mesocycleId: 'mc-1',
      sessionFocus: 'Torso (Empuje)',
      weekNumber: 1,
      mainBlock: [{ exerciseId: 'A' }, { exerciseId: 'B' }],
    });

    const next = upsertMesocycleExerciseIndex(index, {
      mesocycleId: 'mc-2',
      sessionFocus: 'Torso (Empuje)',
      weekNumber: 1,
      mainBlock: [{ exerciseId: 'C' }],
    });

    const excluded = getRotationIdsFromIndex(next, 'mc-3', 'Torso (Empuje)');
    expect(excluded).toContain('A');
    expect(excluded).toContain('B');
    expect(excluded).toContain('C');
  });
});

describe('hybrid level progression', () => {
  it('promotes Novato early with consistency and compound progress', () => {
    const ledger = updateLoadPerformanceLedger(null, [
      {
        exerciseId: 'Barbell_Squat',
        movementPattern: 'Rodilla',
        priority: 1,
        actualWeightKg: 60,
        actualReps: 8,
        actualRIR: 2,
      },
    ]);
    ledger.byExerciseId.Barbell_Squat.previousE1RM = 70;

    const result = resolveHybridExperienceLevel({
      trainingAgeMonths: EARLY_PROMOTION_MIN_MONTHS.Novato,
      currentLevel: 'Novato',
      mesocycleCompletionRate: 0.85,
      persistentJointPain: false,
      loadPerformanceLedger: ledger,
    });

    expect(result.experienceLevel).toBe('Intermedio');
    expect(result.promotionReasons.length).toBeGreaterThan(0);
  });

  it('holds back promotion on low consistency or joint pain', () => {
    const held = resolveHybridExperienceLevel({
      trainingAgeMonths: 8,
      currentLevel: 'Novato',
      mesocycleCompletionRate: 0.4,
      persistentJointPain: false,
      loadPerformanceLedger: null,
    });
    expect(held.heldBack).toBe(true);

    const pain = resolveHybridExperienceLevel({
      trainingAgeMonths: 4,
      currentLevel: 'Novato',
      mesocycleCompletionRate: 0.9,
      persistentJointPain: true,
      loadPerformanceLedger: {
        byExerciseId: {
          a: { priority: 1, e1RM: 110, previousE1RM: 100 },
        },
        byPattern: {},
      },
    });
    expect(pain.experienceLevel).toBe('Novato');
    expect(pain.heldBack).toBe(true);
  });

  it('computes average compound e1RM gain from ledger', () => {
    const gain = computeCompoundE1rmGain({
      byExerciseId: {
        a: { priority: 1, e1RM: 110, previousE1RM: 100 },
        b: { priority: 1, e1RM: 88, previousE1RM: 80 },
      },
      byPattern: {},
    });
    expect(gain).toBeCloseTo(0.1, 2);
  });
});

describe('lifecycle constants', () => {
  it('keeps recent session window around two mesocycles', () => {
    expect(RECENT_SESSIONS_MAX).toBe(36);
  });
});
