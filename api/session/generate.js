import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

// ====================================================================
// V5.0 - ALGORITMO CIENTÍFICO DE SOBRECARGA PROGRESIVA & AUTOREGULACIÓN
// ====================================================================
// CARACTERÍSTICAS IMPLEMENTADAS:
// - Sobrecarga Progresiva Automática con RIR (Reps in Reserve)
// - Historial de Ejercicios por Día de Semana (Evita Repeticiones)
// - Captura de Repeticiones Reales por Serie (para ajuste preciso)
// - Periodización Ondulante según Fatiga Externa (Post/Pre-Evento)
// - Técnicas de Intensidad para Equipo Limitado (Tempo, Pre-fatiga, Rest-Pause)
// - Días de Descanso = Recuperación Activa (Movilidad pura)
// ====================================================================

const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

const normalizeText = (text) => {
    if (!text) return "";
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};

const shuffleArray = (array) => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

// ====================================================================
// A. AUTOREGULACIÓN: CÁLCULO DE LA CONDICIÓN DEL ATLETA
// ====================================================================
const calculateReadiness = (feedback, externalLoad = 'none') => {
    const energy = feedback.energyLevel || 3;
    const soreness = feedback.sorenessLevel || 3; 
    const readinessScore = ((energy * 2) + (6 - soreness)) / 3; 

    let mode = 'standard';
    
    // PRIORIDAD 1: Fatiga Externa (Post-Evento, Pre-Evento)
    if (externalLoad === 'extreme' || externalLoad === 'high') {
        mode = 'survival'; // Forzar recuperación activa
    } else if (externalLoad === 'low') {
        mode = 'taper'; // Pre-evento: Reducir volumen, mantener intensidad
    } 
    // PRIORIDAD 2: Estado Interno del Atleta
    else if (energy <= 2 || soreness >= 4) {
        mode = 'survival';
    } else if (energy >= 4 && soreness <= 2) {
        mode = 'performance';
    }

    return { score: readinessScore, mode, energy, soreness };
};

// ====================================================================
// B. SOBRECARGA PROGRESIVA CIENTÍFICA (Basado en RIR/RPE Real)
// ====================================================================
/**
 * Calcula la sobrecarga para un ejercicio específico basándose en el historial.
 * Retorna: { targetLoad, targetReps, targetRIR, technique, notes }
 */
