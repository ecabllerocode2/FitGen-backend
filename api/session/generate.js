import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, getDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale'; // Para obtener el nombre del día en español
import fetch from 'node-fetch';

// Las claves de entorno se acceden directamente en Vercel
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Definición estricta del JSON de salida para la SESIÓN
const SESSION_SCHEMA = {
    type: "OBJECT",
    properties: {
        sessionGoal: {
            type: "STRING",
            description: "Resumen conciso del objetivo de esta sesión (ej: 'Máxima hipertrofia de cuádriceps y glúteos')."
        },
        warmup: {
            type: "ARRAY",
            description: "Lista de 3 a 5 ejercicios de calentamiento. Solo incluye el ID del ejercicio.",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING", description: "ID corto del ejercicio (ej: e_001)." },
                    sets: { type: "INTEGER", description: "Series (ej: 2)." },
                    repsOrDuration: { type: "STRING", description: "Repeticiones o duración (ej: '15 reps' o '30 segundos')." }
                },
                required: ["id", "sets", "repsOrDuration"]
            }
        },
        workout: {
            type: "ARRAY",
            description: "Lista de ejercicios principales de la sesión. Solo incluye el ID del ejercicio.",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING", description: "ID corto del ejercicio (ej: e_001)." },
                    sets: { type: "INTEGER", description: "Series (ej: 3)." },
                    repsOrRpe: { type: "STRING", description: "Rango de repeticiones y RPE (ej: '8-12 reps @ RPE 7')." },
                    notes: { type: "STRING", description: "Notas de ejecución o descanso específicas para este set." }
                },
                required: ["id", "sets", "repsOrRpe"]
            }
        },
        cooldown: {
            type: "ARRAY",
            description: "Lista de 3 a 5 ejercicios de estiramiento o vuelta a la calma. Solo incluye el ID del ejercicio.",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING", description: "ID corto del ejercicio (ej: e_001)." },
                    duration: { type: "STRING", description: "Duración del estiramiento (ej: '30 segundos por lado')." }
                },
                required: ["id", "duration"]
            }
        }
    },
    required: ["sessionGoal", "warmup", "workout", "cooldown"]
};

// --- HELPER DE CORS ---
const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

/**
 * Mapea el día de la semana (0=Dom, 1=Lun, etc.) a su nombre en español.
 * @param {number} dayIndex - Índice del día de la semana.
 */
const mapDayIndexToSpanish = (dayIndex) => {
    // getDay(new Date()) devuelve 0 para Domingo, 1 para Lunes...
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[dayIndex];
};

/**
 * Crea una cadena optimizada para el prompt del LLM con el catálogo de ejercicios.
 * @param {Array} exercises - Lista de documentos de ejercicios.
 */
const createOptimizedExerciseContext = (exercises) => {
    // // ID_EJERCICIO | NOMBRE_EJERCICIO | MUSCULO_PRIMARIO | TIPO_MOVIMIENTO
    return exercises.map(ex => 
        `${ex.id} | ${ex.nombre} | ${ex.musculoObjetivo || ex.parteCuerpo || 'General'} | ${ex.tipo}`
    ).join('\n');
}

