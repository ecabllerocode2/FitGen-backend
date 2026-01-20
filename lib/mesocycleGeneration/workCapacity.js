import { Experience, LegacyLoad } from './constants.js';

/**
 * Calcula el estrés sistémico total basado en la carga externa semanal.
 * @param {Array} weeklySchedule - Array de objetos { day, externalLoad }
 * @returns {number} TotalStressScore
 */
export function calculateSystemicStress(weeklySchedule) {
    if (!weeklySchedule || !Array.isArray(weeklySchedule)) return 0;

    let totalStressScore = 0;

    weeklySchedule.forEach(day => {
        const load = day.externalLoad ? day.externalLoad.toLowerCase() : 'none';
        const score = LegacyLoad[load] || 0;
        
        // Mapping based on pseudocode weights
        // HIGH (3/4) -> 3
        // MEDIUM (2) -> 2
        // LOW (1) -> 1
        // NONE (0) -> 0
        
        if (score >= 3) totalStressScore += 3;
        else if (score === 2) totalStressScore += 2;
        else if (score === 1) totalStressScore += 1;
        else totalStressScore += 0;
    });

    return totalStressScore;
}

/**
 * Determina el volumen de referencia (Series por grupo muscular por semana)
 * ajustado por estrés sistémico.
 * @param {string} experienceLevel 
 * @param {number} systemicStress 
 * @returns {number} Volumen semanal objetivo (series)
 */
export function determineVolumeTier(experienceLevel, systemicStress, equipmentProfile = null) {
    let baseVolume = 10; // Default Beginner

    switch (experienceLevel) {
        case Experience.BEGINNER:
            baseVolume = 10;
            break;
        case Experience.INTERMEDIATE:
            baseVolume = 14;
            break;
        case Experience.ADVANCED:
            baseVolume = 18;
            break;
        default:
            baseVolume = 14;
    }

    // Ajuste por equipamiento (evidencia: limitada carga externa requiere menor volumen objetivo y más frecuencia)
    if (equipmentProfile && equipmentProfile.location === 'home') {
        // Si es bodyweight-only, reducir volumen objetivo en 10%
        if (equipmentProfile.bodyweightOnly) {
            baseVolume = Math.max(6, Math.round(baseVolume * 0.9));
        } else if (!equipmentProfile.hasBarbell && !equipmentProfile.hasMachines) {
            // Si no hay barra ni máquinas, reducir 5% y favorecer frecuencia
            baseVolume = Math.max(7, Math.round(baseVolume * 0.95));
        }
    }

    const THRESHOLD_HIGH = 12; // Example: 4 days of high stress

    if (systemicStress > THRESHOLD_HIGH) {
        // Reducción del 20% por seguridad
        return Math.floor(baseVolume * 0.8);
    } else {
        return baseVolume;
    }
}
