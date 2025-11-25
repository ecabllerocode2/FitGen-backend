import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';

const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ====================================================================
// 1. BASE DE CONOCIMIENTO CIENTÍFICO (STRATEGY MAPS)
// ====================================================================

/**
 * Define las estrategias de división (SPLITS) según la frecuencia y nivel.
 * Basado en principios de Frecuencia Efectiva (Schoenfeld et al.)
 */
const SPLIT_STRATEGIES = {
    2: {
        beginner: ['Full Body A (Fundamentos)', 'Full Body B (Fundamentos)'],
        advanced: ['Full Body A (Alta Intensidad)', 'Full Body B (Alta Intensidad)'] // Atleta con poco tiempo
    },
    3: {
        beginner: ['Full Body A', 'Full Body B', 'Full Body C'], // Frecuencia 3 es ideal para aprendizaje motor
        intermediate: ['Torso - Fuerza', 'Pierna - Fuerza', 'Full Body - Metabólico'], // Híbrido
        advanced: ['Torso', 'Pierna', 'Full Body (Puntos Débiles)']
    },
    4: {
        beginner: ['Torso', 'Pierna', 'Full Body A', 'Full Body B'], // Transición
        intermediate: ['Torso - Fuerza', 'Pierna - Fuerza', 'Torso - Hipertrofia', 'Pierna - Hipertrofia'], // PHUL clásico
        advanced: ['Empuje (Push)', 'Tracción (Pull)', 'Pierna (Legs)', 'Torso/Brazos (Pump)'] // Especialización
    },
    5: {
        beginner: ['Torso', 'Pierna', 'Descanso', 'Full Body A', 'Full Body B'], // No recomendado, pero manejable
        intermediate: ['Torso', 'Pierna', 'Empuje', 'Tracción', 'Pierna'], // Híbrido Upper/Lower + PPL
        advanced: ['Pecho/Espalda', 'Pierna', 'Hombro/Brazo', 'Descanso', 'Full Body Hyper', 'Cardio/Abs'] // Arnold Split Modificado
    },
    6: {
        beginner: ['Full Body', 'Cardio', 'Full Body', 'Cardio', 'Full Body', 'Cardio'], // Enfoque salud
        intermediate: ['Empuje', 'Tracción', 'Pierna', 'Empuje', 'Tracción', 'Pierna'], // PPL x2
        advanced: ['Pecho/Espalda', 'Pierna', 'Hombro/Brazo', 'Pecho/Espalda', 'Pierna', 'Hombro/Brazo'] // Arnold Split Puro
    }
};

// ====================================================================
// 2. MOTORES DE DECISIÓN (HEURÍSTICA)
// ====================================================================

/**
 * Selecciona el Split óptimo cruzando Días, Nivel y Objetivo.
 */
const selectOptimalSplit = (days, level, goal) => {
    // Normalización de datos
    const d = Math.min(Math.max(days, 2), 6); // Clamp entre 2 y 6 días
    const l = level.toLowerCase();
    const g = goal.toLowerCase();

    // Determinamos el arquetipo de nivel
    let archetype = 'intermediate';
    if (l.includes('principiante') || l.includes('novato')) archetype = 'beginner';
    if (l.includes('avanzado') || l.includes('competidor') || l.includes('elite')) archetype = 'advanced';

    // Selección base
    let selectedSplit = SPLIT_STRATEGIES[d][archetype];

    // AJUSTE POR OBJETIVO (MODIFICADORES)
    // Si el objetivo es "Pérdida de Grasa" y es Principiante/Intermedio, forzamos más Full Body/Metabólico
    if ((g.includes('grasa') || g.includes('peso') || g.includes('definir')) && archetype !== 'advanced') {
        if (d === 3) selectedSplit = ['Full Body - Circuito A', 'Full Body - Circuito B', 'Full Body - Circuito C'];
        if (d === 4) selectedSplit = ['Torso - Fuerza', 'Pierna - Fuerza', 'Full Body - Metabólico A', 'Full Body - Metabólico B'];
    }

    // Si el objetivo es "Fuerza" (Powerlifting style)
    if (g.includes('fuerza') && d === 4) {
        selectedSplit = ['Sentadilla/Empuje (Squat focus)', 'Peso Muerto/Tracción (Hinge focus)', 'Press Banca (Bench focus)', 'Accesorios/Hipertrofia'];
    }

    return selectedSplit;
};

