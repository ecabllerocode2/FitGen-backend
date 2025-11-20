import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ==========================================
// 1. SCHEMA DE SALIDA (ACTUALIZADO)
// ==========================================
// CORRECCIÓN: Añadimos el campo "name" obligatorio para que el LLM
// siempre nos diga qué ejercicio es, incluso si no está en nuestra DB.
const SESSION_SCHEMA = {
    type: "OBJECT",
    properties: {
        sessionGoal: { type: "STRING", description: "Objetivo técnico de la sesión." },
        estimatedDurationMin: { type: "INTEGER", description: "Duración en minutos." },
        warmup: {
            type: "OBJECT",
            properties: {
                exercises: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "STRING", description: "ID del contexto o 'custom'." },
                            name: { type: "STRING", description: "Nombre del ejercicio." }, // <--- NUEVO
                            instructions: { type: "STRING", description: "Cómo hacerlo." },
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
                                name: { type: "STRING" }, // <--- NUEVO
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
                            name: { type: "STRING" }, // <--- NUEVO
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

// ==========================================
// 2. HELPERS
// ==========================================

const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

// Helper para evitar crash con arrays undefined
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

// ==========================================
// 3. HANDLER PRINCIPAL
// ==========================================
export default async function handler(req, res) {
    setCORSHeaders(res);

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    // --- AUTENTICACIÓN ---
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
        // --- OBTENER DATOS USUARIO ---
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') {
            return res.status(400).json({ error: 'No hay un mesociclo activo.' });
        }

        // --- LÓGICA DE FECHAS ---
        const todayDate = req.body.date ? parseISO(req.body.date) : new Date();
        const startDate = parseISO(currentMesocycle.startDate);
        
        if (!isValid(todayDate) || !isValid(startDate)) {
             return res.status(400).json({ error: 'Fechas inválidas.' });
        }

        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada.` });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => 
            s.dayOfWeek.toLowerCase() === dayName.toLowerCase()
        );

        if (!targetSession) {
            return res.status(200).json({ isRestDay: true, message: `Día de descanso: ${dayName}` });
        }

        // --- PREPARAR CONTEXTO ---
        let exerciseCollectionName = 'exercises_home_limited';
        const equipment = profileData.availableEquipment || [];
        
        if (equipment.includes('Gimnasio completo')) {
            exerciseCollectionName = 'exercises_gym_full';
        } else if (equipment.some(e => typeof e === 'string' && (e.toLowerCase().includes('bodyweight') || e.toLowerCase().includes('sin equipo')))) {
            exerciseCollectionName = 'exercises_bodyweight_pure';
        }

        const muscleGroups = getMuscleGroupFromFocus(targetSession.sessionFocus);

        // Leemos utilidades y la colección principal
        const [utilitySnap, mainSnap] = await Promise.all([
            db.collection('exercises_utility').get(),
            db.collection(exerciseCollectionName).get()
        ]);

        let candidateExercises = [];
        const exerciseMap = {};

        const indexExercise = (doc) => {
            const d = doc.data();
            d.id = doc.id;
            exerciseMap[doc.id] = d;
            return d;
        };

        // Indexamos todo para búsqueda rápida
        utilitySnap.forEach(doc => candidateExercises.push(indexExercise(doc)));
        
        mainSnap.forEach(doc => {
            const d = indexExercise(doc);
            // Filtrado blando
            const matchesFocus = muscleGroups.length === 0 
                || muscleGroups.includes(d.parteCuerpo) 
                || (d.musculoObjetivo && muscleGroups.some(g => d.musculoObjetivo.includes(g)));
            
            let levelOk = true;
            if (profileData.experienceLevel === 'Principiante' && d.nivel === 'Avanzado') levelOk = false;

            if (matchesFocus && levelOk) candidateExercises.push(d);
        });
        
        // Fallback de seguridad si el filtro dejó vacío el array
        if (candidateExercises.length < 5) {
             mainSnap.forEach(doc => {
                 if (candidateExercises.length < 30) candidateExercises.push(indexExercise(doc));
             });
        }
        
        const finalContext = candidateExercises.slice(0, 45); 
        const contextCSV = createOptimizedContext(finalContext);

        // --- LLAMADA AL LLM (PROMPT CORREGIDO) ---
        const systemPrompt = `Eres un entrenador experto. Genera una sesión JSON completa.
        
        DATOS:
        - Nivel: ${profileData.experienceLevel}.
        - Foco: ${targetSession.sessionFocus}.
        - RPE Semanal: ${targetMicrocycle.intensityRpe}.
        - Notas: ${targetMicrocycle.notes}.
        
        REGLAS CRÍTICAS (Anti-Empty Response):
        1. Prioridad 1: Usa ejercicios del contexto (CSV) usando su ID real.
        2. Prioridad 2: Si NO encuentras un ejercicio adecuado en el contexto, INVENTALO.
           - Usa "id": "custom"
           - Usa "name": "Nombre descriptivo del ejercicio"
        3. NO devuelvas arrays vacíos en mainBlocks. Genera al menos 3 ejercicios por bloque.
        4. Siempre rellena el campo "name".`;

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
                    { role: "user", content: `Contexto:\n${contextCSV}\n\nGenera JSON:` }
                ],
                response_format: { type: "json_object" },
                schema: SESSION_SCHEMA
            })
        });

        const llmResult = await completion.json();
        
        if (!llmResult.choices || !llmResult.choices[0]) {
             throw new Error("Respuesta vacía de OpenRouter.");
        }

        let sessionJSON;
        try {
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch (e) {
            console.error("JSON inválido:", llmResult.choices[0].message.content);
            throw new Error("Error parseando respuesta de IA.");
        }

        // --- HIDRATACIÓN DATOS (DB + LLM FALLBACK) ---
        const hydrateList = (list) => safeMap(list, (item) => {
            // 1. Intentamos buscar en DB
            const dbData = exerciseMap[item.id];
            
            // 2. Construimos el objeto final mezclando datos
            // Si dbData existe, tiene prioridad. Si no, usamos lo que inventó el LLM.
            return {
                ...item,
                id: dbData ? item.id : "custom", // ID real o 'custom'
                
                name: dbData?.nombre || item.name || "Ejercicio Generado",
                
                description: dbData?.descripcion || item.instructions || item.notes || "Realizar con técnica controlada.",
                
                imageUrl: dbData?.url || null, // Solo ejercicios de DB tienen imagen por ahora
                videoUrl: "",
                
                muscleTarget: dbData?.musculoObjetivo || targetSession.sessionFocus,
                equipment: dbData?.equipo || "General"
            };
        });

        // Procesar Bloques
        const mainBlocksSafe = safeMap(sessionJSON.mainBlocks, (block) => ({
            ...block,
            exercises: hydrateList(block.exercises)
        }));

        const finalSessionData = {
            sessionGoal: sessionJSON.sessionGoal || `Entrenamiento: ${targetSession.sessionFocus}`,
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

        // --- GUARDAR EN FIRESTORE ---
        await userDocRef.update({
            currentSession: finalSessionData
        });

        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("ERROR CRÍTICO en generador:", error);
        return res.status(500).json({ 
            error: error.message,
            details: "Error interno generando la sesión."
        });
    }
}