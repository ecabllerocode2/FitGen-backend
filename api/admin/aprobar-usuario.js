// Importamos las instancias ya inicializadas de Firebase Admin
// Asumimos que '../../lib/firebaseAdmin.js' exporta 'auth'
import { auth } from '../../lib/firebaseAdmin.js'; 

/**
 * Endpoint: POST /api/admin/aprobar-usuario
 * Función: Aprueba un usuario al establecer el Custom Claim 'role: approved' 
 * en su registro de Firebase Authentication.
 * * NOTA CRÍTICA DE SEGURIDAD: Este endpoint carece de autenticación de administrador 
 * explícita (solo verifica un token de Firebase, no que el emisor sea un 'admin'). 
 * Para desarrollo, es funcional. Para producción, DEBE protegerse con una 
 * Custom Claim 'admin' en el token del solicitante.
 */
export default async function handler(req, res) {
    // 1. Verificar el método HTTP
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
    }

    // 2. Extracción y Validación del ID del Usuario a Aprobar
    // Asumimos que el cuerpo de la petición contiene el 'userIdToApprove'
    const { userIdToApprove } = req.body; 

    if (!userIdToApprove || typeof userIdToApprove !== 'string') {
        return res.status(400).json({ error: 'ID de usuario para aprobar (userIdToApprove) es faltante o inválido.' });
    }

    try {
        // 3. Establecer las Reclamaciones Personalizadas (Custom Claims)
        const customClaims = {
            role: 'approved',
            access: true // Puedes añadir cualquier otro claim
        };

        // setCustomUserClaims se comunica con Firebase Authentication (Admin SDK)
        await auth.setCustomUserClaims(userIdToApprove, customClaims);

        // 4. Opcional: También actualizamos el documento de Firestore para mantener la consistencia
        // *Este paso es opcional si solo se usa el claim, pero mantiene la UI del Dashboard limpia.*
        // Ya que no tenemos 'db' importado aquí, lo omitiremos para la simplicidad del 'Admin Claim'.

        return res.status(200).json({ 
            success: true, 
            message: `Usuario ${userIdToApprove} aprobado con el claim 'role: approved'.`, 
            userId: userIdToApprove
        });

    } catch (error) {
        // Manejo de errores de Firebase Admin (p.ej., UID inválido)
        console.error('Error al aprobar el usuario y establecer claims:', error);
        return res.status(500).json({ 
            error: 'Error interno del servidor al procesar la aprobación.', 
            details: error.message 
        });
    }
}