import { db, auth } from '../../lib/firebaseAdmin.js';

// ====================================================================
// MOTOR DE EVALUACIÓN Y AJUSTE
// ====================================================================

/**
 * Calcula el "Multiplicador de Sobrecarga" para el siguiente ciclo
 * basado en el RPE reportado vs el RPE objetivo.
 */
const calculateOverloadAdjustment = (sessionHistory, targetAvgRpe = 7.5) => {
    // Caso 1: Sin historial (salida temprana)
    if (!sessionHistory || sessionHistory.length === 0) {
        return { action: 'maintain', factor: 1.0, reason: "Historial de sesiones vacío.", avgRpe: 0 }; // <--- CORRECCIÓN DE REASON Y avgRpe
    }

    // Extraer RPEs válidos
    const rpes = sessionHistory
        .map(s => s.feedback?.rpe)
        .filter(r => typeof r === 'number' && r > 0);

    // Caso 2: Sin RPEs en el historial (salida temprana)
    if (rpes.length === 0) {
        return { action: 'maintain', factor: 1.0, reason: "No se encontró RPE en el historial.", avgRpe: 0 }; // <--- CORRECCIÓN DE REASON Y avgRpe
    }

    // Calcular promedio
    const avgRpe = rpes.reduce((a, b) => a + b, 0) / rpes.length;

    console.log(`[EVALUATE] Avg RPE: ${avgRpe} vs Target: ${targetAvgRpe}`);

    // Lógica de Ajuste Heurístico
    if (avgRpe <= (targetAvgRpe - 1.5)) {
        // Estaba muy fácil (< 6)
        return { action: 'increase_aggressive', factor: 1.15, reason: "RPE reportado muy bajo.", avgRpe };
    } else if (avgRpe <= (targetAvgRpe - 0.5)) {
        // Estaba algo fácil (~7)
        return { action: 'increase_moderate', factor: 1.05, reason: "Espacio para mejora detectado.", avgRpe };
    } else if (avgRpe >= (targetAvgRpe + 1.5)) {
        // Estaba destructivo (> 9)
        return { action: 'decrease', factor: 0.90, reason: "RPE excesivo, riesgo de burnout.", avgRpe };
    } else {
        // Estaba en el punto dulce
        return { action: 'maintain', factor: 1.0, reason: "Intensidad adecuada.", avgRpe };
    }
};

export default async function handler(req, res) {
    // CORS Setup y validación de método
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

        // 2. Obtener datos del Body
        const { 
            difficultyScore, // 1 (Muy fácil) a 5 (Muy difícil) - Input del usuario
            likedMesocycle = null,  // CORRECCIÓN ANTERIOR: default a null
            painAreas,       // Array de strings ['knees', 'lower_back'] o []
            nextGoalPreference, // Opcional
            notes // Notas libres que vienen del frontend
        } = req.body;

        // 3. Referencias a DB
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) throw new Error("User not found");
        
        const userData = userDoc.data();
        const currentMeso = userData.currentMesocycle;
        const completionDate = new Date().toISOString();

        // Usamos la fecha de inicio del ciclo como ID de archivo, ya que es única para este mesociclo
        const mesocycleIdForArchive = currentMeso.startDate; 

        // 4. Leer HISTORIAL REAL de sesiones
        const startDate = new Date(currentMeso.startDate);
        const historySnapshot = await userRef.collection('history')
            .where('completedAt', '>=', startDate.toISOString())
            .orderBy('completedAt', 'desc')
            .limit(30)
            .get();

        const sessionHistory = historySnapshot.docs.map(doc => doc.data());

        // 5. ANÁLISIS HEURÍSTICO
        const rpeAnalysis = calculateOverloadAdjustment(sessionHistory);
        
        let subjectiveFactor = 1.0;
        if (difficultyScore === 1) subjectiveFactor = 1.1;
        if (difficultyScore === 5) subjectiveFactor = 0.85;

        const nextVolumeIntensityFactor = rpeAnalysis.factor * subjectiveFactor;


        // ====================================================================
        // 6. ARCHIVADO Y ACTUALIZACIÓN (USANDO BATCH PARA ATOMICIDAD)
        // ====================================================================

        const batch = db.batch();

        // 6.A. PREPARAR Y ARCHIVAR DATOS DE EVALUACIÓN (Subcolección 'evaluations')
        const evaluationArchiveData = {
            // Identificadores y Fechas
            mesocycleId: mesocycleIdForArchive,
            archiveDate: completionDate,
            
            // Datos del Mesociclo Finalizado
            durationWeeks: currentMeso.mesocyclePlan.durationWeeks,
            mesocycleGoal: currentMeso.mesocyclePlan.mesocycleGoal,
            
            // Feedback Subjetivo (Crucial para Stats y Logros)
            difficultyScore: difficultyScore, 
            likedMesocycle: likedMesocycle,
            painAreas: painAreas, 
            nextGoalPreference: nextGoalPreference || userData.profileData.fitnessGoal,
            notes: notes || "", 

            // Resultados del Análisis Heurístico y Estadísticas de Adherencia
            rpeAnalysis: {
                // Ahora rpeAnalysis.avgRpe y rpeAnalysis.reason están garantizados.
                avgRpe: rpeAnalysis.avgRpe, 
                rpeAction: rpeAnalysis.action,
                reason: rpeAnalysis.reason,
            },
            adherenceStats: {
                totalSessionsReported: sessionHistory.length
            },
            
            // Factor de Ajuste
            nextVolumeIntensityFactor: nextVolumeIntensityFactor,
        };
        
        // Añadir la escritura a la subcolección 'evaluations'
        const evaluationRef = userRef.collection('evaluations').doc(mesocycleIdForArchive); 
        batch.set(evaluationRef, evaluationArchiveData);


        // 6.B. PREPARAR Y APLICAR ACTUALIZACIONES AL DOCUMENTO PRINCIPAL DEL USUARIO
        const updates = {
            'lastEvaluation': completionDate,
            'currentMesocycle.status': 'completed', // Cierra el ciclo actual
        };
        
        // Si el usuario reportó dolor, actualizamos limitaciones
        if (painAreas && painAreas.length > 0) {
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

        // GUARDAMOS LA CONFIGURACIÓN "CARRYOVER"
        updates['nextCycleConfig'] = {
            overloadFactor: nextVolumeIntensityFactor,
            focusSuggestion: painAreas.length > 0 ? "Rehab/Prehab" : "Progressive Overload",
            previousAdherence: sessionHistory.length
        };
        
        // Añadir la actualización al documento principal
        batch.update(userRef, updates);

        // 6.C. EJECUTAR EL BATCH
        await batch.commit();

        return res.status(200).json({ 
            success: true, 
            message: "Evaluación procesada. Perfil actualizado y datos de evaluación archivados.",
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