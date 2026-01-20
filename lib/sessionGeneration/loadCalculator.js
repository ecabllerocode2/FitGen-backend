// ====================================================================
// LOAD CALCULATOR MODULE
// Cálculo científico de cargas basado en sobrecarga progresiva
// Implementa ecuaciones de Brzycki, tablas RPE/RIR, y límites biomecánicos
// ====================================================================

import { RPE_PERCENTAGE_TABLE, LOAD_PROGRESSION_LIMITS, TEMPO_PROTOCOLS, INTENSITY_TECHNIQUES } from './constants.js';
import { getExerciseHistory, detectPlateau } from './dataFetcher.js';
import { obtenerPesoMaximoDisponible } from './equipmentFilter.js';
import { normalizeText } from './utils.js';

/**
 * Calcula la carga precisa para un ejercicio basándose en historial y contexto
 * @param {Object} ejercicio - Objeto del ejercicio
 * @param {Array} historial - Historial completo del usuario
 * @param {Object} microciclo - Contexto del microciclo actual
 * @param {Object} ajustes - Ajustes de readiness
 * @param {Object} perfilEquipo - Perfil de equipamiento del usuario
 * @returns {Object} Prescripción de carga completa
 */
export function calcularCargaPrecisa(ejercicio, historial, microciclo, ajustes, perfilEquipo = {}, sourceSessionMeta = null) {
    console.log(`[loadCalculator] calcularCargaPrecisa called for ${ejercicio.id} (perfilEquipo.ubicacion=${perfilEquipo.ubicacion})`);
    
    // Determinar ambiente actual para búsqueda inteligente de historial
    const currentEnvironment = perfilEquipo.ubicacion || null;
    
    // Obtener historial específico del ejercicio (priorizando mismo ambiente)
    const registrosPasados = getExerciseHistory(historial, ejercicio.id, 10, currentEnvironment);
    console.log(`[loadCalculator] registrosPasados length for ${ejercicio.id}: ${registrosPasados.length}`);
    
    // Variables base del microciclo
    const rpeBase = parseRPE(microciclo.intensityRpe) || 7;
    const rirObjetivo = microciclo.targetRIR ?? 2;
    const rpeAjustado = Math.max(4, Math.min(10, rpeBase + (ajustes.deltaRPE || 0)));
    const rirAjustado = Math.max(0, Math.min(5, rirObjetivo + (ajustes.deltaRIR || 0)));
    
    // NUEVO: Detectar si estamos en Semana 1 (pesos exploratorios)
    const esSemanaDeCarga = microciclo.week === 1 || microciclo.weekNumber === 1;
    console.log(`[loadCalculator] Semana ${microciclo.week || microciclo.weekNumber}, esSemanaDeCarga=${esSemanaDeCarga}`);
    
    // Determinar tipo de medición
    const measureType = ejercicio.measureType || 'reps';
    const esEjercicioPorTiempo = measureType === 'time';
    
    // ====================================================================
    // CASO 1: SIN HISTORIAL - PRIMERA VEZ
    // ====================================================================
    if (registrosPasados.length === 0) {
        const presc = generarPrescripcionInicial(ejercicio, rpeAjustado, rirAjustado, esEjercicioPorTiempo, perfilEquipo, esSemanaDeCarga);

        // Intentar ajustar por disponibilidad si hay metadata de la sesión fuente
        // (usar el parámetro sourceSessionMeta pasado a esta función)
        try {
            const registroParaAjuste = sourceSessionMeta || null;
            const trans = ajustarPorDisponibilidad(registroParaAjuste, { pesoFinal: null, repsObjetivoHoy: presc.repsObjetivo, tipoProgresion: presc.tipoProgresion, explicacion: presc.explicacion }, ejercicio, perfilEquipo);
            if (trans) {
                presc.availability = trans.availability || null;
                presc.progressionPlan = trans.progressionPlan || null;
                if (trans.modifiedPeso !== undefined) presc.pesoSugerido = trans.modifiedPeso;
                if (trans.modifiedReps !== undefined) presc.repsObjetivo = trans.modifiedReps;
                presc.explicacion = (presc.explicacion || '') + ' ' + (trans.note || '');
            }
        } catch (e) {
            // no bloquear la generación por un fallo en el ajuste
            console.warn('[loadCalculator] ajustarPresc inicial error:', e.message || e);
        }

        return presc;
    }
    
    // ====================================================================
    // CASO 2: CON HISTORIAL - CALCULAR SOBRECARGA
    // ====================================================================
    const ultimoRegistro = registrosPasados[0];
    
    // Verificar si hay meseta
    const analisisMeseta = detectPlateau(historial, ejercicio.id);
    
    if (esEjercicioPorTiempo) {
        return calcularProgresionTiempo(ultimoRegistro, rpeAjustado, rirAjustado, ajustes, analisisMeseta);
    } else {
        return calcularProgresionCarga(
            ejercicio, 
            ultimoRegistro, 
            registrosPasados,
            rpeAjustado, 
            rirAjustado, 
            ajustes, 
            perfilEquipo,
            analisisMeseta,
            sourceSessionMeta
        );
    }
}

/**
 * Genera prescripción inicial para ejercicio sin historial
 */
