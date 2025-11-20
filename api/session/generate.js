import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- SCHEMA (Mantenemos el que incluye "name") ---
const SESSION_SCHEMA = {
    type: "OBJECT",
    properties: {
        sessionGoal: { type: "STRING" },
        estimatedDurationMin: { type: "INTEGER" },
        warmup: {
            type: "OBJECT",
            properties: {
                exercises: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "STRING" },
                            name: { type: "STRING" },
                            instructions: { type: "STRING" },
                            durationOrReps: { type: "STRING" }
                        },
                        required: ["id", "name", "instructions", "durationOrReps"]
                    }
                }
            },
            required: ["exercises"]
        },
        mainBlocks: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    blockType: { type: "STRING", enum: ["station", "superset", "circuit"] },
                    restBetweenSetsSec: { type: "INTEGER" },
                    restBetweenExercisesSec: { type: "INTEGER" },
                    exercises: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING" },
                                name: { type: "STRING" },
                                sets: { type: "INTEGER" },
                                targetReps: { type: "STRING" },
                                rpe: { type: "INTEGER" },
                                notes: { type: "STRING" }
                            },
                            required: ["id", "name", "sets", "targetReps", "rpe"]
                        }
                    }
                },
                required: ["blockType", "exercises"]
            }
        },
        cooldown: {
            type: "OBJECT",
            properties: {
                exercises: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "STRING" },
                            name: { type: "STRING" },
                            duration: { type: "STRING" }
                        },
                        required: ["id", "name", "duration"]
                    }
                }
            },
            required: ["exercises"]
        }
    },
    required: ["sessionGoal", "warmup", "mainBlocks", "cooldown"]
};

// --- HELPERS ---
const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

const safeMap = (collection, callback) => {
    if (!Array.isArray(collection)) return [];
    return collection.map(callback);
};

const createOptimizedContext = (exercises) => {
    if (!exercises || exercises.length === 0) return "SIN CONTEXTO DISPONIBLE";
    return exercises.map(ex => 
        `${ex.id}|${ex.nombre}|${ex.tipo}|${ex.musculoObjetivo || ex.parteCuerpo}|${ex.nivel || 'General'}`
    ).join('\n');
};

const getMuscleGroupFromFocus = (focusString) => {
    if (!focusString) return [];
    const f = focusString.toLowerCase();
    if (f.includes('pierna') || f.includes('cuádriceps') || f.includes('femoral')) return ['Piernas', 'Glúteos', 'Cadera'];
    if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro')) return ['Pecho', 'Hombros', 'Tríceps'];
    if (f.includes('tracción') || f.includes('espalda')) return ['Espalda', 'Bíceps'];
    if (f.includes('full body') || f.includes('híbrido')) return ['Piernas', 'Pecho', 'Espalda', 'Hombros', 'Full Body'];
    return [];
};

// --- RUTINA DE EMERGENCIA (FALLBACK) ---
// Si la IA falla, usamos esto para que el usuario no vea todo vacío.
const getEmergencySession = (focus) => ({
    sessionGoal: `Sesión básica de ${focus} (Modo Respaldo)`,
    estimatedDurationMin: 45,
    warmup: {
        exercises: [
            { id: "custom", name: "Jumping Jacks", instructions: "Calentamiento general", durationOrReps: "2 mins" },
            { id: "custom", name: "Rotaciones de Articulaciones", instructions: "Cuello, hombros y muñecas", durationOrReps: "1 min" }
        ]
    },
    mainBlocks: [
        {
            blockType: "station",
            restBetweenSetsSec: 60,
            restBetweenExercisesSec: 90,
            exercises: [
                { id: "custom", name: `Ejercicio Principal de ${focus}`, sets: 4, targetReps: "12", rpe: 8, notes: "Controla la bajada." },
                { id: "custom", name: `Ejercicio Secundario de ${focus}`, sets: 3, targetReps: "15", rpe: 7, notes: "Enfoque en la técnica." },
                { id: "custom", name: "Ejercicio Auxiliar", sets: 3, targetReps: "15", rpe: 7, notes: "Mantén la tensión." }
            ]
        }
    ],
    cooldown: {
        exercises: [
            { id: "custom", name: "Estiramiento Estático", duration: "5 min" }
        ]
    }
});

