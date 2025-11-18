// api/profile/save.js
// Este endpoint maneja la lógica para guardar/actualizar el perfil de usuario en Firestore.

import { db, auth } from '../../lib/firebaseAdmin.js';

// La función 'handler' se exporta directamente, sin Express.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    const { userId: bodyUserId, userEmail: bodyUserEmail, profileData } = req.body;
    let userId;
    let userEmail;
    
    // --- Lógica de Extracción de Usuario (Verificación obligatoria de token) ---
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;

    if (!idToken) {
        return res.status(401).json({ error: 'Autorización requerida. Falta el token de Firebase.' });
    }

    try {
        // Usa Firebase Admin SDK para validar el token ID del Frontend
        const decodedToken = await auth.verifyIdToken(idToken);
        userId = decodedToken.uid;
        userEmail = decodedToken.email || null;
    } catch (error) {
        console.error('Error de verificación del token de Firebase:', error.message);
        return res.status(401).json({ error: 'Token de autenticación inválido o expirado.' });
    }
    // -------------------------------------------------------------------
    
    // Validación de datos 
    const requiredKeys = ['name', 'age', 'experienceLevel', 'trainingDaysPerWeek', 'availableEquipment', 'initialWeight', 'fitnessGoal'];
    const missingKeys = requiredKeys.filter(key => !profileData.hasOwnProperty(key));

    if (!profileData || typeof profileData !== 'object' || missingKeys.length > 0) {
        return res.status(400).json({ 
            error: 'Datos de perfil incompletos o inválidos.',
            details: `Faltan las claves: ${missingKeys.join(', ')}` 
        });
    }
    
    if (typeof profileData.age !== 'number' || profileData.age < 15 || typeof profileData.trainingDaysPerWeek !== 'number' || profileData.trainingDaysPerWeek > 7) {
        return res.status(400).json({ error: 'Edad o Días de entrenamiento inválidos.' });
    }

    try {
        const userRef = db.collection('users').doc(userId);
        
        // Guardar la data
        await userRef.set({
            userId: userId,
            email: userEmail, 
            plan: 'free', 
            status: 'approved', 
            profileData: profileData,
            lastProfileUpdate: new Date().toISOString(),
            createdAt: new Date().toISOString()
        }, { merge: true });

        // Establecer el Custom Claim para que App.tsx lo vea inmediatamente
        await auth.setCustomUserClaims(userId, { role: 'approved' });

        return res.status(200).json({ 
            success: true, 
            message: 'Perfil guardado exitosamente. Usuario inicializado como FREE.', 
            userId: userId 
        });

    } catch (error) {
        console.error('Error al guardar el perfil en Firestore:', error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud.', details: error.message });
    }
}