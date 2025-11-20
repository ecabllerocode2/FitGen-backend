import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isAfter, isBefore, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// --- SCHEMA DE SALIDA (LLM) ---
// Definimos la estructura estricta por bloques como solicitaste
const SESSION_SCHEMA = {
    type: "OBJECT",
    properties: {
        sessionGoal: {
            type: "STRING",
            description: "Objetivo técnico de la sesión (ej: 'Enfoque en la fase excéntrica del cuádriceps')."
        },
        estimatedDurationMin: {
            type: "INTEGER",
            description: "Duración estimada total en minutos."
        },
        warmup: {
            type: "OBJECT",
            properties: {
                exercises: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "STRING", description: "ID del ejercicio (de exercises_utility)." },
                            instructions: { type: "STRING", description: "Detalle de ejecución (ej: '2 min suaves')." },
                            durationOrReps: { type: "STRING", description: "ej: '15 reps' o '45 seg'." }
                        },
                        required: ["id", "instructions", "durationOrReps"]
                    }
                }
            },
            required: ["exercises"]
        },
        mainBlocks: {
            type: "ARRAY",
            description: "Bloques de entrenamiento principal.",
            items: {
                type: "OBJECT",
                properties: {
                    blockType: { 
                        type: "STRING", 
                        enum: ["station", "superset", "circuit"],
                        description: "station (series planas), superset (biserie), circuit (circuito)." 
                    },
                    restBetweenSetsSec: { type: "INTEGER", description: "Descanso entre rondas/series." },
                    restBetweenExercisesSec: { type: "INTEGER", description: "Descanso al cambiar de ejercicio (0 en superseries)." },
                    exercises: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                id: { type: "STRING", description: "ID del ejercicio." },
                                sets: { type: "INTEGER", description: "Número de series (ajustado al nivel)." },
                                targetReps: { type: "STRING", description: "Rango o tiempo (ej: '10-12' o '40s')." },
                                rpe: { type: "INTEGER", description: "RPE sugerido (1-10)." },
                                notes: { type: "STRING", description: "Instrucción técnica específica (ej: 'Aguanta 1s arriba')." }
                            },
                            required: ["id", "sets", "targetReps", "rpe"]
                        }
                    }
                },
                required: ["blockType", "exercises", "restBetweenSetsSec"]
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
                            duration: { type: "STRING", description: "ej: '30s por lado'." }
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

// Convierte lista de objetos a CSV simplificado para el prompt
const createOptimizedContext = (exercises) => {
    // ID | NOMBRE | TIPO | MUSCULO_OBJETIVO | NIVEL
    return exercises.map(ex => 
        `${ex.id}|${ex.nombre}|${ex.tipo}|${ex.musculoObjetivo || ex.parteCuerpo}|${ex.nivel || 'General'}`
    ).join('\n');
};

