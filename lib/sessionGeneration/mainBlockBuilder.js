// ====================================================================
// MAIN BLOCK BUILDER MODULE
// Constructor del bloque principal de entrenamiento
// Implementa ordenamiento biomecánico y selección inteligente de ejercicios
// ====================================================================

import { 
    MOVEMENT_PATTERN_MAP, 
    MUSCLE_FOCUS_MAP, 
    VOLUME_CONFIG, 
    REST_PROTOCOLS,
    SESSION_SLOT_STRUCTURE,
    FATIGUE_COEFFICIENTS 
} from './constants.js';
import { calcularCargaPrecisa } from './loadCalculator.js';
import { getRecentlyUsedExercises, detectPlateau } from './dataFetcher.js';
import { generarPerfilEquipamiento } from './equipmentFilter.js';
import { normalizeText, shuffleArray } from './utils.js';

/**
 * Construye el bloque principal de la sesión
 * @param {Object} sesionObj - Objeto de la sesión del mesociclo
 * @param {Object} microciclo - Contexto del microciclo actual
 * @param {Array} historial - Historial del usuario
 * @param {Object} ajustes - Ajustes de readiness
 * @param {Array} inventario - Ejercicios filtrados por equipo
 * @param {string} nivelExp - Nivel de experiencia del usuario
 * @param {Array} dbEjercicios - Base de datos completa de ejercicios
 * @param {Object} perfilEquipoInput - Perfil de equipo con pesos específicos
 *   { equipamiento: [...], ubicacion: 'gym'|'home', pesosEspecificos: { dumbbells: [...], barbell: ... } }
 * @returns {Object} Bloque principal estructurado
 */
