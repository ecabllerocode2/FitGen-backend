// ====================================================================
// COOLDOWN GENERATOR MODULE
// Generador de bloque de enfriamiento y recuperación
// Incluye estiramientos específicos según músculos trabajados
// ====================================================================

import { normalizeText, shuffleArray } from './utils.js';

// Mapeo de músculos a estiramientos recomendados (LEGACY: Ya no se usa, se lee del catálogo)
// const STRETCHES_BY_MUSCLE = { ... };

// Estiramientos generales de todo el cuerpo
const GENERAL_STRETCHES = [
    { nombre: 'Child Pose (Postura del Niño)', tiempo: 60, objetivo: 'Espalda baja, hombros, relajación general' },
    { nombre: 'Cat-Cow (Gato-Vaca)', tiempo: 60, objetivo: 'Movilidad espinal, activación parasimpática' },
    { nombre: 'World\'s Greatest Stretch', tiempo: 45, objetivo: 'Caderas, columna torácica, isquiotibiales', porLado: true },
    { nombre: 'Torsión Espinal Supina', tiempo: 45, objetivo: 'Columna, oblicuos, pecho', porLado: true },
    { nombre: 'Happy Baby', tiempo: 45, objetivo: 'Caderas, espalda baja, liberación de tensión' }
];

// Técnicas de respiración para recuperación
const BREATHING_PROTOCOLS = {
    basic: {
        nombre: 'Respiración Diafragmática',
        duracion: 60,
        instrucciones: 'Inhala 4 segundos llenando el abdomen, exhala 6 segundos vaciándolo completamente. ' +
                      'Repite 6-8 ciclos.',
        beneficio: 'Activa el sistema nervioso parasimpático, reduce cortisol, acelera recuperación.'
    },
    box: {
        nombre: 'Respiración Cuadrada (Box Breathing)',
        duracion: 90,
        instrucciones: 'Inhala 4s - Mantén 4s - Exhala 4s - Mantén 4s. Repite 4-6 ciclos.',
        beneficio: 'Equilibra el sistema nervioso, reduce ansiedad, mejora concentración.'
    },
    physiological_sigh: {
        nombre: 'Suspiro Fisiológico',
        duracion: 30,
        instrucciones: 'Inhala profundo por la nariz, luego una segunda inhalación corta adicional, ' +
                      'exhala lento por la boca (como un suspiro). Repite 3 veces.',
        beneficio: 'La forma más rápida de reducir el estrés según investigación de Stanford.'
    }
};

/**
 * Genera el bloque de enfriamiento completo
 * @param {Array} ejerciciosEnfriamiento - Ejercicios de cooldown disponibles en catálogo
 * @param {Object} bloquePrincipal - Bloque principal de la sesión (para identificar músculos trabajados)
 * @param {string} nivel - Nivel del usuario
 * @param {number} duracionMaxima - Duración máxima en minutos
 * @returns {Object} Bloque de enfriamiento estructurado
 */
