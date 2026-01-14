// ====================================================================
// RAMP GENERATOR MODULE
// Generador de Calentamientos basado en el Protocolo RAMP
// R - Raise (Elevar temperatura)
// A - Activate (Activar músculos débiles)
// M - Mobilize (Movilizar articulaciones)
// P - Potentiate (Potenciar SNC)
// ====================================================================

import { RAMP_PHASE_CONFIG, INJURY_MOVEMENT_MAP, MOVEMENT_PATTERN_MAP } from './constants.js';
import { normalizeText } from './utils.js';

/**
 * Genera el bloque de calentamiento RAMP personalizado
 * @param {string} sesionFocus - Foco de la sesión (ej: "Pierna", "Pecho/Espalda")
 * @param {string|Array} lesionesUsuario - Lesiones o limitaciones del usuario
 * @param {Array} inventarioEjercicios - Ejercicios filtrados por equipo disponible
 * @param {Object} opciones - Opciones adicionales (nivel, tiempo disponible, etc.)
 * @returns {Array} Bloque de calentamiento estructurado
 */
export function generarCalentamiento(sesionFocus, lesionesUsuario, inventarioEjercicios, opciones = {}) {
    const bloqueRAMP = [];
    const focusNormalizado = normalizeText(sesionFocus || '');
    
    // Mapear el focus a objetivos musculares específicos
    const objetivosMusculares = mapearFocusAObjetivos(focusNormalizado);
    
    // Obtener patrones de movimiento de la sesión
    const patronesSesion = obtenerPatronesMovimiento(focusNormalizado);
    
    // ====================================================================
    // FASE R - RAISE (Elevar Temperatura)
    // ====================================================================
    const faseRaise = generarFaseRaise(inventarioEjercicios, opciones.ambiente);
    bloqueRAMP.push(...faseRaise);
    
    // ====================================================================
    // FASE A - ACTIVATE (Activación Muscular)
    // ====================================================================
    const faseActivate = generarFaseActivate(
        inventarioEjercicios, 
        objetivosMusculares, 
        lesionesUsuario
    );
    bloqueRAMP.push(...faseActivate);
    
    // ====================================================================
    // FASE M - MOBILIZE (Movilidad Articular)
    // ====================================================================
    const faseMobilize = generarFaseMobilize(
        inventarioEjercicios, 
        objetivosMusculares, 
        focusNormalizado
    );
    bloqueRAMP.push(...faseMobilize);
    
    // ====================================================================
    // FASE P - POTENTIATE (Potenciación del SNC)
    // ====================================================================
    const fasePotentiate = generarFasePotentiate(
        inventarioEjercicios, 
        patronesSesion,
        opciones.nivel
    );
    bloqueRAMP.push(...fasePotentiate);
    
    // ====================================================================
    // PRE-HABILITACIÓN POR LESIONES
    // ====================================================================
    const prehabEjercicios = generarPrehabilitacion(
        inventarioEjercicios, 
        lesionesUsuario
    );
    
    // Insertar prehab después de Activate
    if (prehabEjercicios.length > 0) {
        const indexActivate = bloqueRAMP.findIndex(e => e.fase === 'Activate');
        bloqueRAMP.splice(indexActivate + 1, 0, ...prehabEjercicios);
    }
    
    return bloqueRAMP;
}

/**
 * Mapea el foco de sesión a objetivos musculares
 */
