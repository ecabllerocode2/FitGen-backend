import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays } from 'date-fns';

// ====================================================================
// CONSTANTES Y CONFIGURACIÓN
// ====================================================================

const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Objetivos válidos para mapeo de fase
const OBJECTIVE_MAPPING = {
    'Ganancia_Muscular': 'Hipertrofia',
    'Perdida_Grasa': 'Perdida_Grasa',
    'Fuerza': 'Fuerza_Maxima',
    'Salud': 'Salud_General',
    'Rendimiento_Deportivo': 'Rendimiento_Deportivo'
};

// Niveles válidos
const LEVEL_MAPPING = {
    'Principiante': 'Principiante',
    'Intermedio': 'Intermedio',
    'Avanzado': 'Avanzado'
};

// ====================================================================
// 1. DETERMINACIÓN DEL OBJETIVO DEL MESOCICLO
// ====================================================================

/**
 * Determina el objetivo de la fase basado en el feedback del mesociclo anterior
 * o establece una fase de adaptación si es el primer ciclo
 */
const determinarObjetivoFase = (usuario, mesocicloAnterior, nextCycleConfig) => {
    // Si existe un mesociclo anterior y tiene feedback
    if (mesocicloAnterior && mesocicloAnterior.feedback) {
        const feedback = mesocicloAnterior.feedback;
        
        // Si el usuario se sintió estancado, cambiar a fuerza para romper plateau
        if (feedback.sensation === 'Estancado' || feedback.energyLevel < 3) {
            return {
                objetivo: 'Fuerza_Maxima',
                razon: 'Cambio a fuerza para romper estancamiento y estimular adaptación neural'
            };
        }
        
        // Si hay dolor articular alto, cambiar a descarga y técnica
        if (feedback.sorenessLevel > 7 || feedback.jointPain > 7) {
            return {
                objetivo: 'Descarga_Activa_y_Tecnica',
                razon: 'Fase de descarga debido a alta fatiga articular/muscular'
            };
        }
        
        // Si hay configuración del ciclo siguiente (de evaluate.js), usarla
        if (nextCycleConfig && nextCycleConfig.focusSuggestion) {
            if (nextCycleConfig.focusSuggestion === 'Rehab/Prehab') {
                return {
                    objetivo: 'Descarga_Activa_y_Tecnica',
                    razon: 'Sugerencia de evaluación: Enfoque en recuperación'
                };
            }
        }
        
        // Si todo fue bien, mantener el objetivo general del usuario
        const objetivoMapeado = OBJECTIVE_MAPPING[usuario.fitnessGoal] || usuario.fitnessGoal;
        return {
            objetivo: objetivoMapeado,
            razon: 'Continuación del objetivo principal con progresión'
        };
    }
    
    // Primer ciclo: siempre adaptación para preparar tejidos
    return {
        objetivo: 'Adaptacion_Anatomica_y_Control',
        razon: 'Primer mesociclo: fase de adaptación anatómica y aprendizaje motor'
    };
};

// ====================================================================
// 2. SELECCIÓN DE LA DISTRIBUCIÓN SEMANAL (SPLIT)
// ====================================================================

/**
 * Matriz de decisión de splits según días disponibles y nivel
 */
