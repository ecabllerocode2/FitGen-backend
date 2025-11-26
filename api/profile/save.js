import { db, auth } from '../../lib/firebaseAdmin.js';
import admin from 'firebase-admin'; // 📌 NECESARIO para usar deleteField

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    // Asegúrate de que el Frontend envíe userId, userEmail, profileData y AHORA 'action' en el body
    const { userId: bodyUserId, userEmail: bodyUserEmail, profileData, action } = req.body;
    let userId;
    let userEmail;
    
    // --- Lógica de Extracción de Usuario ---
    const authHeader = req.headers.authorization;
    const idToken = authHeader ? authHeader.split('Bearer ')[1] : null;

    if (idToken) {
        try {
            const decodedToken = await auth.verifyIdToken(idToken);
            userId = decodedToken.uid;
            userEmail = decodedToken.email || null;
        } catch (error) {
            console.warn('Advertencia: Token inválido, usando datos del body para desarrollo.', error.message);
            userId = bodyUserId;
            userEmail = bodyUserEmail;
        }
    } else {
        userId = bodyUserId;
        userEmail = bodyUserEmail;
    }

    if (!userId) {
        return res.status(401).json({ error: 'Faltan datos de usuario (userId) para continuar.' });
    }
    
    // Validación de datos
    const requiredKeys = ['name', 'age', 'experienceLevel', 'trainingDaysPerWeek', 'availableEquipment', 'initialWeight', 'fitnessGoal'];
    // Se valida profileData y sus propiedades, no es necesario validar 'action' ya que es opcional para el primer onboarding
    const missingKeys = requiredKeys.filter(key => !profileData.hasOwnProperty(key)); 

    if (!profileData || typeof profileData !== 'object' || missingKeys.length > 0) {
        return res.status(400).json({ 
            error: 'Datos de perfil incompletos.',
            details: `Faltan las claves: ${missingKeys.join(', ')}` 
        });
    }
    
    // --- LIMPIEZA DE DATOS ---
    // Aseguramos que availableEquipment sea un array limpio y sin duplicados
    let cleanEquipment = [];
    if (Array.isArray(profileData.availableEquipment)) {
        cleanEquipment = [...new Set(profileData.availableEquipment.filter(item => item && typeof item === 'string' && item.trim() !== ''))];
    }

    const finalProfileData = {
        ...profileData,
        availableEquipment: cleanEquipment
    };

    try {
        const userRef = db.collection('users').doc(userId);
        
        // 📌 INICIO DE MODIFICACIÓN: Lógica de la Acción
        
        const updatePayload = {
            userId: userId,
            email: userEmail, 
            plan: 'free', 
            status: 'approved', // Siempre establecemos status como aprobado tras el onboarding/edición exitosa
            profileData: finalProfileData,
            lastProfileUpdate: new Date().toISOString(),
        };

        if (action === 'profile_update_and_invalidate_plan') {
            console.log(`[${userId}]: Perfil actualizado en modo EDICIÓN. Invalidando plan actual.`);
            
            // Si es modo edición, eliminamos el mesociclo y la sesión actuales.
            // Esto obligará al frontend a generar uno nuevo.
            updatePayload.currentMesocycle = admin.firestore.FieldValue.delete();
            updatePayload.currentSession = admin.firestore.FieldValue.delete();

        } else if (action === 'initial_onboarding_complete') {
            console.log(`[${userId}]: Onboarding inicial completado.`);
            
            // Solo creamos el campo createdAt si es el onboarding inicial
            updatePayload.createdAt = new Date().toISOString();
        }

        await userRef.set(updatePayload, { merge: true });
        
        // 📌 FIN DE MODIFICACIÓN
        
        // Aseguramos que los claims estén establecidos
        await auth.setCustomUserClaims(userId, { role: 'approved' });

        return res.status(200).json({ 
            success: true, 
            message: 'Perfil guardado exitosamente.', 
            userId: userId 
        });

    } catch (error) {
        console.error('Error al guardar el perfil en Firestore:', error);
        return res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
}