function mapearFocusAObjetivos(focusNormalizado) {
    const objetivos = [];
    
    if (focusNormalizado.includes('pierna') || focusNormalizado.includes('legs')) {
        objetivos.push('cuadriceps', 'isquiotibiales', 'gluteos', 'pantorrillas', 'cadera');
    }
    if (focusNormalizado.includes('pecho') || focusNormalizado.includes('empuje') || focusNormalizado.includes('push')) {
        objetivos.push('pecho', 'hombros', 'triceps');
    }
    if (focusNormalizado.includes('espalda') || focusNormalizado.includes('traccion') || focusNormalizado.includes('pull')) {
        objetivos.push('espalda', 'biceps', 'dorsal');
    }
    if (focusNormalizado.includes('hombro')) {
        objetivos.push('hombros', 'deltoides', 'manguito rotador');
    }
    if (focusNormalizado.includes('brazo')) {
        objetivos.push('biceps', 'triceps', 'antebrazo');
    }
    if (focusNormalizado.includes('full') || focusNormalizado.includes('body')) {
        objetivos.push('general', 'cuadriceps', 'gluteos', 'pecho', 'espalda');
    }
    if (focusNormalizado.includes('core') || focusNormalizado.includes('cardio')) {
        objetivos.push('core', 'general', 'cadera');
    }
    
    return objetivos.length > 0 ? objetivos : ['general'];
}

/**
 * Obtiene patrones de movimiento de la sesión
 */
function obtenerPatronesMovimiento(focusNormalizado) {
    // Buscar en el mapeo de patrones
    for (const [key, patrones] of Object.entries(MOVEMENT_PATTERN_MAP)) {
        if (focusNormalizado.includes(normalizeText(key))) {
            return patrones;
        }
    }
    return ['General'];
}

/**
 * FASE R - RAISE
 * Ejercicios para elevar temperatura corporal y frecuencia cardíaca
 */
function generarFaseRaise(inventario, ambiente) {
    const ejerciciosRaise = [];
    
    // Buscar ejercicios de cardio ligero o movimientos generales
    const candidatosRaise = inventario.filter(ex => {
        const faseRAMP = normalizeText(ex.faseRAMP || '');
        const categoria = normalizeText(ex.categoriaBloque || '');
        const tipo = normalizeText(ex.tipo || '');
        const parte = normalizeText(ex.parteCuerpo || '');
        
        return faseRAMP === 'raise' || 
               (categoria === 'calentamiento' && parte.includes('general')) ||
               tipo.includes('cardio');
    });
    
    if (candidatosRaise.length > 0) {
        const seleccionado = candidatosRaise[Math.floor(Math.random() * candidatosRaise.length)];
        ejerciciosRaise.push(formatearEjercicioRAMP(seleccionado, 'Raise', '3-5 min'));
    } else {
        // Fallback: Ejercicio genérico de activación general
        ejerciciosRaise.push({
            id: 'raise-generic',
            nombre: 'Cardio Ligero / Movilidad Dinámica General',
            fase: 'Raise',
            duracion: '3-5 min',
            instrucciones: 'Trote estático, Jumping Jacks, escaleras o bicicleta suave. Objetivo: sudor leve y respiración elevada.',
            tipo: 'cardio',
            notas: 'Eleva gradualmente la intensidad durante los primeros 2 minutos.'
        });
    }
    
    return ejerciciosRaise;
}

/**
 * FASE A - ACTIVATE
 * Activación de músculos estabilizadores y cadenas débiles
 */
function generarFaseActivate(inventario, objetivos, lesiones) {
    const ejerciciosActivate = [];
    const maxEjercicios = 2;
    
    // Buscar ejercicios de activación
    const candidatosActivate = inventario.filter(ex => {
        const faseRAMP = normalizeText(ex.faseRAMP || '');
        const categoria = normalizeText(ex.categoriaBloque || '');
        const parte = normalizeText(ex.parteCuerpo || '');
        const tipo = normalizeText(ex.tipo || '');
        
        // Debe ser de activación Y relevante para los objetivos de hoy
        const esActivacion = faseRAMP === 'activate' || 
                            (categoria === 'calentamiento' && tipo.includes('activacion'));
        
        const esRelevante = objetivos.some(obj => parte.includes(obj));
        
        return esActivacion && esRelevante;
    });
    
    // Priorizar ejercicios de bandas si están disponibles (mejor activación)
    const conBandas = candidatosActivate.filter(ex => 
        normalizeText(ex.equipo || '').includes('banda')
    );
    
    const poolFinal = conBandas.length > 0 ? conBandas : candidatosActivate;
    
    // Seleccionar ejercicios variados
    const seleccionados = seleccionarEjerciciosVariados(poolFinal, maxEjercicios);
    
    seleccionados.forEach(ex => {
        ejerciciosActivate.push(formatearEjercicioRAMP(ex, 'Activate', '10-15 reps'));
    });
    
    // Si no hay suficientes, agregar activación genérica
    if (ejerciciosActivate.length < 1) {
        ejerciciosActivate.push({
            id: 'activate-generic',
            nombre: 'Activación General con Peso Corporal',
            fase: 'Activate',
            duracion: '10-12 reps por lado',
            instrucciones: 'Bird-Dogs, Dead Bugs o Puentes de Glúteo lentos y controlados.',
            tipo: 'activacion',
            notas: 'Enfócate en la conexión mente-músculo y la estabilidad.'
        });
    }
    
    return ejerciciosActivate;
}

