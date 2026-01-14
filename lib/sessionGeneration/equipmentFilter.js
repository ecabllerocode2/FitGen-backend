// ====================================================================
// EQUIPMENT FILTER MODULE
// Filtrado inteligente de ejercicios según equipamiento disponible
// ====================================================================

import { normalizeText } from './utils.js';

/**
 * MAPEO DE EQUIPAMIENTO EQUIVALENTE
 * Permite flexibilidad en la selección de ejercicios
 */
const EQUIPMENT_EQUIVALENCES = {
    'mancuernas': ['mancuerna', 'dumbbell', 'dumbbells'],
    'barra olimpica': ['barra', 'barbell', 'barra de pesos'],
    'barra de dominadas': ['dominadas', 'pull up bar', 'barra pull up', 'barra de puerta'],
    'kettlebell': ['pesa rusa', 'kb'],
    'bandas de resistencia': ['banda', 'ligas', 'resistance band'],
    'mini loop bands': ['mini banda', 'loop band', 'hip circle'],
    'banco ajustable': ['banco', 'bench'],
    'foam roller': ['rodillo', 'roller'],
    'peso corporal': ['bodyweight', 'sin equipo', 'ninguno'],
    'poleas': ['cable', 'cable machine'],
    'rack de potencia': ['rack', 'power rack', 'squat rack'],
    'suspension straps': ['trx', 'suspension trainer']
};

/**
 * CATEGORIZACIÓN DE EQUIPAMIENTO
 * Define qué tipo de carga proporciona cada equipo
 */
const EQUIPMENT_CATEGORIES = {
    carga_principal: ['mancuernas', 'barra olimpica', 'kettlebell', 'poleas'],
    traccion: ['barra de dominadas', 'suspension straps', 'poleas'],
    resistencia_variable: ['bandas de resistencia', 'mini loop bands'],
    estabilidad: ['banco ajustable', 'rack de potencia'],
    recuperacion: ['foam roller'],
    sin_equipo: ['peso corporal']
};

/**
 * Detecta el ambiente de entrenamiento basado en el equipamiento
 * @param {Array} userEquipment - Lista de equipo del usuario
 * @returns {string} Tipo de ambiente: 'gym', 'home_equipped', 'home_minimal', 'bodyweight'
 */
export function detectarAmbienteEntrenamiento(userEquipment) {
    if (!userEquipment || userEquipment.length === 0) {
        return 'bodyweight';
    }
    
    const normalizedEquipment = userEquipment.map(e => normalizeText(e));
    const equipmentString = normalizedEquipment.join(' ');
    
    // Gym comercial
    if (equipmentString.includes('gimnasio') || equipmentString.includes('gym')) {
        return 'gym';
    }
    
    // Contar tipos de equipo de carga
    const hasDumbbells = normalizedEquipment.some(e => 
        e.includes('mancuerna') || e.includes('dumbbell')
    );
    const hasBarbell = normalizedEquipment.some(e => 
        e.includes('barra') && !e.includes('dominadas') && !e.includes('pull')
    );
    const hasKettlebell = normalizedEquipment.some(e => 
        e.includes('kettlebell') || e.includes('pesa rusa')
    );
    const hasPullUpBar = normalizedEquipment.some(e => 
        e.includes('dominadas') || e.includes('pull up')
    );
    const hasBands = normalizedEquipment.some(e => 
        e.includes('banda') || e.includes('liga')
    );
    
    const loadEquipmentCount = [hasDumbbells, hasBarbell, hasKettlebell].filter(Boolean).length;
    
    if (loadEquipmentCount >= 2 || (loadEquipmentCount >= 1 && hasPullUpBar)) {
        return 'home_equipped';
    }
    
    if (loadEquipmentCount >= 1 || hasBands || hasPullUpBar) {
        return 'home_minimal';
    }
    
    return 'bodyweight';
}

