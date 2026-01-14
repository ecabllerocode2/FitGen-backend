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
export function calcularCargaPrecisa(ejercicio, historial, microciclo, ajustes, perfilEquipo = {}) {
    // Obtener historial específico del ejercicio
    const registrosPasados = getExerciseHistory(historial, ejercicio.id, 10);
    
    // Variables base del microciclo
    const rpeBase = parseRPE(microciclo.intensityRpe) || 7;
    const rirObjetivo = microciclo.targetRIR ?? 2;
    const rpeAjustado = Math.max(4, Math.min(10, rpeBase + (ajustes.deltaRPE || 0)));
    const rirAjustado = Math.max(0, Math.min(5, rirObjetivo + (ajustes.deltaRIR || 0)));
    
    // Determinar tipo de medición
    const measureType = ejercicio.measureType || 'reps';
    const esEjercicioPorTiempo = measureType === 'time';
    
    // ====================================================================
    // CASO 1: SIN HISTORIAL - PRIMERA VEZ
    // ====================================================================
    if (registrosPasados.length === 0) {
        return generarPrescripcionInicial(ejercicio, rpeAjustado, rirAjustado, esEjercicioPorTiempo, perfilEquipo);
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
            analisisMeseta
        );
    }
}

/**
 * Genera prescripción inicial para ejercicio sin historial
 */
function generarPrescripcionInicial(ejercicio, rpeObjetivo, rirObjetivo, esPorTiempo, perfilEquipo) {
    const prioridadEjercicio = ejercicio.prioridad || 2;
    
    // Reps base según prioridad (compuesto vs aislamiento)
    let repsBase = prioridadEjercicio === 1 ? 8 : (prioridadEjercicio === 2 ? 10 : 12);
    
    // Ajustar si hay limitaciones de equipo
    if (perfilEquipo.ambiente === 'bodyweight' || perfilEquipo.ambiente === 'home_minimal') {
        repsBase = Math.min(repsBase + 4, 15); // Más reps con menos carga
    }
    
    const prescripcion = {
        pesoSugerido: 'Exploratorio',
        repsObjetivo: esPorTiempo ? '30-45s' : repsBase,
        rpeObjetivo,
        rirObjetivo,
        tempo: TEMPO_PROTOCOLS.Control_Tecnico,
        tipoProgresion: 'initial',
        
        // Metadatos
        esExploratorio: true,
        measureType: esPorTiempo ? 'time' : 'reps',
        
        // Explicación educativa
        explicacion: esPorTiempo 
            ? `Primera vez con este ejercicio. Comienza con ${repsBase}s y busca sentir RPE ${rpeObjetivo} al terminar.`
            : `No tenemos historial para este ejercicio. Busca un peso que te permita completar ${repsBase} reps ` +
              `sintiendo que podrías hacer ${rirObjetivo} más (RIR ${rirObjetivo}).`,
        
        indicadores: {
            avgRepsAnterior: null,
            avgRIRAnterior: null,
            e1RMEstimado: null,
            porcentajeObjetivo: null
        }
    };
    
    return prescripcion;
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
    analisisMeseta
) {
    const setsAnteriores = ultimoRegistro.performanceData?.actualSets || [];
    const prioridad = ejercicio.prioridad || 2;
    const esCompuesto = prioridad === 1;
    
    // ====================================================================
    // PASO 1: EXTRAER DATOS DEL ÚLTIMO ENTRENAMIENTO
    // ====================================================================
    let pesoAnterior = null;
    let repsPromedio = null;
    let rirPromedio = null;
    
    if (setsAnteriores.length > 0) {
        // Extraer pesos usados
        const pesos = setsAnteriores
            .map(s => parseFloat(String(s.load || s.peso || '0').replace(/[^\d.]/g, '')))
            .filter(p => !isNaN(p) && p > 0);
        
        if (pesos.length > 0) {
            pesoAnterior = Math.max(...pesos);
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
    // PASO 7: AJUSTAR PARA EQUIPO LIMITADO (HOME TRAINING)
    // ====================================================================
    // Priorizar pesos específicos del frontend si están disponibles
    let pesoMaxDisponible = null;
    
    if (perfilEquipo.pesosEspecificosFrontend) {
        // Usar pesos específicos enviados desde el formulario pre-sesión
        const tipoEquipo = normalizarTipoEquipo(ejercicio.equipo);
        const pesosEsp = perfilEquipo.pesosEspecificosFrontend;
        
        if (tipoEquipo === 'mancuernas' && Array.isArray(pesosEsp.dumbbells) && pesosEsp.dumbbells.length > 0) {
            pesoMaxDisponible = Math.max(...pesosEsp.dumbbells);
        } else if (tipoEquipo === 'barra' && pesosEsp.barbell) {
            pesoMaxDisponible = pesosEsp.barbell;
        } else if (tipoEquipo === 'kettlebell' && Array.isArray(pesosEsp.kettlebells) && pesosEsp.kettlebells.length > 0) {
            pesoMaxDisponible = Math.max(...pesosEsp.kettlebells);
        }
    } else {
        // Fallback al sistema anterior
        pesoMaxDisponible = perfilEquipo.pesosMaximos?.[normalizarTipoEquipo(ejercicio.equipo)];
    }
    
    if (pesoMaxDisponible && pesoFinal && pesoFinal > pesoMaxDisponible) {
        // El peso teórico supera lo disponible - aplicar técnicas de intensidad
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
