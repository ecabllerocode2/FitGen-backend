import { LegacyLoad, DAYS_ORDER } from './constants.js';
import { getSessionOrder } from './splitSelector.js';

/**
 * Mapea las sesiones al calendario semanal optimizando la fatiga.
 * @param {Array} weeklySchedule - Array of { day, canTrain, externalLoad } (ordered Mon-Sun)
 * @param {string} splitType 
 * @returns {Array} Array of objects { dayOfWeek, sessionFocus, structureType, context, ... }
 */
export function mapSessionsToCalendar(weeklySchedule, splitType, equipmentProfile = null, experienceLevel = null) {
    const sessionQueue = getSessionOrder(splitType); // This should define the 'ideal' list of sessions to perform
    const trainingSchedule = new Array(7).fill(null);

    // Identificar sesiones duras
    const hardestSessionsKeywords = ['pierna', 'legs', 'back', 'espalda', 'full body (fuerza)', 'full body heavy'];
    const isHardSession = (sessionName) => {
        if (!sessionName) return false;
        return hardestSessionsKeywords.some(keyword => sessionName.toLowerCase().includes(keyword));
    };

    // Pre-cálculos sobre disponibilidad
    const trainableIndices = weeklySchedule
        .map((d, idx) => (d.canTrain ? idx : null))
        .filter(i => i !== null);
    const daysAvailableCount = trainableIndices.length;
    const isConsecutive = daysAvailableCount > 0 && (trainableIndices[trainableIndices.length - 1] - trainableIndices[0] === trainableIndices.length - 1);

    // Helper to cycle sessions when the sessionQueue is shorter than needed
    const getLoadSessions = (count) => {
        const out = [];
        let idx = 0;
        while (out.length < count) {
            out.push(sessionQueue[idx % sessionQueue.length]);
            idx++;
        }
        return out;
    };

    const isHome = equipmentProfile && equipmentProfile.location === 'home';
    const isBodyweightOnly = equipmentProfile && equipmentProfile.bodyweightOnly;

    // ================================
    // CASO A: Usuario dispone 6 días -> aplicar plantilla 2-1-3-1
    // ================================
    if (daysAvailableCount === 6) {
        console.log('[SessionScheduler] Applying 2-1-3-1 fatigue template for 6 available days');
        // Plantilla de carga: [LOAD, LOAD, REST, LOAD, LOAD, LOAD, REST]
        const loadsNeeded = 5; // cinco slots de carga
        const loads = getLoadSessions(loadsNeeded);
        let loadPtr = 0;

        for (let i = 0; i < 7; i++) {
            // Forzar REST en día 3 (index 2) y día 7 (index 6)
            if (i === 2 || i === 6) {
                trainingSchedule[i] = {
                    dayOfWeek: weeklySchedule[i].day,
                    sessionFocus: 'Descanso / Recuperación',
                    structureType: 'Rest',
                    isRestDay: true,
                    context: { note: 'Fatigue Management: Rest day (2-1-3-1 template)' }
                };
                continue;
            }

            // Si el usuario no puede entrenar en este día, respetarlo como descanso
            if (!weeklySchedule[i].canTrain) {
                trainingSchedule[i] = {
                    dayOfWeek: weeklySchedule[i].day,
                    sessionFocus: 'Descanso / Recuperación',
                    structureType: 'Rest',
                    isRestDay: true,
                    context: { note: 'Día no disponible para entrenamiento.' }
                };
                continue;
            }

            // Asignar siguiente sesión de carga
            const sessionName = loads[loadPtr++] || sessionQueue[0];
            trainingSchedule[i] = {
                dayOfWeek: weeklySchedule[i].day,
                sessionFocus: sessionName,
                structureType: 'Normal',
                isRestDay: false,
                context: { externalFatigue: weeklySchedule[i].externalLoad || 'none' }
            };
        }

        return trainingSchedule;
    }

    // ================================
    // CASO B: Usuario dispone 5 días consecutivos -> aplicar Pivot Low-Load en el día central
    // Para usuarios EN CASA y PRINCIPIANTES, limitar cargas pesadas: máximo 3 sesiones de 'LOAD' y 1 pivot
    // ================================
    if (daysAvailableCount === 5 && isConsecutive) {
        // If in-home beginner, apply conservative home template
        if (isHome && experienceLevel === 'Principiante') {
            console.log('[SessionScheduler] Applying 5-day HOME conservative template (max 3 LOAD, pivot + extra low-load)');
            // Plantilla: [LOAD, LOW_LOAD, LOW_LOAD_PIVOT, LOW_LOAD, LOAD, REST, REST]
            const pivotIdx = trainableIndices[Math.floor(trainableIndices.length / 2)];
            // Select 2 loads only for outer days and leave inner days as low-load
            const loads = getLoadSessions(2);
            let loadPtr = 0;

            for (let i = 0; i < 7; i++) {
                if (!weeklySchedule[i].canTrain) {
                    trainingSchedule[i] = {
                        dayOfWeek: weeklySchedule[i].day,
                        sessionFocus: 'Descanso / Recuperación',
                        structureType: 'Rest',
                        isRestDay: true,
                        context: { note: 'Día no disponible para entrenamiento.' }
                    };
                    continue;
                }

                if (i === pivotIdx) {
                    trainingSchedule[i] = {
                        dayOfWeek: weeklySchedule[i].day,
                        sessionFocus: 'Low-Load Pivot (Disipación)',
                        structureType: 'Low_Load_Pivot',
                        isRestDay: false,
                        context: {
                            externalFatigue: weeklySchedule[i].externalLoad || 'none',
                            lowLoadPivot: true,
                            maxRPE: 6,
                            excludeAxial: true,
                            focus: ['mobility','core','metabolic_flush']
                        }
                    };
                    continue;
                }

                // Outer loads on first and last trainable indices
                if (i === trainableIndices[0] || i === trainableIndices[trainableIndices.length - 1]) {
                    const sessionName = loads[loadPtr++] || sessionQueue[0];
                    trainingSchedule[i] = {
                        dayOfWeek: weeklySchedule[i].day,
                        sessionFocus: sessionName,
                        structureType: 'Normal',
                        isRestDay: false,
                        context: { externalFatigue: weeklySchedule[i].externalLoad || 'none', lowLoad: false }
                    };
                    continue;
                }

                // Middle days set to low-load (flow/mobility/core emphasis)
                trainingSchedule[i] = {
                    dayOfWeek: weeklySchedule[i].day,
                    sessionFocus: 'Low-Load (Recovery Focus)',
                    structureType: 'Low_Load',
                    isRestDay: false,
                    context: {
                        externalFatigue: weeklySchedule[i].externalLoad || 'none',
                        lowLoad: true,
                        maxRPE: 5,
                        excludeAxial: true,
                        focus: ['mobility','core','metabolic_flush']
                    }
                };
            }

            return trainingSchedule;
        }

        console.log('[SessionScheduler] Applying 5-day pivot low-load template (central low-load pivot)');
        // Plantilla conceptual: [LOAD, LOAD, LOW_LOAD_PIVOT, LOAD, LOAD, REST, REST]
        // Encontrar día central entre índices trainable
        const pivotIdx = trainableIndices[Math.floor(trainableIndices.length / 2)];

        // Generar una lista de cargas para los 4 load slots (excluyendo pivot)
        const loads = getLoadSessions(4);
        let loadPtr = 0;

        for (let i = 0; i < 7; i++) {
            if (!weeklySchedule[i].canTrain) {
                trainingSchedule[i] = {
                    dayOfWeek: weeklySchedule[i].day,
                    sessionFocus: 'Descanso / Recuperación',
                    structureType: 'Rest',
                    isRestDay: true,
                    context: { note: 'Día no disponible para entrenamiento.' }
                };
                continue;
            }

            if (i === pivotIdx) {
                // Low-Load Pivot Session
                trainingSchedule[i] = {
                    dayOfWeek: weeklySchedule[i].day,
                    sessionFocus: 'Low-Load Pivot (Disipación)',
                    structureType: 'Low_Load_Pivot',
                    isRestDay: false,
                    context: {
                        externalFatigue: weeklySchedule[i].externalLoad || 'none',
                        lowLoadPivot: true,
                        maxRPE: 6,
                        excludeAxial: true,
                        focus: ['mobility','core','metabolic_flush']
                    }
                };
                continue;
            }

            // Si aún hay loads para asignar, usar la siguiente
            const sessionName = loads[loadPtr++] || sessionQueue[0];
            trainingSchedule[i] = {
                dayOfWeek: weeklySchedule[i].day,
                sessionFocus: sessionName,
                structureType: 'Normal',
                isRestDay: false,
                context: { externalFatigue: weeklySchedule[i].externalLoad || 'none' }
            };
        }

        return trainingSchedule;
    }

    // ================================
    // DEFAULT: comportamiento previo (mapeo por orden y prevención básica de fatiga externa)
    // ================================
    let remainingSessions = [...sessionQueue];

    // Iterar días de la semana (0 = Lunes)
    weeklySchedule.forEach((dayInfo, i) => {
        if (!dayInfo.canTrain) {
            trainingSchedule[i] = {
                dayOfWeek: dayInfo.day,
                sessionFocus: 'Descanso / Recuperación',
                structureType: 'Rest',
                isRestDay: true,
                context: {
                    externalFatigue: dayInfo.externalLoad || 'none',
                    note: 'Día no disponible para entrenamiento.'
                }
            };
            return;
        }

        // Si no quedan sesiones (caso raro)
        if (remainingSessions.length === 0) {
            trainingSchedule[i] = {
                dayOfWeek: dayInfo.day,
                sessionFocus: 'Recuperación Activa Extra',
                structureType: 'Rest',
                isRestDay: true,
                context: { note: 'No hay más sesiones programadas en el split.' }
            };
            return;
        }

        const externalLoadStr = (dayInfo.externalLoad || 'none').toLowerCase();
        const externalLoadScore = LegacyLoad[externalLoadStr] || 0;

        let selectedSessionIndex = 0; // Por defecto el siguiente (PEEK)
        const nextSessionName = remainingSessions[0];

        // Lógica de Prevención de Fatiga SNC
        if (externalLoadScore >= 3 && isHardSession(nextSessionName)) {
            const lighterSessionIndex = remainingSessions.findIndex(s => !isHardSession(s));
            if (lighterSessionIndex !== -1) {
                selectedSessionIndex = lighterSessionIndex;
            }
        }

        const selectedSession = remainingSessions[selectedSessionIndex];
        remainingSessions.splice(selectedSessionIndex, 1);

        trainingSchedule[i] = {
            dayOfWeek: dayInfo.day,
            sessionFocus: selectedSession,
            structureType: 'Normal', // Se definirá mejor en ContentBuilder
            isRestDay: false,
            context: {
                externalFatigue: dayInfo.externalLoad || 'none',
                adjustmentApplied: selectedSessionIndex !== 0 ? 'Fatigue Management Swap' : null
            }
        };
    });

    return trainingSchedule;
} 
