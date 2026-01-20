/**
 * Utilities to enumerate possible values for the ProfileOnboarding form (except equipment)
 * and to generate many profile variants for testing mesocycle generation quality.
 *
 * Usage examples:
 *  - import { PROFILE_OPTION_VALUES, generateProfiles, SAMPLE_PROFILES } from './test/profile-options';
 *  - const gen = generateProfiles({ limit: 100 });
 *  - for (const p of gen) { (send to backend or save as Firestore doc) }
 */

// Local type definitions (fallback when ../types/session is not available)
// These mirror the shapes expected by this module and keep the file self-contained.
type DayOfWeek = 'Lunes' | 'Martes' | 'Miércoles' | 'Jueves' | 'Viernes' | 'Sábado' | 'Domingo';

type ExternalLoad = 'none' | 'light' | 'moderate' | 'heavy';

type ExperienceLevel = 'Principiante' | 'Intermedio' | 'Avanzado';

type FocusArea = 'General' | 'Tren_Superior' | 'Tren_Inferior' | 'Core';

type InjuryType =
  | 'Ninguna'
  | 'Hombro'
  | 'Rodilla'
  | 'Espalda Baja'
  | 'Muñeca'
  | 'Cuello'
  | 'Cadera'
  | 'Tobillo'
  | 'Codo';

type Gender = 'Masculino' | 'Femenino' | 'Otro';

type FitnessGoal = 'Hipertrofia' | 'Fuerza' | 'Resistencia' | 'Perdida_Grasa';

type DayContext = {
  day: DayOfWeek;
  canTrain: boolean;
  externalLoad: ExternalLoad;
};

interface ProfileData {
  name: string;
  age: number;
  gender: Gender;
  heightCm: number;
  initialWeight: number;
  experienceLevel: ExperienceLevel;
  fitnessGoal: FitnessGoal;
  focusArea: FocusArea;
  trainingDaysPerWeek: number;
  preferredTrainingDays: DayOfWeek[];
  weeklyScheduleContext: DayContext[];
  hasHomeEquipment: boolean;
  dateCompleted: string;
  injuriesOrLimitations: InjuryType;
}

export const DAYS_ORDER: DayOfWeek[] = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const PROFILE_OPTION_VALUES = {
  genders: ['Masculino', 'Femenino', 'Otro'] as Gender[],
  ageRange: { min: 15, max: 100 },
  sampleAges: [16, 18, 21, 25, 31, 40, 55, 70],
  heightCm: { min: 120, max: 250 },
  sampleHeights: [150, 160, 170, 175, 180, 190],
  initialWeight: { min: 30, max: 300 },
  sampleWeights: [55, 65, 75, 85, 95, 110],
  fitnessGoals: ['Hipertrofia', 'Fuerza', 'Resistencia', 'Perdida_Grasa'] as FitnessGoal[],
  experienceLevels: ['Principiante', 'Intermedio', 'Avanzado'] as ExperienceLevel[],
  focusAreas: ['General', 'Tren_Superior', 'Tren_Inferior', 'Core'] as FocusArea[],
  injuries: [
    'Ninguna',
    'Hombro',
    'Rodilla',
    'Espalda Baja',
    'Muñeca',
    'Cuello',
    'Cadera',
    'Tobillo',
    'Codo'
  ] as InjuryType[],
  trainingDaysPerWeek: [2, 3, 4, 5, 6] as number[],
  externalLoads: ['none', 'light', 'moderate', 'heavy'] as ExternalLoad[],
  daysOrder: DAYS_ORDER
};

// Utility: generate all combinations (n choose k) of day names for preferredTrainingDays
export function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k <= 0) {
    yield [];
    return;
  }
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

// Build a weekly schedule (DayContext[]) from a list of preferred training days and an external-load strategy
export function buildWeeklySchedule(
  preferredDays: DayOfWeek[],
  externalLoadStrategy: 'all_none' | 'weekend_heavy' | 'alternate' | 'random' = 'all_none',
  seed = 1
) {
  const schedule = DAYS_ORDER.map(day => ({ day, canTrain: preferredDays.includes(day), externalLoad: 'none' as ExternalLoad }));

  const loads = PROFILE_OPTION_VALUES.externalLoads;

  if (externalLoadStrategy === 'all_none') {
    // leave as 'none'
  } else if (externalLoadStrategy === 'weekend_heavy') {
    schedule.forEach(s => {
      if (s.day === 'Sábado' || s.day === 'Domingo') s.externalLoad = 'heavy';
      else if (!s.canTrain) s.externalLoad = 'light';
    });
  } else if (externalLoadStrategy === 'alternate') {
    let toggle = !!(seed % 2);
    schedule.forEach(s => {
      s.externalLoad = toggle ? 'moderate' : 'light';
      toggle = !toggle;
    });
  } else if (externalLoadStrategy === 'random') {
    let r = seed;
    schedule.forEach(s => {
      r = (1103515245 * r + 12345) % 2147483648; // simple LCG
      s.externalLoad = loads[r % loads.length];
    });
  }

  return schedule as ProfileData['weeklyScheduleContext'];
}