function generarPrescripcionInicial(ejercicio, rpeObjetivo, rirObjetivo, esPorTiempo, perfilEquipo, esSemanaDeCarga = false) {
    const prioridadEjercicio = ejercicio.prioridad || 2;
    const esBodyweight = (ejercicio.equipo || []).includes('Peso Corporal') || (ejercicio.equipo || []).length === 0;
    
    // Reps base según prioridad (compuesto vs aislamiento)
    let repsBase = prioridadEjercicio === 1 ? 8 : (prioridadEjercicio === 2 ? 10 : 12);
    
    // Ajustar si hay limitaciones de equipo
    if (perfilEquipo.ambiente === 'bodyweight' || perfilEquipo.ambiente === 'home_minimal') {
        repsBase = Math.min(repsBase + 4, 15); // Más reps con menos carga
    }
    
    // NUEVO: Determinar peso exploratorio estricto en Semana 1
    let pesoSugeridoInicial = 'Exploratorio';
    let explicacionInicial = '';
    
    if (esSemanaDeCarga && !esBodyweight) {
        // SEMANA 1: Marcado explícito como exploratorio
        pesoSugeridoInicial = 'Exploratorio';
        explicacionInicial = `🔍 SEMANA 1 - Peso Exploratorio: Encuentra un peso que te permita completar ${repsBase} reps llegando a RIR ${rirObjetivo} en la última serie. No busques el máximo, busca técnica perfecta.`;
    } else if (esPorTiempo) {
        pesoSugeridoInicial = 'N/A';
        explicacionInicial = `Primera vez con este ejercicio. Comienza con ${repsBase}s y busca sentir RPE ${rpeObjetivo} al terminar.`;
    } else if (esBodyweight) {
        pesoSugeridoInicial = null; // Sin peso externo
        explicacionInicial = `Ejercicio de peso corporal. Busca completar ${repsBase} reps sintiendo RIR ${rirObjetivo}.`;
    } else {
        explicacionInicial = `No tenemos historial para este ejercicio. Busca un peso que te permita completar ${repsBase} reps sintiendo que podrías hacer ${rirObjetivo} más (RIR ${rirObjetivo}).`;
    }
    
    const prescripcion = {
        pesoSugerido: pesoSugeridoInicial,
        repsObjetivo: esPorTiempo ? '30-45s' : repsBase,
        rpeObjetivo,
        rirObjetivo,
        tempo: TEMPO_PROTOCOLS.Control_Tecnico,
        tipoProgresion: 'initial',
        
        // Metadatos
        esExploratorio: esSemanaDeCarga && !esBodyweight, // TRUE solo en Semana 1 con peso
        measureType: esPorTiempo ? 'time' : 'reps',
        
        // Explicación educativa
        explicacion: explicacionInicial,
        
        indicadores: {
            avgRepsAnterior: null,
            avgRIRAnterior: null,
            e1RMEstimado: null,
            porcentajeObjetivo: null,
            esSemanaCarga: esSemanaDeCarga
        }
    };
    
    return prescripcion;
}

/**
 * Calcula progresión para ejercicios de peso corporal (bodyweight)
 * Progresa incrementando REPS en lugar de peso
 */
function calcularProgresionBodyweight(ejercicio, repsAnterior, rirAnterior, rpeObjetivo, rirObjetivo, analisisMeseta) {
    let repsNuevo = Math.round(repsAnterior || 10);
    let tipoProgresion = 'maintain';
    let explicacion = '';
    
    // Lógica de progresión basada en RIR
    if (rirAnterior <= 1) {
        // Muy difícil - mantener o reducir
        repsNuevo = Math.max(5, repsNuevo - 1);
        tipoProgresion = 'decrease_reps';
        explicacion = `RIR ${rirAnterior.toFixed(1)} muy bajo. Reducimos a ${repsNuevo} reps para mejor control técnico.`;
    } else if (rirAnterior >= 3) {
        // Muy fácil - aumentar reps para progresar
        const incremento = Math.max(1, Math.floor(repsNuevo * 0.1)); // 10% incremento
        repsNuevo = Math.min(25, repsNuevo + incremento); // Cap en 25 reps
        tipoProgresion = 'increase_reps_bodyweight';
        explicacion = `RIR ${rirAnterior.toFixed(1)} alto. Aumentamos a ${repsNuevo} reps (+${incremento}) para mayor estímulo.`;
    } else {
        // Zona óptima - mantener
        tipoProgresion = 'maintain';
        explicacion = `RIR ${rirAnterior.toFixed(1)} en zona objetivo. Mantenemos ${repsNuevo} reps.`;
    }
    
    // Si hay meseta, sugerir variante más difícil
    if (analisisMeseta.isPlateau && repsNuevo >= 15) {
        explicacion += ' 💡 Considera progresión a variante más difícil (tempo lento, pausa, o variante unilateral).';
    }
    
    return {
        pesoSugerido: null, // Bodyweight = sin peso externo
        repsObjetivo: repsNuevo,
        rpeObjetivo,
        rirObjetivo,
        tempo: TEMPO_PROTOCOLS.Control_Tecnico,
        tipoProgresion,
        explicacion,
        indicadores: {
            repsAnterior: Math.round(repsAnterior),
            rirAnterior: rirAnterior.toFixed(1),
            esBodyweight: true,
            recomendacionProgresion: repsNuevo >= 20 ? 'Considera variante más difícil o tempo más lento' : null
        }
    };
}

/**
 * Calcula progresión para ejercicios medidos por tiempo
 */
