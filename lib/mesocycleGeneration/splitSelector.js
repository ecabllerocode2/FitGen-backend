import { SplitType, Goal, Experience } from './constants.js';

/**
 * Selecciona la arquitectura de división (Split) óptima.
 * @param {number} daysAvailableCount 
 * @param {string} experienceLevel 
 * @param {string} fitnessGoal 
 * @returns {string} SplitType
 */
export function selectSplitArchitecture(daysAvailableCount, experienceLevel, fitnessGoal, equipmentProfile = null) {
    // If user commits to home training with limited equipment, favour frequency-friendly templates (Full Body) and avoid heavy axial accumulation
    const isHome = equipmentProfile && equipmentProfile.location === 'home';
    const bodyweightOnly = equipmentProfile && equipmentProfile.bodyweightOnly;

    if (daysAvailableCount <= 1) return SplitType.FULL_BODY; // Minimum fallback
    
    if (daysAvailableCount === 2) {
        // Única opción viable para estímulo suficiente
        return SplitType.FULL_BODY;
    }

    if (daysAvailableCount === 3) {
        // Home: prefer Full Body to distribute load across sessions
        if (isHome) return SplitType.FULL_BODY;
        if (experienceLevel === Experience.BEGINNER || fitnessGoal === Goal.ENDURANCE) {
            return SplitType.FULL_BODY;
        } else {
            // Para intermedios/avanzados, Full Body puede ser mucha fatiga sistémica por sesión
            return SplitType.UPPER_LOWER_FULL; // Variación ondulatoria
        }
    }

    if (daysAvailableCount === 4) {
        if (isHome && bodyweightOnly) {
            // Evitar heavy axial stress en casa con sólo peso corporal: usar Torso/Extremidades
            return SplitType.TORSO_LIMBS;
        }
        if (fitnessGoal === Goal.STRENGTH) {
            return SplitType.UPPER_LOWER; // Permite enfoque en básicos
        } else if (experienceLevel === Experience.BEGINNER) {
            return SplitType.TORSO_LIMBS; // Similar a U/L pero menos taxativo
        } else {
            return SplitType.UPPER_LOWER; // El estándar de oro
        }
    }

    if (daysAvailableCount === 5) {
        if (isHome) {
            // En casa, preferimos Full Body para distribuir volumen y reducir cargas axiales pesadas
            return SplitType.FULL_BODY;
        }
        if (experienceLevel === Experience.ADVANCED) {
            return SplitType.BODY_PART; // "Bro Split" con frecuencia revisada
        } else {
            return SplitType.HYBRID_PHUL; // Upper/Lower + PPL Híbrido
        }
    }

    if (daysAvailableCount === 6) {
        if (isHome && bodyweightOnly) {
            // En casa con BW, PPL podría ser demasiado redundante; preferimos PPL con más moderación
            return SplitType.PPL;
        }
        return SplitType.PPL; // Push/Pull/Legs (Frecuencia 2)
    }

    if (daysAvailableCount >= 7) {
        // Entrenar 7 días es contraproducente para naturales
        // Forzamos un día de recuperación activa
        return SplitType.PPL_ACTIVE_REST;
    }

    return SplitType.FULL_BODY; // Fallback
}

/**
 * Retorna la cola de sesiones (secuencia) para un Split dado.
 * @param {string} splitType 
 * @returns {Array<string>} Array de Session Focus Types
 */
export function getSessionOrder(splitType) {
    switch (splitType) {
        case SplitType.FULL_BODY:
            // Ondulación de intensidad para evitar fatiga
            return ['Full Body (Fuerza)', 'Full Body (Hipertrofia)', 'Full Body (Metabólico)'];
        
        case SplitType.UPPER_LOWER_FULL:
            return ['Torso (Fuerza)', 'Pierna (Fuerza)', 'Full Body (Hipertrofia)'];
        
        case SplitType.UPPER_LOWER:
            return ['Torso (Fuerza)', 'Pierna (Fuerza)', 'Torso (Hipertrofia)', 'Pierna (Hipertrofia)'];
        
        case SplitType.TORSO_LIMBS:
            return ['Torso (General)', 'Pierna/Brazos', 'Torso (Pump)', 'Pierna (Completa)'];
        
        case SplitType.HYBRID_PHUL:
            return ['Torso (Fuerza)', 'Pierna (Fuerza)', 'Empuje (Hipertrofia)', 'Tracción (Hipertrofia)', 'Pierna (Hipertrofia)'];
        
        case SplitType.BODY_PART:
            return ['Pecho/Tríceps', 'Espalda/Bíceps', 'Pierna (Cuádriceps)', 'Hombro/Abs', 'Pierna (Isquios/Glúteo)'];
        
        case SplitType.PPL:
            return ['Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)', 'Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)'];
        
        case SplitType.PPL_ACTIVE_REST:
            return ['Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)', 'Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)', 'Recuperación Activa'];

        default:
            return ['Full Body', 'Full Body'];
    }
}