const SPLIT_STRATEGIES = {
    2: {
        'Principiante': ['Full Body A', 'Full Body B'],
        'Intermedio': ['Full Body A', 'Full Body B'],
        'Avanzado': ['Full Body A (Alta Intensidad)', 'Full Body B (Alta Intensidad)']
    },
    3: {
        'Principiante': ['Full Body A', 'Full Body B', 'Full Body C'],
        'Intermedio': ['Torso - Fuerza', 'Pierna - Fuerza', 'Full Body - Metabólico'],
        'Avanzado': ['Torso', 'Pierna', 'Full Body (Puntos Débiles)']
    },
    4: {
        'Principiante': ['Torso', 'Pierna', 'Full Body A', 'Full Body B'],
        'Intermedio': ['Torso - Fuerza', 'Pierna - Fuerza', 'Torso - Hipertrofia', 'Pierna - Hipertrofia'],
        'Avanzado': ['Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)', 'Torso/Brazos (Pump)']
    },
    5: {
        'Principiante': ['Torso', 'Pierna', 'Full Body A', 'Full Body B', 'Full Body C'],
        'Intermedio': ['Torso', 'Pierna', 'Empuje', 'Tracción', 'Pierna'],
        'Avanzado': ['Pecho/Espalda', 'Pierna', 'Hombro/Brazo', 'Full Body', 'Core/Cardio']
    },
    6: {
        'Principiante': ['Full Body', 'Cardio', 'Full Body', 'Cardio', 'Full Body', 'Cardio'],
        'Intermedio': ['Empuje', 'Tracción', 'Pierna', 'Empuje', 'Tracción', 'Pierna'],
        'Avanzado': ['Empuje', 'Tracción', 'Pierna', 'Empuje', 'Tracción', 'Pierna']
    },
    7: {
        'Principiante': ['Full Body', 'Cardio', 'Full Body', 'Cardio', 'Full Body', 'Cardio', 'Movilidad'],
        'Intermedio': ['Empuje', 'Tracción', 'Pierna', 'Empuje', 'Tracción', 'Pierna', 'Recuperación Activa'],
        'Avanzado': ['Empuje', 'Tracción', 'Pierna', 'Empuje', 'Tracción', 'Pierna', 'Accesorios/Puntos Débiles']
    }
};

/**
 * Selecciona el split óptimo basado en días disponibles, nivel y objetivo
 */
const seleccionarSplitOptimo = (numDias, nivel, objetivo) => {
    // Normalizar días entre 2 y 7
    const diasNormalizados = Math.min(Math.max(numDias, 2), 7);
    
    // Normalizar nivel
    const nivelNormalizado = LEVEL_MAPPING[nivel] || 'Intermedio';
    
    // Obtener el split base
    let split = SPLIT_STRATEGIES[diasNormalizados][nivelNormalizado];
    
    // Ajustes específicos por objetivo
    if (objetivo === 'Perdida_Grasa' || objetivo === 'Salud_General') {
        // Para pérdida de grasa, priorizar full body y circuitos
        if (diasNormalizados === 3 && nivelNormalizado !== 'Avanzado') {
            split = ['Full Body - Circuito A', 'Full Body - Circuito B', 'Full Body - Circuito C'];
        } else if (diasNormalizados === 4 && nivelNormalizado !== 'Avanzado') {
            split = ['Torso - Fuerza', 'Pierna - Fuerza', 'Full Body - Metabólico A', 'Full Body - Metabólico B'];
        }
    } else if (objetivo === 'Fuerza_Maxima' && diasNormalizados === 4) {
        // Para fuerza, usar un split orientado a levantamientos principales
        split = ['Sentadilla/Empuje Vertical', 'Peso Muerto/Tracción', 'Press Banca/Empuje Horizontal', 'Accesorios/Hipertrofia'];
    }
    
    return {
        tipo: `Split_${diasNormalizados}_Dias_${nivelNormalizado}`,
        sesiones: split,
        descripcion: `Split de ${diasNormalizados} días para nivel ${nivelNormalizado}`
    };
};

// ====================================================================
// 3. DETERMINACIÓN DE LA DENSIDAD Y METODOLOGÍA DE SESIÓN
// ====================================================================

/**
 * Determina el método de sesión (Estaciones, Superseries, Circuito)
 * basado en tiempo disponible, objetivo y nivel
 */
