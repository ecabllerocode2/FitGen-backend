// ====================================================================
// READINESS MANAGER MODULE
// Sistema de Autoregulación basado en Ciencias del Deporte
// Implementa el Modelo de Aptitud-Fatiga de Banister
// ====================================================================

import { 
    ENERGY_ADJUSTMENTS, 
    SORENESS_ADJUSTMENTS, 
    MUSCLE_FOCUS_MAP,
    FATIGUE_COEFFICIENTS 
} from './constants.js';
import { normalizeText } from './utils.js';

/**
 * Calcula los ajustes de autoregulación basados en el estado del atleta
 * @param {number} nivelEnergia - Nivel de energía (1-5)
 * @param {number} nivelDolor - Nivel de dolor muscular (1-5)
 * @param {string} zonaDolor - Zona del dolor reportado
 * @param {Array} musculosSesionHoy - Músculos a entrenar hoy
 * @param {string} faseMesociclo - Fase actual del mesociclo
 * @param {Object} contextExtra - Contexto adicional (historial, carga externa, etc.)
 * @returns {Object} Ajustes calculados para la sesión
 */
export function calcularAjustesAutoregulacion(
    nivelEnergia, 
    nivelDolor, 
    zonaDolor, 
    musculosSesionHoy, 
    faseMesociclo,
    contextExtra = {}
) {
    // Inicializar estructura de ajustes
    const ajustes = {
        // Multiplicadores de prescripción
        factorVolumen: 1.0,           // Multiplicador de series
        deltaRPE: 0,                   // Ajuste al RPE objetivo
        deltaRIR: 0,                   // Ajuste a las reps en reserva
        
        // Configuración de sesión
        protocoloDescanso: 'normal',   // 'normal', 'extendido', 'corto', 'activo'
        multiplicadorDescanso: 1.0,    // Multiplicador del tiempo de descanso
        tipoSesionModificada: null,    // Si cambia drásticamente el tipo
        tempoRecomendado: null,        // Tempo específico si aplica
        
        // Técnicas especiales
        tecnicasRecomendadas: [],
        tecnicasEvitar: [],
        
        // Feedback para el usuario
        advertencias: [],
        explicaciones: [],
        recomendaciones: []
    };

    // ====================================================================
    // 1. ANÁLISIS DEL SISTEMA NERVIOSO CENTRAL (SNC)
    // ====================================================================
    const ajusteEnergia = analizarEstadoSNC(nivelEnergia, faseMesociclo);
    Object.assign(ajustes, mergeAjustes(ajustes, ajusteEnergia));

    // ====================================================================
    // 2. ANÁLISIS DE DAÑO TISULAR LOCAL (DOMS)
    // ====================================================================
    const ajusteDolor = analizarDolorMuscular(
        nivelDolor, 
        zonaDolor, 
        musculosSesionHoy
    );
    Object.assign(ajustes, mergeAjustes(ajustes, ajusteDolor));

    // ====================================================================
    // 3. ANÁLISIS DE CARGA EXTERNA (Fatiga de vida)
    // ====================================================================
    if (contextExtra.cargaExterna) {
        const ajusteCargaExterna = analizarCargaExterna(contextExtra.cargaExterna);
        Object.assign(ajustes, mergeAjustes(ajustes, ajusteCargaExterna));
    }

    // ====================================================================
    // 4. ANÁLISIS DE TENDENCIAS DEL HISTORIAL
    // ====================================================================
    if (contextExtra.historial && contextExtra.historial.length > 0) {
        const ajusteHistorial = analizarTendenciasHistorial(contextExtra.historial);
        Object.assign(ajustes, mergeAjustes(ajustes, ajusteHistorial));
    }

    // ====================================================================
    // 5. ANÁLISIS DE FASE DEL MESOCICLO
    // ====================================================================
    const ajusteFase = analizarFaseMesociclo(faseMesociclo);
    Object.assign(ajustes, mergeAjustes(ajustes, ajusteFase));

    // ====================================================================
    // 6. CÁLCULO DE SCORE DE READINESS COMPUESTO
    // ====================================================================
    ajustes.readinessScore = calcularReadinessScore(nivelEnergia, nivelDolor, ajustes);
    ajustes.readinessCategoria = categorizarReadiness(ajustes.readinessScore);

    // ====================================================================
    // 7. APLICAR GUARDRAILS DE SEGURIDAD
    // ====================================================================
    aplicarGuardrails(ajustes);

    return ajustes;
}

