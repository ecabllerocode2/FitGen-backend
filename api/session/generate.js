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
// B. SOBRECARGA PROGRESIVA CIENTÍFICA (Basado en RIR/RPE Real + Feedback)
// ====================================================================
/**
 * Calcula la sobrecarga para un ejercicio específico basándose en el historial.
 * MEJORADO: Ahora maneja tanto reps como tiempo, y usa feedback post-sesión.
 * Retorna: { targetLoad, targetReps, targetRIR, technique, notes, measureType }
 */
const calculateProgressiveOverload = (exercise, userHistory, equipmentContext, currentWeekPhase) => {
    const exerciseId = exercise.id;
    const measureType = exercise.measureType || 'reps'; // 'reps' o 'time'
    
    // Buscar el ejercicio en el historial (última vez que se hizo)
    let lastPerformance = null;
    let lastSessionFeedback = null;
    
    for (const session of userHistory) {
        if (!session.mainBlocks && !session.coreBlocks) continue;
        
        // Buscar en mainBlocks
        if (session.mainBlocks) {
            for (const block of session.mainBlocks) {
                const found = block.exercises.find(e => e.id === exerciseId);
                if (found && found.performanceData) {
                    lastPerformance = {
                        ...found,
                        sessionRPE: session.feedback?.rpe || 7,
                        sessionEnergy: session.feedback?.energyLevel || 3,
                        sessionSoreness: session.feedback?.sorenessLevel || 3,
                        sessionDate: session.meta?.date
                    };
                    lastSessionFeedback = session.feedback;
                    break;
                }
            }
        }
        
        // Buscar en coreBlocks si no se encontró
        if (!lastPerformance && session.coreBlocks) {
            for (const block of session.coreBlocks) {
                const found = block.exercises.find(e => e.id === exerciseId);
                if (found && found.performanceData) {
                    lastPerformance = {
                        ...found,
                        sessionRPE: session.feedback?.rpe || 7,
                        sessionEnergy: session.feedback?.energyLevel || 3,
                        sessionSoreness: session.feedback?.sorenessLevel || 3,
                        sessionDate: session.meta?.date
                    };
                    lastSessionFeedback = session.feedback;
                    break;
                }
            }
        }
        
        if (lastPerformance) break;
    }

    // DEFAULT: Si no hay historial previo
    if (!lastPerformance) {
        const defaultValue = measureType === 'time' ? '45s' : (equipmentContext === 'gym' ? 10 : 15);
        return {
            targetRIR: 2,
            targetReps: defaultValue,
            loadProgression: 'initial',
            notes: `📊 LÍNEA BASE: Primera vez. Termina con RIR 2 (esfuerzo controlado).`,
            technique: 'standard',
            measureType: measureType,
            avgRepsPerformed: null,
            avgRIR: null,
            prevTargetReps: null,
            lastSessionDate: null
        };
    }

    // ANÁLISIS DE RENDIMIENTO PREVIO
    const lastSets = lastPerformance.performanceData?.actualSets || [];
    
    // Si no hay datos detallados, usar RPE de sesión + feedback general
    if (lastSets.length === 0) {
        const lastRPE = lastPerformance.sessionRPE;
        const lastEnergy = lastPerformance.sessionEnergy;
        const lastSoreness = lastPerformance.sessionSoreness;
        
        let baseValue = lastPerformance.targetReps;
        
        if (measureType === 'time') {
            // Extraer segundos del string (ej: "45s" -> 45)
            if (typeof baseValue === 'string') {
                const match = baseValue.match(/(\d+)/);
                baseValue = match ? parseInt(match[1]) : 45;
            }
            
            // Progresión para ejercicios por tiempo
            if (lastRPE <= 6 && lastEnergy >= 3) {
                return {
                    targetRIR: 2,
                    targetReps: `${baseValue + 5}s`,
                    loadProgression: 'increase_time',
                    notes: `⚡ PROGRESO: RPE ${lastRPE} fue bajo y energía buena. Aumenta +5s.`,
                    technique: 'standard',
                    measureType: 'time',
                    avgRepsPerformed: null,
                    avgRIR: lastRPE,
                    prevTargetReps: `${baseValue}s`,
                    lastSessionDate: lastPerformance.sessionDate || null
                };
            } else if (lastRPE >= 8 || lastSoreness >= 4) {
                return {
                    targetRIR: 3,
                    targetReps: `${Math.max(20, baseValue - 5)}s`,
                    loadProgression: 'decrease_time',
                    notes: `⚠️ SOBRECARGA: RPE ${lastRPE} o dolor muscular alto. Reduce -5s.`,
                    technique: 'standard',
                    measureType: 'time',
                    avgRepsPerformed: null,
                    avgRIR: lastRPE,
                    prevTargetReps: `${baseValue}s`,
                    lastSessionDate: lastPerformance.sessionDate || null
                };
            }
            return {
                targetRIR: 2,
                targetReps: `${baseValue}s`,
                loadProgression: 'maintain',
                notes: '🔄 MANTÉN: Mismo tiempo, mejora la técnica.',
                technique: 'standard',
                measureType: 'time',
                avgRepsPerformed: null,
                avgRIR: lastRPE,
                prevTargetReps: `${baseValue}s`,
                lastSessionDate: lastPerformance.sessionDate || null
            };
        } else {
            // Progresión para ejercicios por reps
            if (typeof baseValue === 'string' && baseValue.match(/\d+/)) {
                baseValue = parseInt(baseValue.match(/\d+/)[0]);
            } else if (!baseValue) {
                baseValue = equipmentContext === 'gym' ? 10 : 15;
            }
            
            if (lastRPE <= 6 && lastEnergy >= 3) {
                return {
                    targetRIR: 2,
                    targetReps: baseValue + 2,
                    loadProgression: 'increase_volume',
                    notes: `⚡ PROGRESO: RPE ${lastRPE} fue bajo y energía buena. Aumenta volumen.`,
                    technique: 'standard',
                    measureType: 'reps',
                    avgRepsPerformed: null,
                    avgRIR: lastRPE,
                    prevTargetReps: baseValue,
                    lastSessionDate: lastPerformance.sessionDate || null
                };
            } else if (lastRPE >= 8 || lastSoreness >= 4) {
                return {
                    targetRIR: 3,
                    targetReps: Math.max(5, baseValue - 2),
                    loadProgression: 'decrease_volume',
                    notes: `⚠️ SOBRECARGA: RPE ${lastRPE} o dolor muscular alto. Reduce volumen.`,
                    technique: 'standard',
                    measureType: 'reps',
                    avgRepsPerformed: null,
                    avgRIR: lastRPE,
                    prevTargetReps: baseValue,
                    lastSessionDate: lastPerformance.sessionDate || null
                };
            }
            return {
                targetRIR: 2,
                targetReps: baseValue,
                loadProgression: 'maintain',
                notes: '🔄 MANTÉN: Misma carga, mejora la técnica.',
                technique: 'standard',
                measureType: 'reps',
                avgRepsPerformed: null,
                avgRIR: lastRPE,
                prevTargetReps: baseValue,
                lastSessionDate: lastPerformance.sessionDate || null
            };
        }
    }

    // ANÁLISIS DETALLADO POR SERIE (con datos reales de performance)
    const lastEnergy = lastPerformance.sessionEnergy;
    const lastSoreness = lastPerformance.sessionSoreness;
    
    if (measureType === 'time') {
        // Para ejercicios por tiempo, extraer segundos
        const timesPerformed = lastSets.map(set => {
            if (typeof set.reps === 'string') {
                const match = set.reps.match(/(\d+)/);
                return match ? parseInt(match[1]) : 45;
            }
            return set.reps || 45;
        });
        
        const avgTime = timesPerformed.reduce((sum, t) => sum + t, 0) / timesPerformed.length;
        const avgRIR = lastSets.reduce((sum, set) => sum + (set.rir || 2), 0) / lastSets.length;
        
        let progression = {};
        
        if (avgRIR >= 3 && lastEnergy >= 3) {
            progression = {
                targetRIR: 2,
                targetReps: `${Math.round(avgTime) + 10}s`,
                loadProgression: 'increase_time',
                notes: `⚡ PROGRESO: RIR ${avgRIR.toFixed(1)} alto y buena energía. Aumenta +10s.`,
                technique: 'standard',
                measureType: 'time'
            };
        } else if (avgRIR <= 1 || lastSoreness >= 4) {
            progression = {
                targetRIR: 3,
                targetReps: `${Math.max(20, Math.round(avgTime) - 10)}s`,
                loadProgression: 'decrease_time',
                notes: `⚠️ SOBRECARGA: RIR ${avgRIR.toFixed(1)} muy bajo o dolor alto. Reduce -10s.`,
                technique: 'standard',
                measureType: 'time'
            };
        } else {
            progression = {
                targetRIR: 2,
                targetReps: `${Math.round(avgTime) + 5}s`,
                loadProgression: 'slight_increase_time',
                notes: `📈 PROGRESIÓN: Aumenta +5s manteniendo control.`,
                technique: 'standard',
                measureType: 'time'
            };
        }
        
        return {
            ...progression,
            avgRepsPerformed: avgTime,
            avgRIR,
            prevTargetReps: `${Math.round(avgTime)}s`,
            lastSessionDate: lastPerformance.sessionDate || null
        };
    } else {
        // Para ejercicios por reps (lógica existente mejorada con feedback)
        const avgRepsPerformed = lastSets.reduce((sum, set) => sum + (set.reps || 0), 0) / lastSets.length;
        const avgRIR = lastSets.reduce((sum, set) => sum + (set.rir || 2), 0) / lastSets.length;
        let baseReps = avgRepsPerformed;

        // Rep target previo (si existe) para comparar
        let prevTargetReps = lastPerformance.targetReps;
        if (typeof prevTargetReps === 'string' && prevTargetReps.match(/\d+/)) {
            prevTargetReps = parseInt(prevTargetReps.match(/\d+/)[0]);
        }

        // LÓGICA DE PROGRESIÓN
        let progression = {};

        // GIMNASIO: Progresión de Carga (Load)
        if (equipmentContext === 'gym') {
            if (avgRIR >= 3 && lastEnergy >= 3) {
                // Muy fácil y buena energía: subir peso manteniendo reps
                progression = {
                    targetRIR: 2,
                    targetReps: Math.round(baseReps),
                    loadProgression: 'increase_load_5pct',
                    notes: `⚡ PROGRESO: RIR ${avgRIR.toFixed(1)} alto y energía ${lastEnergy}/5. Aumenta peso +5%.`,
                    technique: 'standard'
                };
            } else if (avgRIR <= 1 || lastSoreness >= 4) {
                // Demasiado duro o dolor alto: bajar carga
                progression = {
                    targetRIR: 2,
                    targetReps: Math.max(5, Math.round(baseReps) - 2),
                    loadProgression: 'decrease_load_step',
                    notes: `⚠️ SOBRECARGA: RIR ${avgRIR.toFixed(1)} bajo o dolor muscular ${lastSoreness}/5. Reduce peso.`,
                    technique: 'standard'
                };
            } else {
                // Zona adecuada: ligera progresión en reps
                progression = {
                    targetRIR: 2,
                    targetReps: Math.round(baseReps) + 1,
                    loadProgression: 'increase_reps',
                    notes: `🔥 DENSIDAD: Ejecuta 1 rep extra por serie manteniendo RIR 2.`,
                    technique: 'standard'
                };
            }
        } 
        // EQUIPO LIMITADO / PESO CORPORAL: Progresión de Densidad/Volumen/Técnica
        else {
            if (avgRIR >= 3 && avgRepsPerformed < 15 && lastEnergy >= 3) {
                // Fácil y con margen de reps: subir volumen
                progression = {
                    targetRIR: 2,
                    targetReps: Math.round(baseReps) + 2,
                    loadProgression: 'increase_volume',
                    notes: `📈 VOLUMEN: Aumenta a ${Math.round(baseReps) + 2} reps por serie (RIR 2).`,
                    technique: 'standard'
                };
            } else if (avgRIR <= 1 || lastSoreness >= 4) {
                // Muy duro o dolor alto: bajar repeticiones
                progression = {
                    targetRIR: 2,
                    targetReps: Math.max(5, Math.round(baseReps) - 2),
                    loadProgression: 'decrease_volume',
                    notes: `⚠️ SOBRECARGA: RIR ${avgRIR.toFixed(1)} bajo o dolor ${lastSoreness}/5. Reduce reps.`,
                    technique: 'standard'
                };
            } else if (avgRepsPerformed >= 15 && avgRepsPerformed < 25) {
                progression = {
                    targetRIR: 1,
                    targetReps: Math.round(baseReps),
                    loadProgression: 'technique_tempo',
                    notes: `🐢 TEMPO LENTO: Aplica 3-0-3 (3s bajada, 3s subida) para simular más peso.`,
                    technique: 'tempo_3-0-3'
                };
            } else if (avgRepsPerformed >= 25) {
                progression = {
                    targetRIR: 0,
                    targetReps: 15,
                    loadProgression: 'rest_pause',
                    notes: `⏸️ REST-PAUSE: Reduce descanso a 30s y trabaja cerca del fallo.`,
                    technique: 'rest_pause'
                };
            } else {
                // Zona intermedia: mantener
                progression = {
                    targetRIR: 2,
                    targetReps: Math.round(baseReps),
                    loadProgression: 'maintain',
                    notes: '🔄 MANTÉN: Misma carga y reps, mejora la técnica.',
                    technique: 'standard'
                };
            }
        }

        return {
            ...progression,
            measureType: 'reps',
            avgRepsPerformed,
            avgRIR,
            prevTargetReps: prevTargetReps || null,
            lastSessionDate: lastPerformance.sessionDate || null
        };
    }
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
// Mejorada: Progresión real de peso con varias barras, respetando la dirección de progresión
const assignLoadSuggestion = (exercise, userInventory, sessionMode, userHistory = [], loadProgression = 'maintain') => {
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
                 const sub = assignLoadSuggestion({ ...exercise, equipo: "Mancuernas" }, userInventory, sessionMode, userHistory, loadProgression);
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
    let lastLoad = null;
    let loadDecision = 'none';

    if (finalPool.length > 1 && isCompound && userHistory.length > 0) {
        // Buscar el último peso usado para este ejercicio
        for (const session of userHistory) {
            if (!session.mainBlocks) continue;
            for (const block of session.mainBlocks) {
                const found = block.exercises.find(e => e.id === exercise.id);
                if (found && found.performanceData && found.performanceData.actualSets && found.performanceData.actualSets.length > 0) {
                    const loads = found.performanceData.actualSets
                        .map(s => parseFloat((s.load || '').toString().replace(/[^\d.]/g, '')))
                        .filter(x => !isNaN(x));
                    if (loads.length > 0) {
                        lastLoad = Math.max(...loads);
                        break;
                    }
                }
            }
            if (lastLoad !== null) break;
        }

        if (lastLoad !== null) {
            // Índice del peso actual en la lista ordenada
            const currentIndex = finalPool.findIndex(w => w.weight === lastLoad);
            if (loadProgression.startsWith('increase_load')) {
                // Subir un escalón de peso si es posible
                if (currentIndex >= 0 && currentIndex < finalPool.length - 1) {
                    selected = finalPool[currentIndex + 1];
                } else {
                    selected = finalPool[finalPool.length - 1];
                }
                loadDecision = 'increase';
            } else if (loadProgression.startsWith('decrease_load')) {
                // Bajar un escalón de peso si es posible
                if (currentIndex > 0) {
                    selected = finalPool[currentIndex - 1];
                } else {
                    selected = finalPool[0];
                }
                loadDecision = 'decrease';
            } else {
                // Mantener el mismo peso si existe; si no, el más cercano
                if (currentIndex >= 0) {
                    selected = finalPool[currentIndex];
                } else {
                    selected = finalPool[0];
                }
                loadDecision = 'maintain';
            }
        }
    }

    // Si no había historial o no se pudo determinar lastLoad, usar heurística por modo
    if (!selected && finalPool.length > 0) {
        selected = finalPool[0];
    }
    if (finalPool.length > 1 && (!userHistory || userHistory.length === 0)) {
        if (sessionMode === 'survival') {
            selected = finalPool[Math.floor((finalPool.length - 1) / 2)];
        } else {
            if (isCompound) {
                selected = finalPool[finalPool.length - 1];
            } else {
                selected = finalPool[Math.max(0, finalPool.length - 2)];
            }
        }
    }

    const equipmentName = selected.fullName.split('(')[0].trim();
    const suggestedLoad = `Usa: ${selected.fullName}`;

    let rationale = '';
    if (lastLoad !== null) {
        if (loadDecision === 'increase') {
            rationale = `Peso aumentado desde ~${lastLoad}kg hasta ${selected.weight}kg por buen margen de RIR.`;
        } else if (loadDecision === 'decrease') {
            rationale = `Peso reducido desde ~${lastLoad}kg hasta ${selected.weight}kg por esfuerzo alto en la sesión previa.`;
        } else if (loadDecision === 'maintain') {
            rationale = `Se mantiene peso cercano a ${lastLoad}kg para consolidar el estímulo.`;
        }
    }

    return {
        equipmentName,
        suggestedLoad,
        lastLoad,
        selectedWeight: selected.weight,
        loadDecision,
        loadRationale: rationale
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
        // Principiantes: solo ejercicios principiantes
        if (level === 'principiante') return exLevel === 'principiante';
        // Intermedios: principiantes e intermedios
        if (level === 'intermedio') return exLevel === 'principiante' || exLevel === 'intermedio';
        // Avanzados: todos los niveles (pueden incluir ejercicios de niveles inferiores)
        return true; 
    });
};

