import { db, auth } from '../../lib/firebaseAdmin.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticación de Firebase faltante o malformado.' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
        // Verifica el token
        decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
        console.error('Error al verificar el token:', error.message);
        return res.status(401).json({ error: 'Token inválido o expirado. Acceso denegado.' });
    }
    
    // 💡 Aquí es donde la prueba de diagnóstico temporal se aseguraba de que no colgara.
    // Si llegamos a este punto, la verificación del token fue exitosa.

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email || null;
    const { profileData } = req.body; 

    // Validación de datos (Aseguramos que el LLM reciba lo necesario)
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
        // Uso del Admin SDK para guardar los datos de forma segura (Crea el doc si no existe)
        const userRef = db.collection('users').doc(userId);

        await userRef.set({
            userId: userId,
            email: userEmail, 
            status: 'pending_approval', 
            profileData: profileData,
            lastProfileUpdate: new Date().toISOString(),
            createdAt: new Date().toISOString()
        }, { merge: true });

        return res.status(200).json({ 
            success: true, 
            message: 'Perfil guardado exitosamente y estado establecido a pendiente de aprobación.', 
            userId: userId 
        });

    } catch (error) {
        // Manejo de error de Firestore
        console.error('Error al guardar el perfil en Firestore:', error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud.', details: error.message });
    }
}