/**
 * Ajusta la intensidad (RPE) y el Volumen según el Nivel del usuario.
 * Una ama de casa novata no debe entrenar a RPE 9 (Fallo).
 */
const adjustIntensityForLevel = (baseStructure, level) => {
    const l = level.toLowerCase();
    
    if (l.includes('principiante')) {
        return {
            ...baseStructure,
            intensityRpe: baseStructure.intensityRpe.replace(/RPE \d+/, 'RPE 5-6'), // Baja intensidad
            notes: baseStructure.notes + " Prioridad absoluta: Aprender la técnica. No busques fatiga."
        };
    }
    if (l.includes('avanzado')) {
        // Los avanzados necesitan más intensidad para mantener adaptaciones
        const newRpe = parseInt(baseStructure.intensityRpe.match(/\d+/)[0]) + 1; 
        return {
            ...baseStructure,
            intensityRpe: `RPE ${Math.min(10, newRpe)}`, 
            notes: baseStructure.notes + " Intensidad alta requerida para estímulo."
        };
    }
    return baseStructure;
};

/**
 * Analiza el riesgo futuro (partidos, carreras) para ajustar la sesión actual.
 */
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

/**
 * EL CONSTRUCTOR DEL CALENDARIO (Scheduler)
 * Asigna sesiones respetando: Disponibilidad, Split, Carga Externa y Recuperación.
 */
