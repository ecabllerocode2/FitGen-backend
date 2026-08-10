import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { findEquivalentSwapReplacement } from '../domain/exerciseSelection/swapReplacement.js';
import { applyMainExerciseSwap } from '../domain/session/applyMainExerciseSwap.js';
import {
  applyContinuityReplacements,
  getSessionContinuityReplacements,
  normalizeContinuityOverrides,
  setContinuityReplacement,
} from '../domain/athlete/continuityPreferences.js';
import { selectExercises } from '../domain/exerciseSelection/selector.js';

const catalog = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'colecciones/curated/entrenamiento.json'), 'utf8'),
).items.filter((ex) => ex.categoriaBloque === 'main_block');

describe('exercise swap equivalence', () => {
  it('does not replace a vertical pull with a chest press', () => {
    const source = catalog.find((ex) => ex.id === 'Underhand_Cable_Pulldowns');
    expect(source).toBeTruthy();

    const replacement = findEquivalentSwapReplacement(catalog, source, {
      excludeIds: ['Incline_Dumbbell_Bench_With_Palms_Facing_In', 'Inverted_Row'],
      unavailableEquipment: ['Polea Alta'],
      safetyProfile: { experienceLevel: 'Avanzado' },
      weekNumber: 1,
    });

    expect(replacement).toBeTruthy();
    // Prefer same muscle (Espalda row) over same-pattern isolation when vertical peers are blocked.
    expect(replacement.parteCuerpo).toBe('Espalda');
    expect(replacement.parteCuerpo).not.toBe('Pecho');
    expect(replacement.parteCuerpo).not.toBe('Bíceps');
    expect(replacement.patronMovimiento).not.toBe('Empuje_H');
    expect(replacement.id).not.toMatch(/Bench_Press|Chest_Press/i);
  });

  it('returns null for missing source or empty catalog', () => {
    expect(findEquivalentSwapReplacement(catalog, null)).toBeNull();
    expect(findEquivalentSwapReplacement([], { id: 'X', patronMovimiento: 'Empuje_H', parteCuerpo: 'Pecho' })).toBeNull();
    expect(findEquivalentSwapReplacement(catalog, { nombre: 'sin id' })).toBeNull();
  });

  it('prefers same muscle and pattern over other patterns', () => {
    const source = catalog.find((ex) => ex.id === 'Incline_Dumbbell_Bench_With_Palms_Facing_In');
    const replacement = findEquivalentSwapReplacement(catalog, source, {
      excludeIds: [],
      safetyProfile: { experienceLevel: 'Intermedio' },
    });
    expect(replacement).toBeTruthy();
    expect(replacement.id).not.toBe(source.id);
    expect(replacement.patronMovimiento).toBe('Empuje_H');
    expect(replacement.parteCuerpo).toBe('Pecho');
  });

  it('respects excludeIds so session mates are not chosen', () => {
    const source = catalog.find((ex) => ex.id === 'Underhand_Cable_Pulldowns');
    const allPulls = catalog
      .filter((ex) => ex.patronMovimiento === 'Traccion_V' && ex.parteCuerpo === 'Espalda')
      .map((ex) => ex.id)
      .filter((id) => id !== source.id);

    const replacement = findEquivalentSwapReplacement(catalog, source, {
      excludeIds: allPulls,
      unavailableEquipment: [],
      safetyProfile: { experienceLevel: 'Avanzado' },
    });

    if (replacement) {
      expect(allPulls).not.toContain(replacement.id);
    } else {
      expect(replacement).toBeNull();
    }
  });

  it('keeps session pattern when applying main swap', () => {
    const source = catalog.find((ex) => ex.id === 'Underhand_Cable_Pulldowns');
    const session = {
      weekNumber: 1,
      sessionFocus: 'Upper (Fuerza)',
      mainBlock: [
        {
          exerciseId: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
          exerciseName: 'Press inclinada',
          muscleGroup: 'Pecho',
          movementPattern: 'Empuje_H',
          rirTarget: 2,
          repRange: '3-6',
          priority: 1,
        },
        {
          exerciseId: source.id,
          exerciseName: source.nombre,
          muscleGroup: source.parteCuerpo,
          movementPattern: source.patronMovimiento,
          rirTarget: 2,
          repRange: '3-6',
          priority: 1,
        },
        {
          exerciseId: 'Inverted_Row',
          exerciseName: 'Remo invertido',
          muscleGroup: 'Espalda',
          movementPattern: 'Traccion_H',
          rirTarget: 2,
          repRange: '3-6',
          priority: 1,
        },
      ],
    };

    const result = applyMainExerciseSwap({
      session,
      exerciseIdToReplace: source.id,
      catalog,
      excludeIds: [],
      unavailableEquipment: ['Polea Alta'],
      safetyProfile: { experienceLevel: 'Avanzado' },
      history: [],
    });

    expect(result.error).toBeUndefined();
    expect(result.replacement.parteCuerpo).toBe('Espalda');
    expect(result.replacement.parteCuerpo).not.toBe('Bíceps');
    const swapped = result.mainBlock.find((e) => e.swappedFrom === source.id);
    expect(swapped).toBeTruthy();
    expect(swapped.muscleGroup).toBe('Espalda');
    expect(['Traccion_V', 'Traccion_H']).toContain(swapped.movementPattern);
    expect(swapped.descripcion).toBe(result.replacement.descripcion);
    expect(swapped.exerciseId).toBe(result.replacement.id);
    expect(swapped.exerciseName).toBe(result.replacement.nombre);
    expect(swapped.isUnilateral).toBe(Boolean(result.replacement.isUnilateral));
    expect(swapped.priority).toBe(Number(result.replacement.prioridad ?? 1));
    expect(typeof swapped.loadMode).toBe('string');
    expect(typeof swapped.loadConvention).toBe('string');
    expect(typeof swapped.loadExplanation).toBe('string');
    expect(result.mainBlock).toHaveLength(3);
    expect(result.mainBlock.filter((e) => e.exerciseId === 'Incline_Dumbbell_Bench_With_Palms_Facing_In')).toHaveLength(1);
  });

  it('returns error when exercise to replace is missing', () => {
    const result = applyMainExerciseSwap({
      session: { mainBlock: [] },
      exerciseIdToReplace: 'Does_Not_Exist',
      catalog,
    });
    expect(result.error).toMatch(/no encontrado/i);
  });

  it('returns error when no equivalent alternative exists', () => {
    const source = catalog.find((ex) => ex.id === 'Underhand_Cable_Pulldowns');
    const result = applyMainExerciseSwap({
      session: {
        mainBlock: [
          {
            exerciseId: source.id,
            exerciseName: source.nombre,
            muscleGroup: source.parteCuerpo,
            movementPattern: source.patronMovimiento,
          },
        ],
      },
      exerciseIdToReplace: source.id,
      catalog: [source],
      unavailableEquipment: source.equipo ?? [],
    });
    expect(result.error).toMatch(/alternativo|equivalente/i);
  });

  it('ignores corrupted continuity that crosses patterns', () => {
    const stubs = [
      {
        id: 'Underhand_Cable_Pulldowns',
        nombre: 'Jalón',
        patronMovimiento: 'Traccion_V',
        parteCuerpo: 'Espalda',
      },
    ];
    const resolved = applyContinuityReplacements(stubs, {
      Underhand_Cable_Pulldowns: {
        exerciseId: 'Smith_Machine_Bench_Press',
        nombre: 'Press Smith',
        patronMovimiento: 'Empuje_H',
        parteCuerpo: 'Pecho',
      },
    });
    expect(resolved[0].id).toBe('Underhand_Cable_Pulldowns');
    expect(resolved[0].patronMovimiento).toBe('Traccion_V');
  });

  it('Upper (Fuerza) includes vertical push for shoulders', () => {
    const selected = selectExercises(
      'Upper (Fuerza)',
      catalog,
      { experienceLevel: 'Avanzado' },
      [],
      'Hipertrofia',
      { weekNumber: 1, sessionMuscles: ['Pecho', 'Espalda', 'Hombro'] },
    );

    expect(selected.length).toBeGreaterThanOrEqual(4);
    expect(selected.some((e) => e.patronMovimiento === 'Empuje_V')).toBe(true);
    expect(selected.some((e) => e.patronMovimiento === 'Traccion_V')).toBe(true);
  });

  it('does not offer Rack Delivery or biceps curls when swapping a vertical pull', () => {
    const source = catalog.find((ex) => ex.id === 'Wide-Grip_Lat_Pulldown')
      ?? catalog.find((ex) => ex.patronMovimiento === 'Traccion_V' && ex.parteCuerpo === 'Espalda');
    expect(source).toBeTruthy();

    const replacement = findEquivalentSwapReplacement(catalog, source, {
      excludeIds: ['Leverage_Chest_Press', 'Bent_Over_Two-Dumbbell_Row', 'Seated_Cable_Shoulder_Press'],
      unavailableEquipment: ['Polea Alta', 'Barra de Dominadas'],
      safetyProfile: { experienceLevel: 'Avanzado' },
      weekNumber: 1,
    });

    expect(replacement).toBeTruthy();
    expect(replacement.id).not.toBe('Rack_Delivery');
    expect(replacement.parteCuerpo).not.toBe('Bíceps');
    expect(replacement.dificultadTecnica).not.toBe('Alta');
  });

  it('never selects Rack Delivery or Gorilla Chin for Upper (Fuerza)', () => {
    const selected = selectExercises(
      'Upper (Fuerza)',
      catalog,
      { experienceLevel: 'Avanzado' },
      [],
      'Hipertrofia',
      {
        weekNumber: 1,
        sessionMuscles: ['Pecho', 'Espalda', 'Hombro'],
        unavailableEquipment: ['Polea Alta', 'Smith Machine', 'Banco Ajustable'],
      },
    );
    expect(selected.some((e) => e.id === 'Rack_Delivery')).toBe(false);
    expect(selected.some((e) => e.id === 'Gorilla_Chin_Crunch')).toBe(false);
  });
});