export function construirBloquePrincipal(
    sesionObj,
    microciclo,
    historial,
    ajustes,
    inventario,
    nivelExp,
    dbEjercicios,
    perfilEquipoInput
) {
    const bloquesFinal = [];
    
    // Generar perfil de equipamiento extendido con pesos específicos
    const equipoArray = perfilEquipoInput?.equipamiento || perfilEquipoInput || [];
    const perfilEquipo = generarPerfilEquipamiento(Array.isArray(equipoArray) ? equipoArray : []);
    
    // Agregar pesos específicos del frontend al perfil
    if (perfilEquipoInput?.pesosEspecificos) {
        perfilEquipo.pesosEspecificosFrontend = perfilEquipoInput.pesosEspecificos;
        perfilEquipo.ubicacion = perfilEquipoInput.ubicacion;
    }
    
    // Obtener ejercicios usados recientemente para evitar repetición
    const ejerciciosRecientes = getRecentlyUsedExercises(historial, 7, sesionObj.sessionFocus);
    
    // ====================================================================
    // PASO 1: MAPEO DE PATRONES DE MOVIMIENTO
    // ====================================================================
    const patronesACubrir = mapearFocusAPatrones(sesionObj.sessionFocus);
    const musculosObjetivo = mapearFocusAMusculos(sesionObj.sessionFocus);
    
    // ====================================================================
    // PASO 2: DETERMINAR ESTRUCTURA DE SLOTS
    // ====================================================================
    const estructuraSlots = SESSION_SLOT_STRUCTURE[nivelExp] || SESSION_SLOT_STRUCTURE.Intermedio;
    const configVolumen = VOLUME_CONFIG[nivelExp] || VOLUME_CONFIG.Intermedio;
    
    // Ajustar slots por factor de volumen
    let slotsEfectivos = Math.round(estructuraSlots.totalSlots * ajustes.factorVolumen);
    slotsEfectivos = Math.max(3, slotsEfectivos); // Mínimo 3 ejercicios
    
    // Distribuir prioridades
    const distribucion = calcularDistribucionPrioridades(
        estructuraSlots.distribution,
        slotsEfectivos,
        ajustes.tipoSesionModificada
    );
    
    // ====================================================================
    // PASO 3: SELECCIÓN DE EJERCICIOS POR PRIORIDAD
    // ====================================================================
    const ejerciciosSeleccionados = [];
    const idsUsados = new Set();
    
    // PRIORIDAD 1: Ejercicios multiarticulares principales
    for (let i = 0; i < distribucion.priority1; i++) {
        const ejercicio = seleccionarMejorEjercicio(
            inventario,
            patronesACubrir,
            musculosObjetivo,
            1, // prioridad
            ejerciciosRecientes,
            idsUsados,
            historial,
            nivelExp
        );
        
        if (ejercicio) {
            ejerciciosSeleccionados.push({ ...ejercicio, rolSesion: 'primario' });
            idsUsados.add(ejercicio.id);
        }
    }
    
    // PRIORIDAD 2: Ejercicios accesorios
    for (let i = 0; i < distribucion.priority2; i++) {
        const ejercicio = seleccionarMejorEjercicio(
            inventario,
            patronesACubrir,
            musculosObjetivo,
            2, // prioridad
            ejerciciosRecientes,
            idsUsados,
            historial,
            nivelExp
        );
        
        if (ejercicio) {
            ejerciciosSeleccionados.push({ ...ejercicio, rolSesion: 'secundario' });
            idsUsados.add(ejercicio.id);
        }
    }
    
    // PRIORIDAD 3: Ejercicios de aislamiento
    for (let i = 0; i < distribucion.priority3; i++) {
        const ejercicio = seleccionarMejorEjercicio(
            inventario,
            patronesACubrir,
            musculosObjetivo,
            3, // prioridad
            ejerciciosRecientes,
            idsUsados,
            historial,
            nivelExp
        );
        
        if (ejercicio) {
            ejerciciosSeleccionados.push({ ...ejercicio, rolSesion: 'aislamiento' });
            idsUsados.add(ejercicio.id);
        }
    }
    
    // ====================================================================
    // PASO 4: ORDENAMIENTO BIOMECÁNICO
    // ====================================================================
    const ejerciciosOrdenados = ordenarEjerciciosBiomecanicamente(ejerciciosSeleccionados);
    
    // ====================================================================
    // PASO 5: PRESCRIPCIÓN DE CARGA Y VOLUMEN
    // ====================================================================
    for (const ejercicio of ejerciciosOrdenados) {
        const prescripcion = calcularCargaPrecisa(
            ejercicio,
            historial,
            microciclo,
            ajustes,
            perfilEquipo
        );
        
        // Determinar sets según rol y nivel
        const setsBase = ejercicio.rolSesion === 'primario' 
            ? configVolumen.setsPerExercise.compound
            : configVolumen.setsPerExercise.isolation;
        
        const setsFinal = Math.max(2, Math.round(setsBase * ajustes.factorVolumen));
        
        // Determinar descanso según objetivo y tipo
        const protocoloDescanso = REST_PROTOCOLS[getObjetivoDesdeGoal(microciclo)] || REST_PROTOCOLS.Hipertrofia;
        const descansoBase = ejercicio.rolSesion === 'primario' 
            ? protocoloDescanso.compound.min
            : protocoloDescanso.isolation.min;
        
        const descansoFinal = Math.round(descansoBase * (ajustes.multiplicadorDescanso || 1));
        
        bloquesFinal.push({
            id: ejercicio.id,
            nombre: ejercicio.nombre,
            descripcion: ejercicio.descripcion,
            correcciones: ejercicio.correcciones || [],
            
            // Prescripción
            sets: setsFinal,
            reps: prescripcion.repsObjetivo,
            peso: prescripcion.pesoSugerido,
            rpeTarget: prescripcion.rpeObjetivo,
            rirTarget: prescripcion.rirObjetivo,
            tempo: prescripcion.tempo,
            descanso: `${descansoFinal}s`,
            
            // Metadatos
            equipo: ejercicio.equipo,
            patronMovimiento: ejercicio.patronMovimiento,
            parteCuerpo: ejercicio.parteCuerpo,
            prioridad: ejercicio.prioridad,
            rolSesion: ejercicio.rolSesion,
            
            // Progresión
            tipoProgresion: prescripcion.tipoProgresion,
            tecnica: prescripcion.tecnica,
            
            // Indicadores históricos
            indicadores: prescripcion.indicadores,
            
            // Notas y justificación
            notasTecnicas: ejercicio.correcciones?.join(' | ') || '',
            justificacionCarga: prescripcion.explicacion,
            
            // Imágenes
            imageUrl: ejercicio.url_img_0 || ejercicio.url,
            imageUrl2: ejercicio.url_img_1,
            
            // Estructura para tracking
            performanceData: {
                plannedSets: setsFinal,
                actualSets: []
            }
        });
    }
    
    // ====================================================================
    // PASO 6: ESTRUCTURAR COMO BLOQUES (Estaciones o Superseries)
    // ====================================================================
    const metodoSesion = sesionObj.structureType || 'Estaciones_Puras';
    
    return estructurarBloques(bloquesFinal, metodoSesion, microciclo, ajustes);
}