function calcularProgresionTiempo(ultimoRegistro, rpeObjetivo, rirObjetivo, ajustes, analisisMeseta) {
    const setsAnteriores = ultimoRegistro.performanceData?.actualSets || [];
    
    // Extraer tiempos realizados
    let tiempoBase = 45; // Default
    
    if (setsAnteriores.length > 0) {
        const tiempos = setsAnteriores.map(set => {
            if (typeof set.reps === 'string') {
                const match = set.reps.match(/(\d+)/);
                return match ? parseInt(match[1]) : 45;
            }
            return set.reps || 45;
        });
        tiempoBase = Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length);
    } else if (ultimoRegistro.targetReps) {
        const match = String(ultimoRegistro.targetReps).match(/(\d+)/);
        tiempoBase = match ? parseInt(match[1]) : 45;
    }
    
    // Calcular RIR promedio anterior
    const rirAnterior = setsAnteriores.length > 0
        ? setsAnteriores.reduce((sum, s) => sum + (s.rir ?? 2), 0) / setsAnteriores.length
        : 2;
    
    let tiempoNuevo = tiempoBase;
    let tipoProgresion = 'maintain';
    let explicacion = '';
    
    // Lógica de progresión
    if (rirAnterior >= 3) {
        // Muy fácil - aumentar tiempo
        tiempoNuevo = tiempoBase + 10;
        tipoProgresion = 'increase_time';
        explicacion = `RIR ${rirAnterior.toFixed(1)} alto. Aumentamos +10s para mayor estímulo.`;
    } else if (rirAnterior <= 1) {
        // Muy difícil - reducir tiempo
        tiempoNuevo = Math.max(20, tiempoBase - 10);
        tipoProgresion = 'decrease_time';
        explicacion = `RIR ${rirAnterior.toFixed(1)} muy bajo. Reducimos -10s para mejor control.`;
    } else {
        // Zona adecuada - progresión moderada
        tiempoNuevo = tiempoBase + 5;
        tipoProgresion = 'slight_increase';
        explicacion = `Progresión controlada: +5s manteniendo calidad de ejecución.`;
    }
    
    // Aplicar ajustes de readiness
    tiempoNuevo = Math.round(tiempoNuevo * ajustes.factorVolumen);
    tiempoNuevo = Math.max(15, tiempoNuevo); // Mínimo 15s
    
    return {
        pesoSugerido: 'N/A',
        repsObjetivo: `${tiempoNuevo}s`,
        rpeObjetivo,
        rirObjetivo,
        tempo: ajustes.tempoRecomendado || TEMPO_PROTOCOLS.Metabolico,
        tipoProgresion,
        measureType: 'time',
        explicacion,
        indicadores: {
            tiempoAnterior: tiempoBase,
            rirAnterior: rirAnterior.toFixed(1),
            cambio: tiempoNuevo - tiempoBase
        }
    };
}

/**
 * Calcula progresión de carga para ejercicios con peso/reps
 */