/**
 * Analiza el estado del Sistema Nervioso Central basado en energía
 */
function analizarEstadoSNC(nivelEnergia, faseMesociclo) {
    const ajuste = {
        factorVolumen: 1.0,
        deltaRPE: 0,
        deltaRIR: 0,
        multiplicadorDescanso: 1.0,
        advertencias: [],
        explicaciones: []
    };

    const configEnergia = ENERGY_ADJUSTMENTS[nivelEnergia] || ENERGY_ADJUSTMENTS[3];
    
    ajuste.factorVolumen = configEnergia.volumeMultiplier;
    ajuste.deltaRPE = configEnergia.intensityDelta;
    ajuste.deltaRIR = configEnergia.rirDelta;
    ajuste.multiplicadorDescanso = configEnergia.restMultiplier;

    // Lógica específica por nivel
    switch (nivelEnergia) {
        case 1:
            ajuste.tipoSesionModificada = 'Recuperacion_Activa';
            ajuste.protocoloDescanso = 'extendido';
            ajuste.tecnicasEvitar = ['rest_pause', 'drop_set', 'forced_reps'];
            ajuste.advertencias.push(
                '⚠️ ENERGÍA CRÍTICA: Sesión convertida a recuperación activa. ' +
                'Prioridad: movimiento sin fatiga acumulada.'
            );
            ajuste.explicaciones.push(
                'Tu Sistema Nervioso Central está fatigado. La ciencia muestra que entrenar ' +
                'en este estado aumenta riesgo de lesión y retrasa la recuperación. ' +
                'Hoy trabajamos técnica con cargas muy ligeras.'
            );
            break;

        case 2:
            ajuste.protocoloDescanso = 'extendido';
            ajuste.tecnicasEvitar = ['forced_reps'];
            ajuste.advertencias.push(
                '⚡ Fatiga detectada: Reducimos volumen 40% pero mantenemos intensidad ' +
                'para preservar adaptaciones neurales.'
            );
            ajuste.explicaciones.push(
                'Cuando hay fatiga acumulada, la investigación de Zourdos et al. recomienda ' +
                'reducir sets antes que peso. Así mantenemos las ganancias de fuerza.'
            );
            break;

        case 3:
            // Estado normal - sin cambios
            break;

        case 4:
        case 5:
            // Alta energía - pero respetamos la fase del mesociclo
            const faseNorm = normalizeText(faseMesociclo || '');
            
            if (faseNorm.includes('descarga') || faseNorm.includes('deload')) {
                // FRENAR al usuario en semana de descarga
                ajuste.deltaRPE = 0; // Anular el bonus de intensidad
                ajuste.factorVolumen = 0.5; // Mantener reducción de descarga
                ajuste.advertencias.push(
                    '💪 Alta energía detectada, pero recuerda: esta semana es de DESCARGA. ' +
                    'Usa esa energía para perfeccionar la técnica, no para subir peso.'
                );
                ajuste.explicaciones.push(
                    'El fenómeno de supercompensación requiere respetar la descarga incluso ' +
                    'cuando te sientes bien. La próxima semana aprovecharás esa energía al máximo.'
                );
            } else if (faseNorm.includes('adaptacion') || faseNorm.includes('anatomica')) {
                ajuste.deltaRPE = Math.min(ajuste.deltaRPE, 0.5);
                ajuste.advertencias.push(
                    '✅ Buena energía detectada. Fase de adaptación: enfócate en técnica perfecta, ' +
                    'no en maximizar carga todavía.'
                );
            } else {
                // Permitir intensificación
                ajuste.advertencias.push(
                    '🔥 Estado óptimo: Tienes luz verde para buscar el límite superior del RPE hoy.'
                );
                ajuste.tecnicasRecomendadas = ['rest_pause', 'drop_set'];
            }
            break;
    }

    return ajuste;
}

/**
 * Analiza el dolor muscular y su impacto en la sesión
 */