const determinarMetodoSesion = (tiempoDisponible, objetivoFase, nivel) => {
    // Si el tiempo es limitado (<45 min), usar circuitos para máxima densidad
    if (tiempoDisponible < 45) {
        return {
            metodo: 'Circuito_Metabolico',
            descripcion: 'Circuito de alta densidad para optimizar tiempo',
            restBetweenSetsSec: 30,
            restBetweenExercisesSec: 15
        };
    }
    
    // Para fuerza máxima, siempre estaciones puras con descansos completos
    if (objetivoFase === 'Fuerza_Maxima') {
        return {
            metodo: 'Estaciones_Puras',
            descripcion: 'Estaciones con descansos completos para recuperación ATP-PC',
            restBetweenSetsSec: 180,
            restBetweenExercisesSec: 120
        };
    }
    
    // Para hipertrofia o pérdida de grasa
    if (objetivoFase === 'Hipertrofia' || objetivoFase === 'Perdida_Grasa') {
        // Principiantes: estaciones puras para priorizar técnica
        if (nivel === 'Principiante') {
            return {
                metodo: 'Estaciones_Puras',
                descripcion: 'Estaciones puras para aprendizaje técnico',
                restBetweenSetsSec: 90,
                restBetweenExercisesSec: 60
            };
        }
        
        // Intermedios y avanzados: superseries para eficiencia y estrés metabólico
        return {
            metodo: 'Superseries_Antagonistas',
            descripcion: 'Superseries antagonistas para eficiencia y estrés metabólico',
            restBetweenSetsSec: 60,
            restBetweenExercisesSec: 45
        };
    }
    
    // Por defecto: estaciones puras
    return {
        metodo: 'Estaciones_Puras',
        descripcion: 'Estaciones convencionales',
        restBetweenSetsSec: 90,
        restBetweenExercisesSec: 60
    };
};

// ====================================================================
// 4. PLANIFICACIÓN DE CORE Y CARDIO
// ====================================================================

/**
 * Determina la frecuencia de entrenamiento de core según nivel
 */
const determinarFrecuenciaCore = (nivel) => {
    switch (nivel) {
        case 'Principiante':
            return { frecuencia: 4, intensidad: 'Baja', enfoque: 'Estabilidad básica' };
        case 'Intermedio':
            return { frecuencia: 3, intensidad: 'Media', enfoque: 'Anti-movimiento' };
        case 'Avanzado':
            return { frecuencia: 2, intensidad: 'Alta', enfoque: 'Anti-movimiento pesado' };
        default:
            return { frecuencia: 3, intensidad: 'Media', enfoque: 'Estabilidad' };
    }
};

/**
 * Determina si un día es previo a una sesión de pierna pesada
 */
const esDiaPrevioAPiernaPesada = (diaActualIndex, diasDisponibles, split) => {
    const siguienteDiaIndex = (diaActualIndex + 1) % 7;
    const siguienteDia = DAYS_ORDER[siguienteDiaIndex];
    
    // Buscar si el siguiente día es un día de entrenamiento
    const siguienteDiaEntrena = diasDisponibles.some(d => d.day === siguienteDia && d.canTrain);
    
    if (!siguienteDiaEntrena) return false;
    
    // Verificar si el siguiente día es pierna
    const indexEnSplit = diasDisponibles.findIndex(d => d.day === siguienteDia);
    if (indexEnSplit === -1) return false;
    
    const sesionSiguiente = split[indexEnSplit % split.length];
    return sesionSiguiente.toLowerCase().includes('pierna') || 
           sesionSiguiente.toLowerCase().includes('legs') ||
           sesionSiguiente.toLowerCase().includes('sentadilla');
};

/**
 * Determina si se debe incluir cardio según objetivo
 */
const determinarCardio = (objetivo, sessionFocus) => {
    if (objetivo === 'Perdida_Grasa' || objetivo === 'Salud_General') {
        const esDiaPierna = sessionFocus.toLowerCase().includes('pierna') || 
                           sessionFocus.toLowerCase().includes('legs');
        
        return {
            includeCardio: true,
            cardioType: esDiaPierna ? 'LISS_Bajo_Impacto' : 'HIIT_Opcional',
            duracionMin: esDiaPierna ? 20 : 15
        };
    }
    
    return { includeCardio: false };
};

// ====================================================================
// 5. PERIODIZACIÓN Y ESTRUCTURA DE MICROCICLOS
// ====================================================================

/**
 * Obtiene la estructura del microciclo según la semana (periodización ondulante)
 */