// ----------------------------------------------------
// HANDLER PRINCIPAL
// ----------------------------------------------------
export default async function handler(req, res) {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    // 1. AUTH
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token Bearer.' });
    let userId;
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await auth.verifyIdToken(token);
        userId = decoded.uid;
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido.' });
    }

    console.log(`Generando sesión para: ${userId}`);

    try {
        // 2. DATOS
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') {
            return res.status(400).json({ error: 'No hay mesociclo activo.' });
        }

        const todayDate = req.body.date ? parseISO(req.body.date) : new Date();
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada.` });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) {
            return res.status(200).json({ isRestDay: true, message: `Descanso: ${dayName}` });
        }

        // 3. CONTEXTO (Debug + Selección)
        let exerciseCollectionName = 'exercises_home_limited'; // Default
        const equipment = profileData.availableEquipment || [];
        
        if (equipment.includes('Gimnasio completo')) exerciseCollectionName = 'exercises_gym_full';
        else if (equipment.some(e => typeof e === 'string' && (e.toLowerCase().includes('bodyweight') || e.toLowerCase().includes('sin equipo')))) exerciseCollectionName = 'exercises_bodyweight_pure';

        console.log(`Buscando ejercicios en: ${exerciseCollectionName}`);

        const [utilitySnap, mainSnap] = await Promise.all([
            db.collection('exercises_utility').get(),
            db.collection(exerciseCollectionName).get()
        ]);

        // Validar si las colecciones están vacías (Posible causa del error)
        if (mainSnap.empty) {
            console.warn(`⚠️ ALERTA: La colección ${exerciseCollectionName} está vacía en Firestore.`);
        }

        let candidateExercises = [];
        const exerciseMap = {};

        const indexExercise = (doc) => {
            const d = doc.data(); d.id = doc.id;
            exerciseMap[doc.id] = d;
            return d;
        };

        utilitySnap.forEach(doc => candidateExercises.push(indexExercise(doc)));
        const muscleGroups = getMuscleGroupFromFocus(targetSession.sessionFocus);

        mainSnap.forEach(doc => {
            const d = indexExercise(doc);
            const matchesFocus = muscleGroups.length === 0 || muscleGroups.includes(d.parteCuerpo) || (d.musculoObjetivo && muscleGroups.some(g => d.musculoObjetivo.includes(g)));
            if (matchesFocus) candidateExercises.push(d);
        });

        // Si no hay suficientes ejercicios específicos, rellenar con lo que haya
        if (candidateExercises.length < 5 && !mainSnap.empty) {
             mainSnap.forEach(doc => {
                 if (candidateExercises.length < 30) candidateExercises.push(indexExercise(doc));
             });
        }

        const contextCSV = createOptimizedContext(candidateExercises.slice(0, 50));
        console.log(`Contexto enviado (longitud): ${contextCSV.length} caracteres.`);

        // 4. LLAMADA IA
        const systemPrompt = `Eres un entrenador personal.
        OBJETIVO: Generar una sesión de entrenamiento.
        
        REGLA ABSOLUTA:
        Si el contexto CSV está vacío o no encuentras ejercicios adecuados, **DEBES INVENTARLOS**.
        NUNCA devuelvas arrays vacíos en 'exercises'.
        Siempre usa "id": "custom" y un "name" descriptivo si inventas el ejercicio.`;

        const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Foco: ${targetSession.sessionFocus}\nNivel: ${profileData.experienceLevel}\nContexto:\n${contextCSV}\n\nGenera JSON:` }
                ],
                response_format: { type: "json_object" },
                schema: SESSION_SCHEMA
            })
        });

        const llmResult = await completion.json();
        let sessionJSON;
        
        try {
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch (e) {
            console.error("Error parseando JSON IA, usando respaldo.");
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // 5. VALIDACIÓN DE EMERGENCIA (FAIL-SAFE)
        // Si la IA devuelve arrays vacíos, activamos el modo emergencia.
        let isEmpty = false;
        if (!sessionJSON.mainBlocks || sessionJSON.mainBlocks.length === 0) isEmpty = true;
        else if (!sessionJSON.mainBlocks[0].exercises || sessionJSON.mainBlocks[0].exercises.length === 0) isEmpty = true;

        if (isEmpty) {
            console.warn("⚠️ La IA devolvió una sesión vacía. Usando rutina de respaldo.");
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // 6. HIDRATACIÓN
        const hydrateList = (list) => safeMap(list, (item) => {
            const dbData = exerciseMap[item.id];
            return {
                ...item,
                id: dbData ? item.id : "custom",
                name: dbData?.nombre || item.name || "Ejercicio Personalizado",
                description: dbData?.descripcion || item.instructions || item.notes || "Ejecución controlada.",
                imageUrl: dbData?.url || null,
                muscleTarget: dbData?.musculoObjetivo || targetSession.sessionFocus,
                equipment: dbData?.equipo || "General"
            };
        });

        const mainBlocksSafe = safeMap(sessionJSON.mainBlocks, (block) => ({
            ...block,
            exercises: hydrateList(block.exercises)
        }));

        const finalSessionData = {
            sessionGoal: sessionJSON.sessionGoal,
            estimatedDurationMin: sessionJSON.estimatedDurationMin,
            warmup: { exercises: hydrateList(sessionJSON.warmup?.exercises) },
            mainBlocks: mainBlocksSafe,
            cooldown: { exercises: hydrateList(sessionJSON.cooldown?.exercises) },
            meta: {
                date: todayDate.toISOString(),
                week: currentWeekNum,
                focus: targetSession.sessionFocus,
                generatedAt: new Date().toISOString()
            },
            completed: false
        };

        await userDocRef.update({ currentSession: finalSessionData });
        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("FATAL:", error);
        return res.status(500).json({ error: error.message });
    }
}