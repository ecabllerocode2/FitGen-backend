// Importaciones de Firebase Admin
// Asegúrate de que 'lib/firebaseAdmin.js' inicialice y exporte 'db' (Firestore) y 'auth' (Admin Auth)
import { db, auth } from '../../lib/firebaseAdmin.js'; 

// Las claves de entorno se acceden directamente en Vercel
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Definición estricta del JSON de salida para la planificación
// Esto guía al LLM a generar solo la estructura
const MESOCYCLE_SCHEMA = {
    type: "OBJECT",
    properties: {
        durationWeeks: {
            type: "INTEGER",
            description: "Duración total del mesociclo, generalmente 4 semanas."
        },
        mesocycleGoal: {
            type: "STRING",
            description: "Resumen conciso (máximo 2 frases) del objetivo principal de este ciclo de entrenamiento."
        },
        microcycles: {
            type: "ARRAY",
            description: "Un array donde cada objeto representa una semana (microciclo).",
            items: {
                type: "OBJECT",
                properties: {
                    week: {
                        type: "INTEGER",
                        description: "Número de la semana dentro del mesociclo (ej: 1, 2, 3, 4)."
                    },
                    focus: {
                        type: "STRING",
                        description: "Foco de la semana (ej: Acumulación, Intensificación, Descarga Deload)."
                    },
                    intensityRpe: {
                        type: "STRING",
                        description: "Intensidad percibida (RPE) promedio para la semana (ej: '7/10', '8/10')."
                    },
                    notes: {
                        type: "STRING",
                        description: "Notas importantes sobre la carga o el foco mental para esta semana."
                    },
                    sessions: {
                        type: "ARRAY",
                        description: "Lista de sesiones de entrenamiento programadas para esta semana.",
                        items: {
                            type: "OBJECT",
                            properties: {
                                dayOfWeek: {
                                    type: "STRING",
                                    description: "Día de la semana de la sesión (ej: 'Lunes', 'Martes', 'Sábado'). Debe coincidir con los días preferidos del usuario."
                                },
                                sessionFocus: {
                                    type: "STRING",
                                    description: "Foco principal del entrenamiento (ej: 'Tren Superior - Empuje', 'Pierna - Cuádriceps', 'Full Body Híbrido')."
                                }
                            },
                            required: ["dayOfWeek", "sessionFocus"]
                        }
                    }
                },
                required: ["week", "focus", "intensityRpe", "sessions"]
            }
        }
    },
    required: ["durationWeeks", "mesocycleGoal", "microcycles"]
};


