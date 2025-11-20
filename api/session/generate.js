import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, subHours } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ----------------------------------------------------
// 1. HELPERS DE UTILIDAD
// ----------------------------------------------------

const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

const normalizeText = (text) => {
    if (!text) return "";
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

const safeMap = (collection, callback) => {
    if (!Array.isArray(collection)) return [];
    return collection.map(callback);
};

// ----------------------------------------------------
// 2. LÓGICA DE FILTRADO Y CONTEXTO (NUEVO CORE)
// ----------------------------------------------------

// Filtro estricto: Si el ejercicio pide 'Barra' y el usuario no tiene 'Barra', se descarta.
const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    // Normalizamos la lista de equipo del usuario para comparaciones rápidas
    const userEqSet = new Set(userEquipmentList.map(e => normalizeText(e)));
    const hasFullGym = userEqSet.has("gimnasio completo") || userEqSet.has("gym") || userEqSet.has("comercial");

    return exercises.filter(ex => {
        const exEq = normalizeText(ex.equipment || ex.equipo || "sin equipo");
        
        // 1. Si es peso corporal o sin equipo, siempre pasa
        if (exEq.includes("sin equipo") || exEq.includes("bodyweight") || exEq.includes("corporal")) return true;
        
        // 2. Si tiene gimnasio completo, pasa todo
        if (hasFullGym) return true;

        // 3. Reglas de exclusión (Si el ejercicio requiere X y el usuario NO lo tiene)
        if (exEq.includes("barra") && !userEqSet.has("barra de peso") && !userEqSet.has("barra")) return false;
        if (exEq.includes("mancuerna") && !Array.from(userEqSet).some(e => e.includes("mancuerna") || e.includes("dumbbell"))) return false;
        if (exEq.includes("kettlebell") && !Array.from(userEqSet).some(e => e.includes("kettlebell") || e.includes("pesa rusa"))) return false;
        if (exEq.includes("banda") && !Array.from(userEqSet).some(e => e.includes("banda") || e.includes("elastic"))) return false;
        if ((exEq.includes("polea") || exEq.includes("cable")) && !userEqSet.has("poleas")) return false;
        if (exEq.includes("maquina") && !userEqSet.has("maquinas")) return false;

        // Si pasó los filtros negativos, lo asumimos válido o "general"
        return true;
    });
};

// Formatea la lista para el Prompt del LLM
const formatListForPrompt = (list, label) => {
    if (!list || list.length === 0) return `[${label}]: NO HAY OPCIONES DISPONIBLES (Usa Calistenia básica)`;
    return `--- OPCIONES PARA ${label} (Elegir de aquí) ---\n` + 
    list.map(ex => `ID: "${ex.id}" | Nombre: ${ex.nombre || ex.name} | Equipo: ${ex.equipment || ex.equipo || 'General'} | Objetivo: ${ex.musculoObjetivo || ex.muscleTarget}`).join('\n');
};

// Determina qué grupos musculares buscar según el foco del día
const getMuscleGroupFromFocus = (focusString) => {
    if (!focusString) return [];
    const f = normalizeText(focusString);
    if (f.includes('pierna') || f.includes('cuadriceps') || f.includes('femoral') || f.includes('gluteo') || f.includes('inferior')) 
        return ['piernas', 'gluteos', 'cadera', 'cuadriceps', 'femoral', 'isquios', 'gemelos', 'pierna'];
    if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro') || f.includes('triceps') || f.includes('pectoral')) 
        return ['pecho', 'hombros', 'triceps', 'deltoides', 'pectoral', 'push'];
    if (f.includes('traccion') || f.includes('espalda') || f.includes('biceps') || f.includes('dorsal')) 
        return ['espalda', 'biceps', 'dorsal', 'trapecio', 'lumbares', 'pull'];
    if (f.includes('full') || f.includes('hibrido') || f.includes('cuerpo')) 
        return ['full', 'global', 'completo']; // Se usará lógica especial para full body
    return []; 
};

// Sesión de emergencia (Fallback)
const getEmergencySession = (focus) => ({
    sessionGoal: `Sesión Básica (Fallback): ${focus}`,
    estimatedDurationMin: 45,
    warmup: {
        exercises: [
            { id: "custom", name: "Jumping Jacks", instructions: "Activar ritmo cardiaco", durationOrReps: "60 seg" },
            { id: "custom", name: "Movilidad de Hombros y Cadera", instructions: "Rotaciones suaves", durationOrReps: "60 seg" }
        ]
    },
    mainBlocks: [
        {
            blockType: "station",
            restBetweenSetsSec: 60,
            restBetweenExercisesSec: 90,
            exercises: [
                { id: "custom", name: "Sentadillas (Air Squats)", sets: 4, targetReps: "15", rpe: 7, notes: "Controla la bajada." },
                { id: "custom", name: "Flexiones (Push Ups)", sets: 4, targetReps: "10-12", rpe: 8, notes: "Rodillas al suelo si es necesario." },
                { id: "custom", name: "Plancha Abdominal", sets: 3, targetReps: "45s", rpe: 8, notes: "Mantén la espalda recta." }
            ]
        }
    ],
    cooldown: {
        exercises: [{ id: "custom", name: "Estiramiento General", duration: "5 min" }]
    }
});

