// ====================================================================
// CORE BUILDER MODULE
// Generador de bloque de entrenamiento de Core
// Enfoque en anti-movimiento según principios de Stuart McGill
// ====================================================================

import { normalizeText, shuffleArray } from './utils.js';
import { calcularCargaPrecisa } from './loadCalculator.js';

// Patrones de core según categoría funcional (McGill)
const CORE_PATTERN_MAPPING = {
    'anti_extension': ['planchas', 'ab_wheel', 'dead_bug', 'hollow_body'],
    'anti_flexion_lateral': ['farmer_walk', 'side_plank', 'suitcase_carry'],
    'anti_rotacion': ['pallof_press', 'bird_dog', 'plank_row'],
    'flexion_controlada': ['crunch', 'reverse_crunch', 'leg_raise'],
    'rotacion_controlada': ['russian_twist', 'cable_woodchop'],
    'hip_flexion': ['hanging_leg_raise', 'knee_raise', 'mountain_climber'],
    'global_stability': ['hollow_hold', 'plank_variations', 'carries']
};

// Configuración de volumen por nivel
const CORE_VOLUME_CONFIG = {
    Principiante: { ejercicios: 2, series: 2, repsBase: 10, tiempoBase: 20 },
    Intermedio: { ejercicios: 3, series: 3, repsBase: 12, tiempoBase: 30 },
    Avanzado: { ejercicios: 4, series: 3, repsBase: 15, tiempoBase: 40 }
};

// Progresión de ejercicios de core por dificultad
const CORE_PROGRESSIONS = {
    'plank': ['plank_rodillas', 'plank', 'plank_elevada', 'plank_remo', 'plank_dinamica'],
    'side_plank': ['side_plank_rodilla', 'side_plank', 'side_plank_elevada', 'side_plank_star'],
    'dead_bug': ['dead_bug_basico', 'dead_bug_alternado', 'dead_bug_resistencia', 'dead_bug_kettlebell'],
    'bird_dog': ['bird_dog_basico', 'bird_dog_alternado', 'bird_dog_resistencia'],
    'pallof': ['pallof_estatico', 'pallof_press', 'pallof_walk', 'pallof_rotacion'],
    'leg_raise': ['leg_raise_flexionado', 'leg_raise_recto', 'hanging_leg_raise', 'toes_to_bar']
};

/**
 * Construye el bloque de entrenamiento de Core
 * @param {Array} ejerciciosCore - Ejercicios de core disponibles
 * @param {string} nivel - Nivel del usuario
 * @param {number} rpeObjetivo - RPE base del mesociclo
 * @param {Object} contextualData - Datos contextuales del usuario
 * @param {Object} readinessAdjustments - Ajustes de autoregulación
 * @param {string} coreFocus - Foco planificado del core desde contentData (opcional)
 * @returns {Object} Bloque de core estructurado
 */
