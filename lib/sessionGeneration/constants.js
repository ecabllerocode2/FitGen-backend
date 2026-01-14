// ====================================================================
// CONSTANTES DEL SISTEMA DE GENERACIÓN DE SESIONES
// Basado en principios de Ciencias del Deporte y Fisiología del Entrenamiento
// ====================================================================

/**
 * DÍAS DE LA SEMANA EN ESPAÑOL
 */
export const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/**
 * MAPEO DE PATRONES DE MOVIMIENTO SEGÚN FOCO DE SESIÓN
 * Basado en la clasificación funcional del movimiento humano (McGill, Boyle)
 */
export const MOVEMENT_PATTERN_MAP = {
    'Pecho': ['Empuje_H', 'Empuje_V'],
    'Espalda': ['Traccion_H', 'Traccion_V'],
    'Pecho/Espalda': ['Empuje_H', 'Empuje_V', 'Traccion_H', 'Traccion_V'],
    'Pierna': ['Rodilla', 'Cadera', 'Core'],
    'Hombro': ['Empuje_V', 'Traccion_H'],
    'Hombro/Brazo': ['Empuje_V', 'Traccion_H', 'Traccion_V'],
    'Brazo': ['Traccion_H', 'Empuje_H'],
    'Full Body': ['Rodilla', 'Cadera', 'Empuje_H', 'Traccion_V', 'Core'],
    'Core/Cardio': ['Core', 'General'],
    'Empuje': ['Empuje_H', 'Empuje_V'],
    'Tracción': ['Traccion_H', 'Traccion_V'],
    'Torso': ['Empuje_H', 'Traccion_H', 'Empuje_V', 'Traccion_V']
};

/**
 * MAPEO DE MÚSCULOS SEGÚN FOCO DE SESIÓN
 */
export const MUSCLE_FOCUS_MAP = {
    'Pecho': ['Pecho'],
    'Espalda': ['Espalda'],
    'Pecho/Espalda': ['Pecho', 'Espalda'],
    'Pierna': ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'],
    'Hombro': ['Hombros'],
    'Hombro/Brazo': ['Hombros', 'Bíceps', 'Tríceps'],
    'Full Body': ['Cuádriceps', 'Glúteos', 'Isquiotibiales','Pecho', 'Espalda', 'Core', 'Hombros', 'Tríceps', 'Bíceps'],
    'Core/Cardio': ['Core'],
    'Empuje': ['Pecho', 'Hombros', 'Tríceps'],
    'Tracción': ['Espalda', 'Bíceps']
};

/**
 * TABLA DE PORCENTAJES DE 1RM SEGÚN RPE Y REPETICIONES
 * Basado en la investigación de Zourdos et al. (2016) y Helms et al. (2016)
 * RPE = 10 - RIR (Reps in Reserve)
 */
export const RPE_PERCENTAGE_TABLE = {
    // RPE 10 (RIR 0 - Fallo muscular)
    10: { 1: 1.00, 2: 0.955, 3: 0.922, 4: 0.892, 5: 0.863, 6: 0.837, 8: 0.786, 10: 0.740, 12: 0.700 },
    // RPE 9.5 (RIR 0.5)
    9.5: { 1: 0.978, 2: 0.939, 3: 0.907, 4: 0.878, 5: 0.850, 6: 0.824, 8: 0.774, 10: 0.728, 12: 0.688 },
    // RPE 9 (RIR 1)
    9: { 1: 0.955, 2: 0.922, 3: 0.892, 4: 0.863, 5: 0.837, 6: 0.811, 8: 0.762, 10: 0.717, 12: 0.677 },
    // RPE 8.5 (RIR 1.5)
    8.5: { 1: 0.939, 2: 0.907, 3: 0.878, 4: 0.850, 5: 0.824, 6: 0.799, 8: 0.751, 10: 0.707, 12: 0.667 },
    // RPE 8 (RIR 2)
    8: { 1: 0.922, 2: 0.892, 3: 0.863, 4: 0.837, 5: 0.811, 6: 0.786, 8: 0.740, 10: 0.697, 12: 0.657 },
    // RPE 7.5 (RIR 2.5)
    7.5: { 1: 0.907, 2: 0.878, 3: 0.850, 4: 0.824, 5: 0.799, 6: 0.774, 8: 0.728, 10: 0.687, 12: 0.648 },
    // RPE 7 (RIR 3)
    7: { 1: 0.892, 2: 0.863, 3: 0.837, 4: 0.811, 5: 0.786, 6: 0.762, 8: 0.717, 10: 0.677, 12: 0.638 },
    // RPE 6 (RIR 4)
    6: { 1: 0.863, 2: 0.837, 3: 0.811, 4: 0.786, 5: 0.762, 6: 0.740, 8: 0.697, 10: 0.657, 12: 0.618 },
    // RPE 5 (RIR 5 - Descarga)
    5: { 1: 0.837, 2: 0.811, 3: 0.786, 4: 0.762, 5: 0.740, 6: 0.717, 8: 0.677, 10: 0.638, 12: 0.600 }
};