const mapSplitToCalendar = (availableDays, idealSplit, weeklySchedule) => {
    const scheduledSessions = [];
    
    availableDays.forEach((dayCtx, index) => {
        const dayIndexInWeek = DAYS_ORDER.indexOf(dayCtx.day);
        
        // --- 1. ANÁLISIS DE CONTEXTO ---
        const futureRisk = assessFutureRisk(dayIndexInWeek, weeklySchedule);
        const currentFatigue = dayCtx.externalLoad;
        
        // Fatiga Pasada (Ayer)
        const prevDayIndex = (dayIndexInWeek - 1 + 7) % 7;
        const prevDayLoad = weeklySchedule[prevDayIndex]?.externalLoad || 'none';
        const isPostMatchDay = prevDayLoad === 'extreme' || prevDayLoad === 'high';

        // Sesión base según el Split elegido
        let finalSessionName = idealSplit[index % idealSplit.length];
        let adjustmentReason = null;

        // --- 2. REGLAS DE INTERVENCIÓN ---

        // A. REGLA "POST-EVENTO" (Ej. Lunes post-partido)
        // Si hay fatiga extrema previa, forzamos recuperación o zonas no fatigadas.
        if (isPostMatchDay && currentFatigue !== 'extreme') {
            if (finalSessionName.includes('Pierna') || finalSessionName.includes('Full Body')) {
                finalSessionName = 'Torso - Hipertrofia & Recuperación';
                adjustmentReason = "Ajuste post-carga extrema: Evitar piernas.";
            }
        }
        
        // B. REGLA "PRE-EVENTO" (Ej. Jueves antes de partido)
        // Si mañana hay carga crítica, reducimos volumen e impacto hoy.
        else if (futureRisk === 'critical' || futureRisk === 'warning') {
            if (finalSessionName.includes('Pierna') || finalSessionName.includes('Fuerza')) {
                finalSessionName = 'Activación Neural (Priming) & Movilidad';
                adjustmentReason = "Tapering: Preparación para evento futuro.";
            }
        }

        // C. REGLA "DÍA COMPLICADO" (Ej. Viernes con carga laboral media)
        else if (currentFatigue === 'medium' || currentFatigue === 'high') {
            // Si hoy ya es pesado por trabajo/vida, no matamos al usuario
            if (finalSessionName.includes('Fuerza') || finalSessionName.includes('Hipertrofia')) {
                finalSessionName = finalSessionName.replace('Fuerza', 'Metabólico').replace('Hipertrofia', 'Técnica');
                adjustmentReason = "Ajuste por carga externa del día.";
            }
        }

        // D. VALIDACIÓN DE REDUNDANCIA
        // Evitar repetir el mismo foco si el split era pequeño y los días muchos
        if (index > 0) {
            const prevSession = scheduledSessions[index - 1].sessionFocus;
            if (prevSession.includes('Torso') && finalSessionName.includes('Torso')) {
                // Si el split nos manda Torso de nuevo, intentamos cambiar a Pierna/Full si es seguro
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
        case 1: return { focus: "Adaptación Anatómica", intensityRpe: "6/10 (RPE 6)", notes: "Fase de Introducción: Prioriza la calidad de movimiento y establece tus pesos base." };
        case 2: return { focus: "Sobrecarga Progresiva", intensityRpe: "7/10 (RPE 7)", notes: "Fase de Carga: Intenta aumentar ligeramente el peso o las repeticiones respecto a la semana anterior." };
        case 3: return { focus: "Intensificación (Pico)", intensityRpe: "8.5/10 (RPE 8.5)", notes: "Fase de Choque: Entrenamientos exigentes. Mantén 1-2 repeticiones en reserva (RIR 1-2)." };
        case 4: return { focus: "Descarga (Deload)", intensityRpe: "5/10 (RPE 5)", notes: "Fase de Recuperación: Reduce el peso un 30% y el volumen a la mitad. Vital para el progreso a largo plazo." };
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
        const { profileData } = userDoc.data();

        // 1. PROCESAR CALENDARIO Y CONTEXTO
        const weeklyScheduleRaw = profileData.weeklyScheduleContext || [];
        const fullWeekContext = DAYS_ORDER.map(dayName => {
            return weeklyScheduleRaw.find(d => d.day === dayName) || { day: dayName, canTrain: false, externalLoad: 'none' };
        });

        const preferredDays = profileData.preferredTrainingDays || [];
        const trainingDays = fullWeekContext.filter(d => d.canTrain === true || preferredDays.includes(d.day));

        // VALIDACIÓN DE SEGURIDAD
        if (trainingDays.length === 0) {
            return res.status(400).json({ error: "No hay días de entrenamiento definidos." });
        }

        // 2. SELECCIÓN DEL SPLIT (La Magia Universal)
        const idealSplit = selectOptimalSplit(
            trainingDays.length, 
            profileData.experienceLevel, // "Principiante", "Intermedio", "Avanzado"
            profileData.fitnessGoal      // "Ganancia Muscular", "Pérdida de Grasa", etc.
        );
        
        // 3. MAPEO Y VALIDACIÓN TÁCTICA
        const weekSessionPlan = mapSplitToCalendar(trainingDays, idealSplit, fullWeekContext);

        // 4. GENERACIÓN DE 4 SEMANAS
        const microcycles = [];
        for (let w = 1; w <= 4; w++) {
            let structure = getMicrocycleStructure(w);
            
            // Ajuste de intensidad según Nivel del Usuario
            structure = adjustIntensityForLevel(structure, profileData.experienceLevel);

            const sessionsForWeek = JSON.parse(JSON.stringify(weekSessionPlan));
            microcycles.push({
                week: w,
                focus: structure.focus,
                intensityRpe: structure.intensityRpe,
                notes: structure.notes,
                sessions: sessionsForWeek
            });
        }

        // 5. FINALIZACIÓN
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
                mesocycleGoal: `Objetivo: ${profileData.fitnessGoal}. Nivel: ${profileData.experienceLevel}.`,
                strategy: `Split ${trainingDays.length} días (${profileData.experienceLevel})`,
                microcycles: microcycles
            },
            llmModelUsed: 'v7-universal-heuristic-engine',
            generationDate: today.toISOString(),
            status: 'active'
        };

        await db.collection('users').doc(userId).set({
            currentMesocycle: currentMesocycleData,
            planStatus: 'active'
        }, { merge: true });

        return res.status(200).json({ success: true, plan: currentMesocycleData });

    } catch (error) {
        console.error('FATAL ERROR:', error);
        return res.status(500).json({ error: error.message });
    }
}