export function construirBloqueCore(ejerciciosCore, nivel, rpeObjetivo, contextualData, readinessAdjustments, coreFocus = null) {
    const config = CORE_VOLUME_CONFIG[nivel] || CORE_VOLUME_CONFIG.Intermedio;
    
    // Ajustar volumen según readiness
    const factorVolumen = readinessAdjustments?.factorVolumen || 1.0;
    const ejerciciosRequeridos = Math.max(2, Math.ceil(config.ejercicios * factorVolumen));
    const seriesBase = Math.max(2, Math.ceil(config.series * factorVolumen));
    
    console.log(`[CoreBuilder] Foco planificado del mesociclo: ${coreFocus || 'General'}`);
    
    // ====================================================================
    // 1. CLASIFICAR EJERCICIOS POR PATRÓN FUNCIONAL
    // ====================================================================
    const ejerciciosPorPatron = clasificarEjerciciosCore(ejerciciosCore);
    
    // ====================================================================
    // 2. SELECCIONAR EJERCICIOS BALANCEADOS (considerando foco)
    // ====================================================================
    const ejerciciosSeleccionados = seleccionarEjerciciosCore(
        ejerciciosPorPatron,
        ejerciciosRequeridos,
        nivel,
        contextualData,
        coreFocus // NUEVO: Pasar foco planificado
    );
    
    // ====================================================================
    // 3. GENERAR PRESCRIPCIONES
    // ====================================================================
    const bloqueCore = {
        tipo: 'core',
        nombre: 'Entrenamiento de Core',
        duracionEstimada: ejerciciosSeleccionados.length * 3, // minutos
        ejercicios: []
    };
    
    for (const ejercicio of ejerciciosSeleccionados) {
        const prescripcion = generarPrescripcionCore(
            ejercicio,
            seriesBase,
            config,
            rpeObjetivo,
            nivel
        );
        
        bloqueCore.ejercicios.push({
            ...ejercicio,
            prescripcion,
            notas: generarNotasCore(ejercicio, nivel),
            imageUrl: ejercicio.url_img_0 || ejercicio.url,
            imageUrl2: ejercicio.url_img_1
        });
    }
    
    // ====================================================================
    // 4. ESTRUCTURAR COMO CIRCUITO SI HAY SUFICIENTES EJERCICIOS
    // ====================================================================
    if (bloqueCore.ejercicios.length >= 3) {
        bloqueCore.estructura = 'circuito';
        bloqueCore.instrucciones = 'Realiza todos los ejercicios seguidos con descanso mínimo. ' +
                                  `Descansa ${getDescansoCircuito(nivel)} segundos entre rondas.`;
        bloqueCore.rondas = seriesBase;
        // En circuito, cada ejercicio tiene 1 serie por ronda
        bloqueCore.ejercicios = bloqueCore.ejercicios.map(ej => ({
            ...ej,
            prescripcion: {
                ...ej.prescripcion,
                series: 1 // 1 serie por ronda en circuito
            }
        }));
    } else {
        bloqueCore.estructura = 'secuencial';
        bloqueCore.instrucciones = 'Completa todas las series de un ejercicio antes de pasar al siguiente.';
    }
    
    return bloqueCore;
}

/**
 * Clasifica ejercicios de core por patrón funcional
 */
function clasificarEjerciciosCore(ejercicios) {
    const clasificacion = {
        anti_extension: [],
        anti_flexion_lateral: [],
        anti_rotacion: [],
        flexion_controlada: [],
        rotacion_controlada: [],
        hip_flexion: [],
        global_stability: []
    };
    
    for (const ejercicio of ejercicios) {
        const nombre = normalizeText(ejercicio.nombre || ejercicio.name || '');
        const patron = ejercicio.patronMovimiento || ejercicio.pattern || '';
        const patronNorm = normalizeText(patron);
        
        // Detectar por nombre o patrón
        if (esAntiExtension(nombre, patronNorm)) {
            clasificacion.anti_extension.push(ejercicio);
        } else if (esAntiFlexionLateral(nombre, patronNorm)) {
            clasificacion.anti_flexion_lateral.push(ejercicio);
        } else if (esAntiRotacion(nombre, patronNorm)) {
            clasificacion.anti_rotacion.push(ejercicio);
        } else if (esFlexionControlada(nombre)) {
            clasificacion.flexion_controlada.push(ejercicio);
        } else if (esHipFlexion(nombre)) {
            clasificacion.hip_flexion.push(ejercicio);
        } else {
            // Ejercicio general de core
            clasificacion.global_stability.push(ejercicio);
        }
    }
    
    return clasificacion;
}

function esAntiExtension(nombre, patron) {
    const keywords = ['plank', 'plancha', 'dead_bug', 'hollow', 'ab_wheel', 'rollout', 'body_saw'];
    return keywords.some(k => nombre.includes(k)) || patron.includes('anti_extension');
}

