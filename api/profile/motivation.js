// api/llm/motivation.js
// Este endpoint se encarga de generar una frase motivacional usando el LLM de OpenRouter,
// asegurando que solo usuarios autenticados puedan acceder.

// IMPORTANTE: Asegúrate de que esta ruta sea correcta para tu proyecto
import { auth } from '../../lib/firebaseAdmin.js'; 
import fetch from 'node-fetch'; 

// La clave de OpenRouter se lee automáticamente del entorno (Vercel/local .env)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Modelo LLM gratuito y eficiente recomendado
const LLM_MODEL = 'mistralai/mistral-small-3.2-24b-instruct:free'; 

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Use POST.' });
    }

    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({ error: 'La clave de OpenRouter no está configurada.' });
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
        // Usa Firebase Admin SDK para validar el token ID del Frontend
        const decodedToken = await auth.verifyIdToken(idToken);
        userId = decodedToken.uid;
        // Asumimos que el nombre del usuario viene en el cuerpo de la solicitud (req.body)
        name = req.body.name || 'Atleta'; 
        
    } catch (error) {
        console.error("Error de verificación del token de Firebase:", error.message);
        return res.status(401).json({ error: 'Token de autenticación inválido o expirado.' });
    }

    try {
        const { goal } = req.body;
        
        // 2. CONSTRUIR EL PROMPT PARA EL LLM
        const goalDescription = goal || 'tu meta de fitness';
        
        // 💡 CORRECCIÓN CRÍTICA: Añadimos un Nonce (cacheBuster) al prompt.
        // Esto garantiza que el string del prompt sea ÚNICO en cada llamada,
        // forzando al LLM o a la caché de OpenRouter a generar una nueva respuesta.
        const cacheBuster = Date.now(); 

        const prompt = `Eres un coach de fitness conciso e inspirador. Genera una sola frase motivacional muy corta y poderosa (máximo 15 palabras) dirigida a un atleta. Su meta actual es: ${goalDescription}. El nombre del atleta es ${name}. Debes hablarle por su nombre. (Nonce: ${cacheBuster})`;

        // 3. LLAMADA A LA API DE OPENROUTER
        const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                // Header adicional si quieres identificar las peticiones
                "X-Title": "FitGen-Motivation-Endpoint"
            },
            body: JSON.stringify({
                model: LLM_MODEL,
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
        
        // 4. PROCESAR LA RESPUESTA
        const motivationQuote = data.choices[0].message.content.trim().replace(/"/g, ''); // Limpiar comillas
        
        // 5. RESPUESTA EXITOSA AL FRONTEND
        return res.status(200).json({ 
            success: true, 
            quote: motivationQuote 
        });

    } catch (error) {
        console.error("Error interno en el endpoint de motivación:", error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar el LLM.', details: error.message });
    }
}