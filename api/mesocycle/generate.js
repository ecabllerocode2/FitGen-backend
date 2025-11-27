import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';

const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ====================================================================
// 1. BASE DE CONOCIMIENTO CIENTÍFICO (STRATEGY MAPS)
// ====================================================================

const SPLIT_STRATEGIES = {
    2: {
        beginner: ['Full Body A (Fundamentos)', 'Full Body B (Fundamentos)'],
        advanced: ['Full Body A (Alta Intensidad)', 'Full Body B (Alta Intensidad)']
    },
    3: {
        beginner: ['Full Body A', 'Full Body B', 'Full Body C'],
        intermediate: ['Torso - Fuerza', 'Pierna - Fuerza', 'Full Body - Metabólico'],
        advanced: ['Torso', 'Pierna', 'Full Body (Puntos Débiles)']
    },
    4: {
        beginner: ['Torso', 'Pierna', 'Full Body A', 'Full Body B'],
        intermediate: ['Torso - Fuerza', 'Pierna - Fuerza', 'Torso - Hipertrofia', 'Pierna - Hipertrofia'],
        advanced: ['Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)', 'Torso/Brazos (Pump)']
    },
    5: {
        beginner: ['Torso', 'Pierna', 'Descanso', 'Full Body A', 'Full Body B'],
        intermediate: ['Torso', 'Pierna', 'Empuje', 'Tracción', 'Pierna'],
        advanced: ['Pecho/Espalda', 'Pierna', 'Hombro/Brazo', 'Descanso', 'Full Body Hyper', 'Cardio/Abs']
    },
    6: {
        beginner: ['Full Body', 'Cardio', 'Full Body', 'Cardio', 'Full Body', 'Cardio'],
        intermediate: ['Empuje', 'Tracción', 'Pierna', 'Empuje', 'Tracción', 'Pierna'],
        advanced: ['Pecho/Espalda', 'Pierna', 'Hombro/Brazo', 'Pecho/Espalda', 'Pierna', 'Hombro/Brazo']
    }
};

// ====================================================================
// 2. MOTORES DE DECISIÓN (HEURÍSTICA & ADAPTACIÓN)
// ====================================================================

const selectOptimalSplit = (days, level, goal) => {
    const d = Math.min(Math.max(days, 2), 6);
    const l = level.toLowerCase();
    const g = goal.toLowerCase();

    let archetype = 'intermediate';
    if (l.includes('principiante') || l.includes('novato')) archetype = 'beginner';
    if (l.includes('avanzado') || l.includes('competidor') || l.includes('elite')) archetype = 'advanced';

    let selectedSplit = SPLIT_STRATEGIES[d][archetype];

    if ((g.includes('grasa') || g.includes('peso') || g.includes('definir')) && archetype !== 'advanced') {
        if (d === 3) selectedSplit = ['Full Body - Circuito A', 'Full Body - Circuito B', 'Full Body - Circuito C'];
        if (d === 4) selectedSplit = ['Torso - Fuerza', 'Pierna - Fuerza', 'Full Body - Metabólico A', 'Full Body - Metabólico B'];
    }

    if (g.includes('fuerza') && d === 4) {
        selectedSplit = ['Sentadilla/Empuje (Squat focus)', 'Peso Muerto/Tracción (Hinge focus)', 'Press Banca (Bench focus)', 'Accesorios/Hipertrofia'];
    }

    return selectedSplit;
};

/**
 * NUEVO: Calcula la intensidad adaptativa basada en el feedback del mesociclo anterior.
 * Aplica el 'overloadFactor' al RPE base.
 */
const calculateAdaptiveIntensity = (baseStructure, nextCycleConfig) => {
    // Si no hay configuración previa, devolvemos la estructura base tal cual
    if (!nextCycleConfig || !nextCycleConfig.overloadFactor) return baseStructure;

    const factor = nextCycleConfig.overloadFactor; // Ej: 1.15 (Más duro) o 0.90 (Más suave)
    
    // Extraer el número RPE del string (ej: "7/10 (RPE 7)" -> 7)
    const rpeMatch = baseStructure.intensityRpe.match(/RPE (\d+(\.\d+)?)/);
    let currentRpe = rpeMatch ? parseFloat(rpeMatch[1]) : 6;

    // Aplicar factor matemático
    let newRpe = currentRpe * factor;
    
    // Limites de seguridad (Clamp)
    newRpe = Math.max(5, Math.min(10, newRpe)); // Nunca menos de 5, nunca más de 10
    const roundedRpe = Math.round(newRpe * 10) / 10; // Redondear a 1 decimal

    let newNotes = baseStructure.notes;

    // Inyectar contexto en las notas
    if (factor > 1.05) {
        newNotes += " [ÉNFASIS: Subimos la intensidad debido a tu buen rendimiento previo].";
    } else if (factor < 0.95) {
        newNotes += " [RECUPERACIÓN: Bajamos ligeramente la carga para asegurar tu adaptación].";
    }

    if (nextCycleConfig.focusSuggestion === "Rehab/Prehab") {
        newNotes += " ⚠️ ATENCIÓN: Prioriza la ausencia de dolor sobre el peso. Controla el tempo.";
    }

    return {
        ...baseStructure,
        intensityRpe: `${roundedRpe}/10 (RPE ${roundedRpe})`,
        notes: newNotes
    };
};

