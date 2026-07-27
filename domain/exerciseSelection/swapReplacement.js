/**
 * Find a like-for-like exercise replacement for user/coach swaps.
 * Prefer same pattern + muscle, then same pattern, then same muscle.
 */
import { hasDistinctStimulusForMuscle } from './stimulusCoverage.js';
import {
  isSwapCandidateEligible,
  rankCandidate,
  sourceFields,
} from './swapReplacementSupport.js';

/**
 * @param {object[]} catalog
 * @param {object} sourceExercise
 * @param {object} [options]
 * @returns {object|null}
 */
export function findEquivalentSwapReplacement(catalog, sourceExercise, options = {}) {
  const {
    excludeIds = [],
    unavailableEquipment = [],
    safetyProfile = {},
    weekNumber = 1,
  } = options;

  if (!sourceExercise || !Array.isArray(catalog)) return null;

  const source = sourceFields(sourceExercise);
  if (!source.id) return null;

  const excludeSet = new Set(excludeIds.filter(Boolean));
  excludeSet.add(source.id);
  const blockFilters = { excludeIds: [...excludeSet], unavailableEquipment };
  const selectedStub = [
    {
      id: source.id,
      patronMovimiento: source.patronMovimiento,
      parteCuerpo: source.parteCuerpo,
      nombre: sourceExercise.nombre ?? sourceExercise.exerciseName,
    },
  ];
  const eligibility = {
    excludeSet,
    blockFilters,
    selectedStub,
    safetyProfile,
    weekNumber,
  };

  const pick = (predicate) => {
    const candidates = catalog
      .filter((candidate) => isSwapCandidateEligible(candidate, eligibility))
      .filter(predicate)
      .sort((a, b) => rankCandidate(selectedStub, a, b));
    return candidates[0] ?? null;
  };

  const samePatternAndMuscle = pick(
    (c) =>
      c.patronMovimiento === source.patronMovimiento &&
      c.parteCuerpo === source.parteCuerpo &&
      hasDistinctStimulusForMuscle(selectedStub, c),
  );
  if (samePatternAndMuscle) return samePatternAndMuscle;

  const samePattern = pick(
    (c) =>
      c.patronMovimiento === source.patronMovimiento &&
      hasDistinctStimulusForMuscle(selectedStub, c),
  );
  if (samePattern) return samePattern;

  const samePatternLoose = pick((c) => c.patronMovimiento === source.patronMovimiento);
  if (samePatternLoose) return samePatternLoose;

  const sameMuscle = pick((c) => c.parteCuerpo === source.parteCuerpo);
  if (sameMuscle) return sameMuscle;

  return null;
}