/**
 * FASE M - MOBILIZE
 * Movilidad articular específica para la sesión
 */
function generarFaseMobilize(inventario, objetivos, focusNormalizado) {
    const ejerciciosMobilize = [];
    const maxEjercicios = 2;
    
    // Determinar articulaciones clave según el foco
    const articulacionesClave = determinarArticulacionesClave(focusNormalizado);
    
    // Buscar ejercicios de movilidad
    const candidatosMobilize = inventario.filter(ex => {
        const faseRAMP = normalizeText(ex.faseRAMP || '');
        const categoria = normalizeText(ex.categoriaBloque || '');
        const tipo = normalizeText(ex.tipo || '');
        const parte = normalizeText(ex.parteCuerpo || '');
        
        const esMovilidad = faseRAMP === 'mobilize' || 
                           tipo.includes('movilidad') ||
                           (categoria === 'calentamiento' && ex.isDynamic);
        
        const esRelevante = articulacionesClave.some(art => parte.includes(art)) ||
                           objetivos.some(obj => parte.includes(obj));
        
        return esMovilidad && esRelevante;
    });
    
    // Seleccionar ejercicios variados
    const seleccionados = seleccionarEjerciciosVariados(candidatosMobilize, maxEjercicios);
    
    seleccionados.forEach(ex => {
        const duracion = ex.measureType === 'time' ? '30-45s por lado' : '8-10 reps por lado';
        ejerciciosMobilize.push(formatearEjercicioRAMP(ex, 'Mobilize', duracion));
    });
    
    // Si no hay suficientes, agregar movilidad genérica según el foco
    if (ejerciciosMobilize.length < 1) {
        const movilidadGenerica = getMovilidadGenerica(focusNormalizado);
        ejerciciosMobilize.push(movilidadGenerica);
    }
    
    return ejerciciosMobilize;
}

/**
 * FASE P - POTENTIATE
 * Potenciación del Sistema Nervioso Central
 */
function generarFasePotentiate(inventario, patronesSesion, nivel) {
    const ejerciciosPotentiate = [];
    
    // Los principiantes no necesitan potenciación explosiva
    if (nivel === 'Principiante') {
        ejerciciosPotentiate.push({
            id: 'potentiate-beginner',
            nombre: 'Series de Aproximación',
            fase: 'Potentiate',
            duracion: '2-3 series x 5-8 reps con peso ligero',
            instrucciones: 'Realiza el primer ejercicio principal con 50-60% del peso objetivo. Enfócate en la técnica perfecta.',
            tipo: 'potenciacion',
            notas: 'Esto prepara el patrón motor y activa las fibras musculares específicas.'
        });
        return ejerciciosPotentiate;
    }
    
    // Buscar ejercicios de potenciación (pliométricos o explosivos)
    const candidatosPotentiate = inventario.filter(ex => {
        const faseRAMP = normalizeText(ex.faseRAMP || '');
        const tipo = normalizeText(ex.tipo || '');
        const patron = normalizeText(ex.patronMovimiento || '');
        
        const esPotenciacion = faseRAMP === 'potentiate' || 
                              tipo.includes('pliometrico') ||
                              tipo.includes('explosivo');
        
        // Debe coincidir con los patrones de la sesión
        const patronRelevante = patronesSesion.some(p => patron.includes(normalizeText(p)));
        
        return esPotenciacion && patronRelevante;
    });
    
    if (candidatosPotentiate.length > 0) {
        const seleccionado = candidatosPotentiate[Math.floor(Math.random() * candidatosPotentiate.length)];
        ejerciciosPotentiate.push(formatearEjercicioRAMP(seleccionado, 'Potentiate', '2-3 series x 3-5 reps', {
            intensidad: 'Explosiva',
            descanso: '60-90s',
            notas: 'Máxima velocidad de ejecución. Calidad sobre cantidad.'
        }));
    } else {
        // Fallback según patrón de movimiento
        const potenciacionGenerica = getPotenciacionGenerica(patronesSesion[0] || 'General');
        ejerciciosPotentiate.push(potenciacionGenerica);
    }
    
    return ejerciciosPotentiate;
}