// ----------------------------------------------------
// FUNCIÓN PRINCIPAL DEL ENDPOINT
// ----------------------------------------------------
export default async function handler(req, res) {

    setCORSHeaders(res);

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    if (!OPENROUTER_API_KEY) return res.status(500).json({ error: 'Error de configuración: Clave de OpenRouter no encontrada.' });

    // 1. VALIDACIÓN DE AUTENTICACIÓN
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;
    let userId;

    if (!idToken) return res.status(401).json({ error: 'Falta el token de autenticación (Bearer Token).' });

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        userId = decodedToken.uid;
    } catch (error) {
        console.error('Error de verificación de Token:', error.message);
        return res.status(401).json({ error: 'Token inválido o expirado.', details: error.message });
    }
    
    // Asumimos que el FE puede enviar la fecha, sino usamos la de hoy.
    const requestedDate = req.body.date ? parseISO(req.body.date) : new Date();
    const todayDayOfWeek = format(requestedDate, 'EEEE', { locale: es }); // ej. "miércoles"
    const currentDayIndex = getDay(requestedDate); // 0 (Domingo) - 6 (Sábado)

    console.log(`Iniciando generación de sesión para: ${userId} en ${todayDayOfWeek}`);

    try {
        // 2. OBTENER DATOS DE USUARIO Y PLAN
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) return res.status(404).json({ error: 'Perfil de usuario no encontrado.' });

        const rawData = userDoc.data();
        const profileData = rawData.profileData;
        const mesocycle = rawData.currentMesocycle;
        
        // ** TEMPORAL: OMITIR VALIDACIÓN DE PLAN (Asumimos acceso completo FREE) **
        // const userPlan = rawData.plan; 
        // if (userPlan === 'free' && rawData.freeSessionsUsed >= 2) { ... }

        if (!mesocycle || !mesocycle.mesocyclePlan) {
            return res.status(400).json({ error: 'El usuario no tiene un Mesociclo activo. Debe generar uno primero.' });
        }
        
        // 2.1. ENCONTRAR LA SESIÓN DE HOY
        const plan = mesocycle.mesocyclePlan;
        
        // Lógica simplificada: buscar la sesión que coincide con el día de la semana de HOY.
        // NOTA: Para producción, debe calcularse la semana exacta (currentWeek) y el día exacto (logicalStartDate + daysPassed)
        let sessionBase = null;
        let currentWeekNumber = 1; // Default
        
        for (const microcycle of plan.microcycles) {
            sessionBase = microcycle.sessions.find(s => 
                s.dayOfWeek.toLowerCase() === todayDayOfWeek.toLowerCase()
            );
            if (sessionBase) {
                currentWeekNumber = microcycle.week;
                break;
            }
        }

        if (!sessionBase) {
            return res.status(200).json({ 
                success: true, 
                message: 'No hay entrenamiento programado para hoy.',
                sessionData: null // Devolver null si es día de descanso
            });
        }
        
        // 3. ESTRATEGIA DE SEGMENTACIÓN Y FILTRADO DE EJERCICIOS
        
        const availableEquipmentKey = profileData.availableEquipment.includes('Gimnasio completo') 
            ? 'exercises_gym_full' 
            : profileData.availableEquipment.length > 0 
                ? 'exercises_home_limited' 
                : 'exercises_bodyweight_pure';
                
        // Siempre incluir utilidades para calentamiento/estiramiento
        const exerciseCollectionsToRead = [availableEquipmentKey, 'exercises_utility'];
        const allRelevantExercises = [];
        
        // Mapa para almacenar los datos completos de los ejercicios (para el post-procesamiento)
        const exerciseDataMap = {};

        for (const collectionName of exerciseCollectionsToRead) {
            // Lectura de la colección base
            let query = db.collection(collectionName);
            
            // Filtro por Foco (Query Firestore) - SOLO para la colección principal
            if (collectionName === availableEquipmentKey && sessionBase.sessionFocus) {
                // Buscamos una coincidencia parcial o el músculo principal (lógica simplificada)
                // Usamos una colección para el foco de la sesión:
                // Si el foco es 'Pierna - Cuádriceps', buscamos 'Cuádriceps'.
                const focus = sessionBase.sessionFocus.split('-').pop().trim();
                
                // Si el foco es 'Full Body' o 'Descanso' lo ignoramos en el filtro de Query
                if (focus && focus !== 'Full Body' && focus !== 'Híbrido' && focus !== 'Descanso') {
                    // Nota: Firestore no soporta 'OR' y 'LIKE' fácilmente. Una estrategia común es indexar.
                    // Aquí, asumimos un campo simple para el filtro de Músculo/Parte del cuerpo.
                    query = query.where('musculoObjetivo', '==', focus); // Asumimos 'musculoObjetivo'
                }
            }
            
            const snapshot = await query.get();
            snapshot.forEach(doc => {
                const data = doc.data();
                const exerciseId = doc.id; // Usar el ID del documento
                allRelevantExercises.push({ ...data, id: exerciseId });
                exerciseDataMap[exerciseId] = { ...data, id: exerciseId }; // Guardar para post-procesamiento
            });
        }
        
        // Filtro por Nivel (Backend) y Muestreo Estratégico
        const userLevel = profileData.experienceLevel; // Ej. 'Intermedio'
        const levelPriority = ['Principiante', 'Intermedio', 'Avanzado'];
        const userLevelIndex = levelPriority.indexOf(userLevel);
        
        const filteredExercises = allRelevantExercises.filter(ex => {
            // Incluir siempre los de calentamiento/estiramiento (si tienen 'tipo' utility)
            if (ex.tipo === 'Calentamiento' || ex.tipo === 'Estiramiento') return true;
            
            // Filtrar por nivel: Incluir el nivel del usuario e inferiores
            const exLevelIndex = levelPriority.indexOf(ex.nivel);
            return exLevelIndex !== -1 && exLevelIndex <= userLevelIndex;
        });

        // Limitar la lista a un máximo de 30 ejercicios para el LLM (tokens)
        const contextExercises = filteredExercises.slice(0, 30);
        
        if (contextExercises.length === 0) {
            return res.status(400).json({ error: 'No se encontraron ejercicios adecuados para el perfil y la sesión.' });
        }
        
        const optimizedContext = createOptimizedExerciseContext(contextExercises);

        // 4. CONSTRUCCIÓN DEL PROMPT PARA EL LLM
        const profileString = JSON.stringify(profileData, null, 2);
        const schemaString = JSON.stringify(SESSION_SCHEMA, null, 2);

        const systemPrompt = `Eres un entrenador personal de élite. Tu tarea es generar la rutina de entrenamiento de UN SOLO DÍA, incluyendo una fase de calentamiento y una fase de vuelta a la calma (enfocada en estiramientos). DEBES SEGUIR LAS REGLAS ESTRICTAMENTE.`;

        const userPrompt = `Genera la sesión de entrenamiento para hoy. 
        
        DATOS DE LA SESIÓN:
        - Día del Mesociclo: ${currentWeekNumber}, ${todayDayOfWeek}.
        - Foco del Plan: '${sessionBase.sessionFocus}'.
        - Intensidad general de la semana: '${plan.microcycles.find(m => m.week === currentWeekNumber)?.intensityRpe}'.
        
        REGLAS CRÍTICAS DE GENERACIÓN:
        1. SOLO DEBES usar los IDs de ejercicios listados en el CONTEXTO DE EJERCICIOS DISPONIBLES. NUNCA inventes IDs o nombres.
        2. La rutina principal (workout) debe reflejar el Foco del Plan.
        3. El Calentamiento (warmup) y la Vuelta a la Calma (cooldown) son obligatorios y deben ser relevantes.
        4. Las series y repeticiones/RPE deben ser realistas para el 'experienceLevel' ('${profileData.experienceLevel}') y el objetivo ('${profileData.fitnessGoal}').
        5. El plan DEBE ser realista con el 'availableEquipment' (${profileData.availableEquipment.join(', ')}).
        
        DATOS DEL PERFIL:
        ---
        ${profileString}
        ---
        
        CONTEXTO DE EJERCICIOS DISPONIBLES (SOLO USA ESTOS IDs):
        ---
        ${optimizedContext}
        ---
        
        Genera la respuesta como un **objeto JSON válido** que se ajuste **exactamente** al siguiente esquema:
        ---
        ${schemaString} 
        ---
        
        TU RESPUESTA DEBE SER ÚNICAMENTE EL JSON.`;


        // 5. LLAMADA A OPENROUTER (LLM)
        const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: "json_object" }
            }),
        });

        if (!openRouterResponse.ok) {
            const errorText = await openRouterResponse.text();
            throw new Error(`OpenRouter Error: ${errorText}`);
        }

        const openRouterResult = await openRouterResponse.json();
        const sessionJsonString = openRouterResult.choices[0].message.content;
        
        let sessionData;
        try {
            sessionData = JSON.parse(sessionJsonString);
        } catch (e) {
            console.error('Error parseando JSON del LLM:', sessionJsonString);
            return res.status(500).json({ error: 'El LLM devolvió un JSON inválido.' });
        }
        
        // 6. POST-PROCESAMIENTO: ENSAMBLAR DATOS COMPLETOS
        
        const enrichExerciseList = (list) => {
            return list.map(item => {
                const fullData = exerciseDataMap[item.id] || { nombre: 'Ejercicio No Encontrado', descripcion: 'Datos faltantes.' };
                return {
                    ...item,
                    ...fullData // Añadir el nombre, descripción, URL, etc.
                };
            });
        };
        
        const finalSessionData = {
            metadata: {
                dayOfWeek: todayDayOfWeek,
                sessionFocus: sessionBase.sessionFocus,
                week: currentWeekNumber,
                llmModelUsed: 'openai/gpt-4o-mini',
                generationDate: new Date().toISOString()
            },
            sessionGoal: sessionData.sessionGoal,
            warmup: enrichExerciseList(sessionData.warmup || []),
            workout: enrichExerciseList(sessionData.workout || []),
            cooldown: enrichExerciseList(sessionData.cooldown || [])
        };
        
        // 7. GUARDADO (Opcional, pero recomendado para tracking)
        // Podrías guardar esta sesión en una subcolección users/{userId}/sessions/hoy
        
        return res.status(200).json({
            success: true,
            message: 'Sesión generada exitosamente.',
            sessionData: finalSessionData
        });

    } catch (error) {
        console.error('Error general en generación de sesión:', error);
        return res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
}