/**
 * CONFIGURACIÓN DE VOLUMEN SEGÚN NIVEL DE EXPERIENCIA
 * Basado en las recomendaciones de Schoenfeld et al. (2017) y la NSCA
 */
export const VOLUME_CONFIG = {
    Principiante: {
        setsPerMuscleGroup: { min: 6, max: 10 },
        setsPerExercise: { compound: 3, isolation: 2 },
        totalExercises: { min: 4, max: 6 },
        repsRange: { strength: '6-8', hypertrophy: '10-12', endurance: '15-20' }
    },
    Intermedio: {
        setsPerMuscleGroup: { min: 10, max: 16 },
        setsPerExercise: { compound: 4, isolation: 3 },
        totalExercises: { min: 5, max: 7 },
        repsRange: { strength: '4-6', hypertrophy: '8-12', endurance: '12-15' }
    },
    Avanzado: {
        setsPerMuscleGroup: { min: 14, max: 22 },
        setsPerExercise: { compound: 5, isolation: 4 },
        totalExercises: { min: 6, max: 9 },
        repsRange: { strength: '3-5', hypertrophy: '6-10', endurance: '10-15' }
    }
};

/**
 * TIEMPOS DE DESCANSO ÓPTIMOS SEGÚN OBJETIVO Y TIPO DE EJERCICIO
 * Basado en Schoenfeld et al. (2016) y las guías de la ACSM
 */
export const REST_PROTOCOLS = {
    Fuerza: {
        compound: { min: 180, max: 300 }, // 3-5 min
        isolation: { min: 120, max: 180 }, // 2-3 min
        betweenExercises: 180
    },
    Hipertrofia: {
        compound: { min: 90, max: 150 }, // 1.5-2.5 min
        isolation: { min: 60, max: 90 }, // 1-1.5 min
        betweenExercises: 90
    },
    Resistencia: {
        compound: { min: 30, max: 60 }, // 30s-1 min
        isolation: { min: 15, max: 45 }, // 15-45s
        betweenExercises: 45
    },
    Perdida_Grasa: {
        compound: { min: 45, max: 75 }, // Menos descanso = mayor EPOC
        isolation: { min: 30, max: 60 },
        betweenExercises: 60
    }
};

/**
 * TEMPO DE EJECUCIÓN SEGÚN OBJETIVO
 * Formato: Excéntrica-Pausa Inferior-Concéntrica-Pausa Superior
 */
export const TEMPO_PROTOCOLS = {
    Fuerza: '2-0-1-0', // Énfasis en explosividad concéntrica
    Hipertrofia: '3-1-2-1', // Mayor TUT (Tiempo Bajo Tensión)
    Control_Tecnico: '4-2-2-1', // Para principiantes o nuevos ejercicios
    Metabolico: '2-0-2-0', // Ritmo constante sin pausas
    Potencia: '1-0-X-0', // X = explosivo
    Excentrico: '5-1-1-0', // Sobrecarga excéntrica para mesetas
    Isometrico: '2-3-2-3' // Pausas isométricas prolongadas
};

/**
 * COEFICIENTES DE FATIGA ACUMULADA POR PATRÓN DE MOVIMIENTO
 * Usado para calcular la recuperación necesaria entre sesiones
 */
