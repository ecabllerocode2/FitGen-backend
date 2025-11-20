import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid, subHours } from 'date-fns';
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

// Contexto optimizado para que la IA entienda mejor
const createOptimizedContext = (exercises) => {
    if (!exercises || exercises.length === 0) return "LISTA VACÍA - INVENTA EJERCICIOS";
    return exercises.map(ex => 
        `[ID: ${ex.id}] ${ex.nombre} (${ex.musculoObjetivo || ex.parteCuerpo}) - Nivel: ${ex.nivel || 'General'}`
    ).join('\n');
};

// Lógica de palabras clave
const getMuscleGroupFromFocus = (focusString) => {
    if (!focusString) return [];
    const f = normalizeText(focusString);
    if (f.includes('pierna') || f.includes('cuadriceps') || f.includes('femoral') || f.includes('gluteo')) return ['piernas', 'gluteos', 'cadera', 'cuadriceps', 'femoral', 'isquios', 'gemelos'];
    if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro') || f.includes('triceps')) return ['pecho', 'hombros', 'triceps', 'deltoides', 'pectoral'];
    if (f.includes('traccion') || f.includes('espalda') || f.includes('biceps')) return ['espalda', 'biceps', 'dorsal', 'trapecio', 'lumbares'];
    if (f.includes('full') || f.includes('hibrido') || f.includes('cuerpo')) return ['piernas', 'pecho', 'espalda', 'hombros', 'full body', 'triceps', 'biceps'];
    return []; 
};