/**
 * Mapea el foco de sesión a patrones de movimiento
 */
function mapearFocusAPatrones(sessionFocus) {
    const focusNorm = normalizeText(sessionFocus || '');
    
    for (const [key, patrones] of Object.entries(MOVEMENT_PATTERN_MAP)) {
        if (focusNorm.includes(normalizeText(key))) {
            return patrones;
        }
    }
    
    // Fallback: patrones generales
    return ['Empuje_H', 'Traccion_H', 'Rodilla', 'Cadera'];
}

/**
 * Mapea el foco a músculos objetivo
 */
function mapearFocusAMusculos(sessionFocus) {
    const focusNorm = normalizeText(sessionFocus || '');
    
    for (const [key, musculos] of Object.entries(MUSCLE_FOCUS_MAP)) {
        if (focusNorm.includes(normalizeText(key))) {
            return musculos;
        }
    }
    
    return ['General'];
}

/**
 * Calcula la distribución de prioridades según slots disponibles
 */
function calcularDistribucionPrioridades(distribucionBase, slotsEfectivos, tipoModificado) {
    const ratio = slotsEfectivos / (distribucionBase.priority1 + distribucionBase.priority2 + distribucionBase.priority3);
    
    let dist = {
        priority1: Math.max(1, Math.round(distribucionBase.priority1 * ratio)),
        priority2: Math.max(1, Math.round(distribucionBase.priority2 * ratio)),
        priority3: Math.max(0, Math.round(distribucionBase.priority3 * ratio))
    };
    
    // Ajustar si la sesión es de recuperación/metabólica
    if (tipoModificado === 'Hipertrofia_Metabolica' || tipoModificado === 'Recuperacion_Activa') {
        // Menos compuestos pesados, más aislamiento
        dist.priority1 = Math.max(1, dist.priority1 - 1);
        dist.priority3 = dist.priority3 + 1;
    }
    
    // Asegurar que la suma sea igual a slotsEfectivos
    const suma = dist.priority1 + dist.priority2 + dist.priority3;
    if (suma > slotsEfectivos) {
        dist.priority3 = Math.max(0, dist.priority3 - (suma - slotsEfectivos));
    }
    
    return dist;
}

/**
 * Selecciona el mejor ejercicio según criterios biomecánicos
 */