const obtenerEstructuraMicrociclo = (semana) => {
    switch (semana) {
        case 1:
            return {
                focus: 'Adaptación/Cargas Introductorias',
                intensityRpe: '6/10 (RPE 6)',
                targetRIR: 4,
                notes: 'Fase de Introducción: Prioriza la calidad de movimiento y aprendizaje motor.'
            };
        case 2:
            return {
                focus: 'Acumulación de Volumen',
                intensityRpe: '7/10 (RPE 7)',
                targetRIR: 3,
                notes: 'Fase de Carga: Intenta aumentar peso o repeticiones manteniendo buena técnica.'
            };
        case 3:
            return {
                focus: 'Sobrecarga/Intensificación',
                intensityRpe: '8.5/10 (RPE 8.5)',
                targetRIR: 1.5,
                notes: 'Fase de Pico: Cerca del fallo técnico. Máxima intensidad de todo el ciclo.'
            };
        case 4:
            return {
                focus: 'Descarga (Deload)',
                intensityRpe: '5/10 (RPE 5)',
                targetRIR: 5,
                notes: 'Fase de Recuperación: Reduce peso 30% y volumen 50%. Permite supercompensación.'
            };
        default:
            return {
                focus: 'Mantenimiento',
                intensityRpe: '6.5/10 (RPE 6.5)',
                targetRIR: 3,
                notes: 'Semana estándar de entrenamiento.'
            };
    }
};

/**
 * Aplica ajuste de intensidad adaptativo basado en feedback previo
 */
const aplicarAjusteAdaptativo = (estructuraBase, nextCycleConfig) => {
    if (!nextCycleConfig || !nextCycleConfig.overloadFactor) {
        return estructuraBase;
    }
    
    const factor = nextCycleConfig.overloadFactor;
    
    // Extraer RPE actual
    const rpeMatch = estructuraBase.intensityRpe.match(/(\d+(\.\d+)?)/);
    let rpeActual = rpeMatch ? parseFloat(rpeMatch[1]) : 6;
    
    // Aplicar factor
    let nuevoRpe = rpeActual * factor;
    
    // Límites de seguridad
    nuevoRpe = Math.max(4, Math.min(10, nuevoRpe));
    nuevoRpe = Math.round(nuevoRpe * 10) / 10;
    
    let notasAdicionales = estructuraBase.notes;
    
    if (factor > 1.05) {
        notasAdicionales += ' [ÉNFASIS: Intensidad aumentada por excelente rendimiento previo].';
    } else if (factor < 0.95) {
        notasAdicionales += ' [RECUPERACIÓN: Intensidad reducida para asegurar adaptación completa].';
    }
    
    if (nextCycleConfig.focusSuggestion === 'Rehab/Prehab') {
        notasAdicionales += ' ⚠️ ATENCIÓN: Prioriza ausencia de dolor sobre peso. Control de tempo esencial.';
    }
    
    // Ajustar RIR según RPE
    const nuevoRIR = Math.max(1, 11 - nuevoRpe);
    
    return {
        ...estructuraBase,
        intensityRpe: `${nuevoRpe}/10 (RPE ${nuevoRpe})`,
        targetRIR: nuevoRIR,
        notes: notasAdicionales
    };
};

/**
 * Ajusta la intensidad según el nivel del usuario
 */
const ajustarIntensidadPorNivel = (estructuraBase, nivel) => {
    if (nivel === 'Principiante') {
        return {
            ...estructuraBase,
            intensityRpe: estructuraBase.intensityRpe.replace(/RPE \d+(\.\d+)?/, 'RPE 5-6'),
            targetRIR: 4,
            notes: estructuraBase.notes + ' PRINCIPIANTES: Prioridad absoluta en aprender la técnica correcta.'
        };
    }
    
    return estructuraBase;
};

// ====================================================================
// 6. MAPEO DE SESIONES A CALENDARIO
// ====================================================================

/**
 * Evalúa el riesgo futuro basado en la carga externa de días siguientes
 */
