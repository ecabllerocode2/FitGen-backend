/**
 * Shared filters/ranking helpers for swap replacement (kept separate so mutation
 * testing can target the public selection algorithm without helper noise).
 */
import { isExerciseBlocked } from '../athlete/exercisePreferences.js';
import { passesBodyweightLoadFilter } from './bodyweight.js';
import { passesGymEquipmentFilter } from './equipmentFilters.js';
import { stimulusSelectionScore } from './stimulusCoverage.js';

export const AUTO_SELECT_EXCLUDE = new Set([
  'Clean_Shrug',
  'Clock_Push-Up',
  'Single-Arm_Push-Up',
  'handstand_push-ups',
  'Plyo_Kettlebell_Pushups',
  'Incline_Push-Up_Depth_Jump',
  'kettlebell_pistol_squat',
  'Overhead_Squat',
  'Snatch',
  'Clean_and_Jerk',
  'Alternating_Renegade_Row',
  'Barbell_Guillotine_Bench_Press',
  'Kneeling_Jump_Squat',
  'One-Arm_Kettlebell_Snatch',
  'One-Arm_Kettlebell_Clean',
  'Muscle_Snatch',
  'Spider_Crawl',
  'Push_Up_to_Side_Plank',
  'One-Arm_Kettlebell_Swings',
  'Deficit_Deadlift',
  'Gironda_Sternum_Chins',
  'Box_Squat_with_Chains',
  'Reverse_Band_Bench_Press',
  'Pin_Presses',
  'Bent_Press',
  'Kettlebell_Turkish_Get-Up_Lunge_style',
  'Upright_Row_-_With_Bands',
  'Dumbbell_One-Arm_Upright_Row',
  'Dumbbell_Raise',
  'Single_Dumbbell_Raise',
  'Upright_Barbell_Row',
  'Upright_Cable_Row',
  'one_arm_pronated_dumbbell_triceps_extension',
  'one_arm_supinated_dumbbell_triceps_extension',
  'Dumbbell_One-Arm_Triceps_Extension',
  'Rack_Delivery',
  'Gorilla_Chin_Crunch',
]);

/** Isolation muscles — must not replace compound pulls/pushes via pattern-only fallback. */
export const ISOLATION_SWAP_MUSCLES = new Set(['Bíceps', 'Tríceps', 'Pantorrillas', 'Core']);

export function isGymExercise(exercise) {
  const block = exercise.categoriaBloque;
  return block === 'main_block' || block === 'core';
}

export function difficultyRank(exercise) {
  const d = (exercise.dificultadTecnica ?? '').toLowerCase();
  if (d === 'baja') return 0;
  if (d === 'media') return 1;
  if (d === 'alta') return 2;
  return 1;
}

export function passesExperienceExerciseFilter(exercise, safetyProfile) {
  const level = safetyProfile?.experienceLevel ?? 'Intermedio';
  if (level === 'Novato' || level === 'Principiante') {
    const d = (exercise.dificultadTecnica ?? '').toLowerCase();
    if (d === 'alta') return false;
  }
  return true;
}

export function passesMainstreamExerciseFilter(exercise) {
  return exercise.mainstream !== false;
}

export function passesDifficultyFilter(exercise) {
  // Align with auto-select: never offer Alta / unset technical difficulty in swaps.
  return Boolean(exercise.dificultadTecnica) && exercise.dificultadTecnica !== 'Alta';
}

export function isCompatibleSwapMuscle(sourceMuscle, candidateMuscle) {
  if (!sourceMuscle || !candidateMuscle) return true;
  if (sourceMuscle === candidateMuscle) return true;
  if (!ISOLATION_SWAP_MUSCLES.has(sourceMuscle) && ISOLATION_SWAP_MUSCLES.has(candidateMuscle)) {
    return false;
  }
  return true;
}

export function passesConservativeFilter(exercise, safetyProfile, weekNumber) {
  const name = (exercise.nombre ?? exercise.exerciseName ?? '').toLowerCase();
  if (safetyProfile?.conservative) {
    if (/fondos|parallel bar|bar dip|\bdip\b/i.test(name)) return false;
  }
  void weekNumber;
  return true;
}

export function sourceFields(source) {
  return {
    id: source.id ?? source.exerciseId,
    patronMovimiento: source.patronMovimiento ?? source.movementPattern,
    parteCuerpo: source.parteCuerpo ?? source.muscleGroup,
  };
}

export function rankCandidate(selectedStub, a, b) {
  return (
    stimulusSelectionScore(selectedStub, a) - stimulusSelectionScore(selectedStub, b) ||
    (a.prioridad ?? 3) - (b.prioridad ?? 3) ||
    difficultyRank(a) - difficultyRank(b) ||
    String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''))
  );
}

export function isSwapCandidateEligible(candidate, context) {
  const {
    excludeSet,
    blockFilters,
    selectedStub,
    safetyProfile,
    weekNumber,
  } = context;
  return Boolean(
    candidate?.id &&
      !excludeSet.has(candidate.id) &&
      !AUTO_SELECT_EXCLUDE.has(candidate.id) &&
      isGymExercise(candidate) &&
      passesGymEquipmentFilter(candidate) &&
      !isExerciseBlocked(candidate, blockFilters) &&
      passesBodyweightLoadFilter(candidate, selectedStub) &&
      passesConservativeFilter(candidate, safetyProfile, weekNumber) &&
      passesExperienceExerciseFilter(candidate, safetyProfile) &&
      passesMainstreamExerciseFilter(candidate) &&
      passesDifficultyFilter(candidate),
  );
}