describe('continuity preferences helpers', () => {
  it('normalizes empty overrides', () => {
    expect(normalizeContinuityOverrides(null)).toEqual({});
    expect(normalizeContinuityOverrides({ a: 1 })).toEqual({ a: 1 });
  });

  it('reads session continuity map', () => {
    const overrides = setContinuityReplacement(
      {},
      'mc_1',
      'Upper (Fuerza)',
      'A',
      {
        id: 'B',
        nombre: 'B',
        patronMovimiento: 'Traccion_V',
        parteCuerpo: 'Espalda',
        prioridad: 2,
        equipo: [],
      },
    );
    expect(getSessionContinuityReplacements(overrides, 'mc_1', 'Upper (Fuerza)').A.exerciseId).toBe('B');
    expect(getSessionContinuityReplacements(overrides, 'mc_1', 'Lower (Fuerza)')).toEqual({});
    expect(getSessionContinuityReplacements(overrides, null, 'Upper (Fuerza)')).toEqual({});
  });

  it('leaves stubs unchanged when replacements map is empty', () => {
    const stubs = [{ id: 'A', patronMovimiento: 'Empuje_H' }];
    expect(applyContinuityReplacements(stubs, {})).toEqual(stubs);
    expect(applyContinuityReplacements(stubs, null)).toEqual(stubs);
  });

  it('applies same-pattern replacement and keeps muscle metadata', () => {
    const resolved = applyContinuityReplacements(
      [{ id: 'A', patronMovimiento: 'Empuje_H', parteCuerpo: 'Pecho', nombre: 'Old', prioridad: 1 }],
      {
        A: {
          exerciseId: 'B',
          nombre: 'New',
          patronMovimiento: 'Empuje_H',
          parteCuerpo: 'Pecho',
          prioridad: 2,
          equipo: ['Smith Machine'],
        },
      },
    );
    expect(resolved[0]).toMatchObject({
      id: 'B',
      nombre: 'New',
      patronMovimiento: 'Empuje_H',
      parteCuerpo: 'Pecho',
      prioridad: 2,
      swappedFromUser: 'A',
    });
    expect(resolved[0].equipo).toContain('Smith Machine');
  });
});