const evaluarRiesgoFuturo = (diaActualIndex, weeklySchedule) => {
    const maananaDiaIndex = (diaActualIndex + 1) % 7;
    const pasadoMananaIndex = (diaActualIndex + 2) % 7;
    
    const cargaManana = weeklySchedule[maananaDiaIndex]?.externalLoad || 'none';
    const cargaPasadoManana = weeklySchedule[pasadoMananaIndex]?.externalLoad || 'none';
    
    if (cargaManana === 'extreme') return 'critical';
    if (cargaManana === 'high') return 'high';
    if (cargaPasadoManana === 'extreme') return 'warning';
    
    return 'safe';
};

/**
 * Mapea el split ideal al calendario real del usuario
 */
const mapearSplitACalendario = (diasDisponibles, splitSesiones, weeklySchedule) => {
    const sesionesCalendarizadas = [];
    let contadorCore = 0;
    const configCore = determinarFrecuenciaCore(diasDisponibles[0]?.nivel || 'Intermedio');
    
    diasDisponibles.forEach((diaCtx, index) => {
        const diaIndexEnSemana = DAYS_ORDER.indexOf(diaCtx.day);
        const riesgoFuturo = evaluarRiesgoFuturo(diaIndexEnSemana, weeklySchedule);
        const fatigaActual = diaCtx.externalLoad || 'none';
        
        // Verificar carga del día anterior
        const diaAnteriorIndex = (diaIndexEnSemana - 1 + 7) % 7;
        const cargaDiaAnterior = weeklySchedule[diaAnteriorIndex]?.externalLoad || 'none';
        const esPostPartidoEvento = cargaDiaAnterior === 'extreme' || cargaDiaAnterior === 'high';
        
        // Obtener sesión del split
        let nombreSesionFinal = splitSesiones[index % splitSesiones.length];
        let razonAjuste = null;
        
        // Ajuste 1: Post-evento de alta carga
        if (esPostPartidoEvento && fatigaActual !== 'extreme') {
            if (nombreSesionFinal.toLowerCase().includes('pierna') || 
                nombreSesionFinal.toLowerCase().includes('full body')) {
                nombreSesionFinal = 'Torso - Hipertrofia & Recuperación';
                razonAjuste = 'Ajuste post-carga extrema: Evitar piernas para permitir recuperación.';
            }
        }
        // Ajuste 2: Tapering (preparación para evento futuro)
        else if (riesgoFuturo === 'critical' || riesgoFuturo === 'warning') {
            if (nombreSesionFinal.toLowerCase().includes('pierna') || 
                nombreSesionFinal.toLowerCase().includes('fuerza')) {
                nombreSesionFinal = 'Activación Neural (Priming) & Movilidad';
                razonAjuste = 'Tapering: Preparación para evento importante. Reducción de volumen.';
            }
        }
        // Ajuste 3: Fatiga actual moderada/alta
        else if (fatigaActual === 'medium' || fatigaActual === 'high') {
            if (nombreSesionFinal.toLowerCase().includes('fuerza') || 
                nombreSesionFinal.toLowerCase().includes('hipertrofia')) {
                nombreSesionFinal = nombreSesionFinal
                    .replace('Fuerza', 'Metabólico')
                    .replace('Hipertrofia', 'Técnica');
                razonAjuste = 'Ajuste por carga externa del día. Reducción de intensidad.';
            }
        }
        
        // Ajuste 4: Evitar repetir torso consecutivo
        if (index > 0) {
            const sesionPrevia = sesionesCalendarizadas[index - 1].sessionFocus;
            if (sesionPrevia.toLowerCase().includes('torso') && 
                nombreSesionFinal.toLowerCase().includes('torso')) {
                if (riesgoFuturo === 'safe') {
                    nombreSesionFinal = 'Pierna/Core - Estímulo Complementario';
                    razonAjuste = 'Balance estructural: Evitar sobreuso de torso.';
                }
            }
        }
        
        // Determinar si incluir core
        const incluirCore = contadorCore < configCore.frecuencia && 
                           !esDiaPrevioAPiernaPesada(diaIndexEnSemana, diasDisponibles, splitSesiones);
        
        if (incluirCore) contadorCore++;
        
        // Crear sesión
        const sesion = {
            dayOfWeek: diaCtx.day,
            sessionFocus: nombreSesionFinal,
            structureType: diaCtx.metodoSesion || 'Estaciones_Puras',
            includeCore: incluirCore,
            coreFocus: incluirCore ? configCore.enfoque : null,
            context: {
                externalFatigue: fatigaActual,
                adjustmentApplied: razonAjuste,
                basePlan: splitSesiones[index % splitSesiones.length],
                futureRisk: riesgoFuturo
            }
        };
        
        // Agregar cardio si corresponde
        const cardioConfig = determinarCardio(diaCtx.objetivo || 'Hipertrofia', nombreSesionFinal);
        if (cardioConfig.includeCardio) {
            sesion.includeCardio = true;
            sesion.cardioType = cardioConfig.cardioType;
            sesion.cardioDurationMin = cardioConfig.duracionMin;
        }
        
        sesionesCalendarizadas.push(sesion);
    });
    
    return sesionesCalendarizadas;
};