function analizarDolorMuscular(nivelDolor, zonaDolor, musculosSesionHoy) {
    const ajuste = {
        factorVolumen: 1.0,
        deltaRPE: 0,
        deltaRIR: 0,
        advertencias: [],
        explicaciones: []
    };

    if (nivelDolor <= 2) {
        // Dolor mínimo o nulo - no hay conflicto
        return ajuste;
    }

    // Normalizar zona de dolor y músculos de la sesión
    const zonaNorm = normalizeText(zonaDolor || '');
    const musculosNorm = musculosSesionHoy.map(m => normalizeText(m));

    // Verificar si hay conflicto entre dolor y músculos a entrenar
    const hayConflicto = verificarConflictoMuscular(zonaNorm, musculosNorm);

    if (!hayConflicto) {
        // El dolor no afecta a los músculos de hoy
        ajuste.advertencias.push(
            `📝 Dolor reportado en ${zonaDolor} no afecta directamente la sesión de hoy.`
        );
        return ajuste;
    }

    // HAY CONFLICTO - aplicar ajustes según severidad
    const configDolor = SORENESS_ADJUSTMENTS[nivelDolor];

    if (!configDolor.canTrainAffectedMuscle) {
        // Dolor severo - cambiar enfoque completamente
        if (nivelDolor === 5) {
            ajuste.factorVolumen = 0;
            ajuste.tipoSesionModificada = 'Omitir_Grupo_Afectado';
            ajuste.advertencias.push(
                `🚫 ALERTA: El dolor en ${zonaDolor} es demasiado alto (${nivelDolor}/5). ` +
                `Descanso total para este grupo muscular.`
            );
        } else {
            // Nivel 4 - cambiar a estrés metabólico
            ajuste.tipoSesionModificada = 'Hipertrofia_Metabolica';
            ajuste.deltaRPE = configDolor.intensityDelta;
            ajuste.factorVolumen = configDolor.volumeMultiplier;
            ajuste.tempoRecomendado = '2-1-2-1'; // Tempo controlado sin cargas pesadas
            ajuste.tecnicasEvitar = ['heavy_negatives', 'forced_reps'];
            ajuste.tecnicasRecomendadas = ['blood_flow_restriction', 'tempo_extended'];
            ajuste.advertencias.push(
                `⚠️ Dolor alto en ${zonaDolor} (${nivelDolor}/5). Cambiamos a enfoque ` +
                `de 'BOMBEO' para nutrir el músculo sin estresar tendones.`
            );
            ajuste.explicaciones.push(
                'El estrés metabólico (bombeo, congestión) promueve la recuperación al aumentar ' +
                'el flujo sanguíneo sin el daño mecánico de las cargas pesadas.'
            );
        }
    } else {
        // Dolor moderado - ajustes menores
        ajuste.deltaRIR = +1;
        ajuste.factorVolumen = configDolor.volumeMultiplier;
        ajuste.protocoloDescanso = 'activo';
        ajuste.advertencias.push(
            `⚡ Precaución en ${zonaDolor} (${nivelDolor}/5). Aumentamos el RIR en 1 ` +
            `para evitar fallos técnicos.`
        );
    }

    return ajuste;
}

/**
 * Verifica si hay conflicto entre zona de dolor y músculos a entrenar
 */
function verificarConflictoMuscular(zonaDolor, musculosSesion) {
    // Mapeo de zonas de dolor a músculos relacionados
    const zonasMapeadas = {
        'pecho': ['pecho', 'pectoral', 'empuje'],
        'espalda': ['espalda', 'dorsal', 'traccion', 'lumbar'],
        'hombro': ['hombro', 'deltoides', 'empuje', 'press'],
        'biceps': ['biceps', 'brazo', 'traccion'],
        'triceps': ['triceps', 'brazo', 'empuje'],
        'pierna': ['pierna', 'cuadriceps', 'femoral', 'isquio', 'gluteo', 'rodilla', 'cadera'],
        'cuadriceps': ['cuadriceps', 'pierna', 'rodilla'],
        'isquiotibiales': ['isquio', 'femoral', 'pierna', 'cadera'],
        'gluteos': ['gluteo', 'pierna', 'cadera'],
        'core': ['core', 'abdomen', 'lumbar'],
        'espalda baja': ['lumbar', 'espalda', 'core', 'cadera']
    };

    // Buscar coincidencias
    for (const [zona, relacionados] of Object.entries(zonasMapeadas)) {
        if (zonaDolor.includes(zona)) {
            return musculosSesion.some(m => 
                relacionados.some(r => m.includes(r))
            );
        }
    }

    // Búsqueda directa
    return musculosSesion.some(m => m.includes(zonaDolor) || zonaDolor.includes(m));
}

/**
 * Analiza la carga externa (fatiga de vida)
 */