export function generarEnfriamiento(ejerciciosEnfriamiento, bloquePrincipal, nivel, duracionMaxima = 8) {
    const musculosTrabajados = extraerMusculosTrabajados(bloquePrincipal);
    
    const enfriamiento = {
        tipo: 'cooldown',
        nombre: 'Enfriamiento y Recuperación',
        duracionEstimada: duracionMaxima,
        fases: []
    };
    
    // ====================================================================
    // FASE 1: BAJADA DE PULSACIONES (1-2 min)
    // ====================================================================
    enfriamiento.fases.push({
        fase: 'Bajada de Intensidad',
        duracion: 2,
        icono: '💨',
        descripcion: 'Reduce gradualmente la intensidad del entrenamiento',
        contenido: {
            tipo: 'actividad_ligera',
            opciones: [
                'Caminar suave en el lugar (2 minutos)',
                'Movilidad articular suave y circular',
                'Movimientos de bajo impacto con respiración profunda'
            ],
            explicacion: 'Permite que el ritmo cardíaco descienda gradualmente, ' +
                        'evitando mareos por acumulación de sangre en las extremidades.'
        }
    });
    
    // ====================================================================
    // FASE 2: ESTIRAMIENTOS ESPECÍFICOS (4-5 min)
    // ====================================================================
    const estiramientosEspecificos = seleccionarEstiramientos(musculosTrabajados, nivel, ejerciciosEnfriamiento);
    
    enfriamiento.fases.push({
        fase: 'Estiramientos Específicos',
        duracion: 4,
        icono: '🧘',
        descripcion: 'Estiramientos enfocados en los músculos trabajados hoy',
        contenido: {
            tipo: 'estiramientos',
            ejercicios: estiramientosEspecificos,
            instrucciones: nivel === 'Principiante' 
                ? 'Mantén cada estiramiento sin forzar. Debes sentir tensión, no dolor.'
                : 'Mantén cada posición respirando profundamente. Intenta profundizar ligeramente en cada exhalación.'
        }
    });
    
    // ====================================================================
    // FASE 3: ESTIRAMIENTOS GENERALES (2-3 min)
    // ====================================================================
    const estiramientosGenerales = seleccionarEstiramientosGenerales(nivel);
    
    enfriamiento.fases.push({
        fase: 'Estiramientos Globales',
        duracion: 2,
        icono: '🌊',
        descripcion: 'Estiramientos de todo el cuerpo para recuperación integral',
        contenido: {
            tipo: 'estiramientos_generales',
            ejercicios: estiramientosGenerales,
            instrucciones: 'Fluye entre posturas respirando profundamente. ' +
                          'Este es tu momento para desconectar y sentir tu cuerpo.'
        }
    });
    
    // ====================================================================
    // FASE 4: RESPIRACIÓN Y ACTIVACIÓN PARASIMPÁTICA (1-2 min)
    // ====================================================================
    const protocoloRespiracion = seleccionarProtocoloRespiracion(nivel);
    
    enfriamiento.fases.push({
        fase: 'Respiración de Recuperación',
        duracion: 1,
        icono: '🫁',
        descripcion: 'Activación del sistema nervioso parasimpático',
        contenido: protocoloRespiracion
    });
    
    // ====================================================================
    // AÑADIR EJERCICIOS DEL CATÁLOGO (YA INTEGRADO ARRIBA)
    // ====================================================================
    // Código removido para usar exclusivamente ejercicios del catálogo en la fase específica
    
    return enfriamiento;
}

/**
 * Extrae los músculos trabajados del bloque principal
 */
function extraerMusculosTrabajados(bloquePrincipal) {
    const musculos = new Set();
    
    if (!bloquePrincipal || !bloquePrincipal.estaciones) {
        return ['pecho', 'espalda', 'cuadriceps', 'isquiotibiales']; // Default full body
    }
    
    for (const estacion of bloquePrincipal.estaciones) {
        for (const ejercicio of estacion.ejercicios || []) {
            const parteCuerpo = normalizeText(ejercicio.parteCuerpo || ejercicio.bodyPart || '');
            const patron = normalizeText(ejercicio.patronMovimiento || ejercicio.pattern || '');
            
            // Mapear parte del cuerpo a músculos específicos
            if (parteCuerpo.includes('pecho') || patron.includes('empuje_h')) {
                musculos.add('pecho');
                musculos.add('triceps');
                musculos.add('hombros');
            }
            if (parteCuerpo.includes('espalda') || patron.includes('traccion')) {
                musculos.add('espalda');
                musculos.add('biceps');
            }
            if (parteCuerpo.includes('hombro')) {
                musculos.add('hombros');
            }
            if (parteCuerpo.includes('pierna') || parteCuerpo.includes('cuadricep') || patron.includes('rodilla')) {
                musculos.add('cuadriceps');
                musculos.add('hip_flexors');
            }
            if (parteCuerpo.includes('isquio') || parteCuerpo.includes('gluteo') || patron.includes('cadera')) {
                musculos.add('isquiotibiales');
                musculos.add('gluteos');
            }
            if (parteCuerpo.includes('pantorrilla') || parteCuerpo.includes('gemelo')) {
                musculos.add('pantorrillas');
            }
            if (parteCuerpo.includes('core') || parteCuerpo.includes('abdom')) {
                musculos.add('core');
            }
        }
    }
    
    return Array.from(musculos);
}

/**
 * Selecciona estiramientos específicos para los músculos trabajados USANDO EL CATÁLOGO
 */
