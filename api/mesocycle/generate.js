import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays, format } from 'date-fns';
import { es } from 'date-fns/locale';

// ----------------------------------------------------
// 1. LÓGICA DE PERIODIZACIÓN (CIENCIA DEL ENTRENAMIENTO)
// ----------------------------------------------------

// Definimos los esquemas de división (Splits) según días disponibles
const getTrainingSplit = (daysPerWeek, focusArea) => {
    // Normalizamos inputs
    const days = Math.min(Math.max(daysPerWeek, 1), 6); // Entre 1 y 6 días
    const focus = focusArea ? focusArea.toLowerCase() : 'general';

    // --- 1 DÍA (Mantención / Minimalista) ---
    if (days === 1) return ['Full Body - General'];

    // --- 2 DÍAS (Full Body Frecuencia 2) ---
    if (days === 2) return ['Full Body - Fuerza', 'Full Body - Hipertrofia'];

    // --- 3 DÍAS (Full Body Clásico o Empuje/Tirón/Pierna) ---
    if (days === 3) {
        if (focus.includes('pierna') || focus.includes('gluteo')) {
            return ['Pierna - General', 'Torso - General', 'Full Body - Hipertrofia'];
        }
        return ['Full Body - Fuerza', 'Full Body - Hipertrofia', 'Full Body - Resistencia'];
    }

    // --- 4 DÍAS (Torso/Pierna o Phul Híbrido) - EL ESTÁNDAR DE ORO ---
    if (days === 4) {
        if (focus.includes('pierna') || focus.includes('gluteo')) {
            // Especialización Pierna
            return [
                'Pierna - Cuádriceps',          // Lunes
                'Empuje (Push) - Pecho y Hombro', // Martes
                'Pierna - Glúteos e Isquios',   // Jueves
                'Tracción (Pull) - Espalda y Bíceps' // Viernes
            ];
        }
        // Estándar Torso/Pierna
        return [
            'Torso - Fuerza', 
            'Pierna - Fuerza', 
            'Torso - Hipertrofia', 
            'Pierna - Hipertrofia'
        ];
    }

    // --- 5 DÍAS (Upper/Lower + PPL Híbrido) ---
    if (days === 5) {
        return [
            'Pierna - Fuerza',
            'Empuje (Push) - Pecho y Hombro',
            'Tracción (Pull) - Espalda y Bíceps',
            'Torso - Hipertrofia',
            'Pierna - Hipertrofia'
        ];
    }

    // --- 6 DÍAS (PPL x2 - Arnold Split) ---
    return [
        'Pierna - Cuádriceps',
        'Empuje (Push) - Pecho y Hombro',
        'Tracción (Pull) - Espalda y Bíceps',
        'Pierna - Glúteos e Isquios',
        'Empuje (Push) - Hipertrofia',
        'Tracción (Pull) - Hipertrofia'
    ];
};

// Definimos la progresión semanal (Mesociclo Estándar de 4 Semanas)
const getMicrocycleStructure = (weekNum, goal) => {
    // Modelo: Acumulación -> Intensificación -> Realización -> Descarga
    
    switch (weekNum) {
        case 1:
            return {
                focus: "Adaptación Anatómica",
                intensityRpe: "6/10 (RPE 6)",
                notes: "Semana de introducción. Enfócate en la técnica perfecta y en sentir el movimiento. No llegues al fallo, deja 3-4 repeticiones en reserva."
            };
        case 2:
            return {
                focus: "Sobrecarga Progresiva (Volumen)",
                intensityRpe: "7/10 (RPE 7)",
                notes: "Aumentamos ligeramente el volumen. Intenta añadir una serie extra o un poco más de peso manteniendo la técnica. RIR 2-3."
            };
        case 3:
            return {
                focus: "Intensificación (Pico de Carga)",
                intensityRpe: "8-9/10 (RPE 8.5)",
                notes: "Semana más dura del ciclo. Acércate al fallo técnico en las últimas series. Es el momento de intentar romper récords personales de repeticiones o peso."
            };
        case 4:
            return {
                focus: "Descarga (Deload)",
                intensityRpe: "5/10 (RPE 5)",
                notes: "Semana de recuperación activa. Reduce el peso un 20-30% y haz menos series. El objetivo es disipar la fatiga acumulada para empezar el próximo ciclo con fuerza."
            };
        default:
            return { focus: "Mantenimiento", intensityRpe: "6/10", notes: "Mantener actividad." };
    }
};