// ====================================================================
// 7. GENERACIÓN COMPLETA DEL MESOCICLO
// ====================================================================

/**
 * Genera el mesociclo completo siguiendo el algoritmo del pseudocódigo
 */
const generarMesocicloCompleto = (usuario, mesocicloAnterior, nextCycleConfig) => {
    // Paso 1: Determinar objetivo de la fase
    const { objetivo: objetivoFase, razon: razonObjetivo } = determinarObjetivoFase(
        usuario, 
        mesocicloAnterior, 
        nextCycleConfig
    );
    
    // Preparar contexto semanal
    const weeklySchedule = DAYS_ORDER.map(dayName => {
        const found = usuario.weeklyScheduleContext?.find(d => d.day === dayName);
        return found || { day: dayName, canTrain: false, externalLoad: 'none' };
    });
    
    // Filtrar días de entrenamiento
    const diasEntrenamiento = weeklySchedule.filter(d => 
        d.canTrain === true || usuario.preferredTrainingDays?.includes(d.day)
    );
    
    if (diasEntrenamiento.length === 0) {
        throw new Error('No hay días de entrenamiento definidos en el perfil del usuario.');
    }
    
    // Paso 2: Seleccionar split óptimo
    const splitConfig = seleccionarSplitOptimo(
        diasEntrenamiento.length,
        usuario.experienceLevel,
        objetivoFase
    );
    
    // Paso 3: Determinar método de sesión
    const metodoSesion = determinarMetodoSesion(
        usuario.sessionDurationMin || 60,
        objetivoFase,
        usuario.experienceLevel
    );
    
    // Agregar info a los días de entrenamiento
    diasEntrenamiento.forEach(dia => {
        dia.metodoSesion = metodoSesion.metodo;
        dia.objetivo = objetivoFase;
        dia.nivel = usuario.experienceLevel;
    });
    
    // Paso 4: Planificación de Core
    const coreConfig = determinarFrecuenciaCore(usuario.experienceLevel);
    
    // Paso 5: Construcción de microciclos (4 semanas)
    const microciclos = [];
    
    for (let semana = 1; semana <= 4; semana++) {
        // Obtener estructura base de la semana
        let estructuraSemana = obtenerEstructuraMicrociclo(semana);
        
        // Ajustar por nivel
        estructuraSemana = ajustarIntensidadPorNivel(estructuraSemana, usuario.experienceLevel);
        
        // Aplicar ajuste adaptativo si existe
        estructuraSemana = aplicarAjusteAdaptativo(estructuraSemana, nextCycleConfig);
        
        // Mapear sesiones al calendario
        const sesionesSemana = mapearSplitACalendario(
            JSON.parse(JSON.stringify(diasEntrenamiento)),
            splitConfig.sesiones,
            weeklySchedule
        );
        
        // Crear microciclo
        const microciclo = {
            week: semana,
            focus: estructuraSemana.focus,
            intensityRpe: estructuraSemana.intensityRpe,
            targetRIR: estructuraSemana.targetRIR,
            notes: estructuraSemana.notes,
            sessions: sesionesSemana,
            restProtocol: {
                betweenSets: metodoSesion.restBetweenSetsSec,
                betweenExercises: metodoSesion.restBetweenExercisesSec
            }
        };
        
        microciclos.push(microciclo);
    }
    
    // Construir objeto final
    const today = new Date();
    const fechaInicio = startOfWeek(today, { weekStartsOn: 1 });
    const fechaFin = addDays(fechaInicio, 4 * 7);
    
    const mesociclo = {
        startDate: fechaInicio.toISOString(),
        endDate: fechaFin.toISOString(),
        progress: 0.0,
        currentWeek: 1,
        mesocyclePlan: {
            durationWeeks: 4,
            mesocycleGoal: objetivoFase,
            goalReason: razonObjetivo,
            strategy: `${splitConfig.tipo} con ${metodoSesion.metodo}`,
            splitDescription: splitConfig.descripcion,
            methodDescription: metodoSesion.descripcion,
            coreFrequency: coreConfig.frecuencia,
            coreIntensity: coreConfig.intensidad,
            coreFocus: coreConfig.enfoque,
            microcycles: microciclos
        },
        llmModelUsed: 'v8-algoritmo-pseudocodigo-completo',
        generationDate: today.toISOString(),
        status: 'active',
        metadata: {
            trainingDaysPerWeek: diasEntrenamiento.length,
            userLevel: usuario.experienceLevel,
            userGoal: usuario.fitnessGoal,
            phaseGoal: objetivoFase,
            adaptiveAdjustmentApplied: !!nextCycleConfig
        }
    };
    
    return mesociclo;
};