export const FATIGUE_COEFFICIENTS = {
    Rodilla: 1.2, // Alta demanda del SNC (sentadillas)
    Cadera: 1.3, // Muy alta demanda (peso muerto)
    Empuje_H: 0.9, // Press horizontal
    Empuje_V: 0.8, // Press vertical
    Traccion_H: 0.85, // Remos
    Traccion_V: 0.9, // Dominadas
    Core: 0.5, // Baja fatiga sistémica
    General: 0.4 // Actividades generales
};

/**
 * MAPEO DE LESIONES A PATRONES DE MOVIMIENTO A EVITAR/MODIFICAR
 */
export const INJURY_MOVEMENT_MAP = {
    'Hombro': {
        avoid: ['Empuje_V'],
        modify: ['Empuje_H', 'Traccion_V'],
        prehab: ['Rotación Externa', 'Estabilización Escapular']
    },
    'Rodilla': {
        avoid: [],
        modify: ['Rodilla'],
        prehab: ['Activación de Glúteos', 'Estabilización de Cadera']
    },
    'Espalda Baja': {
        avoid: ['Cadera'],
        modify: ['Rodilla', 'Core'],
        prehab: ['Activación de Core', 'Movilidad de Cadera']
    },
    'Muñeca': {
        avoid: [],
        modify: ['Empuje_H'],
        prehab: ['Movilidad de Muñeca', 'Fortalecimiento de Antebrazo']
    },
    'Ninguna': {
        avoid: [],
        modify: [],
        prehab: []
    }
};

/**
 * ESTRUCTURA DE SLOTS POR TIPO DE SESIÓN Y NIVEL
 * Define cuántos ejercicios de cada prioridad incluir
 */
export const SESSION_SLOT_STRUCTURE = {
    Principiante: {
        totalSlots: 5,
        distribution: { priority1: 2, priority2: 2, priority3: 1 }
    },
    Intermedio: {
        totalSlots: 6,
        distribution: { priority1: 2, priority2: 2, priority3: 2 }
    },
    Avanzado: {
        totalSlots: 7,
        distribution: { priority1: 3, priority2: 2, priority3: 2 }
    }
};

/**
 * CONFIGURACIÓN DE FASES RAMP (Calentamiento)
 */
export const RAMP_PHASE_CONFIG = {
    Raise: {
        duration: '3-5 min',
        description: 'Elevar temperatura corporal y frecuencia cardíaca',
        exercises: 1,
        intensity: 'Baja'
    },
    Activate: {
        duration: '2-3 min',
        description: 'Activar músculos estabilizadores y cadenas débiles',
        exercises: 2,
        intensity: 'Baja-Media'
    },
    Mobilize: {
        duration: '2-3 min',
        description: 'Mejorar rango de movimiento en articulaciones clave',
        exercises: 2,
        intensity: 'Media'
    },
    Potentiate: {
        duration: '1-2 min',
        description: 'Preparar el SNC con movimientos explosivos específicos',
        exercises: 1,
        intensity: 'Alta'
    }
};

/**
 * AJUSTES DE AUTOREGULACIÓN SEGÚN NIVEL DE ENERGÍA
 * Basado en el modelo de Aptitud-Fatiga (Banister)
 */
export const ENERGY_ADJUSTMENTS = {
    1: { // Agotamiento extremo
        volumeMultiplier: 0.4,
        intensityDelta: -3,
        rirDelta: +3,
        sessionType: 'Recuperacion_Activa',
        restMultiplier: 1.5
    },
    2: { // Fatiga alta
        volumeMultiplier: 0.6,
        intensityDelta: -2,
        rirDelta: +2,
        sessionType: 'Tecnica_Reducida',
        restMultiplier: 1.3
    },
    3: { // Normal
        volumeMultiplier: 1.0,
        intensityDelta: 0,
        rirDelta: 0,
        sessionType: 'Normal',
        restMultiplier: 1.0
    },
    4: { // Buena energía
        volumeMultiplier: 1.1,
        intensityDelta: +0.5,
        rirDelta: -0.5,
        sessionType: 'Intensificada',
        restMultiplier: 0.9
    },
    5: { // Energía óptima
        volumeMultiplier: 1.2,
        intensityDelta: +1,
        rirDelta: -1,
        sessionType: 'Peak_Performance',
        restMultiplier: 0.85
    }
};