function seleccionarMejorEjercicio(
    inventario,
    patronesObjetivo,
    musculosObjetivo,
    prioridadBuscada,
    ejerciciosRecientes,
    idsUsados,
    historial,
    nivel
) {
    // Filtrar por prioridad
    let candidatos = inventario.filter(ex => {
        // Debe coincidir con la prioridad
        if (ex.prioridad !== prioridadBuscada) return false;
        
        // No debe estar ya seleccionado
        if (idsUsados.has(ex.id)) return false;
        
        // Debe ser del bloque principal
        const categoria = normalizeText(ex.categoriaBloque || '');
        if (categoria !== 'main_block' && categoria !== '') return false;
        
        // Debe coincidir con patrones o músculos objetivo
        const patronEj = normalizeText(ex.patronMovimiento || '');
        const parteEj = normalizeText(ex.parteCuerpo || '');
        
        const coincidePatron = patronesObjetivo.some(p => patronEj.includes(normalizeText(p)));
        const coincideMusculo = musculosObjetivo.some(m => parteEj.includes(normalizeText(m)));
        
        return coincidePatron || coincideMusculo;
    });
    
    if (candidatos.length === 0) {
        // Relajar criterios: buscar por músculos solamente
        candidatos = inventario.filter(ex => {
            if (idsUsados.has(ex.id)) return false;
            const parteEj = normalizeText(ex.parteCuerpo || '');
            return musculosObjetivo.some(m => parteEj.includes(normalizeText(m)));
        });
    }
    
    if (candidatos.length === 0) return null;
    
    // SCORING: Puntuar cada candidato
    const candidatosConScore = candidatos.map(ex => {
        let score = 0;
        
        // Bonus por no haber sido usado recientemente
        if (!ejerciciosRecientes.has(ex.id)) {
            score += 10;
        }
        
        // Bonus por tener imágenes
        if (ex.url_img_0 || ex.url) {
            score += 2;
        }
        
        // Bonus por tener correcciones (indica buena calidad de datos)
        if (ex.correcciones && ex.correcciones.length > 0) {
            score += 3;
        }
        
        // Penalización por dificultad técnica alta para principiantes
        if (nivel === 'Principiante' && ex.dificultadTecnica === 'Alta') {
            score -= 5;
        }
        
        // Bonus por ejercicios unilaterales para intermedios/avanzados
        if ((nivel === 'Intermedio' || nivel === 'Avanzado') && ex.isUnilateral) {
            score += 2;
        }
        
        // Detectar mesetas y penalizar ejercicios estancados
        const analisisMeseta = detectPlateau(historial, ex.id);
        if (analisisMeseta.isPlateau) {
            score -= 15; // Fuerte penalización para promover variación
        }
        
        return { ...ex, score };
    });
    
    // Ordenar por score y añadir algo de aleatoriedad
    candidatosConScore.sort((a, b) => b.score - a.score);
    
    // Seleccionar del top 3 aleatoriamente para añadir variedad
    const top = candidatosConScore.slice(0, 3);
    return top[Math.floor(Math.random() * top.length)];
}

/**
 * Ordena ejercicios según principios biomecánicos
 * 1. Mayor demanda neurológica primero
 * 2. Multiarticulares antes que aislamiento
 * 3. Peso libre antes que máquinas (si aplica)
 */
function ordenarEjerciciosBiomecanicamente(ejercicios) {
    return ejercicios.sort((a, b) => {
        // Primero por prioridad (menor = más importante)
        if (a.prioridad !== b.prioridad) {
            return a.prioridad - b.prioridad;
        }
        
        // Luego por coeficiente de fatiga del patrón de movimiento
        const fatigaA = FATIGUE_COEFFICIENTS[a.patronMovimiento] || 0.5;
        const fatigaB = FATIGUE_COEFFICIENTS[b.patronMovimiento] || 0.5;
        
        return fatigaB - fatigaA; // Mayor fatiga primero
    });
}

/**
 * Estructura los ejercicios en bloques según el método
 */
function estructurarBloques(ejercicios, metodo, microciclo, ajustes) {
    const protocoloDescanso = microciclo.restProtocol || { betweenSets: 90, betweenExercises: 60 };
    
    if (metodo === 'Superseries_Antagonistas') {
        // Agrupar en pares antagonistas
        return estructurarSuperseries(ejercicios, protocoloDescanso, ajustes);
    } else if (metodo === 'Circuito_Metabolico') {
        // Un solo bloque tipo circuito
        return estructurarCircuito(ejercicios, protocoloDescanso, ajustes);
    } else {
        // Estaciones puras (default)
        return estructurarEstaciones(ejercicios, protocoloDescanso, ajustes);
    }
}