function seleccionarEstiramientos(musculos, nivel, inventario) {
    const estiramientos = [];
    const tiempoBase = nivel === 'Principiante' ? 20 : (nivel === 'Intermedio' ? 30 : 40);
    const usados = new Set();
    
    // Si no hay inventario, retornar vacío para no inventar ejercicios
    if (!inventario || !Array.isArray(inventario) || inventario.length === 0) {
        return [];
    }
    
    // Seleccionar 1-2 estiramientos por cada grupo muscular principal
    for (const musculo of musculos) {
        if (!musculo) continue;
        
        // Buscar en el catálogo ejercicios que coincidan con el músculo
        const disponibles = inventario.filter(ex => {
            // Evitar repetir
            if (usados.has(ex.id)) return false;
            
            const parteCuerpo = normalizeText(ex.parteCuerpo || ex.bodyPart || '');
            const musculosInv = normalizeText(ex.musculosInvolucrados || '');
            const nombre = normalizeText(ex.nombre || '');
            const target = normalizeText(musculo);
            
            return parteCuerpo.includes(target) || 
                   musculosInv.includes(target) || 
                   nombre.includes(target);
        });
        
        if (disponibles && disponibles.length > 0) {
            // Tomar uno aleatorio de los disponibles
            const stretch = shuffleArray(disponibles)[0];
            
            estiramientos.push({
                id: stretch.id,
                nombre: stretch.nombre,
                tiempo: `${tiempoBase}s`,
                musculoObjetivo: musculo,
                instrucciones: stretch.descripcion || stretch.instructions || 'Realiza el estiramiento de forma controlada.',
                imagen: stretch.url_img_0 || stretch.url || ''
            });
            
            usados.add(stretch.id);
        }
        
        // Limitar a 6 estiramientos específicos
        if (estiramientos.length >= 6) break;
    }
    
    return estiramientos;
}

/**
 * Formatea el nombre del estiramiento para mostrar
 */
