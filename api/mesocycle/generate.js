import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';

// ----------------------------------------------------
// 1. LÓGICA HEURÍSTICA DE CONTEXTO (El "Entrenador")
// ----------------------------------------------------

const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/**
 * Decide qué tipo de sesión asignar basándose en la fatiga del día Y la fatiga acumulada.
 * @param {number} currentDayIndex - Índice del día actual (0=Lunes, 6=Domingo)
 * @param {Array<Object>} weeklySchedule - Toda la configuración semanal (para ver días anteriores)
 * @param {string} focusArea - Objetivo del usuario (ej. Pierna)
 * @param {Array} sessionsPlacedSoFar - Lista de sesiones ya asignadas en la semana
 */
const getSessionForContext = (
    currentDayIndex, 
    weeklySchedule, 
    focusArea, 
    sessionsPlacedSoFar
) => {
    const dayContext = weeklySchedule[currentDayIndex];
    const externalLoad = dayContext.externalLoad || 'none';
    const focus = focusArea ? focusArea.toLowerCase() : 'general';
    const FATIGUE_MAP = { 'none': 0, 'low': 1, 'medium': 2, 'high': 4, 'extreme': 6 };

    // 1. CÁLCULO DE FATIGA DE ARRASTRE (Carry-over)
    let totalFatigueScore = 0;
    
    // Iteramos los 2 días anteriores (i=1: ayer, i=2: anteayer)
    for (let i = 1; i <= 2; i++) {
        // Módulo 7 para manejar el bucle de Domingo (índice 6) a Sábado (índice 5)
        const previousDayIndex = (currentDayIndex - i + 7) % 7; 
        const previousDayContext = weeklySchedule[previousDayIndex];
        const load = previousDayContext.externalLoad || 'none';
        
        // Peso: Le damos más importancia al día inmediatamente anterior (i=1)
        totalFatigueScore += FATIGUE_MAP[load] / (i === 1 ? 1 : 2); 
    }

    // UMBRAL DE FATIGA CRÍTICA (Ejemplo: Score >= 6.0)
    // 6.0 se alcanza con: Extremo el día anterior (6.0)
    // O: Alto ayer (4.0) + Alto anteayer (4.0 / 2 = 2.0) = 6.0
    if (totalFatigueScore >= 6.0) {
         return 'Descanso Activo / Movilidad (Fatiga Acumulada)';
    }

    // 2. REGLAS DE PROTECCIÓN (FATIGA DEL DÍA ACTUAL)
    
    // Caso: Día de Partido o Maratón
    if (externalLoad === 'extreme') {
        return 'Descanso Activo / Movilidad'; 
    }
    
    // Caso: Día Post-Partido o Trabajo Pesado (Fatiga Alta del día, pero no suficiente carry-over para anular)
    if (externalLoad === 'high') {
        return 'Full Body - Recuperación y Movilidad';
    }

    // 3. REGLAS DE RENDIMIENTO (Días Frescos)

    if (externalLoad === 'none' || externalLoad === 'medium' || externalLoad === 'low') {
        
        // REGLA 1: Prioridad al Foco (Ej. Pierna)
        const hasDoneLegs = sessionsPlacedSoFar.some(s => 
            s.includes('Pierna') || s.includes('Inferior') || s.includes('Glúteo')
        );
        
        if ((focus.includes('pierna') || focus.includes('inferior') || focus.includes('glúteo')) && !hasDoneLegs) {
            return 'Pierna - Fuerza e Hipertrofia';
        }

        // REGLA 2: Balance Estructural
        const hasDonePush = sessionsPlacedSoFar.some(s => s.includes('Torso') || s.includes('Empuje'));
        
        if (!hasDonePush) {
             return 'Torso - Fuerza e Hipertrofia';
        }

        // REGLA 3: Relleno Metabólico
        return 'Full Body - Estímulo Metabólico';
    }

    // Fallback por seguridad
    return 'Full Body - General';
};

/**
 * Define la intensidad ondulante por semana (Periodización)
 */
const getMicrocycleStructure = (weekNum) => {
    switch (weekNum) {
        case 1: 
            return { 
                focus: "Adaptación Anatómica", 
                intensityRpe: "6/10 (RPE 6)", 
                notes: "Semana de introducción. Enfócate en la técnica perfecta y rango de movimiento completo. Deja 3-4 reps en reserva (RIR 3)." 
            };
        case 2: 
            return { 
                focus: "Acumulación de Volumen", 
                intensityRpe: "7/10 (RPE 7)", 
                notes: "Aumentamos la carga de trabajo. Intenta añadir una serie extra o subir un poco el peso si la técnica fue buena. RIR 2-3." 
            };
        case 3: 
            return { 
                focus: "Intensificación (Pico)", 
                intensityRpe: "8-9/10 (RPE 8.5)", 
                notes: "Semana de choque. Entrena duro, cerca del fallo técnico en las últimas series. Es el momento de buscar récords personales. RIR 1." 
            };
        case 4: 
            return { 
                focus: "Descarga (Deload)", 
                intensityRpe: "5/10 (RPE 5)", 
                notes: "Semana de recuperación activa. Reduce el peso un 30% y haz la mitad de las series. Fundamental para disipar fatiga." 
            };
        default: 
            return { focus: "Mantenimiento", intensityRpe: "6/10", notes: "Mantener actividad." };
    }
};