const adjustIntensityForLevel = (baseStructure, level) => {
    const l = level.toLowerCase();
    
    if (l.includes('principiante')) {
        return {
            ...baseStructure,
            intensityRpe: baseStructure.intensityRpe.replace(/RPE \d+(\.\d+)?/, 'RPE 5-6'),
            notes: baseStructure.notes + " Prioridad absoluta: Aprender la técnica."
        };
    }
    // Para avanzados, el ajuste fino ya lo hace el calculateAdaptiveIntensity
    return baseStructure;
};

const assessFutureRisk = (currentDayIndex, weeklySchedule) => {
    const tomorrowIndex = (currentDayIndex + 1) % 7;
    const dayAfterIndex = (currentDayIndex + 2) % 7;
    
    const tomorrowLoad = weeklySchedule[tomorrowIndex]?.externalLoad || 'none';
    const dayAfterLoad = weeklySchedule[dayAfterIndex]?.externalLoad || 'none';

    if (tomorrowLoad === 'extreme') return 'critical'; 
    if (tomorrowLoad === 'high') return 'high';
    if (dayAfterLoad === 'extreme') return 'warning'; 
    
    return 'safe';
};

const mapSplitToCalendar = (availableDays, idealSplit, weeklySchedule) => {
    const scheduledSessions = [];
    
    availableDays.forEach((dayCtx, index) => {
        const dayIndexInWeek = DAYS_ORDER.indexOf(dayCtx.day);
        const futureRisk = assessFutureRisk(dayIndexInWeek, weeklySchedule);
        const currentFatigue = dayCtx.externalLoad;
        const prevDayIndex = (dayIndexInWeek - 1 + 7) % 7;
        const prevDayLoad = weeklySchedule[prevDayIndex]?.externalLoad || 'none';
        const isPostMatchDay = prevDayLoad === 'extreme' || prevDayLoad === 'high';

        let finalSessionName = idealSplit[index % idealSplit.length];
        let adjustmentReason = null;

        if (isPostMatchDay && currentFatigue !== 'extreme') {
            if (finalSessionName.includes('Pierna') || finalSessionName.includes('Full Body')) {
                finalSessionName = 'Torso - Hipertrofia & Recuperación';
                adjustmentReason = "Ajuste post-carga extrema: Evitar piernas.";
            }
        }
        else if (futureRisk === 'critical' || futureRisk === 'warning') {
            if (finalSessionName.includes('Pierna') || finalSessionName.includes('Fuerza')) {
                finalSessionName = 'Activación Neural (Priming) & Movilidad';
                adjustmentReason = "Tapering: Preparación para evento futuro.";
            }
        }
        else if (currentFatigue === 'medium' || currentFatigue === 'high') {
            if (finalSessionName.includes('Fuerza') || finalSessionName.includes('Hipertrofia')) {
                finalSessionName = finalSessionName.replace('Fuerza', 'Metabólico').replace('Hipertrofia', 'Técnica');
                adjustmentReason = "Ajuste por carga externa del día.";
            }
        }

        if (index > 0) {
            const prevSession = scheduledSessions[index - 1].sessionFocus;
            if (prevSession.includes('Torso') && finalSessionName.includes('Torso')) {
                if (futureRisk === 'safe') {
                    finalSessionName = 'Pierna/Core - Estímulo Complementario';
                    adjustmentReason = "Balance estructural.";
                }
            }
        }

        scheduledSessions.push({
            dayOfWeek: dayCtx.day,
            sessionFocus: finalSessionName,
            context: {
                externalFatigue: currentFatigue,
                adjustmentApplied: adjustmentReason,
                basePlan: idealSplit[index % idealSplit.length]
            }
        });
    });

    return scheduledSessions;
};

// ----------------------------------------------------
// 3. ESTRUCTURA DEL MESOCICLO (PERIODIZACIÓN)
// ----------------------------------------------------