/**
 * Genera ejercicios de pre-habilitación según lesiones
 */
function generarPrehabilitacion(inventario, lesiones) {
    const prehabEjercicios = [];
    
    if (!lesiones || lesiones === 'Ninguna' || lesiones === 'ninguna') {
        return prehabEjercicios;
    }
    
    // Normalizar lesiones
    const lesionesNorm = normalizeText(Array.isArray(lesiones) ? lesiones.join(' ') : lesiones);
    
    // Buscar en el mapeo de lesiones
    for (const [zonaLesion, config] of Object.entries(INJURY_MOVEMENT_MAP)) {
        if (lesionesNorm.includes(normalizeText(zonaLesion))) {
            // Buscar ejercicios de prehab específicos
            const candidatosPrehab = inventario.filter(ex => {
                const categoria = normalizeText(ex.categoriaBloque || '');
                const parte = normalizeText(ex.parteCuerpo || '');
                const nombre = normalizeText(ex.nombre || '');
                
                // Buscar ejercicios que coincidan con las recomendaciones de prehab
                const esCalentamiento = categoria === 'calentamiento';
                const esRelevante = config.prehab.some(p => 
                    parte.includes(normalizeText(p)) || nombre.includes(normalizeText(p))
                );
                
                return esCalentamiento && esRelevante;
            });
            
            if (candidatosPrehab.length > 0) {
                const seleccionado = candidatosPrehab[0];
                prehabEjercicios.push(formatearEjercicioRAMP(seleccionado, 'Prehab', '12-15 reps', {
                    notas: `⚠️ Protección de ${zonaLesion}: Este ejercicio prepara y protege la zona afectada.`
                }));
            }
        }
    }
    
    return prehabEjercicios;
}

/**
 * Determina articulaciones clave según el foco
 */
function determinarArticulacionesClave(focusNormalizado) {
    const articulaciones = [];
    
    if (focusNormalizado.includes('pierna') || focusNormalizado.includes('full')) {
        articulaciones.push('cadera', 'rodilla', 'tobillo');
    }
    if (focusNormalizado.includes('pecho') || focusNormalizado.includes('empuje') || focusNormalizado.includes('hombro')) {
        articulaciones.push('hombro', 'toracic', 'escapula');
    }
    if (focusNormalizado.includes('espalda') || focusNormalizado.includes('traccion')) {
        articulaciones.push('hombro', 'toracic', 'cadera');
    }
    
    return articulaciones.length > 0 ? articulaciones : ['general'];
}

/**
 * Selecciona ejercicios variados evitando repetición
 */
function seleccionarEjerciciosVariados(pool, cantidad) {
    if (pool.length <= cantidad) return pool;
    
    const seleccionados = [];
    const partesUsadas = new Set();
    
    for (const ejercicio of shuffleArray(pool)) {
        const parte = normalizeText(ejercicio.parteCuerpo || '');
        
        if (!partesUsadas.has(parte)) {
            seleccionados.push(ejercicio);
            partesUsadas.add(parte);
        }
        
        if (seleccionados.length >= cantidad) break;
    }
    
    // Si no hay suficiente variedad, completar con lo que haya
    while (seleccionados.length < cantidad && seleccionados.length < pool.length) {
        const siguiente = pool.find(e => !seleccionados.includes(e));
        if (siguiente) seleccionados.push(siguiente);
        else break;
    }
    
    return seleccionados;
}