/**
 * AJUSTES SEGÚN NIVEL DE DOLOR MUSCULAR (DOMS)
 */
export const SORENESS_ADJUSTMENTS = {
    1: { // Sin dolor
        canTrainAffectedMuscle: true,
        volumeMultiplier: 1.0,
        intensityDelta: 0,
        recommendation: 'Proceder con normalidad'
    },
    2: { // Dolor leve
        canTrainAffectedMuscle: true,
        volumeMultiplier: 1.0,
        intensityDelta: 0,
        recommendation: 'Calentamiento extendido recomendado'
    },
    3: { // Dolor moderado
        canTrainAffectedMuscle: true,
        volumeMultiplier: 0.85,
        intensityDelta: -1,
        recommendation: 'Aumentar RIR en 1, priorizar recuperación activa'
    },
    4: { // Dolor severo
        canTrainAffectedMuscle: false,
        volumeMultiplier: 0.6,
        intensityDelta: -2,
        recommendation: 'Cambiar a estrés metabólico, evitar tensión mecánica'
    },
    5: { // Dolor incapacitante
        canTrainAffectedMuscle: false,
        volumeMultiplier: 0,
        intensityDelta: -4,
        recommendation: 'Descanso total del grupo muscular afectado'
    }
};

/**
 * TÉCNICAS DE INTENSIDAD PARA EQUIPO LIMITADO
 */
export const INTENSITY_TECHNIQUES = {
    tempo_extended: {
        name: 'Tempo Extendido',
        tempo: '4-2-2-1',
        effect: 'Aumenta TUT sin necesidad de más peso',
        when: 'Cuando las reps superan 20 con buena forma'
    },
    rest_pause: {
        name: 'Rest-Pause',
        restSeconds: 15,
        effect: 'Permite más trabajo total con el mismo peso',
        when: 'Meseta en progresión de reps'
    },
    drop_set: {
        name: 'Drop Set',
        reductions: 2,
        effect: 'Máxima fatiga metabólica',
        when: 'Última serie de ejercicios de aislamiento'
    },
    pre_exhaust: {
        name: 'Pre-fatiga',
        effect: 'Estimula fibras musculares con menos carga absoluta',
        when: 'Equipo muy limitado (solo peso corporal)'
    },
    mechanical_drop: {
        name: 'Drop Mecánico',
        effect: 'Cambiar a variante más fácil sin soltar el peso',
        when: 'Series extendidas para hipertrofia'
    },
    blood_flow_restriction: {
        name: 'BFR (Restricción de Flujo)',
        effect: 'Hipertrofia con cargas muy bajas (20-30% 1RM)',
        when: 'Rehabilitación o equipo extremadamente limitado'
    }
};

/**
 * LÍMITES DE SEGURIDAD PARA PROGRESIÓN DE CARGA
 */
export const LOAD_PROGRESSION_LIMITS = {
    maxWeeklyIncrease: {
        compound: 0.05, // 5% máximo
        isolation: 0.03 // 3% máximo
    },
    maxSessionIncrease: {
        compound: 0.025, // 2.5%
        isolation: 0.02 // 2%
    },
    deloadReduction: {
        volume: 0.5, // 50% menos sets
        intensity: 0.7 // 30% menos peso
    }
};

/**
 * CONFIGURACIÓN DE MESETA (PLATEAU)
 * Criterios para detectar estancamiento
 */
export const PLATEAU_DETECTION = {
    sessionsToAnalyze: 6, // Últimas 6 sesiones del ejercicio
    noProgressThreshold: 4, // Si 4+ sesiones sin mejora = meseta
    interventions: [
        'Cambiar ejercicio por variante diferente',
        'Aplicar técnica de intensidad',
        'Modificar rango de repeticiones',
        'Ajustar tempo de ejecución',
        'Implementar periodización ondulante'
    ]
};