function esAntiFlexionLateral(nombre, patron) {
    const keywords = ['side_plank', 'plancha_lateral', 'farmer', 'suitcase', 'carry', 'maleta'];
    return keywords.some(k => nombre.includes(k)) || patron.includes('anti_flexion');
}

function esAntiRotacion(nombre, patron) {
    const keywords = ['pallof', 'bird_dog', 'plank_row', 'remo_plancha', 'anti_rot'];
    return keywords.some(k => nombre.includes(k)) || patron.includes('anti_rotacion');
}

function esFlexionControlada(nombre) {
    const keywords = ['crunch', 'curl', 'abdominal', 'reverse_crunch'];
    return keywords.some(k => nombre.includes(k));
}

function esHipFlexion(nombre) {
    const keywords = ['leg_raise', 'knee_raise', 'hanging', 'colgado', 'mountain'];
    return keywords.some(k => nombre.includes(k));
}

/**
 * Selecciona ejercicios de core balanceados
 */
function seleccionarEjerciciosCore(ejerciciosPorPatron, cantidad, nivel, contextualData, coreFocus = null) {
    const seleccionados = [];
    
    // Normalizar lesiones: puede ser string, array o null
    const lesionesRaw = contextualData?.usuario?.injuriesOrLimitations;
    let lesiones = [];
    if (Array.isArray(lesionesRaw)) {
        lesiones = lesionesRaw;
    } else if (typeof lesionesRaw === 'string' && lesionesRaw.toLowerCase() !== 'ninguna' && lesionesRaw !== '') {
        lesiones = [lesionesRaw];
    }
    
    // NUEVO: Ajustar prioridad según foco planificado del mesociclo
    let prioridadPatrones = [
        'anti_extension',      // Base de estabilidad espinal
        'anti_flexion_lateral', // Estabilidad frontal
        'anti_rotacion',       // Control rotacional
        'global_stability'     // Transferencia general
    ];
    
    // Si el mesociclo especificó un foco, priorizarlo
    if (coreFocus) {
        const focoNorm = normalizeText(coreFocus);
        if (focoNorm.includes('anti') && focoNorm.includes('rotacion')) {
            prioridadPatrones = ['anti_rotacion', 'anti_extension', 'anti_flexion_lateral', 'global_stability'];
        } else if (focoNorm.includes('anti') && focoNorm.includes('extension')) {
            prioridadPatrones = ['anti_extension', 'anti_flexion_lateral', 'anti_rotacion', 'global_stability'];
        } else if (focoNorm.includes('lateral')) {
            prioridadPatrones = ['anti_flexion_lateral', 'anti_rotacion', 'anti_extension', 'global_stability'];
        }
    }
    
    // Si tiene historial de dolor lumbar, priorizar anti-movimiento
    const tieneLesionLumbar = lesiones.length > 0 && lesiones.some(l => 
        normalizeText(l).includes('lumbar') || 
        normalizeText(l).includes('espalda_baja')
    );
    
    if (tieneLesionLumbar) {
        // Evitar flexión y rotación cargada
        delete ejerciciosPorPatron.flexion_controlada;
        delete ejerciciosPorPatron.rotacion_controlada;
    }
    
    // Seleccionar al menos uno de cada patrón prioritario
    for (const patron of prioridadPatrones) {
        if (seleccionados.length >= cantidad) break;
        
        const disponibles = ejerciciosPorPatron[patron] || [];
        if (disponibles.length > 0) {
            const ejercicio = seleccionarMejorEjercicio(disponibles, nivel);
            if (ejercicio && !seleccionados.find(e => e.id === ejercicio.id)) {
                seleccionados.push(ejercicio);
            }
        }
    }
    
    // Si faltan ejercicios, añadir de otras categorías
    const otrosPatrones = ['flexion_controlada', 'hip_flexion', 'rotacion_controlada'];
    for (const patron of otrosPatrones) {
        if (seleccionados.length >= cantidad) break;
        
        const disponibles = ejerciciosPorPatron[patron] || [];
        if (disponibles.length > 0) {
            const ejercicio = seleccionarMejorEjercicio(disponibles, nivel);
            if (ejercicio && !seleccionados.find(e => e.id === ejercicio.id)) {
                seleccionados.push(ejercicio);
            }
        }
    }
    
    return seleccionados;
}

