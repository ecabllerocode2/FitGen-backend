import { describe, expect, it } from 'vitest';
import { generateCooldown } from '../domain/session/cooldownGenerator.js';

describe('cooldown unilateral dosing', () => {
  const catalog = [
    {
      id: 'Standing_Quad_Stretch',
      nombre: 'Estiramiento cuádriceps de pie',
      parteCuerpo: 'Cuádriceps',
      isUnilateral: true,
    },
    {
      id: 'Child_Pose',
      nombre: 'Postura del niño',
      parteCuerpo: 'General',
      isUnilateral: false,
    },
  ];

  it('doubles duration and exposes per-side timing for unilateral cooldown', () => {
    const cooldown = generateCooldown(catalog, ['Cuádriceps']);
    const stretch = cooldown.find((c) => c.exerciseId === 'Standing_Quad_Stretch');
    expect(stretch).toBeTruthy();
    expect(stretch.isUnilateral).toBe(true);
    expect(stretch.perSideSeconds).toBe(45);
    expect(stretch.durationSeconds).toBe(90);
    expect(stretch.sideSwitchRestSeconds).toBe(5);
    expect(stretch.unilateralCue).toMatch(/lado/i);
  });

  it('keeps bilateral cooldown at 45s without per-side fields', () => {
    const cooldown = generateCooldown(catalog, ['General']);
    const pose = cooldown.find((c) => c.exerciseId === 'Child_Pose');
    expect(pose).toBeTruthy();
    expect(pose.isUnilateral).toBe(false);
    expect(pose.durationSeconds).toBe(45);
    expect(pose.perSideSeconds).toBeNull();
  });
});
