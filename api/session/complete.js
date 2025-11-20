import { db, auth } from '../../lib/firebaseAdmin.js';

export default async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // 1. Autenticación
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No token provided' });
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);
        const userId = decodedToken.uid;

        // 2. Obtener feedback del body
        const { sessionFeedback } = req.body; 
        // Esperamos: { rpe: number, notes: string }

        if (!sessionFeedback) {
            return res.status(400).json({ error: 'Falta el feedback de la sesión.' });
        }

        // 3. Referencias a Firestore
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

        const userData = userDoc.data();
        
        if (!userData.currentSession) {
            return res.status(400).json({ error: 'No hay sesión activa para completar.' });
        }

        // 4. Preparar el objeto de sesión finalizada
        const completionDate = new Date().toISOString();
        
        const completedSessionData = {
            ...userData.currentSession, // Copia todos los datos del ejercicio
            completed: true,
            feedback: {
                rpe: sessionFeedback.rpe,
                notes: sessionFeedback.notes || "",
                completedAt: completionDate
            }
        };

        // 5. Ejecutar Batch Write (Escritura en Lote)
        const batch = db.batch();

        // A) Actualizar el documento del usuario (Mantiene la sesión visible hoy)
        batch.update(userRef, { 
            currentSession: completedSessionData,
            // Opcional: Aquí podrías actualizar contadores de rachas o estadísticas globales
            lastWorkoutDate: completionDate
        });

        // B) Crear documento en el Historial (Para el registro eterno)
        // Se guarda en: users/{userId}/history/{autoId}
        const newHistoryRef = userRef.collection('history').doc(); 
        batch.set(newHistoryRef, completedSessionData);

        await batch.commit();

        return res.status(200).json({ 
            success: true, 
            message: 'Sesión guardada en historial y marcada como completa.' 
        });

    } catch (error) {
        console.error('Error completando sesión:', error);
        return res.status(500).json({ error: error.message });
    }
}