// Rutina de Respaldo (Por si acaso)
const getEmergencySession = (focus) => ({
    sessionGoal: `Sesión Básica: ${focus}`,
    estimatedDurationMin: 50,
    warmup: {
        exercises: [
            { id: "custom", name: "Jumping Jacks", instructions: "Activar ritmo cardiaco", durationOrReps: "60 seg" },
            { id: "custom", name: "Movilidad Articular", instructions: "Rotaciones suaves", durationOrReps: "60 seg" }
        ]
    },
    mainBlocks: [
        {
            blockType: "station",
            restBetweenSetsSec: 60,
            restBetweenExercisesSec: 90,
            exercises: [
                { id: "custom", name: `Ejercicio Principal (${focus})`, sets: 4, targetReps: "10-12", rpe: 8, notes: "Controla la bajada." },
                { id: "custom", name: "Ejercicio Auxiliar 1", sets: 3, targetReps: "12-15", rpe: 7, notes: "Conexión mente-músculo." },
                { id: "custom", name: "Ejercicio Auxiliar 2", sets: 3, targetReps: "15", rpe: 7, notes: "Bombeo constante." }
            ]
        }
    ],
    cooldown: {
        exercises: [{ id: "custom", name: "Estiramiento Estático", duration: "30 seg por lado" }]
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

        // --- CORRECCIÓN DE FECHA Y ZONA HORARIA ---
        // Si el frontend manda la fecha (ej: "2025-11-20"), usamos esa.
        // Si no, usamos la fecha actual PERO restamos 6 horas para ajustar aprox a LATAM/México si estamos en servidor UTC.
        let todayDate;
        if (req.body.date) {
            // Parseamos la fecha del body asumiendo que viene correcta del cliente
            todayDate = parseISO(req.body.date); 
        } else {
            // Fallback: Usar hora servidor (UTC) menos 6 horas (Aprox México Central)
            todayDate = subHours(new Date(), 6);
        }
        
        const startDate = parseISO(currentMesocycle.startDate);
        
        // Calculamos semanas
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada.` });

        // Obtenemos el día en español
        const dayName = format(todayDate, 'EEEE', { locale: es });
        console.log(`Fecha Procesada: ${todayDate.toISOString()} | Día Detectado: ${dayName}`);

        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) return res.status(200).json({ isRestDay: true, message: `Hoy es ${dayName}, día de descanso.` });

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
        const exerciseMap = {}; // ID -> Data
        const nameMap = {}; // NombreNormalizado -> Data (Para recuperación inteligente)

        const indexExercise = (doc) => {
            const d = doc.data(); d.id = doc.id;
            exerciseMap[doc.id] = d;
            if(d.nombre) nameMap[normalizeText(d.nombre)] = d; // Indexamos por nombre también
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
        finalContextList = finalContextList.slice(0, 45); 
        const contextCSV = createOptimizedContext(finalContextList);
        
        // --- 4. LLAMADA IA (PROMPT CORREGIDO PARA TIEMPOS E IDs) ---
        const systemPrompt = `Eres un entrenador experto.
        OBJETIVO: Generar sesión JSON para "${targetSession.sessionFocus}".

        REGLAS IMPORTANTES:
        1. **COPIA EL ID EXACTO**: En el contexto verás "[ID: xyz] Nombre". Debes usar "id": "xyz" en tu JSON. NO inventes IDs.
        2. **TIEMPOS REALISTAS**:
           - Calentamiento: durationOrReps debe ser "30s", "60s" o "15 reps". NUNCA "5 minutos".
           - Cooldown: duration debe ser "30s" o "45s".
        3. **ESTRUCTURA**: Rellena el siguiente JSON.

        {
            "sessionGoal": "...",
            "estimatedDurationMin": 60,
            "warmup": { "exercises": [{ "id": "...", "name": "...", "instructions": "...", "durationOrReps": "30s" }] },
            "mainBlocks": [{
                "blockType": "station", 
                "restBetweenSetsSec": 60, 
                "restBetweenExercisesSec": 90,
                "exercises": [{ "id": "...", "name": "...", "sets": 3, "targetReps": "10-12", "rpe": 8, "notes": "..." }]
            }],
            "cooldown": { "exercises": [{ "id": "...", "name": "...", "duration": "30s" }] }
        }`;

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
                    { role: "user", content: `Contexto Disponible:\n${contextCSV}\n\nGenera JSON:` }
                ],
                response_format: { type: "json_object" }
            })
        });

        const llmResult = await completion.json();
        let sessionJSON;
        try {
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch (e) {
            console.error("Error JSON IA:", e);
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // Validación básica
        let isEmpty = false;
        if (!sessionJSON.mainBlocks || sessionJSON.mainBlocks.length === 0) isEmpty = true;
        if (isEmpty) sessionJSON = getEmergencySession(targetSession.sessionFocus);

        // --- 5. HIDRATACIÓN INTELIGENTE (RECONEXIÓN) ---
        const hydrateList = (list) => safeMap(list, (item) => {
            let dbData = exerciseMap[item.id];

            // INTENTO DE RECUPERACIÓN:
            // Si el ID es "custom" o no existe, buscamos por NOMBRE en nuestra DB
            if (!dbData && item.name) {
                const normalizedName = normalizeText(item.name);
                // Buscamos si alguna clave del mapa de nombres coincide parcialmente
                const matchName = Object.keys(nameMap).find(k => k.includes(normalizedName) || normalizedName.includes(k));
                if (matchName) {
                    dbData = nameMap[matchName];
                    // console.log(`♻️ RECUPERADO: "${item.name}" mapeado a ID original "${dbData.id}"`);
                }
            }

            return {
                ...item,
                // Si logramos recuperar la data (por ID o por Nombre), usamos el ID real. Si no, custom.
                id: dbData ? dbData.id : "custom",
                name: dbData?.nombre || item.name || "Ejercicio Personalizado",
                description: dbData?.descripcion || item.instructions || item.notes || "Ejecución controlada.",
                imageUrl: dbData?.url || null, // ¡Ahora sí aparecerán las imágenes recuperadas!
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
            estimatedDurationMin: sessionJSON.estimatedDurationMin || 50,
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
        console.log(">>> SESIÓN FINAL GUARDADA");
        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("FATAL:", error);
        return res.status(500).json({ error: error.message });
    }
}