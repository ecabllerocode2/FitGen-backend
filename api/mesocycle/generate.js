import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays } from 'date-fns';

// Las claves de entorno se acceden directamente en Vercel
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Definición estricta del JSON de salida para la planificación
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

// --- HELPER DE CORS ---
const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

// ----------------------------------------------------
// FUNCIÓN PRINCIPAL DEL ENDPOINT
// ----------------------------------------------------
export default async function handler(req, res) {

    setCORSHeaders(res);

    // Manejar OPTIONS (CORS Preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    if (!OPENROUTER_API_KEY) {
        console.error('OPENROUTER_API_KEY no definida.');
        return res.status(500).json({ error: 'Error de configuración: Clave de OpenRouter no encontrada.' });
    }

    // 1. VALIDACIÓN DE AUTENTICACIÓN (Firebase Admin)
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;
    let userId;

    if (!idToken) {
        return res.status(401).json({ error: 'Falta el token de autenticación (Bearer Token).' });
    }

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        userId = decodedToken.uid;
    } catch (error) {
        console.error('Error de verificación de Token:', error.message);
        return res.status(401).json({ error: 'Token inválido o expirado.', details: error.message });
    }

    console.log(`Iniciando generación de mesociclo para: ${userId}`);

    try {
        // 2. OBTENER PERFIL DESDE FIRESTORE
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Perfil de usuario no encontrado.' });
        }

        const rawData = userDoc.data();
        const profileData = rawData.profileData;

        if (!profileData) {
            return res.status(400).json({ error: 'Datos de Onboarding incompletos.' });
        }

        // 3. CONSTRUCCIÓN DEL PROMPT
        const profileString = JSON.stringify(profileData, null, 2);
        const schemaString = JSON.stringify(MESOCYCLE_SCHEMA, null, 2);

        const systemPrompt = `Eres un planificador de entrenamiento deportivo experto en periodización. Tu tarea es generar un plan de entrenamiento (Mesociclo) de 4 semanas, estructurado en microciclos semanales. DEBES SEGUIR LAS REGLAS ESTRICTAMENTE.`;

        const userPrompt = `Basándote en el perfil del usuario a continuación, genera un Mesociclo de 4 semanas. 
        
        REGLAS CRÍTICAS DE GENERACIÓN:
        1. El Mesociclo debe durar 4 semanas. La Semana 4 debe ser una semana de DELOAD (descarga activa o pasiva).
        2. El número total de sesiones debe ser exactamente igual a 'trainingDaysPerWeek' (${profileData.trainingDaysPerWeek} días) y usar solo los 'preferredTrainingDays' (${profileData.preferredTrainingDays ? profileData.preferredTrainingDays.join(', ') : 'días seleccionados'}).
        3. El Mesociclo debe priorizar el 'fitnessGoal' ('${profileData.fitnessGoal}') y el 'focusArea' ('${profileData.focusArea}').
        4. El plan DEBE ser realista con el 'availableEquipment' (${profileData.availableEquipment.join(', ')}).
        5. El Mesociclo debe incluir NOTAS IMPORTANTES sobre la 'intensityRpe' y evitar movimientos que agraven las 'injuriesOrLimitations' ('${profileData.injuriesOrLimitations || "ninguna"}').
        6. NO DEBES incluir NINGÚN EJERCICIO Específico. SÓLO el enfoque de la sesión (sessionFocus).
        
        DATOS DEL PERFIL:
        ---
        ${profileString}
        ---
        
        Genera la respuesta como un **objeto JSON válido** que se ajuste **exactamente** al siguiente esquema:
        ---
        ${schemaString} 
        ---
        
        TU RESPUESTA DEBE SER ÚNICAMENTE EL JSON.`;

        // 4. LLAMADA A OPENROUTER (LLM)
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
        const mesocycleJsonString = openRouterResult.choices[0].message.content;
        
        let mesocycleData;
        try {
            mesocycleData = JSON.parse(mesocycleJsonString);
        } catch (e) {
            console.error('Error parseando JSON:', mesocycleJsonString);
            return res.status(500).json({ error: 'El LLM devolvió un JSON inválido.' });
        }

        // 5. LÓGICA DE FECHAS Y GUARDADO (FIX PARA MITAD DE SEMANA)
        
        const today = new Date();

        // A. Alineación al Lunes:
        // 'startOfWeek' con { weekStartsOn: 1 } devuelve el Lunes de la semana actual.
        // Si hoy es miércoles 20, devolverá el lunes 18.
        const logicalStartDate = startOfWeek(today, { weekStartsOn: 1 });

        // B. Duración y Fecha Final:
        // Asumimos 4 semanas por defecto si el LLM falla en devolver ese dato
        const durationWeeks = mesocycleData.durationWeeks || 4;
        // Calculamos endDate sumando semanas exactas (durationWeeks * 7 días)
        const logicalEndDate = addDays(logicalStartDate, durationWeeks * 7);

        const currentMesocycleData = {
            // Guardamos fechas completas en formato ISO
            startDate: logicalStartDate.toISOString(),
            endDate: logicalEndDate.toISOString(),
            
            progress: 0.0,
            currentWeek: 1, // Inicia siempre en 1 (la UI calcula la real)
            
            mesocyclePlan: mesocycleData,
            llmModelUsed: 'openai/gpt-4o-mini',
            generationDate: today.toISOString(),
            status: 'active'
        };

        // Guardar en Firestore
        await userDocRef.set({
            currentMesocycle: currentMesocycleData,
            planStatus: 'active'
        }, { merge: true });

        return res.status(200).json({
            success: true,
            message: 'Mesociclo generado exitosamente.',
            plan: currentMesocycleData
        });

    } catch (error) {
        console.error('Error general:', error);
        return res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
}