const calculateProgressiveOverload = (exerciseId, userHistory, equipmentContext, currentWeekPhase) => {
    // Buscar el ejercicio en el historial (última vez que se hizo)
    let lastPerformance = null;
    
    for (const session of userHistory) {
        if (!session.mainBlocks) continue;
        for (const block of session.mainBlocks) {
            const found = block.exercises.find(e => e.id === exerciseId);
            if (found && found.performanceData) {
                lastPerformance = {
                    ...found,
                    sessionRPE: session.feedback?.rpe || 7,
                    sessionDate: session.meta?.date
                };
                break;
            }
        }
        if (lastPerformance) break;
    }

    // DEFAULT: Si no hay historial previo
    if (!lastPerformance) {
        return {
            targetRIR: 2, // RIR 2 = 2 repeticiones en reserva
            targetReps: equipmentContext === 'gym' ? '8-12' : '12-15',
            loadProgression: 'initial',
            notes: '📊 LÍNEA BASE: Primera vez. Termina con RIR 2 (2 reps en reserva).',
            technique: 'standard'
        };
    }

    // ANÁLISIS DE RENDIMIENTO PREVIO
    const lastSets = lastPerformance.performanceData?.actualSets || [];
    if (lastSets.length === 0) {
        // No hay datos de rendimiento específico, usar RPE de sesión
        const lastRPE = lastPerformance.sessionRPE;
        if (lastRPE <= 6) {
            return {
                targetRIR: 2,
                targetReps: 'Aumenta +2 reps',
                loadProgression: 'increase_volume',
                notes: `⚡ PROGRESO: RPE ${lastRPE} fue bajo. Aumenta volumen o carga.`,
                technique: 'standard'
            };
        }
        return {
            targetRIR: 2,
            targetReps: lastPerformance.targetReps,
            loadProgression: 'maintain',
            notes: '🔄 MANTÉN: Misma carga, mejora la técnica.',
            technique: 'standard'
        };
    }

    // ANÁLISIS DETALLADO POR SERIE
    const avgRepsPerformed = lastSets.reduce((sum, set) => sum + (set.reps || 0), 0) / lastSets.length;
    const avgRIR = lastSets.reduce((sum, set) => sum + (set.rir || 2), 0) / lastSets.length;
    const avgLoad = lastSets[0]?.load || 'N/A'; // Asumimos que carga es constante

    // LÓGICA DE PROGRESIÓN
    let progression = {};

    // GIMNASIO: Progresión de Carga (Load)
    if (equipmentContext === 'gym') {
        if (avgRIR >= 3) {
            // Tuvo 3+ reps en reserva = Fue muy fácil
            progression = {
                targetRIR: 2,
                targetReps: lastPerformance.targetReps,
                loadProgression: 'increase_load_5pct',
                notes: `⚡ PROGRESO: RIR promedio ${avgRIR.toFixed(1)} fue alto. Aumenta peso +5%.`,
                technique: 'standard'
            };
        } else if (avgRIR <= 1) {
            // Fue muy duro, casi al fallo
            progression = {
                targetRIR: 2,
                targetReps: lastPerformance.targetReps,
                loadProgression: 'maintain',
                notes: `🛡️ CONSOLIDACIÓN: RIR ${avgRIR.toFixed(1)} fue bajo. Mantén y perfecciona.`,
                technique: 'standard'
            };
        } else {
            // RIR óptimo (2)
            progression = {
                targetRIR: 2,
                targetReps: 'Intenta +1 rep',
                loadProgression: 'increase_reps',
                notes: `🔥 DENSIDAD: Ejecuta 1 rep extra por serie manteniendo RIR 2.`,
                technique: 'standard'
            };
        }
    } 
    // EQUIPO LIMITADO: Progresión de Densidad/Volumen/Técnica
    else {
        if (avgRepsPerformed < 15) {
            // Todavía hay margen para aumentar volumen
            progression = {
                targetRIR: 2,
                targetReps: `${Math.floor(avgRepsPerformed) + 2}-${Math.floor(avgRepsPerformed) + 4}`,
                loadProgression: 'increase_volume',
                notes: `📈 VOLUMEN: Aumenta a ${Math.floor(avgRepsPerformed) + 3} reps por serie (RIR 2).`,
                technique: 'standard'
            };
        } else if (avgRepsPerformed >= 15 && avgRepsPerformed < 25) {
            // Activar Técnicas de Intensidad
            progression = {
                targetRIR: 1,
                targetReps: `${Math.floor(avgRepsPerformed)}-${Math.floor(avgRepsPerformed) + 2}`,
                loadProgression: 'technique_tempo',
                notes: `🐢 TEMPO LENTO: Aplica 3-0-3 (3s bajada, 3s subida) para simular más peso.`,
                technique: 'tempo_3-0-3'
            };
        } else {
            // Ya es demasiado volumen, cambiar a rest-pause
            progression = {
                targetRIR: 0,
                targetReps: '12-15 (Rest-Pause)',
                loadProgression: 'rest_pause',
                notes: `⏸️ REST-PAUSE: Reduce descanso a 30s y trabaja cerca del fallo.`,
                technique: 'rest_pause'
            };
        }
    }

    return progression;
};

