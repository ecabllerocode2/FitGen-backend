import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, addDays, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- SCHEMA DE SALIDA (LLM) ---
const SESSION_SCHEMA = {
    type: "OBJECT",
    properties: {
        sessionGoal: { type: "STRING", description: "Objetivo técnico." },
        estimatedDurationMin: { type: "INTEGER", description: "Duración total." },
        warmup: {
            type: "OBJECT",
            properties: {
                exercises: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "STRING" },
                            instructions: { type: "STRING" },
                            durationOrReps: { type: "STRING" }
                        },
                        required: ["id", "instructions", "durationOrReps"]
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
                                sets: { type: "INTEGER" },
                                targetReps: { type: "STRING" },
                                rpe: { type: "INTEGER" },
                                notes: { type: "STRING" }
                            },
                            required: ["id", "sets", "targetReps", "rpe"]
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
                            duration: { type: "STRING" }
                        },
                        required: ["id", "duration"]
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

// Helper seguro para arrays que evita el error "Cannot read properties of undefined (reading 'map')"
const safeMap = (collection, callback) => {
    if (!Array.isArray(collection)) return [];
    return collection.map(callback);
};

const createOptimizedContext = (exercises) => {
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
    if (f.includes('full body') || f.includes('híbrido') || f.includes('cuerpo completo')) return ['Piernas', 'Pecho', 'Espalda', 'Hombros', 'Full Body'];
    return [];
};

