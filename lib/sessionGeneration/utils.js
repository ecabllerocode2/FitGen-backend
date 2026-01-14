// ====================================================================
// UTILITIES MODULE
// Funciones utilitarias compartidas entre todos los módulos
// ====================================================================

/**
 * Normaliza texto para comparaciones consistentes
 * Convierte a minúsculas, remueve acentos, y normaliza espacios
 * @param {string} texto - Texto a normalizar
 * @returns {string} Texto normalizado
 */
export function normalizeText(texto) {
    if (!texto) return '';
    return texto
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remover acentos
        .replace(/\s+/g, '_')           // Espacios a guiones bajos
        .trim();
}

/**
 * Mezcla un array de forma aleatoria usando Fisher-Yates
 * @param {Array} array - Array a mezclar
 * @returns {Array} Nuevo array mezclado
 */
export function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

/**
 * Redondea un número al múltiplo más cercano
 * Útil para redondear cargas a incrementos de 2.5kg o 5kg
 * @param {number} value - Valor a redondear
 * @param {number} multiple - Múltiplo base (default: 2.5)
 * @returns {number} Valor redondeado
 */
export function roundToNearestMultiple(value, multiple = 2.5) {
    return Math.round(value / multiple) * multiple;
}

/**
 * Clamp un valor entre un mínimo y máximo
 * @param {number} value - Valor a limitar
 * @param {number} min - Valor mínimo
 * @param {number} max - Valor máximo
 * @returns {number} Valor limitado
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Parsea un valor de RPE desde diferentes formatos
 * @param {string|number} rpeValue - RPE como "RPE 7", "7", 7, etc.
 * @returns {number|null} Valor numérico de RPE o null
 */