// ----------------------------------------------------
// 3. HANDLER PRINCIPAL
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

    console.log(`>>> [${new Date().toISOString()}] GENERANDO SESIÓN PARA: ${userId}`);

    try {
        // A. CARGA DE USUARIO
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') return res.status(400).json({ error: 'No hay mesociclo activo.' });

        // B. DETERMINAR FECHA Y DÍA
        let todayDate;
        if (req.body.date) {
            todayDate = parseISO(req.body.date); 
        } else {
            todayDate = subHours(new Date(), 6); // Ajuste manual zona horaria (Legacy)
        }
        
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada en el plan.` });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) {
            return res.status(200).json({ isRestDay: true, message: `Hoy es ${dayName}, día de descanso.` });
        }

        console.log(`Foco: ${targetSession.sessionFocus} | Equipo: ${profileData.availableEquipment.length} items`);

        // C. PREPARACIÓN DE DATOS (DB)
        // Lógica para elegir colecciones
        const userEqString = JSON.stringify(profileData.availableEquipment).toLowerCase();
        let mainCollectionName = 'exercises_home_limited'; // Default
        
        if (userEqString.includes('gimnasio completo') || userEqString.includes('gym')) {
            mainCollectionName = 'exercises_gym_full';
        } else if (userEqString.includes('sin equipo') || userEqString.includes('bodyweight')) {
            mainCollectionName = 'exercises_bodyweight_pure';
        }

        // Leemos Utilidad (Calentamiento) y Principal en paralelo
        const [utilitySnap, mainSnap] = await Promise.all([
            db.collection('exercises_utility').get(),
            db.collection(mainCollectionName).get()
        ]);

        // Mapeo inicial
        const processDoc = (doc) => ({ id: doc.id, ...doc.data() });
        let rawMainExercises = [];
        let rawUtilityExercises = [];
        
        // Mapas para "Hidratación" posterior rápida
        const exercisesById = {};
        const exercisesByName = {};

        const indexExercise = (d) => {
            exercisesById[d.id] = d;
            if (d.nombre) exercisesByName[normalizeText(d.nombre)] = d;
            if (d.name) exercisesByName[normalizeText(d.name)] = d;
        };

        mainSnap.forEach(doc => { const d = processDoc(doc); rawMainExercises.push(d); indexExercise(d); });
        utilitySnap.forEach(doc => { const d = processDoc(doc); rawUtilityExercises.push(d); indexExercise(d); });

        // D. FILTRADO ESTRICTO DE EQUIPO (¡CRÍTICO!)
        // Eliminamos ejercicios que piden equipo que el usuario NO tiene
        const validMain = filterExercisesByEquipment(rawMainExercises, profileData.availableEquipment);
        const validUtility = filterExercisesByEquipment(rawUtilityExercises, profileData.availableEquipment);

        // E. SEGMENTACIÓN DE CONTEXTO
        const targetMuscles = getMuscleGroupFromFocus(targetSession.sessionFocus);
        const isFullBody = targetMuscles.includes('full') || targetMuscles.length === 0;

        // 1. Candidatos Principal (Main)
        let mainCandidates = validMain.filter(ex => {
            const target = normalizeText(ex.musculoObjetivo || ex.muscleTarget || "");
            const bodyPart = normalizeText(ex.parteCuerpo || ex.bodyPart || "");
            if (isFullBody) return true; 
            return targetMuscles.some(m => target.includes(m) || bodyPart.includes(m));
        });

        // Si nos quedamos sin ejercicios tras el filtro estricto, rellenamos con bodyweight puro como fallback
        if (mainCandidates.length < 5) {
            console.log("⚠️ Alerta: Pocos ejercicios principales. Añadiendo bodyweight de respaldo.");
            const bodyweightBackup = validMain.filter(ex => normalizeText(ex.equipo || "").includes("sin equipo"));
            mainCandidates = [...mainCandidates, ...bodyweightBackup];
        }
        
        // Mezclar y cortar (Max 30 para no saturar tokens)
        mainCandidates = shuffleArray(mainCandidates).slice(0, 30);

        // 2. Candidatos Calentamiento (Utility)
        const warmupCandidates = validUtility
            .filter(ex => {
                const t = normalizeText(ex.tipo || ex.type || "");
                return t.includes('cardio') || t.includes('movilidad') || t.includes('warm') || t.includes('activacion');
            })
            .slice(0, 8);

        // 3. Candidatos Enfriamiento (Utility)
        const cooldownCandidates = validUtility
            .filter(ex => {
                const t = normalizeText(ex.tipo || ex.type || "");
                return t.includes('stret') || t.includes('yoga') || t.includes('cool');
            })
            .slice(0, 8);

        // F. CONSTRUCCIÓN DEL PROMPT
        // Creamos un "menú" segmentado para que la IA no se confunda
        const contextString = `
        ${formatListForPrompt(warmupCandidates, "CALENTAMIENTO")}
        
        ${formatListForPrompt(mainCandidates, "BLOQUE PRINCIPAL (Foco: " + targetSession.sessionFocus + ")")}
        
        ${formatListForPrompt(cooldownCandidates, "ENFRIAMIENTO")}
        `;

        const systemPrompt = `
        Actúa como un entrenador personal experto y riguroso.
        Tu tarea es construir una sesión de entrenamiento JSON COHERENTE de 60 minutos.

        REGLAS ESTRICTAS DE SELECCIÓN:
        1. Usa SOLO los ejercicios listados en el contexto. NO INVENTES EJERCICIOS.
        2. Usa el ID exacto provisto en el contexto.
        3. Respeta el equipo disponible (implícito en la lista provista).

        REGLAS DE ESTRUCTURA OBLIGATORIAS:
        1. **Calentamiento**: Elige EXACTAMENTE 2 o 3 ejercicios de la lista 'CALENTAMIENTO'.
        2. **Bloque Principal**: Elige ENTRE 4 y 6 ejercicios de la lista 'BLOQUE PRINCIPAL'.
           - Ordena: Ejercicios compuestos/difíciles primero -> Aislamiento después.
           - Asegura un volumen suficiente (3-4 series por ejercicio).
        3. **Enfriamiento**: Elige 1 o 2 ejercicios de 'ENFRIAMIENTO'.

        Output JSON format:
        {
            "sessionGoal": "Resumen breve del objetivo de hoy",
            "estimatedDurationMin": 60,
            "warmup": { "exercises": [{ "id": "ID_EXACTO", "name": "Nombre", "instructions": "Instrucción breve", "durationOrReps": "2 min" }] },
            "mainBlocks": [
                {
                    "blockType": "station", 
                    "restBetweenSetsSec": 60,
                    "restBetweenExercisesSec": 90,
                    "exercises": [
                        { "id": "ID_EXACTO", "name": "Nombre", "sets": 4, "targetReps": "10-12", "rpe": 8, "notes": "Tip técnico breve" }
                    ]
                }
            ],
            "cooldown": { "exercises": [{ "id": "ID_EXACTO", "name": "Nombre", "duration": "30s" }] }
        }
        `;

        // G. LLAMADA AL LLM
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
                    { role: "user", content: `Contexto disponible:\n${contextString}\n\nGenera la rutina JSON ahora:` }
                ],
                response_format: { type: "json_object" }
            })
        });

        const llmResult = await completion.json();
        let sessionJSON;
        
        try {
            if (!llmResult.choices || !llmResult.choices[0]) throw new Error("Respuesta vacía del LLM");
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch (e) {
            console.error("Error parseando JSON IA:", e);
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // Validación básica de sanidad
        if (!sessionJSON.mainBlocks || sessionJSON.mainBlocks.length === 0 || !sessionJSON.mainBlocks[0].exercises) {
            console.error("JSON incompleto, usando fallback.");
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // H. HIDRATACIÓN (Recuperación de datos completos)
        const hydrateList = (list) => safeMap(list, (item) => {
            // 1. Intentar buscar por ID
            let dbData = exercisesById[item.id];

            // 2. Si falla ID (alucinación), intentar buscar por Nombre
            if (!dbData && item.name) {
                const normalizedName = normalizeText(item.name);
                // Búsqueda difusa simple
                const matchName = Object.keys(exercisesByName).find(k => k.includes(normalizedName) || normalizedName.includes(k));
                if (matchName) dbData = exercisesByName[matchName];
            }

            return {
                ...item,
                id: dbData ? dbData.id : "custom", // Si no se encuentra, marcar como custom
                name: dbData?.nombre || dbData?.name || item.name || "Ejercicio",
                description: dbData?.descripcion || dbData?.description || item.instructions || "Ejecución controlada.",
                imageUrl: dbData?.url || dbData?.imageUrl || null,
                muscleTarget: dbData?.musculoObjetivo || targetSession.sessionFocus,
                equipment: dbData?.equipo || dbData?.equipment || "General"
            };
        });

        const mainBlocksSafe = safeMap(sessionJSON.mainBlocks, (block) => ({
            ...block,
            exercises: hydrateList(block.exercises)
        }));

        const finalSessionData = {
            sessionGoal: sessionJSON.sessionGoal || `Entrenamiento ${targetSession.sessionFocus}`,
            estimatedDurationMin: 60, // Forzamos valor lógico
            warmup: { exercises: hydrateList(sessionJSON.warmup?.exercises) },
            mainBlocks: mainBlocksSafe,
            cooldown: { exercises: hydrateList(sessionJSON.cooldown?.exercises) },
            meta: {
                date: todayDate.toISOString(),
                week: currentWeekNum,
                focus: targetSession.sessionFocus,
                generatedAt: new Date().toISOString(),
                model: "gpt-4o-mini-optimized"
            },
            completed: false
        };

        // I. GUARDADO
        await userDocRef.update({ currentSession: finalSessionData });
        console.log(">>> SESIÓN FINAL GUARDADA EXITOSAMENTE");
        
        return res.status(200).json({ success: true, session: finalSessionData });

    } catch (error) {
        console.error("FATAL ERROR:", error);
        return res.status(500).json({ error: error.message });
    }
}