const getMicrocycleStructure = (weekNum) => {
    switch (weekNum) {
        case 1: return { focus: "Adaptación Anatómica", intensityRpe: "6/10 (RPE 6)", notes: "Fase de Introducción: Prioriza la calidad de movimiento." };
        case 2: return { focus: "Sobrecarga Progresiva", intensityRpe: "7/10 (RPE 7)", notes: "Fase de Carga: Intenta aumentar peso o reps." };
        case 3: return { focus: "Intensificación (Pico)", intensityRpe: "8.5/10 (RPE 8.5)", notes: "Fase de Choque: Cerca del fallo técnico (RIR 1-2)." };
        case 4: return { focus: "Descarga (Deload)", intensityRpe: "5/10 (RPE 5)", notes: "Fase de Recuperación: Reduce peso 30% y volumen 50%." };
        default: return { focus: "Mantenimiento", intensityRpe: "6", notes: "" };
    }
};

// ----------------------------------------------------
// 4. HANDLER PRINCIPAL
// ----------------------------------------------------

export default async function handler(req, res) {
    const setCORSHeaders = (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    };
    
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token.' });

    try {
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        // --- MODIFICACIÓN 1: Leemos también el nextCycleConfig ---
        const { profileData, nextCycleConfig } = userDoc.data();

        // 1. PROCESAR CALENDARIO Y CONTEXTO
        const weeklyScheduleRaw = profileData.weeklyScheduleContext || [];
        const fullWeekContext = DAYS_ORDER.map(dayName => {
            return weeklyScheduleRaw.find(d => d.day === dayName) || { day: dayName, canTrain: false, externalLoad: 'none' };
        });

        const preferredDays = profileData.preferredTrainingDays || [];
        const trainingDays = fullWeekContext.filter(d => d.canTrain === true || preferredDays.includes(d.day));

        if (trainingDays.length === 0) {
            return res.status(400).json({ error: "No hay días de entrenamiento definidos." });
        }

        // 2. SELECCIÓN DEL SPLIT
        const idealSplit = selectOptimalSplit(
            trainingDays.length, 
            profileData.experienceLevel, 
            profileData.fitnessGoal
        );
        
        // 3. MAPEO TÁCTICO
        const weekSessionPlan = mapSplitToCalendar(trainingDays, idealSplit, fullWeekContext);

        // 4. GENERACIÓN DE 4 SEMANAS CON ADAPTACIÓN
        const microcycles = [];
        for (let w = 1; w <= 4; w++) {
            let structure = getMicrocycleStructure(w);
            
            // A. Ajuste Base por Nivel (Principiante vs Avanzado)
            structure = adjustIntensityForLevel(structure, profileData.experienceLevel);

            // B. --- MODIFICACIÓN 2: Ajuste Dinámico por Evaluación Previa ---
            // Si evaluate.js dejó instrucciones (overloadFactor), las aplicamos aquí.
            structure = calculateAdaptiveIntensity(structure, nextCycleConfig);

            const sessionsForWeek = JSON.parse(JSON.stringify(weekSessionPlan));
            microcycles.push({
                week: w,
                focus: structure.focus,
                intensityRpe: structure.intensityRpe,
                notes: structure.notes,
                sessions: sessionsForWeek
            });
        }

        // 5. FINALIZACIÓN Y LIMPIEZA
        const today = new Date();
        const logicalStartDate = startOfWeek(today, { weekStartsOn: 1 });
        const durationWeeks = 4;
        const logicalEndDate = addDays(logicalStartDate, durationWeeks * 7);

        const currentMesocycleData = {
            startDate: logicalStartDate.toISOString(),
            endDate: logicalEndDate.toISOString(),
            progress: 0.0,
            currentWeek: 1,
            mesocyclePlan: {
                durationWeeks: durationWeeks,
                mesocycleGoal: `Objetivo: ${profileData.fitnessGoal}.`,
                strategy: `Split ${trainingDays.length} días. Adaptación: ${nextCycleConfig ? 'Activada' : 'Estándar'}`,
                microcycles: microcycles
            },
            llmModelUsed: 'v7-universal-heuristic-engine-adaptive',
            generationDate: today.toISOString(),
            status: 'active'
        };

        // --- MODIFICACIÓN 3: Guardamos y "Consumimos" el nextCycleConfig ---
        // Al poner nextCycleConfig a null, evitamos que se aplique 
        // accidentalmente si el usuario regenera el plan manualmente en el futuro sin re-evaluar.
        await db.collection('users').doc(userId).set({
            currentMesocycle: currentMesocycleData,
            planStatus: 'active',
            nextCycleConfig: null // Borrado lógico (soft delete)
        }, { merge: true });

        return res.status(200).json({ success: true, plan: currentMesocycleData });

    } catch (error) {
        console.error('FATAL ERROR:', error);
        return res.status(500).json({ error: error.message });
    }
}