function calcularProgresionCarga(
    ejercicio,
    ultimoRegistro, 
    todosRegistros,
    rpeObjetivo, 
    rirObjetivo, 
    ajustes, 
    perfilEquipo,
    analisisMeseta,
    sourceSessionMeta = null
) {
    const setsAnteriores = ultimoRegistro.performanceData?.actualSets || [];
    const prioridad = ejercicio.prioridad || 2;
    const esCompuesto = prioridad === 1;
    
    // Detectar si es ejercicio de peso corporal
    const esBodyweight = (ejercicio.equipo || []).includes('Peso Corporal') || 
                        (ejercicio.equipo || []).length === 0;
    
    // ====================================================================
    // PASO 1: EXTRAER DATOS DEL ÚLTIMO ENTRENAMIENTO
    // ====================================================================
    let pesoAnterior = null;
    let repsPromedio = null;
    let rirPromedio = null;
    
    if (setsAnteriores.length > 0) {
        // Extraer pesos usados (solo si no es bodyweight)
        if (!esBodyweight) {
            const pesos = setsAnteriores
                .map(s => parseFloat(String(s.load || s.peso || s.weight || '0').replace(/[^\d.]/g, '')))
                .filter(p => !isNaN(p) && p > 0);
            
            if (pesos.length > 0) {
                pesoAnterior = Math.max(...pesos);
            }
        }
        
        // Extraer reps realizadas
        const reps = setsAnteriores.map(s => s.reps || 0).filter(r => r > 0);
        if (reps.length > 0) {
            repsPromedio = reps.reduce((a, b) => a + b, 0) / reps.length;
        }
        
        // Extraer RIR reportado
        const rirs = setsAnteriores.map(s => s.rir ?? 2);
        rirPromedio = rirs.reduce((a, b) => a + b, 0) / rirs.length;
    } else {
        // Si no hay datos detallados, usar targetReps anterior
        repsPromedio = parseInt(String(ultimoRegistro.targetReps || '10').match(/\d+/)?.[0] || '10');
        rirPromedio = 2;
    }
    
    // ====================================================================
    // CASO ESPECIAL: BODYWEIGHT - Progresar por REPS en lugar de PESO
    // ====================================================================
    if (esBodyweight) {
        return calcularProgresionBodyweight(
            ejercicio,
            repsPromedio,
            rirPromedio,
            rpeAjustado,
            rirAjustado,
            analisisMeseta
        );
    }
    
    // ====================================================================
    // PASO 2: CALCULAR e1RM (1RM Estimado)
    // ====================================================================
    let e1RM = null;
    
    if (pesoAnterior && repsPromedio) {
        // Fórmula de Brzycki modificada con RIR
        const repsReales = repsPromedio + (rirPromedio || 0);
        e1RM = pesoAnterior / (1.0278 - (0.0278 * repsReales));
    }
    
    // ====================================================================
    // PASO 3: DETERMINAR OBJETIVO DE REPS PARA HOY
    // ====================================================================
    let repsObjetivoHoy = determinarRepsObjetivo(rpeObjetivo, prioridad);
    
    // ====================================================================
    // PASO 4: CALCULAR PESO TEÓRICO USANDO TABLAS RPE
    // ====================================================================
    let pesoTeorico = null;
    let porcentajeObjetivo = null;
    
    if (e1RM) {
        porcentajeObjetivo = obtenerPorcentajeTablaRPE(rpeObjetivo, repsObjetivoHoy);
        pesoTeorico = e1RM * porcentajeObjetivo;
    }
    
    // ====================================================================
    // PASO 5: APLICAR GUARDRAILS DE SEGURIDAD
    // ====================================================================
    let pesoFinal = pesoTeorico;
    let tipoProgresion = 'maintain';
    let explicacion = '';
    let tecnicaRecomendada = null;
    
    if (pesoAnterior && pesoTeorico) {
        // Límite de incremento por sesión
        const limiteIncremento = esCompuesto 
            ? LOAD_PROGRESSION_LIMITS.maxSessionIncrease.compound 
            : LOAD_PROGRESSION_LIMITS.maxSessionIncrease.isolation;
        
        const pesoMaximoSeguro = pesoAnterior * (1 + limiteIncremento);
        const pesoMinimoSeguro = pesoAnterior * 0.8; // No bajar más del 20%
        
        if (pesoTeorico > pesoMaximoSeguro) {
            pesoFinal = pesoMaximoSeguro;
            tipoProgresion = 'capped_increase';
            explicacion = `Incremento limitado al ${(limiteIncremento * 100).toFixed(0)}% por seguridad biomecánica. ` +
                          `(Teórico: ${pesoTeorico.toFixed(1)}kg → Aplicado: ${pesoFinal.toFixed(1)}kg)`;
        } else if (pesoTeorico > pesoAnterior) {
            tipoProgresion = 'increase_load';
            explicacion = `Sobrecarga calculada: +${((pesoTeorico - pesoAnterior) / pesoAnterior * 100).toFixed(1)}% ` +
                          `según tu e1RM de ${e1RM.toFixed(1)}kg.`;
        } else if (pesoTeorico < pesoMinimoSeguro) {
            pesoFinal = pesoMinimoSeguro;
            tipoProgresion = 'decrease_capped';
            explicacion = `Reducción limitada al 20% para mantener estímulo de fuerza.`;
        } else {
            tipoProgresion = 'maintain';
            explicacion = `Mantenemos carga similar para consolidar el estímulo.`;
        }
    }
    
    // ====================================================================
    // PASO 6: MANEJAR MESETAS
    // ====================================================================
    if (analisisMeseta.isPlateau) {
        const intervencion = seleccionarIntervencionMeseta(ejercicio, ajustes, perfilEquipo);
        tipoProgresion = 'plateau_intervention';
        tecnicaRecomendada = intervencion.tecnica;
        explicacion = intervencion.explicacion;
        
        // Posibles ajustes por meseta
        if (intervencion.ajusteReps) {
            repsObjetivoHoy = intervencion.ajusteReps;
        }
    }
    
    // ====================================================================
    // PASO 7: AJUSTAR PARA EQUIPO LIMITADO (HOME TRAINING) - ESTRICTO
    // ====================================================================
    // Priorizar pesos específicos del frontend si están disponibles
    let pesosDisponibles = null;
    let pesoMaxDisponible = null;
    
    if (perfilEquipo.pesosEspecificosFrontend) {
        // Usar pesos específicos enviados desde el formulario pre-sesión
        const tipoEquipo = normalizarTipoEquipo(ejercicio.equipo);
        const pesosEsp = perfilEquipo.pesosEspecificosFrontend;
        
        if (tipoEquipo === 'mancuernas' && Array.isArray(pesosEsp.dumbbells) && pesosEsp.dumbbells.length > 0) {
            pesosDisponibles = [...pesosEsp.dumbbells].sort((a, b) => a - b);
            pesoMaxDisponible = Math.max(...pesosEsp.dumbbells);
        } else if (tipoEquipo === 'barra' && pesosEsp.barbell) {
            pesosDisponibles = [pesosEsp.barbell];
            pesoMaxDisponible = pesosEsp.barbell;
        } else if (tipoEquipo === 'kettlebell' && Array.isArray(pesosEsp.kettlebells) && pesosEsp.kettlebells.length > 0) {
            pesosDisponibles = [...pesosEsp.kettlebells].sort((a, b) => a - b);
            pesoMaxDisponible = Math.max(...pesosEsp.kettlebells);
        }
    } else {
        // Fallback al sistema anterior
        pesoMaxDisponible = perfilEquipo.pesosMaximos?.[normalizarTipoEquipo(ejercicio.equipo)];
    }
    
    // NUEVO: Aplicar restricción estricta de pesos disponibles
    if (pesosDisponibles && pesosDisponibles.length > 0 && pesoFinal) {
        const ajustePesos = aplicarRestriccionPesosLimitados(pesoFinal, pesosDisponibles, repsObjetivoHoy, pesoAnterior);
        
        if (ajustePesos.ajusteAplicado) {
            pesoFinal = ajustePesos.pesoFinal;
            repsObjetivoHoy = ajustePesos.repsObjetivo;
            tecnicaRecomendada = ajustePesos.tecnica;
            tipoProgresion = ajustePesos.tipoProgresion;
            explicacion = ajustePesos.explicacion;
            
            console.log(`[loadCalculator] Restricción de pesos aplicada: ${ajustePesos.explicacion}`);
        }
    } else if (pesoMaxDisponible && pesoFinal && pesoFinal > pesoMaxDisponible) {
        // Fallback al sistema anterior para casos sin lista específica
        const compensacion = calcularCompensacionEquipoLimitado(
            pesoFinal, 
            pesoMaxDisponible, 
            repsObjetivoHoy,
            ajustes
        );
        
        pesoFinal = pesoMaxDisponible;
        repsObjetivoHoy = compensacion.repsAjustadas;
        tecnicaRecomendada = compensacion.tecnica;
        tipoProgresion = 'equipment_limited';
        explicacion = compensacion.explicacion;
    }

    // ====================================================================
    // Ajustes por transición de ambiente (home <-> gym)
    // Toma en cuenta lo que realmente se usó la sesión previa (ultimoRegistro)
    // y genera un availabilityAdjustment + progressionPlan si aplica.
    // ====================================================================
    console.log(`[loadCalculator] Calling ajustarPorDisponibilidad for ${ejercicio.id}. ultimoRegistro present: ${!!ultimoRegistro}`);
    if (ultimoRegistro) console.log(`[loadCalculator] ultimoRegistro.sessionEnvironment=${ultimoRegistro.sessionEnvironment} equipmentSnapshot=${!!ultimoRegistro.equipmentSnapshot}`);

    // Use sourceSessionMeta as fallback when there is no ultimoRegistro with performance data
    const registroParaAjuste = ultimoRegistro && ultimoRegistro.sessionEnvironment ? ultimoRegistro : sourceSessionMeta;

    const transAdjustment = ajustarPorDisponibilidad(registroParaAjuste, {
        pesoFinal,
        repsObjetivoHoy,
        tipoProgresion,
        explicacion
    }, ejercicio, perfilEquipo);

    if (transAdjustment) {
        // Aplicar cambios sugeridos por la transición cuando corresponda
        if (transAdjustment.modifiedPeso !== undefined) pesoFinal = transAdjustment.modifiedPeso;
        if (transAdjustment.modifiedReps !== undefined) repsObjetivoHoy = transAdjustment.modifiedReps;
        // Incluir metadata
        if (!transAdjustment.meta) transAdjustment.meta = {};
        explicacion += ` ${transAdjustment.note || ''}`;
    }
    
    // ====================================================================
    // PASO 8: APLICAR AJUSTES DE READINESS
    // ====================================================================
    if (ajustes.factorVolumen < 1) {
        // La readiness baja afecta las reps objetivo, no el peso
        const repsReducidas = Math.max(4, Math.round(repsObjetivoHoy * ajustes.factorVolumen));
        explicacion += ` Reps ajustadas por readiness (${repsObjetivoHoy} → ${repsReducidas}).`;
        repsObjetivoHoy = repsReducidas;
    }
    
    // ====================================================================
    // PASO 9: CONSTRUIR PRESCRIPCIÓN FINAL
    // ====================================================================
    return {
        pesoSugerido: pesoFinal 
            ? redondearAPesoDisponible(pesoFinal, perfilEquipo)
            : 'Ajustar a RPE',
        repsObjetivo: repsObjetivoHoy,
        rpeObjetivo,
        rirObjetivo,
        tempo: ajustes.tempoRecomendado || (esCompuesto ? TEMPO_PROTOCOLS.Fuerza : TEMPO_PROTOCOLS.Hipertrofia),
        tipoProgresion,
        tecnica: tecnicaRecomendada || 'standard',
        measureType: 'reps',
        explicacion,
        
        // Metadata de disponibilidad / transición
        availabilityAdjustment: transAdjustment?.availability || null,
        progressionPlan: transAdjustment?.progressionPlan || null,

        indicadores: {
            pesoAnterior: pesoAnterior ? `${pesoAnterior}kg` : null,
            repsAnterior: repsPromedio ? Math.round(repsPromedio) : null,
            rirAnterior: rirPromedio ? rirPromedio.toFixed(1) : null,
            e1RMEstimado: e1RM ? `${e1RM.toFixed(1)}kg` : null,
            porcentajeObjetivo: porcentajeObjetivo ? `${(porcentajeObjetivo * 100).toFixed(0)}%` : null,
            esMeseta: analisisMeseta.isPlateau
        }
    };
}

