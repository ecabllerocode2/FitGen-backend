import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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

const normalizeText = (text) => {
    if (!text) return "";
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

const createOptimizedContext = (exercises) => {
    if (!exercises || exercises.length === 0) return "LISTA VACÍA - INVENTA EJERCICIOS";
    return exercises.map(ex => 
        `[${ex.id}] ${ex.nombre || 'Ejercicio'} (${ex.musculoObjetivo || 'General'})`
    ).join('\n');
};

const getMuscleGroupFromFocus = (focusString) => {
    if (!focusString) return [];
    const f = normalizeText(focusString);
    if (f.includes('pierna') || f.includes('cuadriceps') || f.includes('femoral') || f.includes('gluteo')) return ['piernas', 'gluteos', 'cadera', 'cuadriceps', 'femoral', 'isquios'];
    if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro') || f.includes('triceps')) return ['pecho', 'hombros', 'triceps', 'deltoides'];
    if (f.includes('traccion') || f.includes('espalda') || f.includes('biceps')) return ['espalda', 'biceps', 'dorsal', 'trapecio'];
    if (f.includes('full') || f.includes('hibrido') || f.includes('cuerpo')) return ['piernas', 'pecho', 'espalda', 'hombros', 'full body', 'triceps', 'biceps'];
    return []; 
};

// --- RUTINA DE EMERGENCIA ---
const getEmergencySession = (focus) => ({
    sessionGoal: `Rutina de Respaldo: ${focus}`,
    estimatedDurationMin: 45,
    warmup: {
        exercises: [
            { id: "custom", name: "Jumping Jacks", instructions: "2 mins activacion", durationOrReps: "2 mins" },
            { id: "custom", name: "Movilidad Articular", instructions: "Rotaciones suaves", durationOrReps: "2 mins" }
        ]
    },
    mainBlocks: [
        {
            blockType: "station",
            restBetweenSetsSec: 60,
            restBetweenExercisesSec: 90,
            exercises: [
                { id: "custom", name: `Press o Movimiento Principal (${focus})`, sets: 4, targetReps: "10-12", rpe: 8, notes: "Controla la técnica." },
                { id: "custom", name: `Accesorio 1 (${focus})`, sets: 3, targetReps: "12-15", rpe: 7, notes: "Enfoque muscular." },
                { id: "custom", name: `Accesorio 2 (${focus})`, sets: 3, targetReps: "15", rpe: 7, notes: "Bombeo." }
            ]
        }
    ],
    cooldown: {
        exercises: [{ id: "custom", name: "Estiramiento General", duration: "5 min" }]
    }
});

// ----------------------------------------------------
// HANDLER PRINCIPAL
// ----------------------------------------------------
export default async function handler(req, res) {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

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

    console.log(`>>> INICIANDO GENERACIÓN SESIÓN: ${userId}`);

    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') return res.status(400).json({ error: 'No hay mesociclo activo.' });

        const todayDate = req.body.date ? parseISO(req.body.date) : new Date();
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada.` });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) return res.status(200).json({ isRestDay: true, message: `Descanso: ${dayName}` });

        console.log(`Foco Sesión: ${targetSession.sessionFocus}`);

        // --- 3. CONTEXTO ---
        let exerciseCollectionName = 'exercises_home_limited';
        const equipment = profileData.availableEquipment || [];
        const eqString = JSON.stringify(equipment).toLowerCase();
        if (eqString.includes('gimnasio completo')) exerciseCollectionName = 'exercises_gym_full';
        else if (eqString.includes('bodyweight') || eqString.includes('sin equipo')) exerciseCollectionName = 'exercises_bodyweight_pure';

        const [utilitySnap, mainSnap] = await Promise.all([
            db.collection('exercises_utility').get(),
            db.collection(exerciseCollectionName).get()
        ]);

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
            const parteCuerpoNorm = normalizeText(d.parteCuerpo || "");
            const musculoObjetivoNorm = normalizeText(d.musculoObjetivo || "");
            
            const matchesFocus = muscleGroups.length === 0 
                || muscleGroups.some(mg => parteCuerpoNorm.includes(mg))
                || muscleGroups.some(mg => musculoObjetivoNorm.includes(mg));
            
            let levelOk = true;
            if (profileData.experienceLevel === 'Principiante' && d.nivel === 'Avanzado') levelOk = false;

            if (matchesFocus && levelOk) candidateExercises.push(d);
        });

        let finalContextList = shuffleArray([...candidateExercises]);
        finalContextList = finalContextList.slice(0, 40); 
        const contextCSV = createOptimizedContext(finalContextList);
        
        console.log(`Contexto enviado (${finalContextList.length} items)`);

        // --- 4. LLAMADA IA (PROMPT CON EJEMPLO JSON) ---
        // CAMBIO: Le damos el JSON masticado para que no invente estructuras raras.
        const systemPrompt = `Eres un entrenador experto.
        TU OBJETIVO: Generar una sesión JSON estrictamente con la estructura de abajo.

        ESTRUCTURA JSON OBLIGATORIA (Copia esto):
        {
            "sessionGoal": "Objetivo aquí",
            "estimatedDurationMin": 60,
            "warmup": { 
                "exercises": [
                    { "id": "...", "name": "...", "instructions": "...", "durationOrReps": "..." }
                ] 
            },
            "mainBlocks": [
                {
                    "blockType": "station", 
                    "restBetweenSetsSec": 60,
                    "restBetweenExercisesSec": 90,
                    "exercises": [
                        { "id": "...", "name": "...", "sets": 3, "targetReps": "...", "rpe": 8, "notes": "..." }
                    ]
                }
            ],
            "cooldown": { 
                "exercises": [
                    { "id": "...", "name": "...", "duration": "..." }
                ] 
            }
        }

        REGLAS:
        1. Usa los IDs de la lista provista ("Contexto").
        2. Si no encuentras ejercicio, usa "id": "custom" y pon el nombre.
        3. NO inventes claves nuevas como "session" o "goal". Usa "sessionGoal" y "mainBlocks".`;

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
                    { role: "user", content: `Foco: ${targetSession.sessionFocus}\nContexto:\n${contextCSV}\n\nGenera el JSON:` }
                ],
                response_format: { type: "json_object" }
            })
        });

        const llmResult = await completion.json();
        
        if (llmResult.choices && llmResult.choices[0]) {
             console.log(">>> RESPUESTA IA (Snippet):", llmResult.choices[0].message.content.substring(0, 150)); 
        }

        let sessionJSON;
        try {
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch (e) {
            console.error("Error JSON IA:", e);
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // --- 5. VALIDACIÓN ---
        let isEmpty = false;
        // Buscamos las claves correctas: warmup, mainBlocks
        if (!sessionJSON.mainBlocks || !Array.isArray(sessionJSON.mainBlocks)) {
            console.warn("Falta mainBlocks en JSON IA");
            isEmpty = true;
        } else if (sessionJSON.mainBlocks.length === 0 || !sessionJSON.mainBlocks[0].exercises) {
             console.warn("mainBlocks vacío o sin ejercicios");
             isEmpty = true;
        }

        if (isEmpty) {
            console.warn("⚠️ ALERT: Estructura inválida. Usando Respaldo.");
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

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
            sessionGoal: sessionJSON.sessionGoal || `Entrenamiento ${targetSession.sessionFocus}`,
            estimatedDurationMin: sessionJSON.estimatedDurationMin || 45,
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
        console.log(">>> SESIÓN FINAL GUARDADA (Origen: " + (isEmpty ? "Respaldo" : "IA") + ")");
        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("FATAL:", error);
        return res.status(500).json({ error: error.message });
    }
}