import { db, auth } from '../../lib/firebaseAdmin.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    // Asegúrate de que el Frontend envíe userId y userEmail en el body
    const { userId: bodyUserId, userEmail: bodyUserEmail, profileData } = req.body;
    let userId;
    let userEmail;
    
    // --- Lógica de Extracción de Usuario (Simplificada Temporalmente) ---
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;

    if (idToken) {
        try {
            const decodedToken = await auth.verifyIdToken(idToken);
            userId = decodedToken.uid;
            userEmail = decodedToken.email || null;
        } catch (error) {
            // Si el token falla, usamos el body (RESTAURAR para producción)
            console.warn('Advertencia: La verificación del token de Firebase falló, usando userId/email del cuerpo. RESTAURAR para producción.', error.message);
            userId = bodyUserId;
            userEmail = bodyUserEmail;
        }
    } else {
        // Si no hay token, usamos los datos del cuerpo (REQUERIR token en producción)
        userId = bodyUserId;
        userEmail = bodyUserEmail;
    }

    if (!userId) {
        return res.status(401).json({ error: 'Faltan datos de usuario (userId) para continuar.' });
    }
    // -------------------------------------------------------------------
    
    // Validación de datos (Igual que antes)
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
        
        // 💡 CAMBIOS CLAVE: Inicializar el plan como 'free'
        await userRef.set({
            userId: userId,
            email: userEmail, 
            plan: 'free', // <<< AHORA TODOS SON FREE POR DEFECTO
            status: 'approved', // Mantenemos 'approved' para dar acceso TOTAL al Dashboard temporalmente
            profileData: profileData,
            lastProfileUpdate: new Date().toISOString(),
            createdAt: new Date().toISOString()
        }, { merge: true });

        // Establecer el Custom Claim para que App.tsx lo vea inmediatamente
        await auth.setCustomUserClaims(userId, { role: 'approved' });

        return res.status(200).json({ 
            success: true, 
            message: 'Perfil guardado exitosamente. Usuario inicializado como FREE con acceso total temporal.', 
            userId: userId 
        });

    } catch (error) {
        console.error('Error al guardar el perfil en Firestore:', error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud.', details: error.message });
    }
}