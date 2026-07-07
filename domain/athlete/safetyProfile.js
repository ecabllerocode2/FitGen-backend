import { INJURY_MOVEMENT_MAP } from '../constants.js';

/**
 * DDS 8.1 — build safety profile from athlete profile.
 * @param {object} profile
 * @param {number} [profile.age]
 * @param {number} [profile.heightCm]
 * @param {number} [profile.currentWeightKg]
 * @param {string[]} [profile.injuriesOrLimitations]
 * @returns {{ avoidPatterns: string[], modifyPatterns: string[], conservative: boolean, prehab: string[], messages: string[] }}
 */
export function buildSafetyProfile(profile) {
  const avoidPatterns = new Set();
  const modifyPatterns = new Set();
  const prehab = new Set();
  const messages = [];

  const injuries = profile.injuriesOrLimitations ?? [];

  for (const injury of injuries) {
    const mapping = INJURY_MOVEMENT_MAP[injury];
    if (!mapping) continue;
    mapping.avoidPatterns?.forEach((p) => avoidPatterns.add(p));
    mapping.modifyPatterns?.forEach((p) => modifyPatterns.add(p));
    mapping.prehab?.forEach((p) => prehab.add(p));
    messages.push(`Restricción activa por lesión/limitación: ${injury}`);
  }

  const bmi = calculateBMI(profile.heightCm, profile.currentWeightKg);
  const conservative =
    (profile.age ?? 0) >= 50 || (bmi !== null && bmi >= 30);

  if (conservative) {
    messages.push(
      'Protocolo conservador activo: preferencia por máquinas y cargas moderadas en semanas iniciales del mesociclo.',
    );
  }

  return {
    avoidPatterns: [...avoidPatterns],
    modifyPatterns: [...modifyPatterns],
    conservative,
    prehab: [...prehab],
    messages,
  };
}

/**
 * @param {number} heightCm
 * @param {number} weightKg
 * @returns {number|null}
 */
function calculateBMI(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}