/**
 * Determina el rango de reps objetivo según RPE y prioridad
 */
function determinarRepsObjetivo(rpe, prioridad) {
    // Ejercicios de prioridad 1 (compuestos): menos reps, más intensidad
    // Prioridad 3 (aislamiento): más reps, estrés metabólico
    
    const tablaReps = {
        1: { high: 6, medium: 8, low: 10 },    // Compuestos
        2: { high: 8, medium: 10, low: 12 },   // Accesorios
        3: { high: 10, medium: 12, low: 15 }   // Aislamiento
    };
    
    const rango = tablaReps[prioridad] || tablaReps[2];
    
    if (rpe >= 8.5) return rango.high;
    if (rpe >= 7) return rango.medium;
    return rango.low;
}

/**
 * Aplica restricción estricta de pesos disponibles en casa
 * Si el usuario tiene pesos limitados, debe usar EXACTAMENTE esos pesos
 * y progresar mediante reps, tempo, densidad o series
 */
function aplicarRestriccionPesosLimitados(pesoIdeal, pesosDisponibles, repsActuales, pesoAnterior) {
    // Ordenar pesos disponibles
    const pesosOrdenados = [...pesosDisponibles].sort((a, b) => a - b);
    const pesoMax = pesosOrdenados[pesosOrdenados.length - 1];
    
    // Encontrar el peso más cercano al ideal
    let pesoSeleccionado = pesosOrdenados[0];
    let menorDiferencia = Math.abs(pesoIdeal - pesosOrdenados[0]);
    
    for (const peso of pesosOrdenados) {
        const diferencia = Math.abs(pesoIdeal - peso);
        if (diferencia < menorDiferencia) {
            pesoSeleccionado = peso;
            menorDiferencia = diferencia;
        }
    }
    
    // CASO A: Llegó al peso máximo disponible -> Progresión alternativa
    if (pesoSeleccionado >= pesoMax && pesoAnterior >= pesoMax) {
        return {
            ajusteAplicado: true,
            pesoFinal: pesoMax,
            repsObjetivo: Math.min(repsActuales + 2, 15), // Aumentar reps gradualmente
            tecnica: 'tempo_control',
            tipoProgresion: 'reps_progression_limited_weight',
            explicacion: `🏠 Peso máximo disponible alcanzado (${pesoMax}kg). Progresión por REPS: ${repsActuales} → ${Math.min(repsActuales + 2, 15)} reps. Cuando llegues a 15 reps, considera añadir 1 serie o reducir descansos.`
        };
    }
    
    // CASO B: Puede usar un peso mayor al anterior -> Progresión de carga normal
    if (pesoSeleccionado > (pesoAnterior || 0)) {
        return {
            ajusteAplicado: true,
            pesoFinal: pesoSeleccionado,
            repsObjetivo: repsActuales,
            tecnica: 'standard',
            tipoProgresion: 'load_increase_available_weight',
            explicacion: `🏠 Progresión de carga: ${pesoAnterior || 'inicial'}kg → ${pesoSeleccionado}kg (peso disponible más cercano al objetivo).`
        };
    }
    
    // CASO C: Debe mantener el peso (no hay mayor disponible) -> Progresión de reps
    if (pesoSeleccionado === pesoAnterior) {
        return {
            ajusteAplicado: true,
            pesoFinal: pesoSeleccionado,
            repsObjetivo: Math.min(repsActuales + 1, 15),
            tecnica: 'standard',
            tipoProgresion: 'reps_progression_same_weight',
            explicacion: `🏠 Mismo peso (${pesoSeleccionado}kg). Progresión por REPS: +1 rep para continuar el estímulo.`
        };
    }
    
    // CASO D: Peso ideal más bajo que el anterior (ajuste por RPE/RIR)
    return {
        ajusteAplicado: true,
        pesoFinal: pesoSeleccionado,
        repsObjetivo: repsActuales,
        tecnica: 'standard',
        tipoProgresion: 'weight_adjustment',
        explicacion: `🏠 Ajuste de carga: ${pesoSeleccionado}kg (peso disponible más cercano al objetivo de intensidad).`
    };
}