/**
 * Filtra ejercicios según el equipamiento disponible
 * IMPORTANTE: Ahora es ESTRICTO - solo permite ejercicios con equipo que el usuario tiene
 * 
 * @param {Array} catalogoCompleto - Array de todos los ejercicios
 * @param {string} ubicacionUsuario - 'gym' | 'home'
 * @param {Array} inventarioUsuario - Lista de equipo que tiene el usuario (ya normalizada por ubicación)
 * @returns {Array} Ejercicios que el usuario puede realizar
 */
export function filtrarEjerciciosDisponibles(catalogoCompleto, ubicacionUsuario, inventarioUsuario) {
    if (!catalogoCompleto || catalogoCompleto.length === 0) {
        return [];
    }
    
    // El inventario ya viene normalizado desde generateV2.js
    // - En gym: tiene el equipo estándar de gym + peso corporal
    // - En home: tiene exactamente lo que el usuario seleccionó + peso corporal
    const inventarioNormalizado = (inventarioUsuario || ['Peso Corporal']).map(e => normalizeText(e));
    
    // Asegurarse de que peso corporal siempre esté incluido
    if (!inventarioNormalizado.some(e => e.includes('peso corporal') || e.includes('bodyweight'))) {
        inventarioNormalizado.push('peso corporal');
    }
    
    return catalogoCompleto.filter(ejercicio => {
        return esEjercicioViableEstricto(ejercicio, inventarioNormalizado, ubicacionUsuario);
    });
}

/**
 * Determina si un ejercicio es viable dado el equipamiento - MODO ESTRICTO
 * Solo permite ejercicios si el usuario tiene TODO el equipo requerido
 * 
 * @param {Object} ejercicio - Objeto del ejercicio
 * @param {Array} inventarioNormalizado - Inventario normalizado del usuario
 * @param {string} ubicacion - 'gym' | 'home'
 * @returns {boolean} Si el ejercicio es realizable
 */
function esEjercicioViableEstricto(ejercicio, inventarioNormalizado, ubicacion) {
    // Obtener equipo requerido (puede ser string o array)
    let equipoRequerido = ejercicio.equipo;
    if (typeof equipoRequerido === 'string') {
        equipoRequerido = [equipoRequerido];
    }
    if (!equipoRequerido || equipoRequerido.length === 0) {
        equipoRequerido = ['Peso Corporal'];
    }
    
    // Normalizar equipo requerido
    const equipoRequeridoNormalizado = equipoRequerido.map(e => normalizeText(e));
    
    // CASO A: Peso corporal - siempre viable
    if (equipoRequeridoNormalizado.some(e => 
        e.includes('peso corporal') || 
        e.includes('bodyweight') || 
        e.includes('sin equipo') ||
        e === ''
    )) {
        return true;
    }
    
    // CASO B: Verificar cada ítem de equipo requerido
    return equipoRequeridoNormalizado.every(itemRequerido => {
        return verificarEquipoDisponible(itemRequerido, inventarioNormalizado);
    });
}

/**
 * Verifica si un ítem de equipo específico está disponible
 * @param {string} itemRequerido - Equipo requerido normalizado
 * @param {Array} inventario - Inventario del usuario normalizado
 * @returns {boolean} Si el equipo está disponible
 */
function verificarEquipoDisponible(itemRequerido, inventario) {
    // Búsqueda directa
    if (inventario.some(inv => inv.includes(itemRequerido) || itemRequerido.includes(inv))) {
        return true;
    }
    
    // Búsqueda por equivalencias
    for (const [categoria, equivalentes] of Object.entries(EQUIPMENT_EQUIVALENCES)) {
        const categoriaMatchRequerido = equivalentes.some(eq => itemRequerido.includes(eq)) || 
                                        itemRequerido.includes(categoria);
        
        if (categoriaMatchRequerido) {
            // El ejercicio pide algo de esta categoría, verificar si el usuario lo tiene
            const usuarioTieneEquivalente = inventario.some(inv => {
                return equivalentes.some(eq => inv.includes(eq)) || inv.includes(categoria);
            });
            
            if (usuarioTieneEquivalente) {
                return true;
            }
        }
    }
    
    // Casos especiales
    
    // 1. Barra de dominadas vs barra de pesos
    if (itemRequerido.includes('dominadas') || itemRequerido.includes('pull')) {
        return inventario.some(inv => inv.includes('dominadas') || inv.includes('pull'));
    }
    
    if (itemRequerido.includes('barra') && !itemRequerido.includes('dominadas')) {
        return inventario.some(inv => 
            inv.includes('barra') && !inv.includes('dominadas') && !inv.includes('pull')
        );
    }
    
    // 2. Mini bands vs bandas normales
    if (itemRequerido.includes('mini') || itemRequerido.includes('loop')) {
        return inventario.some(inv => inv.includes('mini') || inv.includes('loop'));
    }
    
    if (itemRequerido.includes('banda') && !itemRequerido.includes('mini')) {
        return inventario.some(inv => 
            (inv.includes('banda') || inv.includes('liga')) && !inv.includes('mini')
        );
    }
    
    return false;
}