/**
 * Estructura como estaciones individuales
 */
function estructurarEstaciones(ejercicios, protocoloDescanso, ajustes) {
    const descansoBase = protocoloDescanso.betweenSets || 90;
    const multiplicador = ajustes.multiplicadorDescanso || 1;
    
    return {
        tipo: 'estaciones',
        descripcion: 'Completa todas las series de un ejercicio antes de pasar al siguiente',
        bloques: ejercicios.map(ej => ({
            tipo: 'estacion',
            ejercicios: [ej],
            descansoEntreSeries: Math.round(descansoBase * multiplicador),
            descansoEntreEjercicios: protocoloDescanso.betweenExercises || 60
        }))
    };
}

/**
 * Estructura como superseries antagonistas
 */
function estructurarSuperseries(ejercicios, protocoloDescanso, ajustes) {
    const bloques = [];
    const usados = new Set();
    
    // Mapeo de patrones antagonistas
    const antagonistas = {
        'Empuje_H': 'Traccion_H',
        'Empuje_V': 'Traccion_V',
        'Traccion_H': 'Empuje_H',
        'Traccion_V': 'Empuje_V',
        'Rodilla': 'Cadera',
        'Cadera': 'Rodilla'
    };
    
    for (const ejercicio of ejercicios) {
        if (usados.has(ejercicio.id)) continue;
        
        const patronAntagonista = antagonistas[ejercicio.patronMovimiento];
        const pareja = ejercicios.find(e => 
            !usados.has(e.id) && 
            e.id !== ejercicio.id &&
            e.patronMovimiento === patronAntagonista
        );
        
        if (pareja) {
            bloques.push({
                tipo: 'superserie',
                ejercicios: [ejercicio, pareja],
                descansoEntreSeries: 60, // Descanso corto en superseries
                descansoEntreEjercicios: 0, // Sin descanso entre ejercicios de la superserie
                descansoPostBloque: protocoloDescanso.betweenExercises || 90
            });
            usados.add(ejercicio.id);
            usados.add(pareja.id);
        } else {
            // Sin pareja - hacer estación individual
            bloques.push({
                tipo: 'estacion',
                ejercicios: [ejercicio],
                descansoEntreSeries: protocoloDescanso.betweenSets || 90
            });
            usados.add(ejercicio.id);
        }
    }
    
    return {
        tipo: 'superseries',
        descripcion: 'Alterna entre ejercicios antagonistas sin descanso',
        bloques
    };
}

/**
 * Estructura como circuito metabólico
 */
function estructurarCircuito(ejercicios, protocoloDescanso, ajustes) {
    return {
        tipo: 'circuito',
        descripcion: 'Realiza todos los ejercicios seguidos, luego descansa y repite',
        bloques: [{
            tipo: 'circuito',
            ejercicios: ejercicios,
            descansoEntreSeries: 0, // Sin descanso dentro del circuito
            descansoEntreVueltas: 90, // Descanso entre vueltas del circuito
            vueltas: 3 // Número de vueltas al circuito
        }]
    };
}

/**
 * Obtiene el objetivo desde el goal del microciclo
 */
function getObjetivoDesdeGoal(microciclo) {
    const focus = normalizeText(microciclo.focus || '');
    
    if (focus.includes('fuerza') || focus.includes('intensificacion') || focus.includes('sobrecarga')) {
        return 'Fuerza';
    }
    if (focus.includes('volumen') || focus.includes('acumulacion')) {
        return 'Hipertrofia';
    }
    if (focus.includes('descarga') || focus.includes('deload')) {
        return 'Resistencia';
    }
    
    return 'Hipertrofia';
}

export default {
    construirBloquePrincipal
};