// ----------------------------------------------------
// 1. FUNCIÓN PRINCIPAL DEL ENDPOINT
// ----------------------------------------------------
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    if (!OPENROUTER_API_KEY) {
        console.error('OPENROUTER_API_KEY no definida.');
        return res.status(500).json({ error: 'Error de configuración: Clave de OpenRouter no encontrada.' });
    }

    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;
    let userId;

    // --- Lógica de Autenticación de Firebase Admin (Esencial en el Backend) ---
    if (!idToken) {
        return res.status(401).json({ error: 'Falta el token de autenticación (Bearer Token).' });
    }

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        userId = decodedToken.uid;
    } catch (error) {
        console.error('Error de verificación de Token de Firebase Admin:', error.message);
        return res.status(401).json({ error: 'Token de autenticación inválido o expirado.', details: error.message });
    }
    // -------------------------------------------------------------------
    
    console.log(`Iniciando generación de mesociclo para el usuario: ${userId}`);

    try {
        // 1. OBTENER DATOS DE PERFIL DEL USUARIO
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Perfil de usuario no encontrado. Asegúrate de que el Onboarding haya sido completado.' });
        }

        const rawData = userDoc.data();
        // Usamos profileData, que contiene el objeto que proporcionaste.
        const profileData = rawData.profileData; 

        if (!profileData) {
            return res.status(400).json({ error: 'Datos de Onboarding incompletos o ausentes en el perfil.' });
        }

        // 2. CONSTRUIR EL PROMPT PARA EL LLM
        
        // Convertimos el perfil a string para incluirlo fácilmente en el prompt
        const profileString = JSON.stringify(profileData, null, 2);

        // Mensaje de sistema (Persona del LLM)
        const systemPrompt = `Eres un planificador de entrenamiento deportivo experto en periodización. Tu tarea es generar un plan de entrenamiento (Mesociclo) de 4 semanas, estructurado en microciclos semanales. DEBES SEGUIR LAS REGLAS ESTRICTAMENTE.`;

        // Mensaje del usuario (Contexto + Instrucción)
        const userPrompt = `Basándote en el perfil del usuario a continuación, genera un Mesociclo de 4 semanas. 
        
        REGLAS CRÍTICAS DE GENERACIÓN:
        1. El Mesociclo debe durar 4 semanas. La Semana 4 debe ser una semana de DELOAD (descarga activa o pasiva).
        2. El número total de sesiones debe ser exactamente igual a 'trainingDaysPerWeek' (${profileData.trainingDaysPerWeek} días) y usar solo los 'preferredTrainingDays' (${profileData.preferredTrainingDays.join(', ')}).
        3. El Mesociclo debe priorizar el 'fitnessGoal' ('${profileData.fitnessGoal}') y el 'focusArea' ('${profileData.focusArea}').
        4. El plan de entrenamiento DEBE ser realista con el 'availableEquipment' (${profileData.availableEquipment.join(', ')}).
        5. El Mesociclo debe incluir NOTAS IMPORTANTES sobre la 'intensityRpe' y evitar movimientos que agraven las 'injuriesOrLimitations' ('${profileData.injuriesOrLimitations || "ninguna"}').
        6. NO DEBES incluir NINGÚN EJERCICIO Específico. SÓLO el enfoque de la sesión (sessionFocus), como 'Tren Superior - Empuje' o 'Full Body A'. El endpoint posterior se encargará de seleccionar los ejercicios.
        
        DATOS DEL PERFIL DEL USUARIO:
        ---
        ${profileString}
        ---
        
        Genera la respuesta como un objeto JSON que se ajuste exactamente al siguiente esquema.`;
        
        // 3. LLAMADA A LA API DE OPENROUTER (Generación de JSON)
        
        // Implementación con OpenRouter (Asumimos modelo de bajo costo y buen soporte JSON)
        const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini', // Buen rendimiento y bajo costo para JSON
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                // Forzamos la salida JSON
                response_format: { type: "json_object", schema: MESOCYCLE_SCHEMA } 
            }),
        });

        if (!openRouterResponse.ok) {
            const errorText = await openRouterResponse.text();
            console.error('Error de OpenRouter:', errorText);
            return res.status(502).json({ error: 'Fallo la comunicación con el servicio de IA.', details: errorText });
        }

        const openRouterResult = await openRouterResponse.json();
        
        // 4. PARSEO Y VALIDACIÓN DEL RESULTADO DEL LLM
        const mesocycleJsonString = openRouterResult.choices[0].message.content;
        let mesocycleData;

        try {
            mesocycleData = JSON.parse(mesocycleJsonString);
        } catch (e) {
            console.error('Error al parsear el JSON generado por el LLM:', mesocycleJsonString);
            return res.status(500).json({ error: 'El LLM devolvió un JSON inválido o incompleto.' });
        }

        // 5. GUARDADO DEL MESOCICLO EN FIRESTORE
        
        const planData = {
            mesocycle: mesocycleData,
            status: 'active', // El plan está listo para usarse
            startDate: new Date().toISOString(),
            currentWeek: 1, // Empezamos en la semana 1
            lastSessionCompleted: null,
            llmModelUsed: 'openai/gpt-4o-mini', 
            generationDate: new Date().toISOString()
        };

        // Guardamos la estructura del plan en una subcolección del usuario
        // users/{userId}/plan/mesocycle
        const mesocycleRef = db.collection('users').doc(userId).collection('plan').doc('mesocycle');
        await mesocycleRef.set(planData, { merge: true });

        // 6. RESPUESTA EXITOSA
        return res.status(200).json({
            success: true,
            message: 'Mesociclo generado y guardado exitosamente.',
            plan: planData
        });

    } catch (error) {
        console.error('Error general en la generación del Mesociclo:', error);
        return res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
}