// ====================================================================
// C. PARÁMETROS DINÁMICOS DE SESIÓN (Periodización Ondulante)
// ====================================================================
const getDynamicSessionParams = (readiness, sessionFocus, equipmentType, currentWeekPhase) => {
    const { mode } = readiness;
    const focusNorm = normalizeText(sessionFocus);
    const isMetabolic = focusNorm.includes('metabolico') || focusNorm.includes('cardio');
    const limitedWeight = equipmentType === 'home_limited' || equipmentType === 'bodyweight';

    let params = {
        setsCompound: 4, 
        setsIsolation: 3,
        targetRIR: 2, // Reps in Reserve por defecto
        restCompound: 90, 
        restIsolation: 60,
        techniqueNote: "",
        intensityFactor: 1.0 // Multiplicador de volumen
    };

    // AJUSTE POR FASE DE MESOCICLO
    const phaseNorm = normalizeText(currentWeekPhase || '');
    if (phaseNorm.includes('adaptacion') || phaseNorm.includes('anatomica')) {
        params.targetRIR = 3; // Más conservador
        params.intensityFactor = 0.8;
        params.techniqueNote = "Fase de aprendizaje. Perfecciona la técnica.";
    } else if (phaseNorm.includes('intensificacion') || phaseNorm.includes('pico')) {
        params.targetRIR = 1; // Más cerca del fallo
        params.intensityFactor = 1.1;
        params.techniqueNote = "Fase de pico. Busca RIR 1.";
    } else if (phaseNorm.includes('descarga') || phaseNorm.includes('deload')) {
        params.setsCompound = 2;
        params.setsIsolation = 2;
        params.targetRIR = 4;
        params.intensityFactor = 0.5;
        params.techniqueNote = "Semana de descarga. Volumen reducido 50%.";
    }

    // AJUSTE POR MODO (Autoregulación)
    if (mode === 'survival') {
        params.setsCompound = Math.max(2, Math.floor(params.setsCompound * 0.6));
        params.setsIsolation = Math.max(2, Math.floor(params.setsIsolation * 0.6));
        params.restCompound = 120;
        params.restIsolation = 90;
        params.targetRIR = 4;
        params.techniqueNote = "🛡️ RECUPERACIÓN: Volumen reducido -40%. Enfoque en técnica.";
    } else if (mode === 'taper') {
        // Pre-evento: Reducir volumen, mantener intensidad
        params.setsCompound = Math.max(2, Math.floor(params.setsCompound * 0.5));
        params.setsIsolation = Math.max(1, Math.floor(params.setsIsolation * 0.5));
        params.targetRIR = 3;
        params.techniqueNote = "🎯 TAPER: Volumen -50% para frescura neuromuscular.";
    } else if (mode === 'performance') {
        params.setsCompound = Math.floor(params.setsCompound * 1.2);
        params.setsIsolation = Math.floor(params.setsIsolation * 1.2);
        params.restCompound = 150;
        params.restIsolation = 75;
        params.targetRIR = 1;
        params.techniqueNote = "🔥 MÁXIMA CARGA: Ataca con intensidad. RIR 1.";
    }

    // AJUSTE PARA EQUIPO LIMITADO (Densidad en lugar de Carga)
    if (limitedWeight && !isMetabolic && mode !== 'survival') {
        params.restCompound = 60; // Menos descanso para compensar
        params.restIsolation = 45;
        params.techniqueNote += " Controla el tempo (3-0-3) si es necesario.";
    }

    return params;
};

// --- D. SELECCIÓN DE PESO EXACTO (CORRECCIÓN DE CONFLICTOS) ---
const assignLoadSuggestion = (exercise, userInventory, sessionMode) => {
    const targetEquipmentRaw = normalizeText(exercise.equipo || "");
    
    // 1. Peso Corporal
    if (targetEquipmentRaw.includes("corporal") || targetEquipmentRaw.includes("suelo") || targetEquipmentRaw.includes("sin equipo")) {
        return { equipmentName: "Peso Corporal", suggestedLoad: "Tu propio peso" };
    }

    // 2. Gym Comercial
    if (detectEnvironment(userInventory) === 'gym') {
        if (targetEquipmentRaw.includes('mancuerna')) return { equipmentName: "Mancuernas", suggestedLoad: "Peso exigente" };
        if (targetEquipmentRaw.includes('barra')) {
             if (targetEquipmentRaw.includes('dominadas')) return { equipmentName: "Barra de Dominadas", suggestedLoad: "Peso Corporal" };
             return { equipmentName: "Barra Olímpica", suggestedLoad: "Carga discos adecuados" };
        }
        return { equipmentName: exercise.equipo, suggestedLoad: "Ajustar a RPE" };
    }

    // 3. Lógica Home Limited (PRECISIÓN)
    
    let toolType = null;
    // Identificamos qué busca el ejercicio
    if (targetEquipmentRaw.includes("mancuerna")) toolType = "mancuerna";
    else if (targetEquipmentRaw.includes("dominadas")) toolType = "dominadas"; // Prioridad alta
    else if (targetEquipmentRaw.includes("barra")) toolType = "barra_peso";    // Si dice barra pero no dominadas
    else if (targetEquipmentRaw.includes("kettlebell") || targetEquipmentRaw.includes("pesa rusa")) toolType = "kettlebell";
    else if (targetEquipmentRaw.includes("banda") || targetEquipmentRaw.includes("liga")) toolType = "banda";

    if (!toolType) return { equipmentName: exercise.equipo, suggestedLoad: "Según disponibilidad" };

    // Filtramos el inventario del usuario para encontrar coincidencias
    const availableOptions = userInventory.filter(item => {
        const normItem = normalizeText(item);
        
        if (toolType === 'dominadas') {
            return normItem.includes('dominadas') || normItem.includes('pull up');
        }
        if (toolType === 'barra_peso') {
            // CRÍTICO: Debe ser barra, pero NO de dominadas, ni de puerta
            return normItem.includes('barra') && !normItem.includes('dominadas') && !normItem.includes('pull up');
        }
        if (toolType === 'mancuerna') return normItem.includes('mancuerna');
        if (toolType === 'kettlebell') return normItem.includes('kettlebell') || normItem.includes('pesa rusa');
        if (toolType === 'banda') return normItem.includes('banda') || normItem.includes('liga');
        
        return false;
    });

    if (availableOptions.length === 0) {
        // Fallback: Si pide barra de peso y no hay, intenta mancuernas
        if (toolType === 'barra_peso') {
             const dumbbells = userInventory.filter(i => normalizeText(i).includes('mancuerna'));
             if (dumbbells.length > 0) {
                 const sub = assignLoadSuggestion({ ...exercise, equipo: "Mancuernas" }, userInventory, sessionMode);
                 return { equipmentName: "Mancuernas", suggestedLoad: `${sub.suggestedLoad} (Sustituyendo Barra)` };
             }
        }
        return { equipmentName: exercise.equipo, suggestedLoad: "Equipo no detectado exacto" };
    }

    // Si es equipo fijo (Dominadas, Bandas), devolvemos el nombre
    if (toolType === 'dominadas' || toolType === 'banda') {
        return { equipmentName: availableOptions[0], suggestedLoad: "Peso Corporal / Resistencia" };
    }

    // Extracción de Pesos Numéricos para Mancuernas/Barras/KB
    // El frontend guarda genéricos "Barra de Pesos" y específicos "Barra de Pesos (20kg)"
    const weightedItems = availableOptions.map(item => {
        // Buscamos números seguidos de kg/lbs/lb
        const match = item.match(/(\d+(?:\.\d+)?)\s*(?:kg|lb)/i);
        return {
            fullName: item,
            weight: match ? parseFloat(match[1]) : 0 
        };
    });

    // FILTRADO CRÍTICO: Eliminamos los items genéricos (peso 0) SI existen items con peso específico
    const specificWeights = weightedItems.filter(w => w.weight > 0).sort((a, b) => a.weight - b.weight);
    
    // Si solo tenemos el genérico (ej. usuario solo marcó el checkbox padre), usamos ese.
    const finalPool = specificWeights.length > 0 ? specificWeights : weightedItems;

    // Selección Táctica
    const exType = normalizeText(exercise.tipo || "");
    const isCompound = exType.includes("multi") || exType.includes("compuesto");
    
    let selected = finalPool[0]; 

    if (finalPool.length > 1) {
        if (sessionMode === 'survival') {
            // Usar carga media
            selected = finalPool[Math.floor((finalPool.length - 1) / 2)];
        } else {
            // Performance
            if (isCompound) {
                selected = finalPool[finalPool.length - 1]; // El más pesado
            } else {
                // Aislamiento: Evitar el máximo, buscar medio-alto
                selected = finalPool[Math.max(0, finalPool.length - 2)];
            }
        }
    }

    // Construir string de salida. Si tiene peso específico, se muestra.
    return { 
        equipmentName: selected.fullName.split('(')[0].trim(), 
        suggestedLoad: `Usa: ${selected.fullName}` 
    };
};

