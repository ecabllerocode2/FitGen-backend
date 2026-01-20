/**
 * Crea la progresión del microciclo (semana) para periodización ondulante.
 * @param {number} weekNumber 
 * @returns {Object} { focus, notes, intensityModifier, volumeModifier }
 */
export function createMicrocycleProgression(weekNumber) {
    switch(weekNumber) {
        case 1:
            return {
                focus: 'Adaptación & Técnica',
                notes: 'Fase de Introducción: Prioriza la calidad de movimiento y aprendizaje motor.',
                intensityModifier: -1.0, // RPE un poco más bajo que el base
                volumeModifier: 0.8 // Volumen reducido
            };
        case 2:
            return {
                focus: 'Acumulación de Volumen',
                notes: 'Fase de Carga: Intenta aumentar peso o repeticiones manteniendo buena técnica.',
                intensityModifier: 0, // RPE Base
                volumeModifier: 1.0 // Volumen Base
            };
        case 3:
            return {
                focus: 'Intensificación / Sobrecarga',
                notes: 'Fase de Pico: Intensificación controlada. Buscar nuevos récords personales seguros.',
                intensityModifier: +1.0,
                volumeModifier: 0.9 // Un poco menos de volumen, más intensidad
            };
        case 4:
            return {
                focus: 'Descarga (Deload)',
                notes: 'Fase de Recuperación: Reduce peso 30% y volumen 50%. Permite supercompensación.',
                intensityModifier: -2.0, // Muy suave
                volumeModifier: 0.5
            };
        default:
             return {
                focus: 'Mantenimiento',
                notes: 'Semana estándar.',
                intensityModifier: 0,
                volumeModifier: 1.0
            };
    }
}
