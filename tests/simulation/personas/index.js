/** Deterministic athlete personas for simulation (seeded behavior) */

function defaultReadiness() {
  return {
    energyLevel: 3,
    sorenessLevel: 2,
    sleepQuality: 3,
    stressLevel: 3,
  };
}

function completeWithVariance(session, readiness, variance = 0) {
  const mainBlock = (session.mainBlock ?? []).map((ex) => ({
    ...ex,
    actualWeightKg: ex.prescribedLoadKg ?? 40,
    actualReps: 10,
    actualRIR: Math.max(0, ex.rirTarget + variance),
    sets: Array.from({ length: ex.sets }, (_, i) => ({
      setNumber: i + 1,
      reps: 10,
      load: ex.prescribedLoadKg ?? 40,
      rir: Math.max(0, ex.rirTarget + variance),
      completed: true,
    })),
  }));

  return {
    ...session,
    completed: true,
    mainBlock,
    sessionFeedback: {
      pumpQuality: 3,
      sorenessTiming: 'sanó a tiempo',
      jointPain: false,
      perceivedWorkload: 3,
    },
    readinessPreSession: readiness,
  };
}

export const PERSONAS = [
  {
    id: 'novato_constante',
    profile: { trainingAgeMonths: 3, fitnessGoal: 'Hipertrofia' },
    startDate: '2026-01-06T12:00:00Z',
    getReadiness: () => defaultReadiness(),
    completeSession: (s, r) => completeWithVariance(s, r, 0),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'intermedio_recuperacion',
    profile: { trainingAgeMonths: 18, fitnessGoal: 'Hipertrofia' },
    startDate: '2026-02-03T12:00:00Z',
    getReadiness: () => ({ ...defaultReadiness(), energyLevel: 4, sleepQuality: 4 }),
    completeSession: (s, r) => completeWithVariance(s, r, -0.5),
    getCycleEvaluation: () => ({ generalDifficulty: 2, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'avanzado_fatiga',
    profile: { trainingAgeMonths: 36, fitnessGoal: 'Fuerza' },
    startDate: '2026-03-03T12:00:00Z',
    getReadiness: ({ weekNumber }) => ({
      energyLevel: weekNumber >= 3 ? 2 : 3,
      sorenessLevel: weekNumber >= 3 ? 4 : 2,
      sleepQuality: 2,
      stressLevel: 4,
    }),
    completeSession: (s, r) => completeWithVariance(s, r, 1),
    getCycleEvaluation: () => ({ generalDifficulty: 4, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'shoulder_pain',
    profile: { trainingAgeMonths: 24, fitnessGoal: 'Hipertrofia', injuriesOrLimitations: ['Hombro'] },
    startDate: '2026-01-13T12:00:00Z',
    getReadiness: () => defaultReadiness(),
    completeSession: (s, r) => completeWithVariance(s, r, 0),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: true, changeGoal: false }),
  },
  {
    id: 'rir_miss',
    profile: { trainingAgeMonths: 12, fitnessGoal: 'Hipertrofia' },
    startDate: '2026-01-20T12:00:00Z',
    getReadiness: () => defaultReadiness(),
    completeSession: (s, r) => completeWithVariance(s, r, 2),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
  {
    id: 'adherencia_irregular',
    profile: { trainingAgeMonths: 18, fitnessGoal: 'Hipertrofia' },
    startDate: '2026-02-10T12:00:00Z',
    getReadiness: ({ day }) => (day % 3 === 0 ? { energyLevel: 1, sorenessLevel: 4, sleepQuality: 2, stressLevel: 4 } : defaultReadiness()),
    completeSession: (s, r) => completeWithVariance(s, r, 0),
    getCycleEvaluation: () => ({ generalDifficulty: 3, persistentJointPain: false, changeGoal: false }),
  },
];