// ----------------------------------------------------
// 2. HANDLER PRINCIPAL
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

    // Validación Auth
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;
    if (!idToken) return res.status(401).json({ error: 'Falta token.' });

    let userId;
    try {
        const decoded = await auth.verifyIdToken(idToken);
        userId = decoded.uid;
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido.' });
    }

    try {
        // 1. Obtener Perfil
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const { profileData } = userDoc.data();
        if (!profileData) return res.status(400).json({ error: 'Datos de perfil incompletos.' });

        // 2. Generar Estructura del Mesociclo (Algoritmo)
        const splitSessions = getTrainingSplit(profileData.trainingDaysPerWeek, profileData.focusArea);
        const userDays = profileData.preferredTrainingDays || ['Lunes', 'Miércoles', 'Viernes']; // Fallback

        // Aseguramos que la cantidad de sesiones coincida con los días preferidos
        // Si el usuario eligió 3 días pero el split devuelve 4 (error de lógica), cortamos
        const sessionsPerWeek = [];
        
        // Mapeo cíclico: Asignar las sesiones del split a los días disponibles
        userDays.forEach((dayName, index) => {
            // Usamos el operador módulo % para rotar las sesiones si hay más días que rutinas diseñadas (raro)
            // o para repetir si hay menos.
            const sessionTemplate = splitSessions[index % splitSessions.length];
            sessionsPerWeek.push({
                dayOfWeek: dayName,
                sessionFocus: sessionTemplate
            });
        });

        // 3. Construir las 4 Semanas
        const microcycles = [];
        for (let w = 1; w <= 4; w++) {
            const structure = getMicrocycleStructure(w, profileData.fitnessGoal);
            microcycles.push({
                week: w,
                focus: structure.focus,
                intensityRpe: structure.intensityRpe,
                notes: structure.notes,
                sessions: sessionsPerWeek // Las sesiones se repiten estructuralmente, la intensidad cambia por la 'week'
            });
        }

        // 4. Fechas y Respuesta
        const today = new Date();
        const logicalStartDate = startOfWeek(today, { weekStartsOn: 1 }); // Lunes actual o pasado
        const durationWeeks = 4;
        const logicalEndDate = addDays(logicalStartDate, durationWeeks * 7);

        const mesocyclePlan = {
            durationWeeks: durationWeeks,
            mesocycleGoal: `Objetivo: ${profileData.fitnessGoal}. Enfoque en ${profileData.focusArea}.`,
            microcycles: microcycles
        };

        const currentMesocycleData = {
            startDate: logicalStartDate.toISOString(),
            endDate: logicalEndDate.toISOString(),
            progress: 0.0,
            currentWeek: 1,
            mesocyclePlan: mesocyclePlan,
            llmModelUsed: 'heuristic-algorithm-v1', // Transparencia
            generationDate: today.toISOString(),
            status: 'active'
        };

        // Guardar en Firestore
        await db.collection('users').doc(userId).set({
            currentMesocycle: currentMesocycleData,
            planStatus: 'active'
        }, { merge: true });

        console.log(`>>> Mesociclo Heurístico Generado para ${userId}`);
        return res.status(200).json({ success: true, plan: currentMesocycleData });

    } catch (error) {
        console.error('FATAL:', error);
        return res.status(500).json({ error: error.message });
    }
}