// ====================================================================
// 2. FILTRADO DE EQUIPO (CORREGIDO Y ESTRICTO)
// ====================================================================

const detectEnvironment = (equipmentList) => {
    if (!equipmentList || equipmentList.length === 0) return 'bodyweight';
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('gym')) return 'gym';
    // Detectar si hay carga externa real
    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        // Excluimos "barra de dominadas" de ser considerada "carga"
        const isPullUp = i.includes('dominadas') || i.includes('pull');
        return (i.includes('mancuerna') || i.includes('pesa') || (i.includes('barra') && !isPullUp));
    });
    return hasLoad ? 'home_limited' : 'bodyweight';
};

const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises; 

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipo || "peso corporal");
        
        // 1. Peso Corporal: Siempre permitido
        if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;
        
        // 2. Barras (CRÍTICO: Distinción Dominadas vs Pesos)
        if (reqEq.includes("dominadas") || (reqEq.includes("barra") && reqEq.includes("pull"))) {
            // El ejercicio pide barra de dominadas. ¿La tiene el usuario?
            return userKeywords.some(k => k.includes("dominadas") || k.includes("pull up"));
        }
        if (reqEq.includes("barra") && !reqEq.includes("dominadas")) {
            // El ejercicio pide barra de PESO. ¿La tiene el usuario? (Excluyendo la de dominadas)
            return userKeywords.some(k => k.includes("barra") && !k.includes("dominadas") && !k.includes("pull"));
        }

        // 3. Bandas (CRÍTICO: Distinción Mini vs Larga)
        if (reqEq.includes("banda") || reqEq.includes("liga")) {
            const needsMini = reqEq.includes("mini") || reqEq.includes("gluteo") || reqEq.includes("tobillo");
            if (needsMini) {
                return userKeywords.some(k => k.includes("mini"));
            } else {
                // Banda de resistencia normal
                return userKeywords.some(k => (k.includes("banda") || k.includes("liga")) && !k.includes("mini"));
            }
        }

        // 4. Otros equipos estándar
        if (reqEq.includes("mancuerna") && userKeywords.some(k => k.includes("mancuerna"))) return true;
        if (reqEq.includes("kettlebell") && userKeywords.some(k => k.includes("kettlebell") || k.includes("pesa rusa"))) return true;
        if (reqEq.includes("rodillo") && userKeywords.some(k => k.includes("rodillo") || k.includes("foam"))) return true;

        return false;
    });
};

