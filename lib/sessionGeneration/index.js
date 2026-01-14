// ====================================================================
// INDEX - Session Generation Library
// Punto de entrada que exporta todos los módulos
// ====================================================================

export { CONSTANTS, RPE_PERCENTAGE_TABLE, VOLUME_CONFIG, REST_PROTOCOLS, TEMPO_PROTOCOLS } from './constants.js';
export { obtenerDatosContextuales, getExerciseHistory, getRecentlyUsedExercises, detectPlateau } from './dataFetcher.js';
export { filtrarEjerciciosDisponibles, detectarAmbienteEntrenamiento, generarPerfilEquipamiento } from './equipmentFilter.js';
export { calcularAjustesAutoregulacion, determinarModoSesion } from './readinessManager.js';
export { calcularCargaPrecisa, estimarE1RM, calcularRepeticionesObjetivo } from './loadCalculator.js';
export { generarCalentamiento } from './rampGenerator.js';
export { construirBloquePrincipal } from './mainBlockBuilder.js';
export { construirBloqueCore, generarCoreFinnisher } from './coreBuilder.js';
export { generarEnfriamiento, generarEnfriamientoRapido, generarRecomendacionesRecuperacion } from './coolDownGenerator.js';
export { generarNarrativaDidactica, generarTipDelDia } from './educationContent.js';
export * from './utils.js';