// Normalize preferredTrainingDays to an ordered list and ensure length matches trainingDaysPerWeek
export function preferredDaysFromCount(count: number, slot = 0): DayOfWeek[] {
  // Simple heuristic strategies to spread days across the week for different counts
  const patterns: Record<number, DayOfWeek[][]> = {
    2: [['Lunes', 'Jueves'], ['Martes', 'Viernes'], ['Miércoles', 'Sábado']],
    3: [['Lunes', 'Miércoles', 'Viernes'], ['Martes', 'Jueves', 'Sábado']],
    4: [['Lunes', 'Martes', 'Jueves', 'Viernes'], ['Lunes', 'Miércoles', 'Jueves', 'Sábado']],
    5: [['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']],
    6: [['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']]
  };
  const opts = patterns[count] || [DAYS_ORDER.slice(0, count)];
  return opts[slot % opts.length];
}

// Profile generator: iterate combinations of categorical fields and produce profiles. Limit to `limit`.
export function* generateProfiles({ limit = 500, randomize = false } = {}) {
  const genders = PROFILE_OPTION_VALUES.genders;
  const goals = PROFILE_OPTION_VALUES.fitnessGoals;
  const experienceLevels = PROFILE_OPTION_VALUES.experienceLevels;
  const focusAreas = PROFILE_OPTION_VALUES.focusAreas;
  const injuries = PROFILE_OPTION_VALUES.injuries;
  const dayCounts = PROFILE_OPTION_VALUES.trainingDaysPerWeek;

  let count = 0;

  // Randomized mode: generate `limit` random profiles (may contain duplicates)
  if (randomize) {
    const strategies: Array<'all_none' | 'weekend_heavy' | 'alternate' | 'random'> = [
      'all_none',
      'weekend_heavy',
      'alternate',
      'random'
    ];

    while (count < limit) {
      const gender = genders[Math.floor(Math.random() * genders.length)];
      const goal = goals[Math.floor(Math.random() * goals.length)];
      const exp = experienceLevels[Math.floor(Math.random() * experienceLevels.length)];
      const focus = focusAreas[Math.floor(Math.random() * focusAreas.length)];
      const inj = injuries[Math.floor(Math.random() * injuries.length)];
      const days = dayCounts[Math.floor(Math.random() * dayCounts.length)];
      const slot = Math.floor(Math.random() * Math.max(1, days));
      const preferred = preferredDaysFromCount(days, slot);
      const strategy = strategies[Math.floor(Math.random() * strategies.length)];
      const weekly = buildWeeklySchedule(preferred, strategy, days);

      const profile: ProfileData = {
        name: `Rand ${count} ${String(gender)} ${String(goal)}`,
        age: PROFILE_OPTION_VALUES.sampleAges[Math.floor(Math.random() * PROFILE_OPTION_VALUES.sampleAges.length)],
        gender,
        heightCm: PROFILE_OPTION_VALUES.sampleHeights[Math.floor(Math.random() * PROFILE_OPTION_VALUES.sampleHeights.length)],
        initialWeight: PROFILE_OPTION_VALUES.sampleWeights[Math.floor(Math.random() * PROFILE_OPTION_VALUES.sampleWeights.length)],
        experienceLevel: exp,
        fitnessGoal: goal,
        focusArea: focus,
        trainingDaysPerWeek: days,
        preferredTrainingDays: preferred,
        weeklyScheduleContext: weekly,
        hasHomeEquipment: false,
        dateCompleted: new Date().toISOString(),
        injuriesOrLimitations: inj
      };

      yield profile;
      count++;
    }

    return;
  }

  // Deterministic exhaustive mode (original behavior)
  for (const gender of genders) {
    for (const goal of goals) {
      for (const exp of experienceLevels) {
        for (const focus of focusAreas) {
          for (const inj of injuries) {
            for (const days of dayCounts) {
              const preferred = preferredDaysFromCount(days);
              const weekly = buildWeeklySchedule(preferred, 'weekend_heavy', days);

              const profile: ProfileData = {
                name: `Test ${gender} ${goal} ${exp}`,
                age: PROFILE_OPTION_VALUES.sampleAges[Math.floor(Math.random() * PROFILE_OPTION_VALUES.sampleAges.length)],
                gender,
                heightCm: PROFILE_OPTION_VALUES.sampleHeights[Math.floor(Math.random() * PROFILE_OPTION_VALUES.sampleHeights.length)],
                initialWeight: PROFILE_OPTION_VALUES.sampleWeights[Math.floor(Math.random() * PROFILE_OPTION_VALUES.sampleWeights.length)],
                experienceLevel: exp,
                fitnessGoal: goal,
                focusArea: focus,
                trainingDaysPerWeek: days,
                preferredTrainingDays: preferred,
                weeklyScheduleContext: weekly,
                hasHomeEquipment: false, // excluded from permutations but required by type
                dateCompleted: new Date().toISOString(),
                injuriesOrLimitations: inj
              };

              yield profile;
              count++;
              if (count >= limit) return;
            }
          }
        }
      }
    }
  }
}

// Small sample set for quick tests
export const SAMPLE_PROFILES: ProfileData[] = [];
{
  const gen = generateProfiles({ limit: 12 });
  for (const p of gen) SAMPLE_PROFILES.push(p);
}

export default {
  PROFILE_OPTION_VALUES,
  buildWeeklySchedule,
  preferredDaysFromCount,
  generateProfiles,
  SAMPLE_PROFILES
};