/**
 * Ajusta la prescripción según la disponibilidad entre la sesión previa y la actual
 * Retorna { availability, progressionPlan, modifiedPeso, modifiedReps, note }
 */
function ajustarPorDisponibilidad(ultimoRegistro, prescripcion, ejercicio, perfilEquipo) {
    try {
        if (!ultimoRegistro) return null;

        const prevEnv = ultimoRegistro.sessionEnvironment || (ultimoRegistro.equipmentSnapshot && ultimoRegistro.equipmentSnapshot.ubicacion) || null;
        const currEnv = perfilEquipo.ubicacion || perfilEquipo.ambiente || null;

        console.log(`[loadCalculator] ajustarPorDisponibilidad: prevEnv=${prevEnv}, currEnv=${currEnv}, ejercicio=${ejercicio.id}`);

        const pesoObjetivo = prescripcion.pesoSugerido && typeof prescripcion.pesoSugerido === 'number' ? prescripcion.pesoSugerido : null;
        const pesoMaxDisponible = (() => {
            if (perfilEquipo.pesosEspecificosFrontend) {
                if (Array.isArray(perfilEquipo.pesosEspecificosFrontend.dumbbells) && perfilEquipo.pesosEspecificosFrontend.dumbbells.length > 0) {
                    return Math.max(...perfilEquipo.pesosEspecificosFrontend.dumbbells);
                }
                if (perfilEquipo.pesosEspecificosFrontend.barbell) return perfilEquipo.pesosEspecificosFrontend.barbell;
            }
            return perfilEquipo.pesosMaximos?.[normalizarTipoEquipo(ejercicio.equipo)] || null;
        })();

        // Case: home -> gym (más opciones): no problema, permitir peso objetivo (marcar nota)
        if (prevEnv === 'home' && currEnv === 'gym') {
            return {
                availability: { strategy: 'home_to_gym', note: 'Más opciones de carga disponibles en gym; priorizar peso objetivo cuando sea aplicable.' },
                progressionPlan: null,
                // No forzamos cambios si no hay peso objetivo calculado
                modifiedPeso: typeof pesoObjetivo === 'number' ? pesoObjetivo : undefined,
                note: 'Se recomienda usar peso objetivo en gimnasio si está definido; de lo contrario priorizar progresión de carga.'
            };
        }

        // Case: gym -> home (menos capacidad): bridge load
        if (prevEnv === 'gym' && currEnv === 'home') {
            if (!pesoObjetivo) return null;
            if (!pesoMaxDisponible || pesoMaxDisponible >= pesoObjetivo) {
                return null; // no hay limitación real
            }

            // Si el peso objetivo no está disponible en casa: proponer bridge
            const pasos = [];
            // Paso 0: usar el máximo disponible en casa
            pasos.push({ sessionOffset: 0, weight: pesoMaxDisponible, reps: prescripcion.repsObjetivo + 2, note: 'Usar máximo disponible; compensar con +reps' });
            // Paso 1: si vuelve a gym, volver a objetivo; pero plan incremental por reps/series si sigue en casa
            pasos.push({ sessionOffset: 1, weight: pesoMaxDisponible, reps: prescripcion.repsObjetivo + 3, note: 'Incrementar reps para progresión' });

            return {
                availability: { strategy: 'gym_to_home', note: `Peso objetivo ${pesoObjetivo}kg no disponible en casa (${pesoMaxDisponible}kg).` },
                progressionPlan: {
                    targetWeight: pesoObjetivo,
                    steps: pasos,
                    fallback: 'increase_reps'
                },
                modifiedPeso: pesoMaxDisponible,
                modifiedReps: prescripcion.repsObjetivo + 2,
                note: `Bridge: usar ${pesoMaxDisponible}kg + aumentar reps hasta poder acceder a peso objetivo.`
            };
        }

        // No cambio significativo
        return null;
    } catch (e) {
        console.warn('[loadCalculator] ajustarPorDisponibilidad error:', e.message || e);
        return null;
    }
}