const filterExercisesByLevel = (exercises, userLevel) => {
    const level = normalizeText(userLevel || "principiante");
    return exercises.filter(ex => {
        const exLevel = normalizeText(ex.nivel || "principiante");
        if (level === 'principiante') return exLevel === 'principiante';
        if (level === 'intermedio') return exLevel !== 'avanzado';
        return true; 
    });
};

// ====================================================================
// D. EVITAR REPETICIÓN DE EJERCICIOS (Historial por Día de Semana)
// ====================================================================
/**
 * Obtiene ejercicios realizados en las últimas N sesiones del mismo día de la semana.
 * Esto evita la monotonía y permite rotación inteligente.
 */
const getExercisesFromSameDayHistory = (userHistory, targetDayOfWeek, weeksBack = 2) => {
    const usedExerciseIds = new Set();
    const targetDayNorm = normalizeText(targetDayOfWeek);
    
    let sessionsAnalyzed = 0;
    for (const session of userHistory) {
        if (sessionsAnalyzed >= weeksBack) break;
        
        // Verificar si es del mismo día de la semana
        const sessionDate = session.meta?.date;
        if (!sessionDate) continue;
        
        try {
            const sessionDay = format(parseISO(sessionDate), 'EEEE', { locale: es });
            if (normalizeText(sessionDay) !== targetDayNorm) continue;
            
            // Recolectar ejercicios de esta sesión
            if (session.mainBlocks) {
                session.mainBlocks.forEach(block => {
                    block.exercises.forEach(ex => {
                        usedExerciseIds.add(ex.id);
                    });
                });
            }
            
            sessionsAnalyzed++;
        } catch (e) {
            continue;
        }
    }
    
    return usedExerciseIds;
};

/**
 * Filtra ejercicios que NO se hayan usado recientemente en este día.
 * Si no quedan suficientes opciones, permite reutilización parcial.
 */
const filterExercisesByHistory = (exercises, usedExerciseIds, minimumRequired = 5) => {
    const freshExercises = exercises.filter(ex => !usedExerciseIds.has(ex.id));
    
    // Si tenemos suficientes ejercicios frescos, los usamos
    if (freshExercises.length >= minimumRequired) {
        return freshExercises;
    }
    
    // Si no, permitimos reutilización (mejor eso que fallar)
    console.log(`⚠️ Solo ${freshExercises.length} ejercicios frescos. Permitiendo reutilización parcial.`);
    return exercises;
};

// ====================================================================
// 3. GENERACIÓN DE BLOQUES (WARMUP, CORE, MAIN)
// ====================================================================

const generateWarmup = (utilityPool, bodyweightPool, focus) => {
    const normFocus = normalizeText(focus);
    let target = 'general';
    if (normFocus.includes('pierna') || normFocus.includes('full')) target = 'pierna';
    if (normFocus.includes('torso') || normFocus.includes('pecho') || normFocus.includes('empuje')) target = 'superior';

    // Filtro simple para Utility (Stretch/Mobility)
    const mobility = utilityPool.filter(ex => {
        const type = normalizeText(ex.tipo);
        const part = normalizeText(ex.parteCuerpo);
        return type.includes('calentamiento') || (type.includes('estiramiento') && part.includes(target));
    });

    // Filtro simple para Activación (Bodyweight)
    const activation = bodyweightPool.filter(ex => {
        const part = normalizeText(ex.parteCuerpo);
        const isLeg = part.includes('pierna') || part.includes('gluteo');
        return target === 'pierna' ? isLeg : !isLeg && !part.includes('core');
    });

    const selected = [
        ...shuffleArray(mobility).slice(0, 2).map(e => ({ ...e, durationOrReps: '45s' })),
        ...shuffleArray(activation).slice(0, 2).map(e => ({ ...e, durationOrReps: '15 reps' }))
    ];

    return selected.map(ex => ({
        id: ex.id,
        name: ex.nombre,
        instructions: ex.descripcion,
        durationOrReps: ex.durationOrReps,
        imageUrl: ex.url,
        equipment: "Peso Corporal"
    }));
};

