import { describe, it, expect } from 'vitest';
import {
  addExerciseExclusion,
  isExerciseBlocked,
  restoreExerciseExclusion,
  resolveExclusionFilters,
} from '../domain/athlete/exercisePreferences.js';
import { generateWarmup, replaceWarmupExercise } from '../domain/session/rampGenerator.js';

describe('exercise preferences', () => {
  it('blocks exercises by id and equipment tag', () => {
    const prefs = addExerciseExclusion(
      { excluded: [], unavailableEquipment: [] },
      {
        exerciseId: 'Stair_Climber',
        nombre: 'Escaladora',
        equipmentTags: ['Escaladora'],
      },
      true,
    );
    const filters = resolveExclusionFilters(prefs);
    expect(isExerciseBlocked({ id: 'Stair_Climber' }, filters)).toBe(true);
    expect(isExerciseBlocked({ id: 'Other', equipo: ['Escaladora'] }, filters)).toBe(true);
    expect(isExerciseBlocked({ id: 'Arm_Circles', equipo: ['Peso Corporal'] }, filters)).toBe(false);
  });

  it('restores exercise and equipment exclusions', () => {
    const prefs = addExerciseExclusion(
      { excluded: [], unavailableEquipment: [] },
      { exerciseId: 'Squats_-_With_Bands', nombre: 'Sentadilla con banda', equipmentTags: ['Bandas de Resistencia'] },
      true,
    );
    const restored = restoreExerciseExclusion(prefs, { exerciseId: 'Squats_-_With_Bands' });
    expect(restored.excluded).toHaveLength(0);
    expect(restored.unavailableEquipment).not.toContain('Bandas de Resistencia');
  });
});

describe('warmup exclusions', () => {
  const catalog = [
    {
      id: 'Stair_Climber',
      nombre: 'Escaladora',
      faseRAMP: 'Raise',
      patronMovimiento: 'General',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Escaladora'],
      isDynamic: true,
    },
    {
      id: 'Fast_Skipping',
      nombre: 'Skipping rápido',
      faseRAMP: 'Raise',
      patronMovimiento: 'Rodilla',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Peso Corporal'],
      isDynamic: true,
    },
    {
      id: 'Monster_Walk',
      nombre: 'Caminata de Monstruo',
      faseRAMP: 'Activate',
      patronMovimiento: 'Cadera',
      parteCuerpo: 'Glúteos',
      equipo: ['Bandas de Resistencia'],
      isDynamic: true,
    },
    {
      id: 'Knee_Circles',
      nombre: 'Círculos de Rodilla',
      faseRAMP: 'Mobilize',
      patronMovimiento: 'Rodilla',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Peso Corporal'],
      isDynamic: true,
    },
    {
      id: 'Squats_-_With_Bands',
      nombre: 'Sentadilla con Bandas',
      faseRAMP: 'Potentiate',
      patronMovimiento: 'Rodilla',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Bandas de Resistencia'],
      isDynamic: true,
    },
  ];

  it('skips unavailable equipment in future warmups', () => {
    const warmup = generateWarmup(['Rodilla', 'Cadera'], catalog, {
      sessionFocus: 'Legs',
      sessionMuscles: ['Cuádriceps', 'Glúteos'],
      unavailableEquipment: ['Escaladora'],
    });
    const names = warmup.map((w) => w.name);
    expect(names).not.toContain('Escaladora');
  });

  it('replaces a warmup item in the same phase', () => {
    const initial = generateWarmup(['Rodilla'], catalog, { sessionFocus: 'Legs' });
    const stair = initial.find((w) => w.exerciseId === 'Stair_Climber' || w.name?.includes('Escaladora'));
    if (!stair) return;
    const result = replaceWarmupExercise(initial, stair.exerciseId, catalog, {
      patterns: ['Rodilla'],
      sessionMuscles: ['Cuádriceps'],
      sessionFocus: 'Legs',
      excludeIds: [stair.exerciseId],
      unavailableEquipment: ['Escaladora'],
    });
    expect(result).not.toBeNull();
    expect(result.replacement.phase).toBe(stair.phase);
    expect(result.warmup.length).toBe(initial.length);
  });
});