// Mapeo simple para filtrar ejercicios según el foco de la sesión
const getMuscleGroupFromFocus = (focusString) => {
    const f = focusString.toLowerCase();
    if (f.includes('pierna') || f.includes('cuádriceps') || f.includes('femoral')) return ['Piernas', 'Glúteos', 'Cadera'];
    if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro')) return ['Pecho', 'Hombros', 'Tríceps'];
    if (f.includes('tracción') || f.includes('espalda')) return ['Espalda', 'Bíceps'];
    if (f.includes('full body') || f.includes('híbrido')) return ['Piernas', 'Pecho', 'Espalda', 'Hombros', 'Full Body'];
    return []; // Si no matchea, devolvemos vacío para lógica de fallback
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
        // 2. OBTENER DATOS
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') {
            return res.status(400).json({ error: 'No hay un mesociclo activo. Genera uno primero.' });
        }

        // 3. DETERMINAR QUÉ SESIÓN TOCA HOY
        // Usamos la fecha enviada por el FE o la actual
        const todayDate = req.body.date ? parseISO(req.body.date) : new Date();
        const startDate = parseISO(currentMesocycle.startDate);
        
        // Calcular semana actual (0-based index, sumamos 1)
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;
        
        // Buscar el microciclo correspondiente
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        
        if (!targetMicrocycle) {
            return res.status(400).json({ error: 'La fecha está fuera del rango del mesociclo actual.' });
        }

        const dayName = format(todayDate, 'EEEE', { locale: es }); // "lunes", "martes"...
        
        // Buscar la sesión exacta por nombre de día
        const targetSession = targetMicrocycle.sessions.find(s => 
            s.dayOfWeek.toLowerCase() === dayName.toLowerCase()
        );

        if (!targetSession) {
            // Es día de descanso
            return res.status(200).json({ 
                isRestDay: true, 
                message: `Hoy (${dayName}) es día de descanso según tu plan.` 
            });
        }

        // 4. PREPARAR CONTEXTO DE EJERCICIOS
        // Seleccionar colección basada en availableEquipment
        let exerciseCollectionName = 'exercises_home_limited'; // Fallback
        if (profileData.availableEquipment.includes('Gimnasio completo')) {
            exerciseCollectionName = 'exercises_gym_full'; // Asumiendo que existe o se usará home
        } else if (profileData.availableEquipment.some(e => e.toLowerCase().includes('bodyweight') || e.toLowerCase().includes('sin equipo'))) {
            exerciseCollectionName = 'exercises_bodyweight_pure';
        }

        // Lógica de filtrado en memoria (para no quemar lecturas ni tokens)
        const muscleGroups = getMuscleGroupFromFocus(targetSession.sessionFocus);

        // Leer UTILIDADES (Calentamiento/CoolDown) + PRINCIPALES
        const [utilitySnap, mainSnap] = await Promise.all([
            db.collection('exercises_utility').get(),
            db.collection(exerciseCollectionName).get() 
            // Leemos toda la colección principal (asumiendo <500 docs es barato y rápido en Firestore)
            // para poder filtrar bien en JS por 'parteCuerpo' o 'musculoObjetivo'
        ]);

        let candidateExercises = [];
        const exerciseMap = {}; // Para hidratar después

        // Procesar Utility
        utilitySnap.forEach(doc => {
            const d = doc.data(); 
            d.id = doc.id;
            candidateExercises.push(d);
            exerciseMap[doc.id] = d;
        });

        // Procesar y Filtrar Main Exercises
        mainSnap.forEach(doc => {
            const d = doc.data();
            d.id = doc.id;
            
            // Filtro Blando: ¿Coincide la parte del cuerpo con el foco?
            // Si el foco es "Full Body", entran todos.
            const matchesFocus = muscleGroups.length === 0 
                || muscleGroups.includes(d.parteCuerpo) 
                || muscleGroups.some(g => d.musculoObjetivo && d.musculoObjetivo.includes(g));
            
            // Filtro Nivel: No dar ejercicios avanzados a principiantes
            // (Simplificado: Si eres principiante, evitas 'Avanzado')
            let levelOk = true;
            if (profileData.experienceLevel === 'Principiante' && d.nivel === 'Avanzado') levelOk = false;

            if (matchesFocus && levelOk) {
                candidateExercises.push(d);
                exerciseMap[doc.id] = d;
            }
        });
        
        // Seguridad: Si el filtro fue muy agresivo y no hay ejercicios, metemos un fallback
        if (candidateExercises.length < 10) {
             mainSnap.forEach(doc => {
                const d = doc.data(); d.id = doc.id;
                if (!candidateExercises.find(e => e.id === d.id)) {
                    candidateExercises.push(d);
                    exerciseMap[doc.id] = d;
                }
             });
        }
        
        // Recortar contexto para no exceder tokens (max 40 ejercicios)
        // Priorizamos mezclar un poco para variedad
        const finalContext = candidateExercises.slice(0, 40); 
        const contextCSV = createOptimizedContext(finalContext);

        // 5. LLAMADA AL LLM
        const systemPrompt = `Eres un entrenador personal experto. Genera una sesión de entrenamiento detallada basada en bloques.
        
        DATOS CLAVE:
        - Nivel Usuario: ${profileData.experienceLevel}.
        - Foco Sesión: ${targetSession.sessionFocus}.
        - Intensidad Semana (RPE): ${targetMicrocycle.intensityRpe}.
        - Notas Semana: ${targetMicrocycle.notes}.
        
        REGLAS DE ESTRUCTURA:
        1. Calentamiento: Usa ejercicios de 'tipo: Calentamiento' del contexto.
        2. Bloques Principales: Crea entre 2 y 4 bloques.
           - Usa 'station' para fuerza pesada.
           - Usa 'superset' o 'circuit' para densidad/metabólico.
           - Define los descansos explícitamente.
        3. Vuelta a la calma: Usa ejercicios de 'tipo: Estiramiento' del contexto.
        
        REGLA DE ORO: SOLO usa los IDs proporcionados en el contexto. No inventes ejercicios.`;

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
                    { role: "user", content: `Contexto Ejercicios:\n${contextCSV}\n\nGenera el JSON:` }
                ],
                response_format: { type: "json_object" },
                schema: SESSION_SCHEMA
            })
        });

        const llmResult = await completion.json();
        const sessionJSON = JSON.parse(llmResult.choices[0].message.content);

        // 6. HIDRATACIÓN DE DATOS (IDs -> Objetos Completos)
        const hydrateList = (list) => list.map(item => {
            const fullData = exerciseMap[item.id] || {};
            return {
                ...item, // Mantiene sets, reps, notes del LLM
                name: fullData.nombre || "Ejercicio desconocido",
                description: fullData.descripcion || "",
                imageUrl: fullData.url || null, // Campo URL de tus docs
                videoUrl: "", // Placeholder
                muscleTarget: fullData.musculoObjetivo || "",
                equipment: fullData.equipo || ""
            };
        });

        const hydratedBlocks = sessionJSON.mainBlocks.map(block => ({
            ...block,
            exercises: hydrateList(block.exercises)
        }));

        const finalSessionData = {
            ...sessionJSON,
            warmup: { exercises: hydrateList(sessionJSON.warmup.exercises) },
            mainBlocks: hydratedBlocks,
            cooldown: { exercises: hydrateList(sessionJSON.cooldown.exercises) },
            meta: {
                date: todayDate.toISOString(),
                week: currentWeekNum,
                focus: targetSession.sessionFocus,
                generatedAt: new Date().toISOString()
            },
            completed: false
        };

        // 7. GUARDAR EN FIRESTORE
        // Guardamos en currentSession para acceso rápido hoy
        await userDocRef.update({
            currentSession: finalSessionData
        });

        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("Error en generation:", error);
        return res.status(500).json({ error: error.message });
    }
}