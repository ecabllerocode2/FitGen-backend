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
    // NOTA: Si skipPotentiate=true en opciones, se omite esta fase
    // porque se generará después con el primer ejercicio del main block
    if (!opciones.skipPotentiate) {
        const fasePotentiate = generarFasePotentiate(
            inventarioEjercicios, 
            patronesSesion,
            opciones.nivel
        );
        bloqueRAMP.push(...fasePotentiate);
    }
    
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
 * SOLO CARDIO REAL: caminadora, bicicleta, elíptica, escaladora
 */
function generarFaseRaise(inventario, ambiente) {
    const ejerciciosRaise = [];
    
    // Buscar SOLO ejercicios de cardio real que se puedan mantener 3+ minutos
    const candidatosRaise = inventario.filter(ex => {
        const faseRAMP = normalizeText(ex.faseRAMP || '');
        const nombre = normalizeText(ex.nombre || '');
        const tipo = normalizeText(ex.tipo || '');
        const equipo = normalizeText(ex.equipo || '');
        
        // Cardio sostenible: máquinas de cardio o ejercicios de bajo impacto
        const esCardioSostenible = (
            nombre.includes('caminadora') ||
            nombre.includes('bicicleta') ||
            nombre.includes('eliptica') ||
            nombre.includes('escaladora') ||
            nombre.includes('remo') ||
            nombre.includes('trote') ||
            nombre.includes('caminar') ||
            nombre.includes('march') ||
            (tipo.includes('cardio') && !nombre.includes('jump') && !nombre.includes('sprint'))
        );
        
        return faseRAMP === 'raise' && esCardioSostenible;
    });
    
    if (candidatosRaise.length > 0) {
        const seleccionado = candidatosRaise[Math.floor(Math.random() * candidatosRaise.length)];
        ejerciciosRaise.push(formatearEjercicioRAMP(seleccionado, 'Raise', '3-5 min'));
    } else {
        // IMPORTANTE: Si no hay ejercicios de cardio en BD, lanzar advertencia
        console.warn('[RAMP] ⚠️ No se encontraron ejercicios de cardio en la BD. Verifica que la colección tenga ejercicios con faseRAMP="Raise"');
        // Devolver array vacío en lugar de hardcodear ejercicio
        // El frontend debe manejar esto mostrando instrucciones genéricas
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
    
    // CRÍTICO: NO agregar ejercicios hardcodeados, SOLO usar BD real
    if (ejerciciosActivate.length < 1) {
        console.warn('[RAMP] ⚠️ No se encontraron ejercicios de activación en la BD para los objetivos:', objetivos);
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
    
    // CRÍTICO: NO agregar ejercicios hardcodeados, SOLO usar BD real
    if (ejerciciosMobilize.length < 1) {
        console.warn('[RAMP] ⚠️ No se encontraron ejercicios de movilidad en la BD para:', focusNormalizado);
    }
    
    return ejerciciosMobilize;
}

/**
 * FASE P - POTENTIATE
 * Series de aproximación con el primer ejercicio del bloque principal
 * O ejercicios pliométricos/explosivos si no hay main block aún
 * IMPORTANTE: Esta función ahora puede recibir el primer ejercicio del main block
 * para generar series de aproximación detalladas
 */
function generarFasePotentiate(inventario, patronesSesion, nivel, primerEjercicioMain = null) {
    const ejerciciosPotentiate = [];
    
    // ====================================================================
    // OPCIÓN A: SERIES DE APROXIMACIÓN CON PRIMER EJERCICIO PRINCIPAL
    // ====================================================================
    if (primerEjercicioMain) {
        // Generar 2-3 series de aproximación progresivas
        const numSeriesAprox = nivel === 'Principiante' ? 2 : 3;
        const pesoObjetivo = primerEjercicioMain.pesoObjetivo || primerEjercicioMain.peso || 100; // Base 100kg si no hay dato
        
        // Progresión de cargas: 40% -> 60% -> 75% (última serie)
        const porcentajes = nivel === 'Principiante' ? [0.4, 0.6] : [0.4, 0.6, 0.75];
        const repsProgresion = nivel === 'Principiante' ? [8, 6] : [8, 6, 4];
        
        for (let i = 0; i < numSeriesAprox; i++) {
            const pesoSerie = Math.round(pesoObjetivo * porcentajes[i]);
            const reps = repsProgresion[i];
            
            ejerciciosPotentiate.push({
                id: `${primerEjercicioMain.id}-warmup-set-${i + 1}`,
                nombre: primerEjercicioMain.nombre,
                fase: 'Potentiate',
                tipo: 'aproximacion',
                
                // Estructura detallada como en main block
                serieNumero: i + 1,
                totalSeries: numSeriesAprox,
                reps: reps,
                peso: pesoSerie,
                porcentajeCarga: Math.round(porcentajes[i] * 100),
                descanso: '90s',
                
                // Información del ejercicio
                equipo: primerEjercicioMain.equipo,
                imageUrl: primerEjercicioMain.imageUrl || primerEjercicioMain.url_img_0,
                imageUrl2: primerEjercicioMain.imageUrl2 || primerEjercicioMain.url_img_1,
                instrucciones: primerEjercicioMain.descripcion || primerEjercicioMain.instrucciones,
                
                notas: `Serie de aproximación ${i + 1}/${numSeriesAprox}: ${Math.round(porcentajes[i] * 100)}% del peso objetivo. Enfoque en técnica perfecta.`,
                esSerieAproximacion: true
            });
        }
        
        return ejerciciosPotentiate;
    }
    
    // ====================================================================
    // OPCIÓN B: EJERCICIOS PLIOMÉTRICOS/EXPLOSIVOS (FALLBACK)
    // ====================================================================
    // Solo si NO hay series de aproximación disponibles
    
    // Buscar ejercicios de potenciación (pliométricos o explosivos) en BD
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
        
        // Estructurar 2-3 series detalladas
        const numSeries = nivel === 'Principiante' ? 2 : 3;
        const reps = nivel === 'Principiante' ? 5 : 3;
        
        for (let i = 0; i < numSeries; i++) {
            ejerciciosPotentiate.push({
                ...formatearEjercicioRAMP(seleccionado, 'Potentiate', `${reps} reps`),
                serieNumero: i + 1,
                totalSeries: numSeries,
                reps: reps,
                descanso: '90s',
                intensidad: 'Explosiva',
                notas: `Serie ${i + 1}/${numSeries}: Máxima velocidad de ejecución. Calidad sobre cantidad.`
            });
        }
    } else {
        // CRÍTICO: NO usar fallback hardcodeado
        console.warn('[RAMP] ⚠️ No se encontraron ejercicios de potenciación en BD y no hay primer ejercicio main para series de aproximación');
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
