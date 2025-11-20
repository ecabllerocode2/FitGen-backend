import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, subHours } from 'date-fns';
import { es } from 'date-fns/locale';
import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ----------------------------------------------------
// 1. HELPERS DE NORMALIZACIÓN Y UTILIDAD
// ----------------------------------------------------

const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

// ESTA FUNCIÓN GARANTIZA QUE NO IMPORTEN MAYÚSCULAS NI ACENTOS
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
// 2. LÓGICA DE FILTRADO EXACTA (V4.0 FINAL)
// ----------------------------------------------------

const detectEnvironment = (equipmentList) => {
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('comercial') || eqString.includes('gym')) return 'gym';
    
    // Verificamos carga externa real para distinguir de bodyweight puro
    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        return i.includes('mancuerna') || i.includes('pesa') || i.includes('barra de peso') || i.includes('disco') || i.includes('kettlebell') || (i.includes('banda') && !i.includes('mini'));
    });

    if (!hasLoad) return 'bodyweight';
    return 'home_equipment';
};

const filterExercisesSmart = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    // Normalizamos equipo del usuario una sola vez para comparar rápido
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises;

    return exercises.filter(ex => {
        // Normalizamos equipo del ejercicio (DB)
        const reqEq = normalizeText(ex.equipment || ex.equipo || "sin equipo");

        // --- 1. REGLA DE ORO: Bodyweight siempre pasa ---
        if (reqEq === "sin equipo" || reqEq === "peso corporal" || reqEq === "propio cuerpo" || reqEq === "suelo" || reqEq === "general" || reqEq === "ninguno") {
            return true; 
        }

        // Si el usuario entrena SOLO con cuerpo, rechazamos cualquier equipo externo
        if (environment === 'bodyweight') return false;

        // --- 2. LÓGICA DE EQUIPO ESPECÍFICO (ESTRICTO) ---

        // Mini Bandas (Diferenciar de bandas largas)
        if (reqEq.includes("mini")) {
            return userKeywords.some(k => k.includes("mini"));
        }

        // Bandas Largas / Tubos / Ligas
        if (reqEq.includes("banda") || reqEq.includes("elastica") || reqEq.includes("liga")) {
            // Debe tener banda Y esa banda NO debe ser "mini"
            return userKeywords.some(k => (k.includes("banda") || k.includes("liga") || k.includes("asa")) && !k.includes("mini"));
        }

        // Foam Roller / Rodillo
        if (reqEq.includes("rodillo") || reqEq.includes("foam")) {
            return userKeywords.some(k => k.includes("rodillo") || k.includes("foam"));
        }

        // Mancuernas
        if (reqEq.includes("mancuerna") || reqEq.includes("dumbbell")) {
            return userKeywords.some(k => k.includes("mancuerna") || k.includes("dumbbell"));
        }

        // Kettlebells (ESTRICTO: No acepta mancuernas)
        if (reqEq.includes("kettlebell") || reqEq.includes("rusa")) {
            return userKeywords.some(k => k.includes("kettlebell") || k.includes("rusa"));
        }

        // Barras
        if (reqEq.includes("barra")) {
            // Barra Dominadas
            if (reqEq.includes("dominada") || reqEq.includes("pull up")) {
                return userKeywords.some(k => k.includes("dominada") || k.includes("pull up") || k.includes("marco"));
            }
            // Barra de Pesas
            return userKeywords.some(k => k.includes("barra de peso") || k.includes("olimpica") || k.includes("z") || k.includes("discos"));
        }

        // Poleas (Estricto: Solo si tiene polea real)
        if (reqEq.includes("polea") || reqEq.includes("cable")) {
             return userKeywords.some(k => k.includes("polea") || k.includes("multiestacion"));
        }

        return false; // Si pide algo que no tenemos, fuera.
    });
};

const formatListForPrompt = (list, label) => {
    if (!list || list.length === 0) return `[${label}]: NO HAY OPCIONES DISPONIBLES (Usa Bodyweight Básico)`;
    return `--- OPCIONES PARA ${label} (Elegir de aquí) ---\n` + 
    list.map(ex => `ID: "${ex.id}" | Nombre: ${ex.nombre || ex.name} | Equipo: ${ex.equipment || ex.equipo || 'Sin equipo'}`).join('\n');
};