function formatearNombreEstiramiento(id) {
    const traducciones = {
        'estiramiento_pectoral_pared': 'Estiramiento de Pectoral en Pared',
        'estiramiento_pectoral_suelo': 'Apertura de Pecho en Suelo',
        'estiramiento_hombro_cruzado': 'Estiramiento de Hombro Cruzado',
        'child_pose': 'Postura del Niño (Child Pose)',
        'gato_vaca': 'Gato-Vaca (Cat-Cow)',
        'estiramiento_lat_pared': 'Estiramiento de Dorsal en Pared',
        'estiramiento_cuadriceps_pie': 'Estiramiento de Cuádriceps de Pie',
        'estiramiento_isquio_pie': 'Estiramiento de Isquiotibiales de Pie',
        'estiramiento_piriforme': 'Estiramiento de Piriforme',
        'estiramiento_psoas_rodilla': 'Estiramiento de Psoas en Genuflexión',
        'estiramiento_soleo_pared': 'Estiramiento de Sóleo en Pared',
        'estiramiento_triceps_overhead': 'Estiramiento de Tríceps sobre la Cabeza',
        'figura_4_suelo': 'Figura 4 en Suelo (Piriforme)',
        'torsion_espinal_suelo': 'Torsión Espinal Supina'
    };
    
    return traducciones[id] || id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Obtiene instrucciones específicas para cada estiramiento
 */
function getInstruccionesEstiramiento(id) {
    const instrucciones = {
        'estiramiento_pectoral_pared': 'Coloca el antebrazo contra la pared a 90°. Gira el torso alejándote hasta sentir tensión en el pecho.',
        'child_pose': 'Rodillas separadas, brazos extendidos al frente, hunde el pecho hacia el suelo. Respira profundamente.',
        'gato_vaca': 'Cuadrupedia. Arquea la espalda hacia arriba (gato) y hacia abajo (vaca) coordinando con la respiración.',
        'estiramiento_cuadriceps_pie': 'De pie, lleva el talón al glúteo sosteniendo el tobillo. Mantén las rodillas juntas.',
        'estiramiento_isquio_pie': 'Pie sobre superficie elevada, pierna recta. Inclínate desde la cadera manteniendo espalda neutral.',
        'estiramiento_piriforme': 'Tumbado boca arriba, cruza el tobillo sobre la rodilla opuesta. Tira de la pierna de apoyo hacia el pecho.',
        'estiramiento_psoas_rodilla': 'Genuflexión con un pie adelante. Empuja la cadera hacia delante manteniendo el torso erguido.',
        'estiramiento_soleo_pared': 'Pie atrasado con rodilla ligeramente flexionada. Empuja la pared manteniendo el talón en el suelo.',
        'torsion_espinal_suelo': 'Tumbado boca arriba, lleva una rodilla al lado opuesto. Mantén ambos hombros en el suelo.'
    };
    
    return instrucciones[id] || 'Mantén la posición respirando profundamente. Siente el estiramiento sin dolor.';
}

/**
 * Selecciona estiramientos generales de todo el cuerpo
 */
function seleccionarEstiramientosGenerales(nivel) {
    // Seleccionar 2-3 estiramientos generales
    const cantidad = nivel === 'Principiante' ? 2 : 3;
    const seleccionados = shuffleArray([...GENERAL_STRETCHES]).slice(0, cantidad);
    
    return seleccionados.map(s => ({
        ...s,
        tiempo: nivel === 'Principiante' ? `${Math.round(s.tiempo * 0.75)}s` : `${s.tiempo}s`,
        instrucciones: s.porLado ? `${s.tiempo}s por cada lado` : `${s.tiempo}s total`
    }));
}

/**
 * Selecciona protocolo de respiración según nivel
 */
function seleccionarProtocoloRespiracion(nivel) {
    if (nivel === 'Principiante') {
        return BREATHING_PROTOCOLS.basic;
    } else if (nivel === 'Intermedio') {
        return BREATHING_PROTOCOLS.physiological_sigh;
    } else {
        return BREATHING_PROTOCOLS.box;
    }
}

/**
 * Incorpora ejercicios del catálogo al enfriamiento
 */
function incorporarEjerciciosCatalogo(enfriamiento, ejerciciosCatalogo, nivel) {
    // Filtrar ejercicios que realmente son de enfriamiento
    const ejerciciosValidos = ejerciciosCatalogo.filter(e => {
        const cat = normalizeText(e.categoriaBloque || '');
        return cat.includes('enfriamiento') || cat.includes('cooldown') || cat.includes('estiramiento');
    });
    
    if (ejerciciosValidos.length > 0) {
        // Añadir hasta 2 ejercicios del catálogo a la fase de estiramientos
        const seleccionados = ejerciciosValidos.slice(0, 2);
        
        const fasesEstiramientos = enfriamiento.fases.find(f => f.fase === 'Estiramientos Específicos');
        if (fasesEstiramientos) {
            for (const ejercicio of seleccionados) {
                fasesEstiramientos.contenido.ejercicios.push({
                    id: ejercicio.id,
                    nombre: ejercicio.nombre || ejercicio.name,
                    tiempo: '30s',
                    instrucciones: ejercicio.notas || 'Mantén la posición respirando profundamente.',
                    imageUrl: ejercicio.url_img_0 || ejercicio.url,
                    imageUrl2: ejercicio.url_img_1,
                    deCatalogo: true
                });
            }
        }
    }
}

/**
 * Genera enfriamiento rápido para sesiones con poco tiempo
 */
export function generarEnfriamientoRapido(musculosPrincipales = [], nivel = 'Intermedio') {
    return {
        tipo: 'cooldown_express',
        nombre: 'Enfriamiento Express',
        duracionEstimada: 3,
        instrucciones: 'Versión rápida de enfriamiento. Prioriza los estiramientos si tienes tiempo extra.',
        contenido: [
            {
                nombre: 'Caminata suave',
                duracion: '30s',
                descripcion: 'Camina suavemente mientras respiras profundamente'
            },
            {
                nombre: 'World\'s Greatest Stretch',
                duracion: '30s por lado',
                descripcion: 'El estiramiento más completo en una sola posición'
            },
            {
                nombre: 'Child Pose con respiración',
                duracion: '45s',
                descripcion: '4-5 respiraciones profundas en postura del niño'
            },
            {
                nombre: 'Suspiro Fisiológico',
                duracion: '30s',
                descripcion: 'Doble inhalación + exhalación lenta. Repite 3 veces.'
            }
        ]
    };
}

/**
 * Genera recomendaciones de recuperación post-sesión
 */
export function generarRecomendacionesRecuperacion(intensidadSesion, musculosTrabajados) {
    const recomendaciones = {
        inmediatas: [],
        siguientes24h: [],
        siguientes48h: []
    };
    
    // Recomendaciones inmediatas
    recomendaciones.inmediatas = [
        'Hidratación: Bebe 500ml de agua en la próxima hora',
        'Nutrición: Consume proteína (20-40g) en las próximas 2 horas',
        'Movilidad: Si sientes rigidez, 5 minutos de movilidad ligera ayudarán'
    ];
    
    // Siguientes 24 horas
    if (intensidadSesion === 'alta') {
        recomendaciones.siguientes24h = [
            'Sueño: Prioriza 7-9 horas de sueño de calidad',
            'Nutrición: Aumenta ligeramente la ingesta calórica para la recuperación',
            'Actividad: Movilidad ligera o caminata suave si hay rigidez'
        ];
    } else {
        recomendaciones.siguientes24h = [
            'Sueño: Mantén tu rutina de sueño habitual',
            'Actividad: Puedes realizar actividad normal',
            'Movilidad: 10 minutos de estiramientos antes de dormir'
        ];
    }
    
    // Siguientes 48 horas
    recomendaciones.siguientes48h = [
        'DOMS: Si sientes dolor muscular, es normal. El movimiento ligero ayuda.',
        'Próximo entrenamiento: Los músculos trabajados necesitan ~48h para recuperarse',
        'Escucha tu cuerpo: El dolor articular o agudo NO es normal'
    ];
    
    return recomendaciones;
}

export default {
    generarEnfriamiento,
    generarEnfriamientoRapido,
    generarRecomendacionesRecuperacion
};