// ====================================================================
// D. EVITAR REPETICIÓN DE EJERCICIOS (Historial últimos 14 días)
// ====================================================================
/**
 * Obtiene ejercicios realizados en los últimos N días (por defecto 14).
 * Esto evita la monotonía y permite rotación inteligente.
 */
const getExercisesFromRecentHistory = (userHistory, daysBack = 14, today = new Date()) => {
    const usedExerciseIds = new Set();
    const todayDate = today instanceof Date ? today : new Date();
    for (const session of userHistory) {
        const sessionDate = session.meta?.date;
        if (!sessionDate) continue;
        try {
            const parsed = parseISO(sessionDate);
            const diffDays = Math.abs((todayDate - parsed) / (1000 * 60 * 60 * 24));
            if (diffDays > daysBack) continue;
            if (session.mainBlocks) {
                session.mainBlocks.forEach(block => {
                    block.exercises.forEach(ex => {
                        usedExerciseIds.add(ex.id);
                    });
                });
            }
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

const generateWarmup = (unifiedPool, focus) => {
    const normFocus = normalizeText(focus);
    let target = 'general';
    if (normFocus.includes('pierna') || normFocus.includes('full')) target = 'pierna';
    if (normFocus.includes('torso') || normFocus.includes('pecho') || normFocus.includes('empuje') || normFocus.includes('hombro') || normFocus.includes('brazo')) target = 'superior';
    if (normFocus.includes('espalda') || normFocus.includes('traccion')) target = 'superior';

    // Filtro para ejercicios de calentamiento y movilidad
    const mobility = unifiedPool.filter(ex => {
        const type = normalizeText(ex.tipo);
        const part = normalizeText(ex.parteCuerpo);
        return type.includes('calentamiento') || type.includes('movilidad') || 
               (type.includes('estiramiento') && !ex.isDynamic && (target === 'general' || part.includes(target)));
    });

    // Filtro para ejercicios de activación (peso corporal, dinámicos, fáciles)
    const activation = unifiedPool.filter(ex => {
        const type = normalizeText(ex.tipo);
        const part = normalizeText(ex.parteCuerpo);
        const equip = normalizeText(ex.equipo);
        const isBodyweight = equip.includes('corporal') || equip.includes('sin equipo');
        const isLeg = part.includes('pierna') || part.includes('gluteo') || part.includes('cuadriceps');
        const isUpper = part.includes('pecho') || part.includes('hombro') || part.includes('espalda') || part.includes('brazo');
        
        return isBodyweight && ex.isDynamic && !part.includes('core') &&
               (target === 'pierna' ? isLeg : target === 'superior' ? isUpper : true);
    });

    const selected = [
        ...shuffleArray(mobility).slice(0, 2).map(e => ({ ...e, durationOrReps: e.measureType === 'time' ? '45s' : '10 reps' })),
        ...shuffleArray(activation).slice(0, 2).map(e => ({ ...e, durationOrReps: '12 reps' }))
    ];

    return selected.map(ex => ({
        id: ex.id || `warmup-${Math.random().toString(36).substr(2, 9)}`,
        name: ex.nombre,
        instructions: ex.descripcion,
        durationOrReps: ex.durationOrReps,
        imageUrl: ex.url,
        equipment: ex.equipo || "Peso Corporal"
    }));
};

const generateCoreBlock = (unifiedPool, readiness, userLevel = 'principiante') => {
    // Filtrar ejercicios core de la colección unificada
    const corePool = unifiedPool.filter(ex => {
        const part = normalizeText(ex.parteCuerpo);
        const type = normalizeText(ex.tipo);
        return (part.includes('core') || part.includes('abdomen') || part.includes('oblicuo')) &&
               !type.includes('estiramiento') && !type.includes('calentamiento');
    });
    
    if (corePool.length === 0) return null;
    // Más series para avanzados
    let sets = 3;
    if (userLevel && normalizeText(userLevel) === 'avanzado') sets = 4;
    if (readiness.mode === 'survival') sets = 1;
    let rpe = readiness.mode === 'performance' ? 9 : 7;
    const coreEx = shuffleArray(corePool).slice(0, 3); // hasta 3 ejercicios core
    return {
        blockType: 'superset',
        restBetweenSetsSec: 60,
        restBetweenExercisesSec: 0,
        exercises: coreEx.map(ex => ({
            id: ex.id || `core-${Math.random().toString(36).substr(2, 9)}`,
            name: ex.nombre,
            instructions: ex.descripcion,
            imageUrl: ex.url,
            equipment: ex.equipo || "Peso Corporal",
            sets: sets,
            targetReps: ex.measureType === 'time' ? "45-60s" : "15-20 reps",
            rpe: rpe,
            notes: "Abdomen contraído."
        }))
    };
};

// ====================================================================
// E. SISTEMA DE AUTO-NIVEL (Detección Automática de Progresión)
// ====================================================================
/**
 * Determina si el usuario debe subir de nivel automáticamente.
 * Criterios múltiples: sesiones completadas, consistencia, performance, tiempo entrenando
 * Retorna: { shouldUpgrade: boolean, newLevel: string, reason: string }
 */
const evaluateUserLevelProgression = (userData, userHistory) => {
    const currentLevel = normalizeText(userData.experienceLevel || 'principiante');
    
    // Ya es avanzado, no hay más niveles
    if (currentLevel === 'avanzado') {
        return { shouldUpgrade: false, newLevel: 'avanzado', reason: 'Ya estás en el nivel máximo' };
    }
    
    // Calcular métricas del usuario
    const completedSessions = userHistory.filter(s => s.feedback && s.feedback.completed).length;
    const totalSessions = userHistory.length;
    const completionRate = totalSessions > 0 ? completedSessions / totalSessions : 0;
    
    // Fecha de inicio (primera sesión o creación del perfil)
    let startDate = null;
    if (userHistory.length > 0) {
        const dates = userHistory.map(s => s.meta?.date).filter(Boolean).sort();
        if (dates.length > 0) {
            startDate = new Date(dates[0]);
        }
    }
    
    const weeksTraining = startDate ? Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24 * 7)) : 0;
    
    // Análisis de performance promedio
    const sessionsWithFeedback = userHistory.filter(s => s.feedback);
    const avgRPE = sessionsWithFeedback.length > 0 
        ? sessionsWithFeedback.reduce((sum, s) => sum + (s.feedback.rpe || 7), 0) / sessionsWithFeedback.length
        : 7;
    
    const avgEnergy = sessionsWithFeedback.length > 0
        ? sessionsWithFeedback.reduce((sum, s) => sum + (s.feedback.energyLevel || 3), 0) / sessionsWithFeedback.length
        : 3;
    
    // Calcular progresión en cargas (análisis de sobrecarga real)
    let progressionCount = 0;
    let totalExercisesTracked = 0;
    
    for (let i = 1; i < userHistory.length; i++) {
        const current = userHistory[i];
        const previous = userHistory[i - 1];
        
        if (!current.mainBlocks || !previous.mainBlocks) continue;
        
        current.mainBlocks.forEach(block => {
            block.exercises.forEach(ex => {
                // Buscar el mismo ejercicio en la sesión anterior
                previous.mainBlocks.forEach(prevBlock => {
                    const prevEx = prevBlock.exercises.find(e => e.id === ex.id);
                    if (prevEx && ex.performanceData && prevEx.performanceData) {
                        totalExercisesTracked++;
                        
                        const currentAvg = ex.performanceData.actualSets?.reduce((sum, s) => sum + (s.reps || 0), 0) 
                            / (ex.performanceData.actualSets?.length || 1);
                        const prevAvg = prevEx.performanceData.actualSets?.reduce((sum, s) => sum + (s.reps || 0), 0) 
                            / (prevEx.performanceData.actualSets?.length || 1);
                        
                        if (currentAvg > prevAvg) progressionCount++;
                    }
                });
            });
        });
    }
    
    const progressionRate = totalExercisesTracked > 0 ? progressionCount / totalExercisesTracked : 0;
    
    // ====== CRITERIOS DE UPGRADE ======
    
    // PRINCIPIANTE -> INTERMEDIO
    if (currentLevel === 'principiante') {
        const criteria = {
            minSessions: 24, // ~8 semanas con 3 sesiones/semana
            minWeeks: 8,
            minCompletionRate: 0.75,
            minProgressionRate: 0.3,
            maxAvgRPE: 8.5 // No debe estar constantemente agotado
        };
        
        const meetsSessionCount = completedSessions >= criteria.minSessions;
        const meetsTimeRequirement = weeksTraining >= criteria.minWeeks;
        const meetsConsistency = completionRate >= criteria.minCompletionRate;
        const meetsProgression = progressionRate >= criteria.minProgressionRate;
        const meetsRecovery = avgRPE <= criteria.maxAvgRPE;
        
        const passedCriteria = [meetsSessionCount, meetsTimeRequirement, meetsConsistency, meetsProgression, meetsRecovery]
            .filter(Boolean).length;
        
        if (passedCriteria >= 4) { // 4 de 5 criterios
            return {
                shouldUpgrade: true,
                newLevel: 'intermedio',
                reason: `🎉 ¡UPGRADE A INTERMEDIO! Has completado ${completedSessions} sesiones en ${weeksTraining} semanas con ${(completionRate * 100).toFixed(0)}% consistencia y excelente progresión (${(progressionRate * 100).toFixed(0)}%).`,
                metrics: {
                    completedSessions,
                    weeksTraining,
                    completionRate: (completionRate * 100).toFixed(0) + '%',
                    progressionRate: (progressionRate * 100).toFixed(0) + '%',
                    avgRPE: avgRPE.toFixed(1)
                }
            };
        }
    }
    
    // INTERMEDIO -> AVANZADO
    if (currentLevel === 'intermedio') {
        const criteria = {
            minSessions: 60, // ~20 semanas con 3 sesiones/semana
            minWeeks: 20,
            minCompletionRate: 0.80,
            minProgressionRate: 0.25, // Más difícil progresar en intermedio
            minAvgEnergy: 3.2 // Debe tener buena capacidad de recuperación
        };
        
        const meetsSessionCount = completedSessions >= criteria.minSessions;
        const meetsTimeRequirement = weeksTraining >= criteria.minWeeks;
        const meetsConsistency = completionRate >= criteria.minCompletionRate;
        const meetsProgression = progressionRate >= criteria.minProgressionRate;
        const meetsRecovery = avgEnergy >= criteria.minAvgEnergy;
        
        const passedCriteria = [meetsSessionCount, meetsTimeRequirement, meetsConsistency, meetsProgression, meetsRecovery]
            .filter(Boolean).length;
        
        if (passedCriteria >= 4) { // 4 de 5 criterios
            return {
                shouldUpgrade: true,
                newLevel: 'avanzado',
                reason: `🏆 ¡UPGRADE A AVANZADO! Has completado ${completedSessions} sesiones en ${weeksTraining} semanas con ${(completionRate * 100).toFixed(0)}% consistencia. Capacidad de recuperación excelente (${avgEnergy.toFixed(1)}/5).`,
                metrics: {
                    completedSessions,
                    weeksTraining,
                    completionRate: (completionRate * 100).toFixed(0) + '%',
                    progressionRate: (progressionRate * 100).toFixed(0) + '%',
                    avgEnergy: avgEnergy.toFixed(1)
                }
            };
        }
    }
    
    // No cumple criterios para upgrade
    return {
        shouldUpgrade: false,
        newLevel: currentLevel,
        reason: `Sigue progresando. Métricas actuales: ${completedSessions} sesiones, ${weeksTraining} semanas, ${(completionRate * 100).toFixed(0)}% consistencia.`,
        metrics: {
            completedSessions,
            weeksTraining,
            completionRate: (completionRate * 100).toFixed(0) + '%',
            progressionRate: (progressionRate * 100).toFixed(0) + '%',
            avgRPE: avgRPE.toFixed(1),
            avgEnergy: avgEnergy.toFixed(1)
        }
    };
};

const generateMainBlock = (pool, sessionFocus, params, userHistory, equipmentContext, currentWeekPhase, userLevel = 'principiante') => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;
    let setsCompound = params.setsCompound;
    let setsIsolation = params.setsIsolation;
    // Más series para avanzados
    if (userLevel && normalizeText(userLevel) === 'avanzado') {
        setsCompound = Math.max(5, setsCompound);
        setsIsolation = Math.max(4, setsIsolation);
    }
    const { targetRIR, techniqueNote } = params;
    
    // ====== CATEGORIZACIÓN INTELIGENTE DE SESIONES ======
    if (focus.includes('full') || focus.includes('metabolico') || focus.includes('acondicionamiento') || focus.includes('circuito')) {
        isCircuit = true;
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' },
            { pattern: ['empuje', 'pecho', 'hombro'], role: 'compound' },
            { pattern: ['traccion', 'espalda'], role: 'compound' },
            { pattern: ['gluteo', 'isquios'], role: 'compound' },
        ];
    } else if (focus.includes('cardio') || focus.includes('abs')) {
        // Sesiones de Cardio/Abs (acondicionamiento metabólico + core)
        isCircuit = true;
        template = [
            { pattern: ['core', 'abdomen', 'oblicuo'], role: 'compound' },
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' },
            { pattern: ['core', 'abdomen'], role: 'isolation' },
            { pattern: ['pierna', 'gluteo'], role: 'compound' },
        ];
    } else if (focus.includes('hyper') || focus.includes('hipertrofia') || focus.includes('pump') || focus.includes('débil')) {
        // Sesiones de Hipertrofia/Pump (más volumen, menos descanso)
        template = [
            { pattern: ['pecho', 'empuje'], role: 'compound' },
            { pattern: ['espalda', 'traccion'], role: 'compound' },
            { pattern: ['hombro', 'deltoides'], role: 'isolation' },
            { pattern: ['biceps'], role: 'isolation' },
            { pattern: ['triceps'], role: 'isolation' },
            { pattern: ['pierna', 'gluteo'], role: 'isolation' }
        ];
    } else if (focus.includes('fuerza') || focus.includes('sentadilla') || focus.includes('peso muerto') || focus.includes('bench') || focus.includes('banca')) {
        // Sesiones de Fuerza (menos reps, más carga, más descanso)
        setsCompound = Math.max(5, setsCompound);
        template = [
            { pattern: ['cuadriceps', 'sentadilla', 'pierna'], role: 'compound' },
            { pattern: ['isquios', 'peso muerto', 'femoral'], role: 'compound' },
            { pattern: ['pecho', 'press', 'banca'], role: 'compound' },
            { pattern: ['gluteo', 'pierna'], role: 'isolation' }
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
    } else if (focus.includes('hombro') || focus.includes('brazo')) {
        // Día específico de hombro/brazo
        template = [
            { pattern: ['hombro', 'deltoides'], role: 'compound' },
            { pattern: ['hombro', 'deltoides'], role: 'compound' },
            { pattern: ['hombro', 'deltoides'], role: 'isolation' },
            { pattern: ['biceps'], role: 'isolation' },
            { pattern: ['triceps'], role: 'isolation' }
        ];
    } else if (focus.includes('pierna') || focus.includes('gluteo') || focus.includes('legs')) {
        // Día específico de pierna
        template = [
            { pattern: ['cuadriceps', 'sentadilla'], role: 'compound' },
            { pattern: ['isquios', 'peso muerto', 'femoral'], role: 'compound' },
            { pattern: ['prensa', 'zancada', 'gluteo'], role: 'isolation' },
            { pattern: ['gemelos', 'pantorrilla'], role: 'isolation' }
        ];
    } else {
        // Fallback: Full Body balanceado
        console.log(`⚠️ Sesión con focus no reconocido: "${sessionFocus}". Usando template Full Body por defecto.`);
        isCircuit = true;
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' },
            { pattern: ['empuje', 'pecho'], role: 'compound' },
            { pattern: ['traccion', 'espalda'], role: 'compound' },
            { pattern: ['gluteo', 'isquios'], role: 'compound' },
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
            let pick = candidates.find(c => slot.role === 'compound' ? normalizeText(c.tipo).includes('multi') : normalizeText(c.tipo).includes('aislamiento'));
            if (!pick) pick = candidates[0];
            usedIds.add(pick.id);
            const isCompound = slot.role === 'compound';
            // ===== SOBRECARGA PROGRESIVA CIENTÍFICA =====
            const progression = calculateProgressiveOverload(
                pick, // Ahora pasamos el ejercicio completo para acceder a measureType
                userHistory,
                equipmentContext,
                currentWeekPhase
            );
            // CÁLCULO DE PESO EXACTO (respeta loadProgression)
            const loadSuggestion = assignLoadSuggestion(
                pick,
                params.userInventory,
                params.sessionMode,
                userHistory,
                progression.loadProgression
            );

            // Construcción de notas explicativas
            let historyNote = '';
            if (progression.avgRepsPerformed && progression.avgRIR !== null) {
                const avgReps = Math.round(progression.avgRepsPerformed);
                const avgRIR = progression.avgRIR.toFixed(1);
                if (progression.prevTargetReps) {
                    historyNote = `La última vez el objetivo era ~${progression.prevTargetReps} reps y realizaste ~${avgReps} reps por serie con RIR medio ${avgRIR}.`;
                } else {
                    historyNote = `La última vez realizaste ~${avgReps} reps por serie con RIR medio ${avgRIR}.`;
                }
            }
            if (!historyNote && progression.lastSessionDate) {
                historyNote = `Última sesión de este ejercicio el ${progression.lastSessionDate}.`;
            }

            const loadNote = loadSuggestion.loadRationale || '';

            const notesPieces = [
                progression.notes || '',
                historyNote,
                loadNote,
                techniqueNote || ''
            ].filter(Boolean);

            const finalNotes = notesPieces.join('\n');
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
                performanceData: {
                    plannedSets: isCompound ? setsCompound : setsIsolation,
                    actualSets: []
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
        
        // ===== EVALUACIÓN AUTOMÁTICA DE NIVEL =====
        const levelEvaluation = evaluateUserLevelProgression(userDoc.data(), userHistory);
        let levelUpgradeApplied = false;
        
        if (levelEvaluation.shouldUpgrade) {
            // Actualizar nivel del usuario automáticamente
            await userRef.update({
                'profileData.experienceLevel': levelEvaluation.newLevel,
                'profileData.lastLevelUpgrade': new Date().toISOString(),
                'profileData.levelUpgradeReason': levelEvaluation.reason
            });
            
            // Actualizar el profileData local para esta sesión
            profileData.experienceLevel = levelEvaluation.newLevel;
            levelUpgradeApplied = true;
            
            console.log(`✨ Usuario ${userId}升级 a ${levelEvaluation.newLevel}: ${levelEvaluation.reason}`);
        }
        
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

        // ===== OBTENER EJERCICIOS DE LOS ÚLTIMOS 14 DÍAS =====
        const usedExercisesIds = getExercisesFromRecentHistory(userHistory, 14, sessionDate);

        // ===== CARGA DE EJERCICIOS UNIFICADOS =====
        // 🆕 Todos los ejercicios están en: unified_exercises/all con campo 'exercises'
        const unifiedDoc = await db.collection('unified_exercises').doc('all').get();
        
        if (!unifiedDoc.exists) {
            return res.status(500).json({ error: 'No se encontró la colección de ejercicios unificados.' });
        }

        const allExercises = unifiedDoc.data().exercises || [];
        
        // Agregar IDs únicos a cada ejercicio basado en su posición si no tienen
        const allExercisesWithIds = allExercises.map((ex, index) => ({
            id: ex.id || `ex-${index}-${normalizeText(ex.nombre).replace(/\s+/g, '-')}`,
            ...ex
        }));

        // Separar por tipo de ejercicio
        const warmupAndStretchEx = allExercisesWithIds.filter(ex => {
            const tipo = normalizeText(ex.tipo);
            return tipo.includes('calentamiento') || tipo.includes('estiramiento') || tipo.includes('movilidad');
        });

        const mainExercisesRaw = allExercisesWithIds.filter(ex => {
            const tipo = normalizeText(ex.tipo);
            return tipo.includes('multiarticular') || tipo.includes('aislamiento') || 
                   (!tipo.includes('calentamiento') && !tipo.includes('estiramiento') && !tipo.includes('movilidad'));
        });

        // Filtrado Estricto de ejercicios principales
        let fullMainPool = mainExercisesRaw;
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        fullMainPool = filterExercisesByLevel(fullMainPool, profileData.experienceLevel);
        
        // ⭐ FILTRAR POR HISTORIAL (Evitar repetición del mismo día)
        fullMainPool = filterExercisesByHistory(fullMainPool, usedExercisesIds, 10);

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
            const mobilityExercises = warmupAndStretchEx.filter(e => {
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
                    equipment: ex.equipo || "Peso Corporal",
                    sets: 2,
                    targetReps: ex.measureType === 'time' ? "45-60s" : "8-10 reps",
                    targetRIR: 5,
                    notes: "Movimiento fluido y controlado. Sin esfuerzo.",
                    performanceData: { plannedSets: 2, actualSets: [] }
                }))
            }];
        } else {
            // ⭐ SESIÓN DE ENTRENAMIENTO NORMAL
            finalSession.warmup.exercises = generateWarmup(allExercisesWithIds, targetSession.sessionFocus);
            
            const mainBlock = generateMainBlock(
                fullMainPool,
                targetSession.sessionFocus,
                sessionParams,
                userHistory,
                equipmentType,
                targetMicrocycle.focus,
                profileData.experienceLevel || 'principiante'
            );

            const blockRestSets = mainBlock.type === 'circuit' ? Math.max(90, sessionParams.restCompound + 30) : sessionParams.restCompound;
            const blockRestEx = mainBlock.type === 'circuit' ? 15 : sessionParams.restIsolation;

            finalSession.mainBlocks = [{
                blockType: mainBlock.type,
                restBetweenSetsSec: blockRestSets,
                restBetweenExercisesSec: blockRestEx,
                exercises: mainBlock.exercises
            }];

            // ⭐ BLOQUE DE CORE
            const coreBlock = generateCoreBlock(allExercisesWithIds, readiness, profileData.experienceLevel || 'principiante');
            if (coreBlock) finalSession.coreBlocks.push(coreBlock);

            const workedMuscles = finalSession.mainBlocks.flatMap(b => b.exercises).map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
            let stretches = warmupAndStretchEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
            let priority = stretches.filter(ex => workedMuscles.includes(normalizeText(ex.parteCuerpo).split(' ')[0]));
            if (priority.length < 3) {
                const filler = shuffleArray(stretches.filter(x => !priority.includes(x))).slice(0, 3 - priority.length);
                priority = [...priority, ...filler];
            }
            finalSession.cooldown.exercises = priority.slice(0, 4).map(ex => ({
                id: ex.id,
                name: ex.nombre,
                instructions: ex.descripcion,
                durationOrReps: ex.measureType === 'time' ? "30s" : "8 reps",
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
                exercisesAvoidedFromHistory: usedExercisesIds.size,
                currentLevel: profileData.experienceLevel
            },
            // Información de upgrade de nivel (si aplica)
            levelUpgrade: levelUpgradeApplied ? {
                upgraded: true,
                newLevel: levelEvaluation.newLevel,
                reason: levelEvaluation.reason,
                metrics: levelEvaluation.metrics
            } : {
                upgraded: false,
                currentLevel: profileData.experienceLevel,
                progressInfo: levelEvaluation.reason,
                metrics: levelEvaluation.metrics
            }
        });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}