/**
 * Selecciona el mejor ejercicio de core según nivel
 */
function seleccionarMejorEjercicio(ejercicios, nivel) {
    // Mapeo de dificultad técnica a nivel
    const dificultadObjetivo = {
        Principiante: [1, 2],
        Intermedio: [2, 3],
        Avanzado: [3, 4, 5]
    };
    
    const rangoAceptable = dificultadObjetivo[nivel] || [2, 3];
    
    // Filtrar por dificultad apropiada
    const apropiados = ejercicios.filter(e => {
        const dif = e.dificultadTecnica || 2;
        return dif >= rangoAceptable[0] && dif <= rangoAceptable[rangoAceptable.length - 1];
    });
    
    if (apropiados.length === 0) return ejercicios[0];
    
    // Priorizar los que tienen imagen
    const conImagen = apropiados.filter(e => e.imagenUrl || e.image);
    if (conImagen.length > 0) {
        return conImagen[Math.floor(Math.random() * conImagen.length)];
    }
    
    return apropiados[Math.floor(Math.random() * apropiados.length)];
}

/**
 * Genera la prescripción para un ejercicio de core
 */
function generarPrescripcionCore(ejercicio, seriesBase, config, rpeObjetivo, nivel) {
    const nombre = normalizeText(ejercicio.nombre || ejercicio.name || '');
    const esIsometrico = esEjercicioIsometrico(nombre);
    const esUnilateral = ejercicio.isUnilateral || false;
    
    // RPE ajustado para core (generalmente más bajo que bloque principal)
    const rpeCoreAjustado = Math.min(rpeObjetivo - 1, 7);
    
    if (esIsometrico) {
        // Prescripción basada en tiempo
        let tiempo = config.tiempoBase;
        
        // Ajustar según nivel
        if (nivel === 'Principiante') tiempo = Math.max(15, tiempo - 10);
        if (nivel === 'Avanzado') tiempo = Math.min(60, tiempo + 15);
        
        return {
            series: seriesBase,
            tiempo: `${tiempo}s`,
            repsOTiempo: `${tiempo} segundos`,
            descanso: getDescansoCore(nivel),
            rpeObjetivo: rpeCoreAjustado,
            notaUnilateral: esUnilateral ? 'Por lado' : null,
            tipo: 'isometrico'
        };
    } else {
        // Prescripción basada en repeticiones
        let reps = config.repsBase;
        
        // Ajustar según nivel
        if (nivel === 'Principiante') reps = Math.max(8, reps - 4);
        if (nivel === 'Avanzado') reps = Math.min(20, reps + 5);
        
        return {
            series: seriesBase,
            reps: reps,
            repsOTiempo: `${reps} reps`,
            descanso: getDescansoCore(nivel),
            rpeObjetivo: rpeCoreAjustado,
            notaUnilateral: esUnilateral ? 'Por lado' : null,
            tipo: 'dinamico'
        };
    }
}

/**
 * Determina si un ejercicio es isométrico
 */
function esEjercicioIsometrico(nombre) {
    const isometricos = [
        'plank', 'plancha', 'hollow', 'hold', 'dead_bug_hold',
        'side_plank', 'bird_dog_hold', 'pallof_hold', 'l_sit',
        'carry', 'farmer', 'suitcase', 'maleta'
    ];
    return isometricos.some(k => nombre.includes(k));
}

/**
 * Obtiene el descanso recomendado para core
 */
function getDescansoCore(nivel) {
    const descansos = {
        Principiante: 45,
        Intermedio: 30,
        Avanzado: 20
    };
    return descansos[nivel] || 30;
}

