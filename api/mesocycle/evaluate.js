import { db, auth } from '../../lib/firebaseAdmin.js';

// ====================================================================
// MOTOR DE EVALUACIÓN Y AJUSTE
// ====================================================================

/**
 * Calcula el "Multiplicador de Sobrecarga" para el siguiente ciclo
 * basado en el RPE reportado vs el RPE objetivo.
 */
const calculateOverloadAdjustment = (sessionHistory, targetAvgRpe = 7.5) => {
    if (!sessionHistory || sessionHistory.length === 0) return { action: 'maintain', factor: 1.0 };

    // Extraer RPEs válidos
    const rpes = sessionHistory
        .map(s => s.feedback?.rpe)
        .filter(r => typeof r === 'number' && r > 0);

    if (rpes.length === 0) return { action: 'maintain', factor: 1.0 };

    // Calcular promedio
    const avgRpe = rpes.reduce((a, b) => a + b, 0) / rpes.length;

    console.log(`[EVALUATE] Avg RPE: ${avgRpe} vs Target: ${targetAvgRpe}`);

    // Lógica de Ajuste Heurístico
    if (avgRpe <= (targetAvgRpe - 1.5)) {
        // Estaba muy fácil (< 6)
        return { action: 'increase_aggressive', factor: 1.15, reason: "RPE reportado muy bajo." };
    } else if (avgRpe <= (targetAvgRpe - 0.5)) {
        // Estaba algo fácil (~7)
        return { action: 'increase_moderate', factor: 1.05, reason: "Espacio para mejora detectado." };
    } else if (avgRpe >= (targetAvgRpe + 1.5)) {
        // Estaba destructivo (> 9)
        return { action: 'decrease', factor: 0.90, reason: "RPE excesivo, riesgo de burnout." };
    } else {
        // Estaba en el punto dulce
        return { action: 'maintain', factor: 1.0, reason: "Intensidad adecuada." };
    }
};

export default async function handler(req, res) {
    // CORS Setup
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing auth token' });

    try {
        // 1. Autenticación
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;

        // 2. Obtener datos del Body (El formulario que llena el usuario)
        const { 
            difficultyScore, // 1 (Muy fácil) a 5 (Muy difícil) - Input del usuario
            likedMesocycle,  // Boolean
            painAreas,       // Array de strings ['knees', 'lower_back'] o []
            nextGoalPreference // Opcional: Si el usuario quiere cambiar de "Fuerza" a "Hipertrofia" manualmente
        } = req.body;

        // 3. Referencias a DB
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) throw new Error("User not found");
        
        const userData = userDoc.data();
        const currentMeso = userData.currentMesocycle;

        // 4. Leer HISTORIAL REAL de sesiones (La subcolección 'history')
        // Traemos las sesiones que pertenezcan a este mesociclo (por fecha aprox o ID si lo tuvieras)
        // Aquí asumimos que traemos las últimas 20 y filtramos por fecha de inicio del mesociclo
        const startDate = new Date(currentMeso.startDate);
        const historySnapshot = await userRef.collection('history')
            .where('completedAt', '>=', startDate.toISOString())
            .orderBy('completedAt', 'desc')
            .limit(30)
            .get();

        const sessionHistory = historySnapshot.docs.map(doc => doc.data());

        // 5. ANÁLISIS HEURÍSTICO
        // A. Ajuste por RPE Real (Datos objetivos)
        const rpeAnalysis = calculateOverloadAdjustment(sessionHistory);
        
        // B. Ajuste por Feedback Subjetivo (Lo que siente el usuario)
        let subjectiveFactor = 1.0;
        if (difficultyScore === 1) subjectiveFactor = 1.1; // "Muy fácil" -> Sube más
        if (difficultyScore === 5) subjectiveFactor = 0.85; // "Muy difícil" -> Baja

        // C. Factor Combinado
        const nextVolumeIntensityFactor = rpeAnalysis.factor * subjectiveFactor;

        // 6. ACTUALIZACIÓN DEL PERFIL (PREPARACIÓN PARA EL SIGUIENTE GENERATE)
        // En lugar de generar aquí, actualizamos 'profileData' y un nuevo campo 'nextCycleConfig'
        // que el endpoint 'generate' leerá.

        const updates = {
            'lastEvaluation': new Date().toISOString(),
            'currentMesocycle.status': 'completed', // Cierra el ciclo actual
            'currentMesocycle.completionStats': {
                avgRpe: rpeAnalysis.avgRpe || 0,
                adherenceCount: sessionHistory.length
            }
        };

        // Si el usuario reportó dolor, actualizamos limitaciones
        if (painAreas && painAreas.length > 0) {
            // Agregamos a las limitaciones existentes sin borrar las viejas si no queremos
            const currentInjuries = userData.profileData.injuriesOrLimitations || "";
            const newInjuries = painAreas.join(", ");
            updates['profileData.injuriesOrLimitations'] = currentInjuries === "Ninguna" 
                ? newInjuries 
                : `${currentInjuries}, ${newInjuries}`;
        }

        // Si el usuario pidió cambio de objetivo
        if (nextGoalPreference && nextGoalPreference !== userData.profileData.fitnessGoal) {
            updates['profileData.fitnessGoal'] = nextGoalPreference;
        }

        // GUARDAMOS LA CONFIGURACIÓN "CARRYOVER" PARA EL SIGUIENTE CICLO
        // Esto es clave: El generate.js leerá esto para saber si hacer el siguiente más duro o suave.
        updates['nextCycleConfig'] = {
            overloadFactor: nextVolumeIntensityFactor, // Ej: 1.1 (10% más duro)
            focusSuggestion: painAreas.length > 0 ? "Rehab/Prehab" : "Progressive Overload",
            previousAdherence: sessionHistory.length
        };

        await userRef.update(updates);

        return res.status(200).json({ 
            success: true, 
            message: "Evaluación procesada. Perfil actualizado para el siguiente ciclo.",
            analysis: {
                rpeAction: rpeAnalysis.action,
                nextFactor: nextVolumeIntensityFactor
            }
        });

    } catch (error) {
        console.error("Error evaluating mesocycle:", error);
        return res.status(500).json({ error: error.message });
    }
}