function analizarCargaExterna(cargaExterna) {
    const ajuste = {
        factorVolumen: 1.0,
        deltaRPE: 0,
        advertencias: []
    };

    switch (cargaExterna) {
        case 'extreme':
            // Post-evento importante (examen, viaje largo, etc.)
            ajuste.factorVolumen = 0.3;
            ajuste.deltaRPE = -3;
            ajuste.tipoSesionModificada = 'Recuperacion_Activa';
            ajuste.advertencias.push(
                '🛑 Carga externa extrema detectada. Sesión convertida a recuperación activa.'
            );
            break;
        case 'high':
            ajuste.factorVolumen = 0.5;
            ajuste.deltaRPE = -2;
            ajuste.advertencias.push(
                '⚠️ Alta carga externa. Reducimos demanda significativamente.'
            );
            break;
        case 'low':
            // Pre-evento - taper
            ajuste.factorVolumen = 0.6;
            ajuste.deltaRPE = 0; // Mantener intensidad
            ajuste.tipoSesionModificada = 'Taper';
            ajuste.advertencias.push(
                '🎯 TAPER: Volumen reducido para máxima frescura, intensidad mantenida.'
            );
            break;
    }

    return ajuste;
}

/**
 * Analiza tendencias del historial reciente
 */
function analizarTendenciasHistorial(historial) {
    const ajuste = {
        factorVolumen: 1.0,
        deltaRPE: 0,
        advertencias: [],
        explicaciones: []
    };

    if (historial.length < 3) return ajuste;

    // Analizar últimas 5 sesiones
    const ultimasSesiones = historial.slice(0, 5);
    
    // Calcular RPE promedio
    const rpePromedio = ultimasSesiones
        .filter(s => s.feedback?.rpe != null)
        .reduce((sum, s, _, arr) => sum + s.feedback.rpe / arr.length, 0);

    // Calcular energía promedio
    const energiaPromedio = ultimasSesiones
        .filter(s => s.feedback?.energyLevel != null)
        .reduce((sum, s, _, arr) => sum + s.feedback.energyLevel / arr.length, 0);

    // Detectar patrones preocupantes
    if (rpePromedio > 8.5) {
        ajuste.factorVolumen *= 0.9;
        ajuste.deltaRIR = +1;
        ajuste.advertencias.push(
            `📊 Tendencia de RPE alto (${rpePromedio.toFixed(1)}) en sesiones recientes. ` +
            'Ajustamos conservadoramente para prevenir sobreentrenamiento.'
        );
    }

    if (energiaPromedio < 2.5) {
        ajuste.factorVolumen *= 0.85;
        ajuste.advertencias.push(
            `😴 Patrón de energía baja (${energiaPromedio.toFixed(1)}/5) detectado. ` +
            'Considera revisar sueño, nutrición y estrés.'
        );
    }

    // Detectar adherencia
    const sesionesCompletadas = ultimasSesiones.filter(s => s.feedback?.completed !== false).length;
    if (sesionesCompletadas < 3) {
        ajuste.advertencias.push(
            '📉 Adherencia reciente baja. Priorizamos sesiones más cortas y manejables.'
        );
        ajuste.factorVolumen *= 0.8;
    }

    return ajuste;
}

/**
 * Ajusta según la fase del mesociclo
 */
function analizarFaseMesociclo(faseMesociclo) {
    const ajuste = {
        factorVolumen: 1.0,
        deltaRPE: 0,
        explicaciones: []
    };

    const faseNorm = normalizeText(faseMesociclo || '');

    if (faseNorm.includes('adaptacion') || faseNorm.includes('introductoria')) {
        ajuste.deltaRIR = +1;
        ajuste.tempoRecomendado = '3-1-2-1';
        ajuste.explicaciones.push(
            'Fase de Adaptación: Priorizamos control motor y conexión mente-músculo sobre carga.'
        );
    } else if (faseNorm.includes('acumulacion') || faseNorm.includes('volumen')) {
        ajuste.factorVolumen = 1.1;
        ajuste.explicaciones.push(
            'Fase de Acumulación: Aumentamos ligeramente el volumen para maximizar el estímulo.'
        );
    } else if (faseNorm.includes('intensificacion') || faseNorm.includes('sobrecarga') || faseNorm.includes('pico')) {
        ajuste.deltaRPE = +0.5;
        ajuste.deltaRIR = -0.5;
        ajuste.explicaciones.push(
            'Fase de Intensificación: Máxima intensidad controlada. RIR bajo permitido.'
        );
    } else if (faseNorm.includes('descarga') || faseNorm.includes('deload')) {
        ajuste.factorVolumen = 0.5;
        ajuste.deltaRPE = -2;
        ajuste.deltaRIR = +2;
        ajuste.explicaciones.push(
            'Semana de Descarga: Reducción programada del 50% en volumen para supercompensación.'
        );
    }

    return ajuste;
}