/**
 * Sugiere sustituciones de equipamiento para un ejercicio
 * @param {Object} ejercicio - Ejercicio que requiere sustitución
 * @param {Array} inventarioUsuario - Equipo disponible
 * @returns {Object|null} Sugerencia de sustitución o null
 */
export function sugerirSustitucionEquipo(ejercicio, inventarioUsuario) {
    const equipoOriginal = normalizeText(
        Array.isArray(ejercicio.equipo) ? ejercicio.equipo[0] : ejercicio.equipo || ''
    );
    
    const inventarioNormalizado = (inventarioUsuario || []).map(e => normalizeText(e));
    
    const sustituciones = {
        'barra olimpica': [
            { equipo: 'mancuernas', nota: 'Usar mancuernas en lugar de barra' },
            { equipo: 'kettlebell', nota: 'Usar kettlebell como alternativa' }
        ],
        'poleas': [
            { equipo: 'bandas de resistencia', nota: 'Bandas replican la curva de resistencia variable' },
            { equipo: 'mancuernas', nota: 'Usar mancuernas con gravedad' }
        ],
        'maquina': [
            { equipo: 'mancuernas', nota: 'Versión con peso libre' },
            { equipo: 'bandas de resistencia', nota: 'Versión con bandas' },
            { equipo: 'peso corporal', nota: 'Versión calistenia' }
        ],
        'banco ajustable': [
            { equipo: 'suelo', nota: 'Realizar en el suelo (menor rango de movimiento)' }
        ]
    };
    
    for (const [original, alternativas] of Object.entries(sustituciones)) {
        if (equipoOriginal.includes(original)) {
            for (const alt of alternativas) {
                if (inventarioNormalizado.some(inv => inv.includes(normalizeText(alt.equipo)))) {
                    return {
                        equipoOriginal: equipoOriginal,
                        equipoSustituto: alt.equipo,
                        nota: alt.nota
                    };
                }
            }
        }
    }
    
    return null;
}

/**
 * Obtiene el peso máximo disponible para un tipo de equipo
 * @param {Array} inventarioUsuario - Equipo del usuario
 * @param {string} tipoEquipo - Tipo de equipo (ej: 'mancuernas')
 * @returns {number|null} Peso máximo disponible en kg
 */
export function obtenerPesoMaximoDisponible(inventarioUsuario, tipoEquipo) {
    if (!inventarioUsuario || inventarioUsuario.length === 0) return null;
    
    const tipoNormalizado = normalizeText(tipoEquipo);
    let maxPeso = 0;
    
    for (const item of inventarioUsuario) {
        const itemNormalizado = normalizeText(item);
        
        // Verificar si es del tipo correcto
        let esDelTipo = false;
        for (const [categoria, equivalentes] of Object.entries(EQUIPMENT_EQUIVALENCES)) {
            if (tipoNormalizado.includes(categoria) || equivalentes.some(eq => tipoNormalizado.includes(eq))) {
                if (itemNormalizado.includes(categoria) || equivalentes.some(eq => itemNormalizado.includes(eq))) {
                    esDelTipo = true;
                    break;
                }
            }
        }
        
        if (!esDelTipo) continue;
        
        // Extraer peso del nombre (ej: "Mancuernas 10kg", "Mancuerna (15 kg)")
        const pesoMatch = item.match(/(\d+(?:\.\d+)?)\s*(?:kg|lb|lbs)/i);
        if (pesoMatch) {
            let peso = parseFloat(pesoMatch[1]);
            
            // Convertir libras a kg si es necesario
            if (item.toLowerCase().includes('lb')) {
                peso = peso * 0.453592;
            }
            
            maxPeso = Math.max(maxPeso, peso);
        }
    }
    
    return maxPeso > 0 ? maxPeso : null;
}

