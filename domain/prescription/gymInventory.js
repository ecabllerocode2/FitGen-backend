import { LOAD_CONVENTIONS } from './loadConvention.js';

/** Olympic bar — standard commercial gym assumption. */
export const OLYMPIC_BAR_KG = 20;

/**
 * Plates per side when the gym has no 1.25 kg micro-discs.
 * Per-side load is a multiple of 2.5 kg → total bar load advances in 5 kg steps.
 */
export const PLATES_PER_SIDE_KG = [2.5, 5, 10, 15, 20, 25];

/**
 * Typical fixed dumbbell rack (kg, per hand).
 * Light: 1 kg steps + 2.5 kg pair.
 * Heavy (≥12 kg): even numbers and 5 kg landmarks — no 12.5 / 17.5 / 22.5 pairs.
 */
export const DUMBBELL_PER_HAND_KG = buildDumbbellInventory();

/** Pin / selectorized stacks usually move in 5 kg steps. */
export const MACHINE_STACK_KG = buildMachineStackInventory();

function buildDumbbellInventory(maxKg = 50) {
  const weights = new Set([2.5]);
  for (let kg = 1; kg <= 10; kg += 1) weights.add(kg);
  for (let kg = 12; kg <= maxKg; kg += 2) weights.add(kg);
  for (let kg = 15; kg <= maxKg; kg += 10) weights.add(kg);
  return [...weights].sort((a, b) => a - b);
}

function buildMachineStackInventory(maxKg = 200) {
  const weights = [];
  for (let kg = 5; kg <= maxKg; kg += 5) weights.push(kg);
  return weights;
}

function buildBarbellTotals(maxKg = 260) {
  const totals = [];
  for (let total = OLYMPIC_BAR_KG; total <= maxKg; total += 5) totals.push(total);
  return totals;
}

function getAllowedWeights(convention) {
  switch (convention) {
    case LOAD_CONVENTIONS.DUMBBELL_PER_HAND:
    case LOAD_CONVENTIONS.UNILATERAL:
      return DUMBBELL_PER_HAND_KG;
    case LOAD_CONVENTIONS.MACHINE_STACK:
      return MACHINE_STACK_KG;
    case LOAD_CONVENTIONS.BARBELL_TOTAL:
    default:
      return buildBarbellTotals();
  }
}

/**
 * Snap a target load to the nearest available gym weight.
 * Prescriptions round down (conservative); exploratory suggestions round to nearest.
 * @param {number} weightKg
 * @param {string} convention
 * @param {{ direction?: 'down'|'up'|'nearest' }} [options]
 * @returns {number|null}
 */
export function snapToGymWeight(weightKg, convention, options = {}) {
  if (weightKg == null || Number.isNaN(weightKg) || weightKg <= 0) return null;

  const direction = options.direction ?? 'down';
  const allowed = getAllowedWeights(convention);
  if (!allowed.length) return Math.round(weightKg * 10) / 10;

  if (direction === 'down') {
    let best = allowed[0];
    for (const candidate of allowed) {
      if (candidate <= weightKg + 1e-9) best = candidate;
      else break;
    }
    return best;
  }

  if (direction === 'up') {
    for (const candidate of allowed) {
      if (candidate >= weightKg - 1e-9) return candidate;
    }
    return allowed[allowed.length - 1];
  }

  let nearest = allowed[0];
  let bestDistance = Math.abs(weightKg - nearest);
  for (const candidate of allowed) {
    const distance = Math.abs(weightKg - candidate);
    if (distance < bestDistance) {
      nearest = candidate;
      bestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Round prescribed load to gym-realistic inventory.
 * @param {number} targetWeight
 * @param {string} convention
 * @returns {{ weight: number, addRep: boolean }}
 */
export function snapPrescribedLoad(targetWeight, convention) {
  const weight = snapToGymWeight(targetWeight, convention, { direction: 'down' });
  const nextUp = snapToGymWeight(targetWeight, convention, { direction: 'up' });
  const gapDown = targetWeight - weight;
  const gapUp = nextUp - targetWeight;
  const addRep = gapDown > 0 && gapDown < gapUp;
  return { weight, addRep };
}

export function isGymRealisticWeight(weightKg, convention) {
  if (weightKg == null) return false;
  const allowed = getAllowedWeights(convention);
  return allowed.some((candidate) => Math.abs(candidate - weightKg) < 1e-9);
}
