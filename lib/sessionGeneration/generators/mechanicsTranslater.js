// ==========================================
// MÓDULO: TRADUCTOR DE MECÁNICA Y ESTRUCTURA (Structure Type)
// ==========================================

/**
 * Traduce el structureType del mesociclo a directrices biomecánicas concretas
 * para la ejecución de la sesión (Tempo, Descansos, Foco Técnico).
 * 
 * @param {string} structureType - Neural_Strength | Hypertrophy_Standard | Metabolic_Volume
 * @param {string} userLevel - Principiante | Intermedio | Avanzado
 * @returns {Object} Directrices de ejecución (tempo, rest, technicalFocus)
 */
export function translateBiomechanics(structureType, userLevel) {
    
    // Default fallback
    const defaults = {
        tempo: "2-0-2-0 (Controlado estándar)",
        restRange: [60, 90], // Segundos
        executionIntent: "Control motor y rango completo",
        setIntensityProfile: "Straight Sets"
    };

    if (!structureType) return defaults;

    switch (structureType) {
        case 'Neural_Strength':
            return {
                tempo: "2-0-X-0 (Control en bajada, explosivo en subida)",
                restRange: [180, 300], // 3-5 minutos
                restProtocols: { primary: 240, accessory: 180, isolation: 180 },
                executionIntent: "Máxima aceleración intencional (CAT). Mover la carga lo más rápido posible.",
                setIntensityProfile: "Ascending Sets (Ramping up)",
                rationale: "Optimización de reclutamiento de unidades motoras de alto umbral y resíntesis ATP-PC."
            };

        case 'Hypertrophy_Standard':
            return {
                tempo: "3-1-1-0 (Excéntrica lenta de 3s, pausa, concéntrica explosiva)",
                restRange: [60, 90], // 1-1.5 minutos
                restProtocols: { primary: 90, accessory: 75, isolation: 60 },
                executionIntent: "Enfoque interno: Conexión mente-músculo y tensión constante.",
                setIntensityProfile: "Straight Sets",
                rationale: "Maximizar tiempo bajo tensión y estrés mecánico garantizando limpieza metabólica suficiente."
            };

        case 'Metabolic_Volume':
            return {
                tempo: "2-0-2-0 (Fluido y constante, sin pausas)",
                restRange: [30, 75], // 30-75s range
                restProtocols: { primary: 60, accessory: 45, isolation: 35 },
                executionIntent: "Acumulación de fatiga y bombeo (Pump). No bloquear articulaciones.",
                setIntensityProfile: "Drop Sets / Myo-reps enabled",
                rationale: "Estrés metabólico local y acumulación de metabolitos con bajo impacto articular."
            };
            
        default: 
            return defaults;
    }
}
