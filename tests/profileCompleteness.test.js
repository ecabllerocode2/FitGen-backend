import { describe, it, expect } from 'vitest';
import {
  isPersonalProfileComplete,
  isTrainingProfileComplete,
  buildProfileCompleteness,
} from '../domain/coach/profileCompleteness.js';

describe('profileCompleteness', () => {
  const personal = {
    name: 'Ana',
    age: 28,
    gender: 'F',
    heightCm: 165,
    currentWeightKg: 62,
  };

  const training = {
    fitnessGoal: 'Hipertrofia',
    trainingAgeMonths: 18,
    trainingDaysPerWeek: 4,
    weeklyScheduleContext: [
      { day: 'Lunes', canTrain: true },
      { day: 'Martes', canTrain: false },
      { day: 'Miércoles', canTrain: true },
      { day: 'Jueves', canTrain: false },
      { day: 'Viernes', canTrain: true },
      { day: 'Sábado', canTrain: true },
    ],
  };

  it('detects personal profile complete', () => {
    expect(isPersonalProfileComplete(personal)).toBe(true);
    expect(isPersonalProfileComplete({ ...personal, name: '' })).toBe(false);
  });

  it('detects training profile complete', () => {
    expect(isTrainingProfileComplete(training)).toBe(true);
    expect(isTrainingProfileComplete({ ...training, trainingDaysPerWeek: 1 })).toBe(false);
  });

  it('builds hybrid completeness flags', () => {
    expect(buildProfileCompleteness({ ...personal })).toEqual({
      personal: true,
      training: false,
      readyForMesocycle: false,
    });
    expect(buildProfileCompleteness({ ...personal, ...training })).toEqual({
      personal: true,
      training: true,
      readyForMesocycle: true,
    });
  });
});
