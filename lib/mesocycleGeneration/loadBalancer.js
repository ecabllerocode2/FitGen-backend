import { Experience, LegacyLoad } from './constants.js';

/**
 * Calcula la intensidad objetivo (RPE) para una sesión específica basada en carga externa y nivel.
 * @param {string} experienceLevel 
 * @param {string} dateExternalLoad - 'high', 'medium', 'low', 'none'
 * @param {string} sessionType - 'Legs', 'Back', etc.
 * @returns {number} Target RPE (1-10)
 */
export function setSessionIntensity(experienceLevel, dateExternalLoad, sessionType) {
    let targetRPE = 7; // Base

    // Base RPE por nivel
    switch (experienceLevel) {
        case Experience.BEGINNER: targetRPE = 7; break; // RIR 3
        case Experience.INTERMEDIATE: targetRPE = 8; break; // RIR 2
        case Experience.ADVANCED: targetRPE = 9; break; // RIR 1
        default: targetRPE = 7.5;
    }

    const loadScore = LegacyLoad[dateExternalLoad ? dateExternalLoad.toLowerCase() : 'none'] || 0;

    // Ajuste por Carga Externa (Oficina vs Construcción)
    // HIGH (3 or 4 in our mapping)
    if (loadScore >= 3) {
        targetRPE -= 1.5; // Bajamos intensidad drásticamente para evitar burnout
    } else if (loadScore === 2) {
        targetRPE -= 0.5;
    } else if (loadScore <= 1) {
        // Día ideal para sobrecarga (si es 'none' o 'low')
        if (sessionType && (sessionType.toLowerCase().includes('pierna') || sessionType.toLowerCase().includes('back') || sessionType.toLowerCase().includes('fuerza'))) {
            targetRPE += 0.5;
            if (targetRPE > 9.5) targetRPE = 9.5;
        }
    }

    // Proteger límite seguridad
    if (targetRPE < 5) targetRPE = 5;
    if (targetRPE > 10) targetRPE = 10;

    return Number(targetRPE.toFixed(1));
}

/**
 * Determina el tipo de estructura de sesión basado en la carga.
 * @param {number} rpe 
 * @returns {string} 'Neural_Strength', 'Hypertrophy_Standard', 'Metabolic_Volume'
 */
export function determineSessionStructureType(rpe) {
    if (rpe >= 8.5) return 'Neural_Strength';
    if (rpe >= 7) return 'Hypertrophy_Standard';
    return 'Metabolic_Volume';
}