// ====================================================================
// 8. HANDLER PRINCIPAL
// ====================================================================

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Use POST.' });
    }
    
    // Verificar autenticación
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticación requerido.' });
    }
    
    try {
        // Verificar token
        const token = authHeader.split('Bearer ')[1];
        const decoded = await auth.verifyIdToken(token);
        const userId = decoded.uid;
        
        // Obtener datos del usuario
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuario no encontrado en la base de datos.' });
        }
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle, nextCycleConfig } = userData;
        
        // Validar que existe profileData
        if (!profileData) {
            return res.status(400).json({ 
                error: 'Perfil incompleto. Complete su perfil antes de generar un mesociclo.' 
            });
        }
        
        // Validar campos mínimos requeridos
        const camposRequeridos = ['experienceLevel', 'fitnessGoal', 'weeklyScheduleContext'];
        const camposFaltantes = camposRequeridos.filter(campo => !profileData[campo]);
        
        if (camposFaltantes.length > 0) {
            return res.status(400).json({ 
                error: `Faltan campos requeridos en el perfil: ${camposFaltantes.join(', ')}` 
            });
        }
        
        // Generar el mesociclo
        console.log(`Generando mesociclo para usuario ${userId}...`);
        const mesocicloGenerado = generarMesocicloCompleto(
            profileData,
            currentMesocycle,
            nextCycleConfig
        );
        
        // Guardar en Firestore
        await db.collection('users').doc(userId).set({
            currentMesocycle: mesocicloGenerado,
            planStatus: 'active',
            nextCycleConfig: null, // Limpiar configuración de ciclo siguiente
            lastMesocycleGeneration: new Date().toISOString()
        }, { merge: true });
        
        console.log(`Mesociclo generado exitosamente para usuario ${userId}`);
        
        return res.status(200).json({
            success: true,
            message: 'Mesociclo generado exitosamente',
            plan: mesocicloGenerado
        });
        
    } catch (error) {
        console.error('ERROR al generar mesociclo:', error);
        
        // Manejo de errores específicos
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expirado. Vuelva a iniciar sesión.' });
        }
        
        if (error.code === 'auth/argument-error') {
            return res.status(401).json({ error: 'Token inválido.' });
        }
        
        return res.status(500).json({ 
            error: 'Error interno al generar el mesociclo',
            details: error.message
        });
    }
}