// ----------------------------------------------------
// HANDLER PRINCIPAL
// ----------------------------------------------------
export default async function handler(req, res) {
    setCORSHeaders(res);

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    // 1. AUTENTICACIÓN
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
        // 2. OBTENER DATOS USUARIO
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') {
            return res.status(400).json({ error: 'No hay un mesociclo activo. Genera uno primero.' });
        }

        // 3. LOGICA DE FECHAS (Robusta)
        const todayDate = req.body.date ? parseISO(req.body.date) : new Date();
        const startDate = parseISO(currentMesocycle.startDate);
        
        if (!isValid(todayDate) || !isValid(startDate)) {
             return res.status(400).json({ error: 'Fechas inválidas en el mesociclo.' });
        }

        // Calcular semana actual (si es negativo, asumir semana 1)
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        // Buscar microciclo y sesión
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        
        if (!targetMicrocycle) {
            return res.status(400).json({ error: `No se encontró plan para la semana ${currentWeekNum}.` });
        }

        const dayName = format(todayDate, 'EEEE', { locale: es });
        
        const targetSession = targetMicrocycle.sessions.find(s => 
            s.dayOfWeek.toLowerCase() === dayName.toLowerCase()
        );

        if (!targetSession) {
            return res.status(200).json({ 
                isRestDay: true, 
                message: `Hoy (${dayName}) es día de descanso según tu plan.` 
            });
        }

        // 4. PREPARAR CONTEXTO (Firestore Optimization)
        let exerciseCollectionName = 'exercises_home_limited';
        const equipment = profileData.availableEquipment || []; // Fallback array vacío
        
        if (equipment.includes('Gimnasio completo')) {
            exerciseCollectionName = 'exercises_gym_full';
        } else if (equipment.some(e => typeof e === 'string' && (e.toLowerCase().includes('bodyweight') || e.toLowerCase().includes('sin equipo')))) {
            exerciseCollectionName = 'exercises_bodyweight_pure';
        }

        const muscleGroups = getMuscleGroupFromFocus(targetSession.sessionFocus);

        const [utilitySnap, mainSnap] = await Promise.all([
            db.collection('exercises_utility').get(),
            db.collection(exerciseCollectionName).get()
        ]);

        let candidateExercises = [];
        const exerciseMap = {};

        // Helper para indexar
        const indexExercise = (doc) => {
            const d = doc.data();
            d.id = doc.id;
            exerciseMap[doc.id] = d;
            return d;
        };

        utilitySnap.forEach(doc => {
            const d = indexExercise(doc);
            candidateExercises.push(d);
        });

        mainSnap.forEach(doc => {
            const d = indexExercise(doc);
            
            // Filtros
            const matchesFocus = muscleGroups.length === 0 
                || muscleGroups.includes(d.parteCuerpo) 
                || (d.musculoObjetivo && muscleGroups.some(g => d.musculoObjetivo.includes(g)));
            
            let levelOk = true;
            if (profileData.experienceLevel === 'Principiante' && d.nivel === 'Avanzado') levelOk = false;

            if (matchesFocus && levelOk) {
                candidateExercises.push(d);
            }
        });
        
        // Fallback si hay pocos ejercicios
        if (candidateExercises.length < 10) {
             mainSnap.forEach(doc => {
                const d = indexExercise(doc);
                if (!candidateExercises.find(e => e.id === d.id)) {
                    candidateExercises.push(d);
                }
             });
        }
        
        const finalContext = candidateExercises.slice(0, 45); 
        const contextCSV = createOptimizedContext(finalContext);

        // 5. LLAMADA AL LLM
        const systemPrompt = `Eres un entrenador experto. Genera una sesión JSON.
        
        DATOS:
        - Nivel: ${profileData.experienceLevel}.
        - Foco: ${targetSession.sessionFocus}.
        - RPE: ${targetMicrocycle.intensityRpe}.
        - Notas Semanales: ${targetMicrocycle.notes}.
        
        REGLAS CRÍTICAS:
        1. Usa SIEMPRE el formato JSON solicitado.
        2. 'exercises' debe ser SIEMPRE un array, aunque esté vacío.
        3. Intenta usar IDs del contexto, pero si necesitas un ejercicio básico que no está, usa el ID "custom".
        4. NO devuelvas texto fuera del JSON.`;

        const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini", // Modelo rápido y barato
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Contexto (ID|Nombre|Tipo):\n${contextCSV}\n\nGenera la sesión para hoy:` }
                ],
                response_format: { type: "json_object" },
                schema: SESSION_SCHEMA
            })
        });

        const llmResult = await completion.json();
        
        if (!llmResult.choices || !llmResult.choices[0]) {
             throw new Error("Respuesta vacía del proveedor de IA.");
        }

        let sessionJSON;
        try {
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch (e) {
            console.error("JSON corrupto del LLM:", llmResult.choices[0].message.content);
            throw new Error("Error al procesar la respuesta de la IA.");
        }

        // 6. HIDRATACIÓN DEFENSIVA (AQUÍ ESTABA EL ERROR)
        // Usamos una función interna segura que nunca falla si la lista es undefined
        const hydrateList = (list) => safeMap(list, (item) => {
            const fullData = exerciseMap[item.id];
            
            // Si encontramos el ejercicio en la DB, usamos sus datos.
            // Si NO (ej. ID inventado por LLM), usamos los datos básicos que envió el LLM o genéricos.
            return {
                ...item,
                id: item.id || "unknown",
                name: fullData?.nombre || "Ejercicio Sugerido", // Fallback visual
                description: fullData?.descripcion || item.instructions || "Sigue las indicaciones.",
                imageUrl: fullData?.url || null,
                videoUrl: "",
                muscleTarget: fullData?.musculoObjetivo || "General",
                equipment: fullData?.equipo || "Sin equipo específico"
            };
        });

        // Procesamos bloques principales con seguridad
        const mainBlocksSafe = safeMap(sessionJSON.mainBlocks, (block) => ({
            ...block,
            exercises: hydrateList(block.exercises)
        }));

        const finalSessionData = {
            sessionGoal: sessionJSON.sessionGoal || `Entrenamiento de ${targetSession.sessionFocus}`,
            estimatedDurationMin: sessionJSON.estimatedDurationMin || 45,
            warmup: { 
                exercises: hydrateList(sessionJSON.warmup?.exercises) 
            },
            mainBlocks: mainBlocksSafe,
            cooldown: { 
                exercises: hydrateList(sessionJSON.cooldown?.exercises) 
            },
            meta: {
                date: todayDate.toISOString(),
                week: currentWeekNum,
                focus: targetSession.sessionFocus,
                generatedAt: new Date().toISOString()
            },
            completed: false
        };

        // 7. GUARDAR Y RESPONDER
        await userDocRef.update({
            currentSession: finalSessionData
        });

        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("FATAL ERROR en /session/generate:", error);
        return res.status(500).json({ 
            error: error.message,
            details: "Hubo un error generando la sesión. Por favor intenta de nuevo."
        });
    }
}