/**
 * Obtiene el porcentaje de 1RM según la tabla RPE/Reps
 */
function obtenerPorcentajeTablaRPE(rpe, reps) {
    // Redondear RPE al valor más cercano en la tabla
    const rpesDisponibles = Object.keys(RPE_PERCENTAGE_TABLE).map(Number).sort((a, b) => b - a);
    let rpeUsado = rpesDisponibles.find(r => r <= rpe) || 6;
    
    // Buscar reps en la tabla
    const tablaRPE = RPE_PERCENTAGE_TABLE[rpeUsado];
    const repsDisponibles = Object.keys(tablaRPE).map(Number).sort((a, b) => a - b);
    
    // Encontrar el valor más cercano
    let repsUsadas = repsDisponibles.find(r => r >= reps) || repsDisponibles[repsDisponibles.length - 1];
    
    return tablaRPE[repsUsadas] || 0.7;
}

/**
 * Selecciona intervención para mesetas de progresión
 */
function seleccionarIntervencionMeseta(ejercicio, ajustes, perfilEquipo) {
    const intervenciones = [
        {
            tecnica: 'tempo_extended',
            explicacion: '📊 MESETA DETECTADA: Aplicamos tempo extendido (4-2-1-0) para nuevo estímulo.',
            ajusteReps: null
        },
        {
            tecnica: 'rest_pause',
            explicacion: '📊 MESETA DETECTADA: Aplicamos Rest-Pause para superar el estancamiento.',
            ajusteReps: null
        },
        {
            tecnica: 'drop_reps_increase_weight',
            explicacion: '📊 MESETA DETECTADA: Reducimos reps e intentamos subir peso.',
            ajusteReps: -2
        },
        {
            tecnica: 'increase_reps',
            explicacion: '📊 MESETA DETECTADA: Aumentamos reps antes de subir peso.',
            ajusteReps: +3
        }
    ];
    
    // Seleccionar según contexto
    if (perfilEquipo.ambiente === 'bodyweight' || perfilEquipo.ambiente === 'home_minimal') {
        return intervenciones[0]; // Tempo para equipo limitado
    }
    
    if (ajustes.readinessCategoria === 'optimal') {
        return intervenciones[2]; // Subir peso si está bien
    }
    
    return intervenciones[Math.floor(Math.random() * intervenciones.length)];
}

/**
 * Calcula compensación cuando el peso disponible es insuficiente
 */
