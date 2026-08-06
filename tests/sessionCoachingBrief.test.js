import { describe, expect, it } from 'vitest';
import { buildSessionCoachingBrief } from '../domain/session/sessionCoachingBrief.js';

describe('buildSessionCoachingBrief', () => {
  it('puts deload coaching first during deload week', () => {
    const brief = buildSessionCoachingBrief({
      profile: { bodyCompositionGoal: 'Mantener' },
      sessionMuscles: ['Pecho'],
      mainBlock: [],
      weekPlan: { isDeload: true, phase: 'deload', rirObjetivo: 3 },
    });

    expect(brief.items[0]).toMatchObject({
      id: 'deload_week',
      type: 'strategy',
      title: 'Semana de descarga',
    });
    expect(brief.items[0].message).toMatch(/RIR ~3/);
    expect(brief.items[0].message.toLowerCase()).toMatch(/peso prescrito|fallo/);
    expect(brief.items.some((item) => item.id === 'body_goal')).toBe(true);
  });

  it('detects deload from phase alone when isDeload flag missing', () => {
    const brief = buildSessionCoachingBrief({
      profile: { bodyCompositionGoal: 'Mantener' },
      weekPlan: { phase: 'deload', rirObjetivo: 4 },
    });
    expect(brief.items[0].id).toBe('deload_week');
    expect(brief.items[0].message).toMatch(/RIR ~4/);
  });

  it('defaults deload RIR to 3 when rirObjetivo is missing', () => {
    const brief = buildSessionCoachingBrief({
      profile: {},
      weekPlan: { isDeload: true, phase: 'deload' },
    });
    expect(brief.items[0].message).toMatch(/RIR ~3/);
  });

  it('defaults deload RIR to 3 when rirObjetivo is NaN', () => {
    const brief = buildSessionCoachingBrief({
      profile: {},
      weekPlan: { isDeload: true, rirObjetivo: Number.NaN },
    });
    expect(brief.items[0].message).toMatch(/RIR ~3/);
  });

  it('omits deload coaching outside deload week', () => {
    const brief = buildSessionCoachingBrief({
      profile: { bodyCompositionGoal: 'Mantener' },
      sessionMuscles: ['Pecho'],
      mainBlock: [],
      weekPlan: { isDeload: false, phase: 'acumulacion', rirObjetivo: 2 },
    });

    expect(brief.items.some((item) => item.id === 'deload_week')).toBe(false);
    expect(brief.items[0].id).toBe('body_goal');
  });

  it('adds fat-loss RIR strategy outside deload', () => {
    const brief = buildSessionCoachingBrief({
      profile: { bodyCompositionGoal: 'Perder_Grasa' },
      weekPlan: { isDeload: false, phase: 'acumulacion', rirObjetivo: 2.5 },
    });
    expect(brief.items.some((item) => item.id === 'rir_strategy')).toBe(true);
    expect(brief.bodyCompositionGoal).toBe('Perder_Grasa');
  });

  it('includes priority coaching for emphasized muscles', () => {
    const brief = buildSessionCoachingBrief({
      profile: {
        bodyCompositionGoal: 'Ganar_Musculo',
        musclePriorities: [{ muscle: 'Pecho', intensity: 'strong' }],
      },
      sessionMuscles: ['Pecho'],
      mainBlock: [
        { muscleGroup: 'Pecho', emphasisTag: 'priority', exerciseName: 'Press banca' },
      ],
    });
    const priority = brief.items.find((item) => item.id === 'priority_Pecho');
    expect(priority).toBeTruthy();
    expect(priority.message).toMatch(/Press banca/);
    expect(priority.message).toMatch(/énfasis alto/);
  });

  it('includes focus-area coaching when no priorities', () => {
    const brief = buildSessionCoachingBrief({
      profile: { focusArea: 'Tren_Superior' },
      sessionMuscles: ['Pecho', 'Espalda'],
      mainBlock: [],
    });
    const focus = brief.items.find((item) => item.id === 'focus_area');
    expect(focus).toBeTruthy();
    expect(focus.title).toMatch(/Tren superior/i);
    expect(focus.message).toMatch(/Pecho/);
  });

  it('includes finisher coaching when present', () => {
    const brief = buildSessionCoachingBrief({
      profile: {},
      finisher: {
        included: true,
        durationMinutes: 10,
        exerciseName: 'Bici',
        intensityLabel: 'moderado',
        coachingTip: 'Mantén conversación.',
      },
    });
    const finisher = brief.items.find((item) => item.id === 'finisher');
    expect(finisher).toBeTruthy();
    expect(finisher.message).toMatch(/10 min/);
    expect(finisher.message).toMatch(/Bici/);
  });
});