/**
 * Calcula un score compuesto de readiness (0-100)
 */
function calcularReadinessScore(energia, dolor, ajustes) {
    // Factores base
    const energiaBase = (energia / 5) * 50; // 0-50 puntos
    const dolorBase = ((6 - dolor) / 5) * 30; // 0-30 puntos
    
    // Bonus/penalizaciones por ajustes
    let modifier = 0;
    if (ajustes.factorVolumen < 0.7) modifier -= 10;
    if (ajustes.tipoSesionModificada === 'Recuperacion_Activa') modifier -= 15;
    if (ajustes.deltaRPE > 0) modifier += 5;
    
    const score = Math.max(0, Math.min(100, energiaBase + dolorBase + 20 + modifier));
    return Math.round(score);
}

/**
 * Categoriza el readiness score
 */
function categorizarReadiness(score) {
    if (score >= 80) return 'optimal';
    if (score >= 60) return 'normal';
    if (score >= 40) return 'reduced';
    if (score >= 20) return 'minimal';
    return 'recovery_only';
}

/**
 * Combina ajustes de diferentes análisis
 */
function mergeAjustes(base, nuevo) {
    return {
        factorVolumen: base.factorVolumen * (nuevo.factorVolumen || 1.0),
        deltaRPE: (base.deltaRPE || 0) + (nuevo.deltaRPE || 0),
        deltaRIR: (base.deltaRIR || 0) + (nuevo.deltaRIR || 0),
        multiplicadorDescanso: (base.multiplicadorDescanso || 1.0) * (nuevo.multiplicadorDescanso || 1.0),
        protocoloDescanso: nuevo.protocoloDescanso || base.protocoloDescanso,
        tipoSesionModificada: nuevo.tipoSesionModificada || base.tipoSesionModificada,
        tempoRecomendado: nuevo.tempoRecomendado || base.tempoRecomendado,
        tecnicasRecomendadas: [...(base.tecnicasRecomendadas || []), ...(nuevo.tecnicasRecomendadas || [])],
        tecnicasEvitar: [...(base.tecnicasEvitar || []), ...(nuevo.tecnicasEvitar || [])],
        advertencias: [...(base.advertencias || []), ...(nuevo.advertencias || [])],
        explicaciones: [...(base.explicaciones || []), ...(nuevo.explicaciones || [])],
        recomendaciones: [...(base.recomendaciones || []), ...(nuevo.recomendaciones || [])]
    };
}

/**
 * Aplica guardrails de seguridad a los ajustes
 */
function aplicarGuardrails(ajustes) {
    // Factor de volumen nunca menor a 0.3 (excepto 0 por dolor severo)
    if (ajustes.factorVolumen > 0 && ajustes.factorVolumen < 0.3) {
        ajustes.factorVolumen = 0.3;
    }
    
    // Factor de volumen nunca mayor a 1.3
    ajustes.factorVolumen = Math.min(ajustes.factorVolumen, 1.3);
    
    // Delta RPE entre -4 y +2
    ajustes.deltaRPE = Math.max(-4, Math.min(2, ajustes.deltaRPE));
    
    // Delta RIR entre -2 y +4
    ajustes.deltaRIR = Math.max(-2, Math.min(4, ajustes.deltaRIR));
    
    // Multiplicador de descanso entre 0.7 y 2.0
    ajustes.multiplicadorDescanso = Math.max(0.7, Math.min(2.0, ajustes.multiplicadorDescanso));
}

/**
 * Exporta función de análisis rápido de modo de sesión
 */
export function determinarModoSesion(energia, dolor, cargaExterna = 'none') {
    // Prioridad 1: Carga externa
    if (cargaExterna === 'extreme' || cargaExterna === 'high') {
        return 'survival';
    }
    if (cargaExterna === 'low') {
        return 'taper';
    }
    
    // Prioridad 2: Estado interno
    if (energia <= 2 || dolor >= 4) {
        return 'survival';
    }
    if (energia >= 4 && dolor <= 2) {
        return 'performance';
    }
    
    return 'standard';
}

export default {
    calcularAjustesAutoregulacion,
    determinarModoSesion
};