function calcularCompensacionEquipoLimitado(pesoIdeal, pesoDisponible, repsBase, ajustes) {
    const deficit = (pesoIdeal - pesoDisponible) / pesoIdeal;
    
    if (deficit < 0.2) {
        // Déficit menor al 20% - aumentar reps
        return {
            repsAjustadas: Math.min(repsBase + 4, 20),
            tecnica: 'standard',
            explicacion: `Peso disponible (${pesoDisponible}kg) cercano al ideal. Compensamos con +4 reps.`
        };
    } else if (deficit < 0.4) {
        // Déficit 20-40% - aplicar tempo
        return {
            repsAjustadas: repsBase,
            tecnica: 'tempo_extended',
            explicacion: `Superas el peso disponible en ${(deficit * 100).toFixed(0)}%. ` +
                        `Aplicamos Tempo 4-2-1-0 para compensar con Tiempo Bajo Tensión.`
        };
    } else {
        // Déficit > 40% - técnicas avanzadas
        return {
            repsAjustadas: Math.min(repsBase, 15),
            tecnica: 'rest_pause',
            explicacion: `El peso ideal supera significativamente lo disponible. ` +
                        `Aplicamos Rest-Pause: ${repsBase} reps, 15s pausa, ${Math.floor(repsBase * 0.5)} reps más.`
        };
    }
}

/**
 * Redondea el peso al incremento disponible más cercano
 * Si hay pesos específicos del frontend, redondea al peso disponible más cercano
 */
function redondearAPesoDisponible(peso, perfilEquipo) {
    if (!peso) return 'Ajustar a RPE';
    
    // Si hay pesos específicos del frontend (entrenamiento en casa)
    if (perfilEquipo.pesosEspecificosFrontend) {
        const pesosDisponibles = obtenerPesosDisponiblesDeFrontend(perfilEquipo);
        if (pesosDisponibles.length > 0) {
            // Encontrar el peso disponible más cercano
            const pesoMasCercano = pesosDisponibles.reduce((prev, curr) => 
                Math.abs(curr - peso) < Math.abs(prev - peso) ? curr : prev
            );
            return `${pesoMasCercano}kg`;
        }
    }
    
    // Incrementos típicos según equipo (fallback)
    const incremento = perfilEquipo.ubicacion === 'gym' || perfilEquipo.ambiente === 'gym' ? 2.5 : 1; // kg
    
    const pesoRedondeado = Math.round(peso / incremento) * incremento;
    return `${pesoRedondeado}kg`;
}

/**
 * Obtiene todos los pesos disponibles del perfil de equipo del frontend
 */
function obtenerPesosDisponiblesDeFrontend(perfilEquipo) {
    const pesos = new Set();
    const pesosEsp = perfilEquipo.pesosEspecificosFrontend;
    
    if (!pesosEsp) return [];
    
    // Agregar pesos de mancuernas
    if (Array.isArray(pesosEsp.dumbbells)) {
        pesosEsp.dumbbells.forEach(p => pesos.add(p));
    }
    
    // Agregar peso de barra (incluye barra + discos)
    if (pesosEsp.barbell) {
        pesos.add(pesosEsp.barbell);
    }
    
    // Agregar pesos de kettlebells
    if (Array.isArray(pesosEsp.kettlebells)) {
        pesosEsp.kettlebells.forEach(p => pesos.add(p));
    }
    
    return Array.from(pesos).sort((a, b) => a - b);
}

/**
 * Normaliza el tipo de equipo para búsqueda
 */
function normalizarTipoEquipo(equipo) {
    const equipoNorm = normalizeText(Array.isArray(equipo) ? equipo[0] : equipo || '');
    
    if (equipoNorm.includes('mancuerna')) return 'mancuernas';
    if (equipoNorm.includes('barra') && !equipoNorm.includes('dominadas')) return 'barra';
    if (equipoNorm.includes('kettlebell') || equipoNorm.includes('pesa rusa')) return 'kettlebell';
    
    return null;
}

/**
 * Parsea el RPE desde string (ej: "7/10 (RPE 7)" → 7)
 */
function parseRPE(rpeString) {
    if (typeof rpeString === 'number') return rpeString;
    if (!rpeString) return null;
    
    const match = String(rpeString).match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

/**
 * Estima el 1RM usando la fórmula de Brzycki
 * @param {number} peso - Peso levantado
 * @param {number} reps - Repeticiones realizadas
 * @returns {number} 1RM estimado
 */
export function estimarE1RM(peso, reps) {
    if (!peso || peso <= 0 || !reps || reps <= 0) return 0;
    if (reps === 1) return peso;
    // Brzycki formula: 1RM = peso × (36 / (37 - reps))
    return peso * (36 / (37 - Math.min(reps, 36)));
}

/**
 * Calcula repeticiones objetivo basándose en RPE/RIR y objetivo de entrenamiento
 * @param {string} objetivo - 'Fuerza', 'Hipertrofia', 'Resistencia'
 * @param {number} rpeObjetivo - RPE objetivo de la sesión
 * @param {string} nivel - Nivel del usuario
 * @returns {Object} Rango de repeticiones recomendado
 */
export function calcularRepeticionesObjetivo(objetivo, rpeObjetivo, nivel) {
    const rangos = {
        Fuerza: { min: 3, max: 6 },
        Hipertrofia: { min: 6, max: 12 },
        Resistencia: { min: 12, max: 20 }
    };
    
    const rango = rangos[objetivo] || rangos.Hipertrofia;
    
    // Ajustar según nivel
    if (nivel === 'Principiante') {
        rango.min = Math.max(rango.min, 8);
        rango.max = Math.min(rango.max + 2, 15);
    }
    
    return {
        minReps: rango.min,
        maxReps: rango.max,
        repsRecomendadas: Math.round((rango.min + rango.max) / 2)
    };
}

export default {
    calcularCargaPrecisa,
    estimarE1RM,
    calcularRepeticionesObjetivo
};
