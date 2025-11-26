// api/llm/motivation.js
// Este endpoint se encarga de generar una frase motivacional usando el LLM de OpenRouter,
// asegurando que solo usuarios autenticados puedan acceder.

import { auth } from '../../lib/firebaseAdmin.js'; 
import fetch from 'node-fetch'; 

// La clave de OpenRouter se lee automáticamente del entorno (Vercel/local .env)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Modelo LLM a usar cuando esté activo (Aseguramos que es el correcto)
const LLM_MODEL = ''; 

// ----------------------------------------------------
// 🚨 MODO DE DESARROLLO/MOCKING
// ----------------------------------------------------
// CRÍTICO: Cambia a 'true' cuando vayas a desplegar a producción o hacer pruebas de costo/calidad.
const IS_LLM_ACTIVE = false; 

// Frase estática que se usará cuando IS_LLM_ACTIVE es false.
// Se usa un placeholder ${name} para simular la personalización del LLM.
const MOCK_QUOTE_TEMPLATE = "¡Hola ${name}! La disciplina de hoy es la fuerza de mañana. Sigue adelante.";


export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Use POST.' });
    }

    // 1. VERIFICACIÓN DE AUTENTICACIÓN
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autorización requerida. Falta el token de Firebase.' });
    }
    
    const idToken = authHeader.split(' ')[1];
    let userId;
    let name = 'Atleta'; // Valor por defecto si no se puede verificar o no se pasa el nombre

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        userId = decodedToken.uid;
        // Asumimos que el nombre del usuario viene en el cuerpo de la solicitud (req.body)
        name = req.body.name || 'Atleta'; 
        
    } catch (error) {
        console.error("Error de verificación del token de Firebase:", error.message);
        return res.status(401).json({ error: 'Token de autenticación inválido o expirado.' });
    }
    
    // ----------------------------------------------------
    // 2. LÓGICA DE GENERACIÓN (MOCK o LLM Real)
    // ----------------------------------------------------
    let motivationQuote;
    
    if (IS_LLM_ACTIVE) {
        // --- Lógica LLM Real ---
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({ error: 'La clave de OpenRouter no está configurada.' });
        }
        
        console.log(`[MOTIVACION] Llamada real al LLM (${LLM_MODEL})...`);
        
        try {
            const { goal } = req.body;
            const goalDescription = goal || 'tu meta de fitness';
            const cacheBuster = Date.now(); 

            const prompt = `Eres un coach de fitness conciso e inspirador. Genera una sola frase motivacional muy corta y poderosa (máximo 15 palabras) dirigida a un atleta. Su meta actual es: ${goalDescription}. El nombre del atleta es ${name}. Debes hablarle por su nombre. (Nonce: ${cacheBuster})`;

            // LLAMADA A LA API DE OPENROUTER
            const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "X-Title": "FitGen-Motivation-Endpoint"
                },
                body: JSON.stringify({
                    model: LLM_MODEL, // Usamos el modelo GPT-4o Mini
                    messages: [
                        { role: "system", content: "Eres un asistente útil y muy conciso que genera frases motivacionales en español." },
                        { role: "user", content: prompt }
                    ],
                    max_tokens: 40, 
                    temperature: 0.8,
                }),
            });

            if (!openRouterResponse.ok) {
                const errorText = await openRouterResponse.text();
                console.error(`OpenRouter Error (${openRouterResponse.status}):`, errorText);
                return res.status(500).json({ error: 'Error al comunicarse con el LLM. Revisa logs del Backend.' });
            }

            const data = await openRouterResponse.json();
            
            // PROCESAR LA RESPUESTA
            motivationQuote = data.choices[0].message.content.trim().replace(/"/g, ''); 
        
        } catch (error) {
            console.error("Error interno en el endpoint de motivación (LLM):", error);
            return res.status(500).json({ error: 'Error interno del servidor al procesar el LLM.', details: error.message });
        }

    } else {
        // --- Modo Mock ---
        // Simular una pequeña latencia
        await new Promise(resolve => setTimeout(resolve, 300)); 
        console.log(`[MOTIVACION] Devolviendo quote estática para: ${name}`);
        
        // Generar la frase estática usando el nombre del usuario
        motivationQuote = MOCK_QUOTE_TEMPLATE.replace('${name}', name);
    }
    
    // 3. RESPUESTA EXITOSA AL FRONTEND (Válida para Mock o LLM Real)
    return res.status(200).json({ 
        success: true, 
        quote: motivationQuote 
    });
}