/**
 * Genera un perfil completo del equipamiento del usuario
 * @param {Array} inventarioUsuario - Lista de equipo
 * @returns {Object} Perfil detallado del equipamiento
 */
export function generarPerfilEquipamiento(inventarioUsuario) {
    const ambiente = detectarAmbienteEntrenamiento(inventarioUsuario);
    const inventarioNormalizado = (inventarioUsuario || []).map(e => normalizeText(e));
    
    const perfil = {
        ambiente,
        equipoDisponible: {
            cargaPrincipal: [],
            traccion: [],
            resistenciaVariable: [],
            estabilidad: [],
            recuperacion: []
        },
        pesosMaximos: {},
        capacidades: {
            puedeCargarPesado: false,
            puedeTraccionVertical: false,
            tieneResistenciaVariable: false,
            puedeAjustarInclinacion: false
        },
        limitaciones: []
    };
    
    // Analizar cada categoría de equipo
    for (const item of inventarioUsuario || []) {
        const itemNorm = normalizeText(item);
        
        // Carga principal
        if (itemNorm.includes('mancuerna') || itemNorm.includes('barra') || itemNorm.includes('kettlebell')) {
            if (!itemNorm.includes('dominadas') && !itemNorm.includes('pull')) {
                perfil.equipoDisponible.cargaPrincipal.push(item);
                perfil.capacidades.puedeCargarPesado = true;
            }
        }
        
        // Tracción
        if (itemNorm.includes('dominadas') || itemNorm.includes('pull') || itemNorm.includes('trx')) {
            perfil.equipoDisponible.traccion.push(item);
            perfil.capacidades.puedeTraccionVertical = true;
        }
        
        // Resistencia variable
        if (itemNorm.includes('banda') || itemNorm.includes('liga')) {
            perfil.equipoDisponible.resistenciaVariable.push(item);
            perfil.capacidades.tieneResistenciaVariable = true;
        }
        
        // Estabilidad
        if (itemNorm.includes('banco')) {
            perfil.equipoDisponible.estabilidad.push(item);
            perfil.capacidades.puedeAjustarInclinacion = true;
        }
        
        // Recuperación
        if (itemNorm.includes('foam') || itemNorm.includes('rodillo')) {
            perfil.equipoDisponible.recuperacion.push(item);
        }
    }
    
    // Calcular pesos máximos por tipo
    perfil.pesosMaximos = {
        mancuernas: obtenerPesoMaximoDisponible(inventarioUsuario, 'mancuernas'),
        barra: obtenerPesoMaximoDisponible(inventarioUsuario, 'barra'),
        kettlebell: obtenerPesoMaximoDisponible(inventarioUsuario, 'kettlebell')
    };
    
    // Identificar limitaciones
    if (!perfil.capacidades.puedeCargarPesado) {
        perfil.limitaciones.push('Sin equipo de carga pesada - se usarán técnicas de intensidad');
    }
    if (!perfil.capacidades.puedeTraccionVertical) {
        perfil.limitaciones.push('Sin barra de dominadas - se priorizarán remos');
    }
    if (!perfil.capacidades.puedeAjustarInclinacion) {
        perfil.limitaciones.push('Sin banco - ejercicios se realizarán en suelo');
    }
    
    return perfil;
}

export default {
    detectarAmbienteEntrenamiento,
    filtrarEjerciciosDisponibles,
    sugerirSustitucionEquipo,
    obtenerPesoMaximoDisponible,
    generarPerfilEquipamiento
};