const generateCoreBlock = (corePool, readiness) => {
    if (corePool.length === 0) return null;
    let sets = readiness.mode === 'survival' ? 1 : 3;
    let rpe = readiness.mode === 'performance' ? 9 : 7;
    const coreEx = shuffleArray(corePool).slice(0, 2);

    return {
        blockType: 'superset',
        restBetweenSetsSec: 60,
        restBetweenExercisesSec: 0,
        exercises: coreEx.map(ex => ({
            id: ex.id,
            name: ex.nombre,
            instructions: ex.descripcion,
            imageUrl: ex.url,
            equipment: "Peso Corporal",
            sets: sets,
            targetReps: "15-20 reps",
            rpe: rpe,
            notes: "Abdomen contraído."
        }))
    };
};

const generateMainBlock = (pool, sessionFocus, params, userHistory, equipmentContext, currentWeekPhase) => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;
    const { setsCompound, setsIsolation, targetRIR, techniqueNote } = params;

    if (focus.includes('full') || focus.includes('metabolico') || focus.includes('acondicionamiento')) {
        isCircuit = true; 
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' }, 
            { pattern: ['empuje', 'pecho', 'hombro'], role: 'compound' }, 
            { pattern: ['traccion', 'espalda'], role: 'compound' }, 
            { pattern: ['gluteo', 'isquios'], role: 'compound' }, 
        ];
    } else if (focus.includes('torso') || focus.includes('superior')) {
        template = [
            { pattern: ['pecho', 'empuje'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'compound' }, 
            { pattern: ['hombro', 'pecho'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'isolation' }, 
            { pattern: ['triceps', 'biceps'], role: 'isolation' } 
        ];
    } else if (focus.includes('empuje') || focus.includes('push') || focus.includes('pecho')) {
        template = [
            { pattern: ['pecho', 'pectoral'], role: 'compound' }, 
            { pattern: ['hombro', 'deltoides'], role: 'compound' }, 
            { pattern: ['pecho', 'hombro'], role: 'isolation' }, 
            { pattern: ['triceps'], role: 'isolation' }, 
            { pattern: ['triceps'], role: 'isolation' } 
        ];
    } else if (focus.includes('traccion') || focus.includes('pull') || focus.includes('espalda')) {
        template = [
            { pattern: ['espalda', 'dorsal'], role: 'compound' }, 
            { pattern: ['traccion', 'remo'], role: 'compound' }, 
            { pattern: ['espalda', 'posterior'], role: 'isolation' }, 
            { pattern: ['biceps'], role: 'isolation' }, 
            { pattern: ['biceps'], role: 'isolation' } 
        ];
    } else {
        template = [
            { pattern: ['cuadriceps', 'sentadilla'], role: 'compound' },
            { pattern: ['isquios', 'peso muerto', 'femoral'], role: 'compound' },
            { pattern: ['prensa', 'zancada', 'gluteo'], role: 'isolation' },
            { pattern: ['gemelos', 'pantorrilla'], role: 'isolation' }
        ];
    }

    const selectedExercises = [];
    const usedIds = new Set();

    template.forEach(slot => {
        const candidates = pool.filter(ex => {
            if (usedIds.has(ex.id)) return false;
            const targets = normalizeText((ex.musculoObjetivo || "") + " " + (ex.parteCuerpo || ""));
            const type = normalizeText(ex.tipo || "");
            const matchesPattern = slot.pattern.some(p => targets.includes(p));
            return matchesPattern;
        });

        if (candidates.length > 0) {
            // Preferencia por rol compuesto/aislamiento
            let pick = candidates.find(c => slot.role === 'compound' ? normalizeText(c.tipo).includes('multi') : normalizeText(c.tipo).includes('aislamiento'));
            if (!pick) pick = candidates[0];

            usedIds.add(pick.id);
            const isCompound = slot.role === 'compound';
            
            // ===== SOBRECARGA PROGRESIVA CIENTÍFICA =====
            const progression = calculateProgressiveOverload(
                pick.id, 
                userHistory, 
                equipmentContext, 
                currentWeekPhase
            );
            
            // CÁLCULO DE PESO EXACTO
            const loadSuggestion = assignLoadSuggestion(pick, params.userInventory, params.sessionMode);
            
            // COMBINAR NOTAS
            const finalNotes = `${progression.notes}\n${techniqueNote}`.trim();

            selectedExercises.push({
                id: pick.id,
                name: pick.nombre,
                instructions: pick.descripcion,
                imageUrl: pick.url || null,
                url: pick.videoUrl || null,
                equipment: loadSuggestion.equipmentName,
                suggestedLoad: loadSuggestion.suggestedLoad,
                sets: isCompound ? setsCompound : setsIsolation,
                targetReps: progression.targetReps,
                targetRIR: progression.targetRIR,
                loadProgression: progression.loadProgression,
                technique: progression.technique,
                notes: finalNotes,
                musculoObjetivo: pick.musculoObjetivo || pick.parteCuerpo,
                // ⭐ NUEVO: Estructura para capturar rendimiento real
                performanceData: {
                    plannedSets: isCompound ? setsCompound : setsIsolation,
                    actualSets: [] // Se llenará durante la sesión: [{ set: 1, reps: 12, rir: 2, load: '20kg' }]
                }
            });
        }
    });

    return {
        type: isCircuit ? 'circuit' : 'station',
        restSets: isCircuit ? 0 : params.restCompound,
        restExercises: isCircuit ? 0 : params.restIsolation,
        exercises: selectedExercises
    };
};

// ====================================================================
// 4. HANDLER PRINCIPAL
// ====================================================================

export default async function handler(req, res) {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token.' });

    try {
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;

        const userRef = db.collection('users').doc(userId);
        const [userDoc, historySnapshot] = await Promise.all([
            userRef.get(),
            userRef.collection('history').orderBy('meta.date', 'desc').limit(15).get()
        ]);

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const { profileData, currentMesocycle } = userDoc.data();
        if (!currentMesocycle) return res.status(400).json({ error: 'No hay plan activo.' });

        const userHistory = historySnapshot.docs.map(doc => doc.data());
        const dateStringRaw = req.body.date || format(new Date(), 'yyyy-MM-dd');
        const sessionDate = parseISO(dateStringRaw);

        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(sessionDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: "Plan finalizado o fecha inválida." });

        const dayName = format(sessionDate, 'EEEE', { locale: es });
        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());
        
        // ===== DETECCIÓN DE DÍA DE DESCANSO =====
        let isRestDay = false;
        if (!targetSession) {
            isRestDay = true;
            targetSession = { sessionFocus: "Recuperación Activa (Movilidad)" };
        }

        // ===== OBTENER FATIGA EXTERNA DEL DÍA =====
        const daySchedule = profileData.weeklyScheduleContext?.find(d => 
            normalizeText(d.day) === normalizeText(dayName)
        );
        const externalLoad = daySchedule?.externalLoad || 'none';
        const canTrain = daySchedule?.canTrain !== false;

        const feedback = req.body.realTimeFeedback || {};
        const isRecoveryFlag = req.body.isRecovery || 
                               isRestDay || 
                               !canTrain ||
                               normalizeText(targetSession.sessionFocus).includes('recuperacion');

        // ===== AUTOREGULACIÓN CON FATIGA EXTERNA =====
        const readiness = calculateReadiness(feedback, externalLoad);
        const equipmentType = detectEnvironment(profileData.availableEquipment);
        
        const sessionParams = getDynamicSessionParams(
            readiness, 
            targetSession.sessionFocus, 
            equipmentType,
            targetMicrocycle.focus // Fase actual del mesociclo
        );
        sessionParams.userInventory = profileData.availableEquipment || [];
        sessionParams.sessionMode = readiness.mode;

        // ===== OBTENER EJERCICIOS DEL MISMO DÍA DE SEMANAS ANTERIORES =====
        const usedExercisesIds = getExercisesFromSameDayHistory(userHistory, dayName, 2);

        // Carga de Pools
        const promises = [
            db.collection('exercises_utility').get(),        
            db.collection('exercises_bodyweight_pure').get() 
        ];

        if (equipmentType === 'gym') {
            promises.push(db.collection('exercises_gym_full').get());
        } else {
            promises.push(db.collection('exercises_home_limited').get());
        }

        const results = await Promise.all(promises);
        const utilityEx = results[0].docs.map(d => ({ id: d.id, ...d.data() }));
        const bodyweightEx = results[1].docs.map(d => ({ id: d.id, ...d.data() }));
        const mainExPoolRaw = results[2].docs.map(d => ({ id: d.id, ...d.data() }));

        // Filtrado Estricto
        let fullMainPool = [...mainExPoolRaw, ...bodyweightEx.filter(e => normalizeText(e.parteCuerpo) !== 'core')];
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        fullMainPool = filterExercisesByLevel(fullMainPool, profileData.experienceLevel);
        
        // ⭐ FILTRAR POR HISTORIAL (Evitar repetición del mismo día)
        fullMainPool = filterExercisesByHistory(fullMainPool, usedExercisesIds, 10);
        
        const bodyweightFiltered = filterExercisesByLevel(bodyweightEx, profileData.experienceLevel);
        const corePool = bodyweightFiltered.filter(e => normalizeText(e.parteCuerpo) === 'core');

        // Construcción de Sesión
        let finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: 60,
            warmup: { exercises: [] },
            mainBlocks: [],
            coreBlocks: [],
            cooldown: { exercises: [] },
            meta: {
                date: dateStringRaw,
                generatedAt: new Date().toISOString(),
                readinessScore: readiness.score,
                sessionMode: readiness.mode
            }
        };

        // ===== CONSTRUCCIÓN DE SESIÓN =====
        if (isRecoveryFlag) {
            // ⭐ DÍA DE DESCANSO O RECUPERACIÓN = SOLO MOVILIDAD
            const mobilityExercises = utilityEx.filter(e => {
                const tipo = normalizeText(e.tipo);
                return tipo.includes('estiramiento') || tipo.includes('movilidad') || tipo.includes('calentamiento');
            });
            
            const mobilityFlow = shuffleArray(mobilityExercises).slice(0, 10);
            finalSession.sessionGoal = isRestDay ? 
                "🧘 Día de Descanso - Movilidad y Recuperación" : 
                "🛡️ Recuperación Activa";
            finalSession.estimatedDurationMin = 25;
            finalSession.mainBlocks = [{
                blockType: 'flow',
                restBetweenSetsSec: 0,
                restBetweenExercisesSec: 15,
                exercises: mobilityFlow.map(ex => ({
                    id: ex.id,
                    name: ex.nombre,
                    instructions: ex.descripcion,
                    imageUrl: ex.url,
                    equipment: "Peso Corporal",
                    sets: 2,
                    targetReps: "45-60s",
                    targetRIR: 5,
                    notes: "Movimiento fluido y controlado. Sin esfuerzo.",
                    performanceData: { plannedSets: 2, actualSets: [] }
                }))
            }];
        } else {
            // ⭐ SESIÓN DE ENTRENAMIENTO NORMAL
            finalSession.warmup.exercises = generateWarmup(utilityEx, bodyweightFiltered, targetSession.sessionFocus);
            
            const mainBlock = generateMainBlock(
                fullMainPool, 
                targetSession.sessionFocus, 
                sessionParams, 
                userHistory,
                equipmentType,
                targetMicrocycle.focus
            );

            const blockRestSets = mainBlock.type === 'circuit' ? Math.max(90, sessionParams.restCompound + 30) : sessionParams.restCompound;
            const blockRestEx = mainBlock.type === 'circuit' ? 15 : sessionParams.restIsolation;

            finalSession.mainBlocks = [{
                blockType: mainBlock.type,
                restBetweenSetsSec: blockRestSets,
                restBetweenExercisesSec: blockRestEx,
                exercises: mainBlock.exercises
            }];

            if (corePool.length > 0) {
                 const coreBlock = generateCoreBlock(corePool, readiness);
                 if (coreBlock) finalSession.coreBlocks.push(coreBlock);
            }

            const workedMuscles = finalSession.mainBlocks.flatMap(b => b.exercises).map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
            let stretches = utilityEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
            let priority = stretches.filter(ex => workedMuscles.includes(normalizeText(ex.parteCuerpo).split(' ')[0]));
            if (priority.length < 3) {
                const filler = shuffleArray(stretches.filter(x => !priority.includes(x))).slice(0, 3 - priority.length);
                priority = [...priority, ...filler];
            }
            finalSession.cooldown.exercises = priority.slice(0, 4).map(ex => ({
                id: ex.id,
                name: ex.nombre,
                instructions: ex.descripcion,
                durationOrReps: "30s",
                imageUrl: ex.url
            }));

            const setsTotal = finalSession.mainBlocks.flatMap(b => b.exercises).reduce((acc, curr) => acc + curr.sets, 0); 
            finalSession.estimatedDurationMin = 10 + (setsTotal * 3) + 5; 
        }

        // ===== METADATA EXTENDIDA =====
        finalSession.meta.externalLoad = externalLoad;
        finalSession.meta.isRestDay = isRestDay;
        finalSession.meta.dayOfWeek = dayName;
        finalSession.meta.weekPhase = targetMicrocycle.focus;
        finalSession.meta.targetRIR = sessionParams.targetRIR;

        await db.collection('users').doc(userId).update({ currentSession: finalSession });
        
        return res.status(200).json({ 
            success: true, 
            session: finalSession,
            context: {
                readinessMode: readiness.mode,
                externalLoad: externalLoad,
                isRestDay: isRestDay,
                exercisesAvoidedFromHistory: usedExercisesIds.size
            }
        });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}