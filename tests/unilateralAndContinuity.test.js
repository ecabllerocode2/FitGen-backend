import { describe, expect, it } from 'vitest';
import { generateWarmup } from '../domain/session/rampGenerator.js';
import {
  applyContinuityReplacements,
  setContinuityReplacement,
} from '../domain/athlete/continuityPreferences.js';

describe('unilateral warmup dosing', () => {
  const catalog = [
    {
      id: 'External_Rotation_with_Cable',
      nombre: 'Rotación externa con polea',
      descripcion: 'Rote el brazo hacia afuera.',
      faseRAMP: 'Activate',
      patronMovimiento: 'General',
      parteCuerpo: 'Hombro',
      equipo: ['Poleas'],
      isUnilateral: true,
      isDynamic: true,
    },
    {
      id: 'Arm_Circles',
      nombre: 'Círculos de brazos',
      faseRAMP: 'Mobilize',
      patronMovimiento: 'General',
      parteCuerpo: 'Hombro',
      equipo: ['Peso Corporal'],
      isUnilateral: false,
      isDynamic: true,
    },
    {
      id: 'Fast_Skipping',
      nombre: 'Skipping rápido',
      faseRAMP: 'Raise',
      patronMovimiento: 'General',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Peso Corporal'],
      isUnilateral: true,
      isDynamic: true,
    },
    {
      id: 'Bodyweight_Squat',
      nombre: 'Sentadilla peso corporal',
      faseRAMP: 'Potentiate',
      patronMovimiento: 'Rodilla',
      parteCuerpo: 'Cuádriceps',
      equipo: ['Peso Corporal'],
      isUnilateral: false,
      isDynamic: true,
    },
  ];

  it('doubles time and adds bilateral cue for unilateral activate work', () => {
    const warmup = generateWarmup(['Empuje_H'], catalog, {
      sessionFocus: 'Upper (Fuerza)',
      goal: 'Fuerza',
      weekNumber: 1,
    });
    const rotation = warmup.find((w) => w.exerciseId === 'External_Rotation_with_Cable');
    expect(rotation).toBeTruthy();
    expect(rotation.isUnilateral).toBe(true);
    expect(rotation.durationSeconds).toBeGreaterThanOrEqual(80);
    expect(rotation.reps).toMatch(/por lado/i);
    expect(rotation.unilateralCue).toMatch(/brazo|lado/i);
  });

  it('does not treat raise cardio as unilateral even if catalog flag is wrong', () => {
    const warmup = generateWarmup(['Empuje_H'], catalog, {
      sessionFocus: 'Upper (Fuerza)',
      goal: 'Fuerza',
      weekNumber: 1,
    });
    const raise = warmup.find((w) => w.phase === 'Raise' || w.faseRAMP === 'Raise');
    if (raise?.exerciseId === 'Fast_Skipping') {
      expect(raise.isUnilateral).toBe(false);
      expect(raise.unilateralCue).toBeFalsy();
    }
  });
});

describe('continuity preferences', () => {
  it('stores continuity replacement metadata', () => {
    const next = setContinuityReplacement(
      {},
      'mc_1',
      'Upper (Fuerza)',
      'Underhand_Cable_Pulldowns',
      {
        id: 'Wide_Grip_Lat_Pulldown',
        nombre: 'Jalón agarre ancho',
        patronMovimiento: 'Traccion_V',
        parteCuerpo: 'Espalda',
        prioridad: 1,
        equipo: ['Polea Alta'],
      },
    );
    expect(next.mc_1['Upper (Fuerza)'].Underhand_Cable_Pulldowns.exerciseId).toBe(
      'Wide_Grip_Lat_Pulldown',
    );
  });

  it('applies same-pattern continuity replacements', () => {
    const resolved = applyContinuityReplacements(
      [
        {
          id: 'Underhand_Cable_Pulldowns',
          patronMovimiento: 'Traccion_V',
          parteCuerpo: 'Espalda',
          nombre: 'Jalón',
        },
      ],
      {
        Underhand_Cable_Pulldowns: {
          exerciseId: 'Wide_Grip_Lat_Pulldown',
          patronMovimiento: 'Traccion_V',
          parteCuerpo: 'Espalda',
          nombre: 'Jalón ancho',
        },
      },
    );
    expect(resolved[0].id).toBe('Wide_Grip_Lat_Pulldown');
    expect(resolved[0].swappedFromUser).toBe('Underhand_Cable_Pulldowns');
  });
});