/**
 * Obtiene el descanso entre rondas de circuito
 */
function getDescansoCircuito(nivel) {
    const descansos = {
        Principiante: 90,
        Intermedio: 60,
        Avanzado: 45
    };
    return descansos[nivel] || 60;
}

/**
 * Genera notas educativas para el ejercicio de core
 */
function generarNotasCore(ejercicio, nivel) {
    const nombre = normalizeText(ejercicio.nombre || ejercicio.name || '');
    
    // Notas específicas por tipo de ejercicio
    if (nombre.includes('plank') || nombre.includes('plancha')) {
        return 'Mantén la línea recta de cabeza a talones. Aprieta glúteos y abdomen ' +
               'como si fueras a recibir un puñetazo. No dejes que la cadera caiga.';
    }
    
    if (nombre.includes('dead_bug')) {
        return 'La espalda baja debe permanecer pegada al suelo en todo momento. ' +
               'Si se levanta, estás llevando las extremidades demasiado lejos.';
    }
    
    if (nombre.includes('bird_dog')) {
        return 'Imagina que tienes un vaso de agua en la espalda baja - no lo derrames. ' +
               'Movimientos lentos y controlados, sin balanceo de cadera.';
    }
    
    if (nombre.includes('pallof')) {
        return 'El core trabaja RESISTIENDO la rotación. Mantén los brazos extendidos ' +
               'y el torso completamente quieto mirando al frente.';
    }
    
    if (nombre.includes('hollow')) {
        return 'Presiona la zona lumbar contra el suelo. Si la espalda se despega, ' +
               'eleva más las piernas hasta poder mantener la posición correcta.';
    }
    
    if (nombre.includes('leg_raise') || nombre.includes('knee_raise')) {
        return 'Evita el balanceo usando el core para controlar el movimiento. ' +
               'Sube las piernas lentamente y bájalas aún más lento.';
    }
    
    // Nota genérica
    return 'Mantén el core activo durante todo el movimiento. Respira de manera controlada ' +
           'sin contener la respiración. Calidad sobre cantidad.';
}

/**
 * Genera bloque de core para sesiones con limitación de tiempo
 */
export function generarCoreFinnisher(ejerciciosCore, nivel, duracionMaxima = 5) {
    // Circuito rápido de 2-3 ejercicios, 2 rondas
    const config = {
        ejercicios: 2,
        rondas: 2,
        trabajoDescanso: nivel === 'Principiante' ? [20, 20] : [30, 15]
    };
    
    const clasificados = clasificarEjerciciosCore(ejerciciosCore);
    
    // Seleccionar uno de anti-extensión y uno de anti-rotación/lateral
    const seleccionados = [];
    
    if (clasificados.anti_extension.length > 0) {
        seleccionados.push(clasificados.anti_extension[0]);
    }
    if (clasificados.anti_rotacion.length > 0) {
        seleccionados.push(clasificados.anti_rotacion[0]);
    } else if (clasificados.anti_flexion_lateral.length > 0) {
        seleccionados.push(clasificados.anti_flexion_lateral[0]);
    }
    
    return {
        tipo: 'core_finisher',
        nombre: 'Core Finisher',
        formato: `${config.rondas} rondas x ${seleccionados.length} ejercicios`,
        tiempoTrabajo: `${config.trabajoDescanso[0]}s trabajo / ${config.trabajoDescanso[1]}s descanso`,
        duracionTotal: `${duracionMaxima} minutos`,
        ejercicios: seleccionados.map(e => ({
            ...e,
            tiempo: `${config.trabajoDescanso[0]}s`,
            notas: generarNotasCore(e, nivel),
            imageUrl: e.url_img_0 || e.url,
            imageUrl2: e.url_img_1
        }))
    };
}

export default {
    construirBloqueCore,
    generarCoreFinnisher
};