export function parseRPE(rpeValue) {
    if (typeof rpeValue === 'number') return rpeValue;
    if (!rpeValue) return null;
    const match = String(rpeValue).match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

/**
 * Convierte RPE a RIR (Reps in Reserve)
 * @param {number} rpe - Valor de RPE (1-10)
 * @returns {number} Valor de RIR
 */
export function rpeToRir(rpe) {
    return Math.max(0, 10 - rpe);
}

/**
 * Convierte RIR a RPE
 * @param {number} rir - Valor de RIR
 * @returns {number} Valor de RPE
 */
export function rirToRpe(rir) {
    return Math.max(1, 10 - rir);
}

/**
 * Calcula el promedio de un array de números
 * @param {Array<number>} numbers - Array de números
 * @returns {number} Promedio
 */
export function average(numbers) {
    if (!numbers || numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * Calcula la mediana de un array de números
 * @param {Array<number>} numbers - Array de números
 * @returns {number} Mediana
 */
export function median(numbers) {
    if (!numbers || numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Obtiene la fecha actual en formato ISO sin hora
 * @returns {string} Fecha en formato YYYY-MM-DD
 */
export function getTodayISO() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Calcula la diferencia en días entre dos fechas
 * @param {Date|string} date1 - Primera fecha
 * @param {Date|string} date2 - Segunda fecha
 * @returns {number} Diferencia en días
 */
export function daysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Genera un ID único simple
 * @returns {string} ID único
 */
export function generateSimpleId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Agrupa un array por una propiedad
 * @param {Array} array - Array a agrupar
 * @param {string} key - Clave para agrupar
 * @returns {Object} Objeto con arrays agrupados
 */
export function groupBy(array, key) {
    return array.reduce((groups, item) => {
        const value = item[key];
        groups[value] = groups[value] || [];
        groups[value].push(item);
        return groups;
    }, {});
}

/**
 * Filtra valores únicos de un array
 * @param {Array} array - Array con posibles duplicados
 * @returns {Array} Array sin duplicados
 */
export function unique(array) {
    return [...new Set(array)];
}

/**
 * Verifica si dos arrays tienen elementos en común
 * @param {Array} arr1 - Primer array
 * @param {Array} arr2 - Segundo array
 * @returns {boolean} True si hay intersección
 */
export function hasIntersection(arr1, arr2) {
    const set = new Set(arr1);
    return arr2.some(item => set.has(item));
}

/**
 * Valida que un objeto tenga las propiedades requeridas
 * @param {Object} obj - Objeto a validar
 * @param {Array<string>} requiredProps - Propiedades requeridas
 * @returns {Object} Objeto con isValid y missingProps
 */
export function validateRequiredProps(obj, requiredProps) {
    const missingProps = requiredProps.filter(prop => 
        obj[prop] === undefined || obj[prop] === null
    );
    return {
        isValid: missingProps.length === 0,
        missingProps
    };
}

/**
 * Formatea duración en minutos a string legible
 * @param {number} minutes - Duración en minutos
 * @returns {string} Duración formateada
 */
export function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

/**
 * Formatea peso con unidad
 * @param {number} weight - Peso en kg
 * @param {string} unit - Unidad ('kg' o 'lb')
 * @returns {string} Peso formateado
 */
export function formatWeight(weight, unit = 'kg') {
    if (unit === 'lb') {
        return `${roundToNearestMultiple(weight * 2.20462, 5)} lb`;
    }
    return `${roundToNearestMultiple(weight, 2.5)} kg`;
}

/**
 * Parsea tempo de entrenamiento
 * @param {string} tempo - Tempo en formato "3-1-2-0"
 * @returns {Object} Objeto con eccentric, pause, concentric, pause2
 */
export function parseTempo(tempo) {
    if (!tempo) return null;
    const parts = tempo.split('-').map(p => parseInt(p) || 0);
    return {
        eccentric: parts[0] || 0,
        pauseBottom: parts[1] || 0,
        concentric: parts[2] || 0,
        pauseTop: parts[3] || 0,
        total: parts.reduce((a, b) => a + b, 0)
    };
}

/**
 * Calcula el tiempo bajo tensión estimado
 * @param {string} tempo - Tempo de entrenamiento
 * @param {number} reps - Número de repeticiones
 * @returns {number} Tiempo en segundos
 */
export function calculateTUT(tempo, reps) {
    const parsed = parseTempo(tempo);
    if (!parsed) return reps * 4; // Default 4s por rep
    return parsed.total * reps;
}

/**
 * Mapea patrones de movimiento a músculos principales
 */
export const PATTERN_TO_MUSCLES = {
    'empuje_h': ['pecho', 'deltoides_anterior', 'triceps'],
    'empuje_v': ['deltoides', 'triceps', 'trapecio_superior'],
    'traccion_h': ['espalda_media', 'romboides', 'biceps'],
    'traccion_v': ['dorsal', 'biceps', 'trapecio_inferior'],
    'rodilla': ['cuadriceps', 'gluteos'],
    'cadera': ['isquiotibiales', 'gluteos', 'erector_espinal'],
    'core': ['recto_abdominal', 'oblicuos', 'transverso'],
    'aislamiento_brazo': ['biceps', 'triceps', 'antebrazos'],
    'aislamiento_hombro': ['deltoides_lateral', 'deltoides_posterior']
};

/**
 * Mapea focos de sesión a patrones y músculos
 */
export const FOCUS_MAPPING = {
    'full_body': {
        patrones: ['empuje_h', 'traccion_h', 'rodilla', 'cadera', 'core'],
        musculos: ['pecho', 'espalda', 'cuadriceps', 'isquiotibiales', 'gluteos']
    },
    'upper_body': {
        patrones: ['empuje_h', 'empuje_v', 'traccion_h', 'traccion_v', 'core'],
        musculos: ['pecho', 'espalda', 'deltoides', 'biceps', 'triceps']
    },
    'lower_body': {
        patrones: ['rodilla', 'cadera', 'core'],
        musculos: ['cuadriceps', 'isquiotibiales', 'gluteos', 'pantorrillas']
    },
    'push': {
        patrones: ['empuje_h', 'empuje_v', 'aislamiento_brazo'],
        musculos: ['pecho', 'deltoides', 'triceps']
    },
    'pull': {
        patrones: ['traccion_h', 'traccion_v', 'aislamiento_brazo'],
        musculos: ['espalda', 'biceps', 'antebrazos']
    },
    'legs': {
        patrones: ['rodilla', 'cadera'],
        musculos: ['cuadriceps', 'isquiotibiales', 'gluteos', 'pantorrillas']
    },
    'chest_back': {
        patrones: ['empuje_h', 'traccion_h'],
        musculos: ['pecho', 'espalda']
    },
    'shoulders_arms': {
        patrones: ['empuje_v', 'aislamiento_hombro', 'aislamiento_brazo'],
        musculos: ['deltoides', 'biceps', 'triceps']
    }
};

/**
 * Calcula factor de fatiga acumulada
 * @param {Array} sesionesRecientes - Últimas sesiones completadas
 * @param {number} diasAtras - Días a considerar
 * @returns {number} Factor de fatiga (0-1, donde 1 es máxima fatiga)
 */
export function calculateAccumulatedFatigue(sesionesRecientes, diasAtras = 7) {
    if (!sesionesRecientes || sesionesRecientes.length === 0) return 0;
    
    const hoy = new Date();
    const sesionesEnRango = sesionesRecientes.filter(s => {
        const fechaSesion = new Date(s.completedAt || s.date);
        return daysBetween(fechaSesion, hoy) <= diasAtras;
    });
    
    // Factor basado en número de sesiones y su intensidad
    const sesionesCount = sesionesEnRango.length;
    const intensidadPromedio = average(
        sesionesEnRango.map(s => s.averageRPE || s.perceivedExertion || 7)
    );
    
    // Normalizar: 5+ sesiones en 7 días con RPE alto = fatiga máxima
    const factorSesiones = clamp(sesionesCount / 5, 0, 1);
    const factorIntensidad = clamp((intensidadPromedio - 5) / 4, 0, 1);
    
    return (factorSesiones * 0.6) + (factorIntensidad * 0.4);
}

export default {
    normalizeText,
    shuffleArray,
    roundToNearestMultiple,
    clamp,
    parseRPE,
    rpeToRir,
    rirToRpe,
    average,
    median,
    getTodayISO,
    daysBetween,
    generateSimpleId,
    groupBy,
    unique,
    hasIntersection,
    validateRequiredProps,
    formatDuration,
    formatWeight,
    parseTempo,
    calculateTUT,
    calculateAccumulatedFatigue,
    PATTERN_TO_MUSCLES,
    FOCUS_MAPPING
};