/**
 * Formatea un ejercicio para el bloque RAMP
 */
function formatearEjercicioRAMP(ejercicio, fase, duracion, extras = {}) {
    return {
        id: ejercicio.id || `${fase.toLowerCase()}-${Math.random().toString(36).substr(2, 9)}`,
        nombre: ejercicio.nombre,
        fase,
        duracion,
        instrucciones: ejercicio.descripcion,
        equipo: ejercicio.equipo || 'Peso Corporal',
        imageUrl: ejercicio.url_img_0 || ejercicio.url,
        imageUrl2: ejercicio.url_img_1,
        tipo: fase.toLowerCase(),
        parteCuerpo: ejercicio.parteCuerpo,
        ...extras
    };
}

/**
 * Obtiene movilidad genérica según foco
 */
function getMovilidadGenerica(focusNormalizado) {
    if (focusNormalizado.includes('pierna')) {
        return {
            id: 'mobilize-legs',
            nombre: 'World\'s Greatest Stretch',
            fase: 'Mobilize',
            duracion: '5-6 reps por lado',
            instrucciones: 'Zancada profunda, codo al piso, rotación torácica. Moviliza cadera, femorales y tórax.',
            tipo: 'movilidad'
        };
    } else if (focusNormalizado.includes('pecho') || focusNormalizado.includes('hombro')) {
        return {
            id: 'mobilize-upper',
            nombre: 'Open Books + Wall Slides',
            fase: 'Mobilize',
            duracion: '8-10 reps por ejercicio',
            instrucciones: 'Open Books para movilidad torácica, Wall Slides para activar serrato y mejorar overhead.',
            tipo: 'movilidad'
        };
    }
    
    return {
        id: 'mobilize-general',
        nombre: 'Cat-Cow + Hip Circles',
        fase: 'Mobilize',
        duracion: '10-12 reps',
        instrucciones: 'Cat-Cow para columna, círculos de cadera en cuadrupedia. Movilidad general.',
        tipo: 'movilidad'
    };
}

/**
 * Obtiene potenciación genérica según patrón
 */
function getPotenciacionGenerica(patron) {
    const potenciaciones = {
        'Rodilla': {
            nombre: 'Box Jumps o Squat Jumps',
            instrucciones: 'Saltos explosivos con aterrizaje suave. Preparación neural para sentadillas.'
        },
        'Cadera': {
            nombre: 'Broad Jumps o KB Swings Explosivos',
            instrucciones: 'Extensión explosiva de cadera. Activa glúteos y prepara para peso muerto.'
        },
        'Empuje_H': {
            nombre: 'Plyo Push-ups o Med Ball Chest Pass',
            instrucciones: 'Push-ups con despegue de manos o pases explosivos. Activa el SNC para press.'
        },
        'Empuje_V': {
            nombre: 'Med Ball Overhead Throws',
            instrucciones: 'Lanzamientos explosivos sobre la cabeza. Prepara para press militar.'
        },
        'Traccion_V': {
            nombre: 'Pull-up Explosivos o Lat Pulldown Explosivo',
            instrucciones: 'Dominadas con tirón rápido o jalones explosivos.'
        },
        'default': {
            nombre: 'Series de Aproximación al 50%',
            instrucciones: 'Realiza el primer ejercicio con carga ligera, enfocándote en velocidad y técnica.'
        }
    };
    
    const config = potenciaciones[patron] || potenciaciones['default'];
    
    return {
        id: `potentiate-${patron.toLowerCase()}`,
        nombre: config.nombre,
        fase: 'Potentiate',
        duracion: '2-3 series x 3-5 reps',
        instrucciones: config.instrucciones,
        tipo: 'potenciacion',
        notas: 'Máxima intención de velocidad. Descanso completo entre series (60-90s).'
    };
}

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffleArray(array) {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

export default {
    generarCalentamiento
};