// ----------------------------------------------------
// 2. CONFIGURACIÓN DEL SERVIDOR
// ----------------------------------------------------

const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

export default async function handler(req, res) {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    // Validación de Token
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token de autenticación.' });

    let userId;
    try {
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        userId = decoded.uid;
    } catch (e) { 
        return res.status(401).json({ error: 'Token inválido o expirado.' }); 
    }

    try {
        // 1. Obtener Perfil del Usuario
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const { profileData } = userDoc.data();
        if (!profileData) return res.status(400).json({ error: 'Datos de perfil incompletos. Por favor completa el onboarding.' });

        // 2. Determinar la Estructura Semanal basada en CONTEXTO
        const weeklySchedule = profileData.weeklyScheduleContext || [];
        
        let daysToProcess = [];
        
        if (weeklySchedule.length > 0) {
            // Aseguramos que el array siga el orden Lunes a Domingo para el cálculo de fatiga de arrastre
            daysToProcess = DAYS_ORDER.map(dayName => {
                return weeklySchedule.find(d => d.day === dayName) || { day: dayName, canTrain: false, externalLoad: 'none' };
            });
        } else {
            // Fallback para usuarios antiguos
            const simpleDays = profileData.preferredTrainingDays || ['Lunes', 'Miércoles', 'Viernes'];
            daysToProcess = DAYS_ORDER.map(dayName => ({ 
                day: dayName, 
                canTrain: simpleDays.includes(dayName), 
                externalLoad: 'none' 
            }));
        }

        // 3. Generar la Plantilla de Sesiones (Base Semanal)
        const sessionsTemplate = [];
        const sessionsPlacedSoFar = [];

        // Iteramos sobre el array completo de Lunes a Domingo (daysToProcess)
        daysToProcess.forEach((dayCtx, index) => { // AÑADIDO: index para saber qué día estamos procesando
            // Solo generamos sesión si el usuario marcó que puede entrenar ese día
            if (dayCtx.canTrain) {
                const sessionType = getSessionForContext(
                    index, // Índice del día actual
                    daysToProcess, // Pasamos la matriz completa
                    profileData.focusArea, 
                    sessionsPlacedSoFar
                );
                
                sessionsTemplate.push({
                    dayOfWeek: dayCtx.day,
                    sessionFocus: sessionType,
                    context: { 
                        externalFatigue: dayCtx.externalLoad,
                        fatigueCarryOverCalculated: true // Flag para debug
                    }
                });
                
                // Registramos qué tipo de sesión pusimos para equilibrar el resto de la semana
                sessionsPlacedSoFar.push(sessionType);
            }
        });

        // 4. Construir las 4 Semanas del Mesociclo
        const microcycles = [];
        for (let w = 1; w <= 4; w++) {
            const structure = getMicrocycleStructure(w);
            
            microcycles.push({
                week: w,
                focus: structure.focus,
                intensityRpe: structure.intensityRpe,
                notes: structure.notes,
                sessions: JSON.parse(JSON.stringify(sessionsTemplate)) 
            });
        }

        // 5. Metadatos y Fechas
        const today = new Date();
        const logicalStartDate = startOfWeek(today, { weekStartsOn: 1 }); // Lunes actual
        const durationWeeks = 4;
        const logicalEndDate = addDays(logicalStartDate, durationWeeks * 7);

        const mesocyclePlan = {
            durationWeeks: durationWeeks,
            mesocycleGoal: `Objetivo: ${profileData.fitnessGoal}. Enfoque en ${profileData.focusArea || 'General'}.`,
            microcycles: microcycles
        };

        const currentMesocycleData = {
            startDate: logicalStartDate.toISOString(),
            endDate: logicalEndDate.toISOString(),
            progress: 0.0,
            currentWeek: 1,
            mesocyclePlan: mesocyclePlan,
            llmModelUsed: 'heuristic-algorithm-v3-carryover-aware', // Actualización de versión
            generationDate: today.toISOString(),
            status: 'active'
        };

        // 6. Guardar en Firestore
        await db.collection('users').doc(userId).set({
            currentMesocycle: currentMesocycleData,
            planStatus: 'active'
        }, { merge: true });

        return res.status(200).json({ 
            success: true, 
            message: "Mesociclo generado exitosamente adaptado al contexto y fatiga de arrastre.",
            plan: currentMesocycleData 
        });

    } catch (error) {
        console.error('FATAL ERROR (Mesocycle Generate):', error);
        return res.status(500).json({ error: error.message });
    }
}