const getMuscleGroupFromFocus = (focusString) => {
    if (!focusString) return [];
    const f = normalizeText(focusString);
    if (f.includes('pierna') || f.includes('cuadriceps') || f.includes('femoral') || f.includes('gluteo') || f.includes('inferior')) 
        return ['piernas', 'gluteos', 'cadera', 'cuadriceps', 'femoral', 'isquios', 'gemelos', 'pierna', 'tren inferior'];
    if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro') || f.includes('triceps') || f.includes('pectoral')) 
        return ['pecho', 'hombros', 'triceps', 'deltoides', 'pectoral', 'push', 'empuje'];
    if (f.includes('traccion') || f.includes('espalda') || f.includes('biceps') || f.includes('dorsal')) 
        return ['espalda', 'biceps', 'dorsal', 'trapecio', 'lumbares', 'pull', 'traccion'];
    if (f.includes('full') || f.includes('hibrido') || f.includes('cuerpo') || f.includes('estabilidad')) 
        return ['full', 'global', 'completo', 'core', 'abdominales'];
    return []; 
};

const getEmergencySession = (focus) => ({
    sessionGoal: `Sesión Básica (Fallback): ${focus}`,
    estimatedDurationMin: 45,
    warmup: {
        exercises: [
            { id: "custom", name: "Jumping Jacks", instructions: "Activar ritmo cardiaco", durationOrReps: "60 seg" },
            { id: "custom", name: "Movilidad Articular", instructions: "Rotaciones suaves", durationOrReps: "60 seg" }
        ]
    },
    mainBlocks: [
        {
            blockType: "station",
            exercises: [
                { id: "custom", name: "Sentadillas (Air Squats)", sets: 4, targetReps: "15", rpe: 7, notes: "Controla la bajada." },
                { id: "custom", name: "Flexiones (Push Ups)", sets: 4, targetReps: "10-12", rpe: 8, notes: "Rodillas al suelo si es necesario." },
                { id: "custom", name: "Plancha Abdominal", sets: 3, targetReps: "45s", rpe: 8, notes: "Mantén la espalda recta." }
            ]
        }
    ],
    cooldown: { exercises: [{ id: "custom", name: "Estiramiento General", duration: "5 min" }] }
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

    console.log(`>>> [${new Date().toISOString()}] GENERANDO SESIÓN: ${userId}`);

    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') return res.status(400).json({ error: 'No hay mesociclo activo.' });

        let todayDate = req.body.date ? parseISO(req.body.date) : subHours(new Date(), 6);
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada.` });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) return res.status(200).json({ isRestDay: true, message: `Hoy es ${dayName}, descanso.` });

        console.log(`Focus: ${targetSession.sessionFocus}`);

        // --- SELECCIÓN Y MEZCLA DE COLECCIONES ---
        const environment = detectEnvironment(profileData.availableEquipment);
        
        // Promesas de carga base
        let collectionsToFetch = [db.collection('exercises_utility').get()];
        
        if (environment === 'gym') {
            collectionsToFetch.push(db.collection('exercises_gym_full').get());
        } else if (environment === 'bodyweight') {
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        } else {
            // Environment === 'home_equipment'
            // CARGAMOS AMBAS: Home Limited Y Bodyweight Pure para mezclar
            console.log("Entorno Home: Fusionando colecciones Limited + Bodyweight");
            collectionsToFetch.push(db.collection('exercises_home_limited').get());
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        }

        const results = await Promise.all(collectionsToFetch);
        
        // Utility es siempre el primero (índice 0)
        const utilitySnap = results[0];
        
        // Procesar Principal (Indices restantes)
        let rawMain = [];
        const processDoc = (doc) => ({ id: doc.id, ...doc.data() });
        
        // Mapas para hidratación
        const exercisesById = {};
        const exercisesByName = {};
        const indexEx = (d) => {
            exercisesById[d.id] = d;
            if (d.nombre) exercisesByName[normalizeText(d.nombre)] = d;
            if (d.name) exercisesByName[normalizeText(d.name)] = d;
        };

        // Recorremos results desde el índice 1 en adelante (las colecciones principales)
        for (let i = 1; i < results.length; i++) {
            results[i].forEach(doc => {
                const d = processDoc(doc);
                rawMain.push(d);
                indexEx(d);
            });
        }
        
        let rawUtility = [];
        utilitySnap.forEach(doc => {
            const d = processDoc(doc);
            rawUtility.push(d);
            indexEx(d);
        });

        // --- FILTRADO ESTRICTO ---
        const validMain = filterExercisesSmart(rawMain, profileData.availableEquipment);
        
        // Utility: También pasamos el filtro smart (para validar si tiene rodillo/bandas)
        const validUtility = filterExercisesSmart(rawUtility, profileData.availableEquipment);

        // --- SEGMENTACIÓN POR TIPO Y MUSCULO ---
        const targetMuscles = getMuscleGroupFromFocus(targetSession.sessionFocus);
        const isFullBody = targetMuscles.includes('full') || targetMuscles.length === 0;

        // 1. MAIN: Filtro muscular
        let mainCandidates = validMain.filter(ex => {
            const target = normalizeText(ex.musculoObjetivo || ex.muscleTarget || "");
            const bodyPart = normalizeText(ex.parteCuerpo || ex.bodyPart || "");
            if (isFullBody) return true; 
            return targetMuscles.some(m => target.includes(m) || bodyPart.includes(m));
        });
        
        mainCandidates = shuffleArray(mainCandidates).slice(0, 35);

        // 2. WARMUP: Filtramos por 'tipo' normalizado
        let warmupCandidates = validUtility.filter(ex => {
            const t = normalizeText(ex.tipo || "");
            return t === 'calentamiento';
        }).slice(0, 10);

        // 3. COOLDOWN: Filtramos por 'tipo' normalizado
        let cooldownCandidates = validUtility.filter(ex => {
            const t = normalizeText(ex.tipo || "");
            return t === 'estiramiento';
        }).slice(0, 10);

        // --- GENERACIÓN DE CONTEXTO ---
        const contextString = `
        ${formatListForPrompt(warmupCandidates, "CALENTAMIENTO (WARMUP)")}
        
        ${formatListForPrompt(mainCandidates, "BLOQUE PRINCIPAL (Foco: " + targetSession.sessionFocus + ")")}
        
        ${formatListForPrompt(cooldownCandidates, "ENFRIAMIENTO (COOLDOWN)")}
        `;

        const systemPrompt = `
        Eres un entrenador experto. Crea la sesión JSON usando SOLO el contexto provisto.

        REGLAS ESTRICTAS:
        1. Usa los IDs exactos de la lista. NO inventes ejercicios.
        2. Para Calentamiento usa SOLO la lista 'CALENTAMIENTO'.
        3. Para Enfriamiento usa SOLO la lista 'ENFRIAMIENTO'.
        4. Respeta el equipo indicado en el contexto.

        ESTRUCTURA JSON:
        {
            "sessionGoal": "...",
            "estimatedDurationMin": 60,
            "warmup": { "exercises": [{ "id": "...", "name": "...", "durationOrReps": "..." }] },
            "mainBlocks": [
                {
                    "blockType": "station", 
                    "exercises": [{ "id": "...", "name": "...", "sets": 3, "targetReps": "10-12", "rpe": 8 }]
                }
            ],
            "cooldown": { "exercises": [{ "id": "...", "duration": "..." }] }
        }
        `;

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
                    { role: "user", content: `Contexto:\n${contextString}\n\nGenera JSON:` }
                ],
                response_format: { type: "json_object" }
            })
        });

        const llmResult = await completion.json();
        let sessionJSON;
        try {
            sessionJSON = JSON.parse(llmResult.choices[0].message.content);
        } catch(e) {
            console.error("Error JSON IA:", e);
            sessionJSON = getEmergencySession(targetSession.sessionFocus);
        }

        // HIDRATACIÓN
        const hydrateList = (list) => safeMap(list, (item) => {
            let dbData = exercisesById[item.id];
            if (!dbData && item.name) {
                const matchName = Object.keys(exercisesByName).find(k => k.includes(normalizeText(item.name)));
                if (matchName) dbData = exercisesByName[matchName];
            }
            return {
                ...item,
                id: dbData ? dbData.id : "custom",
                name: dbData?.nombre || item.name || "Ejercicio",
                description: dbData?.descripcion || item.instructions || "Ejecución controlada.",
                imageUrl: dbData?.url || null,
                muscleTarget: dbData?.musculoObjetivo || targetSession.sessionFocus,
                equipment: dbData?.equipo || "General"
            };
        });

        const finalSession = {
            sessionGoal: sessionJSON.sessionGoal || "Entrenamiento",
            estimatedDurationMin: 60,
            warmup: { exercises: hydrateList(sessionJSON.warmup?.exercises) },
            mainBlocks: safeMap(sessionJSON.mainBlocks, b => ({ ...b, exercises: hydrateList(b.exercises) })),
            cooldown: { exercises: hydrateList(sessionJSON.cooldown?.exercises) },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                week: currentWeekNum,
                focus: targetSession.sessionFocus,
                model: "gpt-4o-mini-v4-final"
            },
            completed: false
        };

        await userDocRef.update({ currentSession: finalSession });
        console.log(">>> SESIÓN FINAL OK");
        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("FATAL:", error);
        return res.status(500).json({ error: error.message });
    }
}