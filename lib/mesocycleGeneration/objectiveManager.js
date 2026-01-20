import { Goal, OBJECTIVE_MAPPING } from './constants.js';

/**
 * Determina el objetivo de la fase basado en el feedback del mesociclo anterior
 * @param {Object} usuario 
 * @param {Object} mesocicloAnterior 
 * @param {Object} nextCycleConfig 
 * @returns {Object} { objetivo: Goal, razon: string }
 */
export function determinePhaseObjective(usuario, mesocicloAnterior, nextCycleConfig) {
    // Si existe un mesociclo anterior y tiene feedback
    if (mesocicloAnterior && mesocicloAnterior.feedback) {
        const feedback = mesocicloAnterior.feedback;
        
        // Si el usuario se sintió estancado, cambiar a fuerza
        if (feedback.sensation === 'Estancado' || feedback.energyLevel < 3) {
            return {
                objetivo: Goal.STRENGTH,
                razon: 'Cambio a fuerza para romper estancamiento y estimular adaptación neural'
            };
        }
        
        // Si hay dolor articular alto
        if (feedback.sorenessLevel > 7 || feedback.jointPain > 7) {
            return {
                objetivo: 'Descarga_Activa_y_Tecnica', // Mapped later or handled as special state
                razon: 'Fase de descarga debido a alta fatiga articular/muscular'
            };
            // Note: In our constants, we might map this to General Health or specific logic
        }
        
        // Si hay configuración del ciclo siguiente
        if (nextCycleConfig && nextCycleConfig.focusSuggestion) {
            if (nextCycleConfig.focusSuggestion === 'Rehab/Prehab') {
                return {
                    objetivo: Goal.GENERAL_HEALTH,
                    razon: 'Sugerencia de evaluación: Enfoque en recuperación'
                };
            }
        }
        
        // Default: Continue goal
        const rawGoal = usuario.fitnessGoal;
        const normalizedGoal = OBJECTIVE_MAPPING[rawGoal] || rawGoal || Goal.HYPERTROPHY;
        return {
            objetivo: normalizedGoal,
            razon: 'Continuación del objetivo principal con progresión'
        };
    }
    
    // Primer ciclo: Adaptación
    // Para el nuevo sistema, Adaptación es una fase de introducción dentro del objetivo principal,
    // pero podemos forzar un objetivo de 'Salud' o similar si es muy novato.
    // Sin embargo, respetaremos el objetivo del usuario pero con la Semana 1 siendo Intro.
    
    const rawGoal = usuario.fitnessGoal;
    const normalizedGoal = OBJECTIVE_MAPPING[rawGoal] || rawGoal || Goal.HYPERTROPHY;
    
    return {
        objetivo: normalizedGoal,
        razon: 'Primer mesociclo: fase de adaptación anatómica y aprendizaje motor'
    };
}
