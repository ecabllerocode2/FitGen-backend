// ====================================================================
// DATA FETCHER MODULE
// Recuperación y validación de datos del usuario y catálogo de ejercicios
// ====================================================================

import { db } from '../firebaseAdmin.js';

/**
 * Obtiene todos los datos necesarios para generar una sesión
 * @param {string} userId - ID del usuario
 * @returns {Object} Datos consolidados del usuario y catálogo
 */
export async function obtenerDatosContextuales(userId) {
    if (!userId) {
        return {
            success: false,
            error: 'USER_ID_REQUIRED: Se requiere un ID de usuario válido'
        };
    }

    try {
        // Ejecutar consultas en paralelo para optimizar tiempo
        const [userDoc, exercisesCatalog] = await Promise.all([
            obtenerDocumentoUsuario(userId),
            obtenerCatalogoEjercicios()
        ]);

        // Validar estructura del usuario
        const validation = validarEstructuraUsuario(userDoc);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error
            };
        }

        // ✅ DEVOLVER EN EL FORMATO CORRECTO QUE ESPERA generateV2.js
        // Normalizar lesiones: siempre devolver como array
        const lesionesRaw = userDoc.profileData.injuriesOrLimitations;
        let lesionesNormalizadas = [];
        if (Array.isArray(lesionesRaw)) {
            lesionesNormalizadas = lesionesRaw.filter(l => l && l.toLowerCase() !== 'ninguna');
        } else if (typeof lesionesRaw === 'string' && lesionesRaw.toLowerCase() !== 'ninguna' && lesionesRaw !== '') {
            lesionesNormalizadas = [lesionesRaw];
        }

        return {
            success: true,
            usuario: {
                id: userDoc.id,
                ...userDoc.profileData,
                experienceLevel: userDoc.profileData.experienceLevel,
                fitnessGoal: userDoc.profileData.fitnessGoal,
                injuriesOrLimitations: lesionesNormalizadas, // Siempre array
                availableEquipment: userDoc.profileData.availableEquipment || []
            },
            mesocicloActivo: userDoc.currentMesocycle,
            catalogoEjercicios: exercisesCatalog,
            historialSesiones: userDoc.history || [],
            metrics: userDoc.metrics
        };
    } catch (error) {
        console.error('[DataFetcher] Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Obtiene el documento del usuario con todos sus datos
 * @param {string} userId - ID del usuario
 * @returns {Object} Documento del usuario
 */
async function obtenerDocumentoUsuario(userId) {
    const userRef = db.collection('users').doc(userId);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
        throw new Error(`USER_NOT_FOUND: Usuario con ID ${userId} no encontrado`);
    }

    const userData = userSnapshot.data();

    // Extraer y estructurar datos críticos
    return {
        id: userId,
        profileData: userData.profileData || {},
        currentMesocycle: userData.currentMesocycle || null,
        history: userData.history || [],
        planStatus: userData.planStatus || 'active',
        nextCycleConfig: userData.nextCycleConfig || null,
        // Métricas calculadas
        metrics: {
            totalSessions: (userData.history || []).length,
            lastSessionDate: getLastSessionDate(userData.history),
            consecutiveCompletedSessions: getConsecutiveCompletedSessions(userData.history),
            averageRPE: calculateAverageRPE(userData.history),
            averageEnergy: calculateAverageEnergy(userData.history),
            weeklyFrequency: calculateWeeklyFrequency(userData.history)
        }
    };
}

/**
 * Obtiene el catálogo completo de ejercicios
 * @returns {Array} Array de ejercicios
 */
async function obtenerCatalogoEjercicios() {
    // Intentar primero desde la colección 'exercises' (producción)
    let exercisesSnapshot = await db.collection('exercises').get();
    
    if (exercisesSnapshot.empty) {
        // Fallback: buscar en documento único
        const catalogDoc = await db.collection('catalogs').doc('exercises').get();
        if (catalogDoc.exists) {
            return catalogDoc.data().items || [];
        }
        
        console.warn('EXERCISE_CATALOG_EMPTY: No se encontraron ejercicios en la base de datos');
        return [];
    }

    const exercises = [];
    exercisesSnapshot.forEach(doc => {
        exercises.push({
            id: doc.id,
            ...doc.data()
        });
    });

    return exercises;
}

/**
 * Valida que el usuario tenga la estructura mínima necesaria
 * @param {Object} userDoc - Documento del usuario
 * @returns {Object} Resultado de validación
 */
function validarEstructuraUsuario(userDoc) {
    const errores = [];

    if (!userDoc.profileData) {
        errores.push('Falta profileData');
    } else {
        if (!userDoc.profileData.experienceLevel) {
            errores.push('Falta nivel de experiencia');
        }
        if (!userDoc.profileData.fitnessGoal) {
            errores.push('Falta objetivo de fitness');
        }
    }

    if (!userDoc.currentMesocycle) {
        errores.push('No hay mesociclo activo');
    } else {
        if (!userDoc.currentMesocycle.mesocyclePlan) {
            errores.push('El mesociclo no tiene plan definido');
        }
        if (!userDoc.currentMesocycle.mesocyclePlan?.microcycles) {
            errores.push('El mesociclo no tiene microciclos definidos');
        }
    }

    if (errores.length > 0) {
        return {
            valid: false,
            error: `INVALID_USER_STRUCTURE: ${errores.join(', ')}`
        };
    }

    return { valid: true };
}

// ====================================================================
// FUNCIONES DE CÁLCULO DE MÉTRICAS (sin cambios)
// ====================================================================

function getLastSessionDate(history) {
    if (!history || history.length === 0) return null;
    
    const dates = history
        .map(s => s.meta?.date || s.date)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a));
    
    return dates[0] || null;
}

function getConsecutiveCompletedSessions(history) {
    if (!history || history.length === 0) return 0;
    
    let consecutive = 0;
    const sorted = [...history].sort((a, b) => {
        const dateA = new Date(a.meta?.date || a.date || 0);
        const dateB = new Date(b.meta?.date || b.date || 0);
        return dateB - dateA;
    });

    for (const session of sorted) {
        if (session.feedback?.completed !== false) {
            consecutive++;
        } else {
            break;
        }
    }

    return consecutive;
}

function calculateAverageRPE(history, lastN = 10) {
    if (!history || history.length === 0) return null;
    
    const sessionsWithRPE = history
        .filter(s => s.feedback?.rpe != null)
        .slice(0, lastN);
    
    if (sessionsWithRPE.length === 0) return null;
    
    const sum = sessionsWithRPE.reduce((acc, s) => acc + s.feedback.rpe, 0);
    return Math.round((sum / sessionsWithRPE.length) * 10) / 10;
}

function calculateAverageEnergy(history, lastN = 10) {
    if (!history || history.length === 0) return null;
    
    const sessionsWithEnergy = history
        .filter(s => s.feedback?.energyLevel != null)
        .slice(0, lastN);
    
    if (sessionsWithEnergy.length === 0) return null;
    
    const sum = sessionsWithEnergy.reduce((acc, s) => acc + s.feedback.energyLevel, 0);
    return Math.round((sum / sessionsWithEnergy.length) * 10) / 10;
}

function calculateWeeklyFrequency(history) {
    if (!history || history.length < 2) return null;
    
    const dates = history
        .map(s => new Date(s.meta?.date || s.date))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b);
    
    if (dates.length < 2) return null;
    
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const weeksDiff = Math.max(1, Math.ceil((lastDate - firstDate) / (7 * 24 * 60 * 60 * 1000)));
    
    return Math.round((dates.length / weeksDiff) * 10) / 10;
}

// Resto de funciones de análisis del historial (sin cambios)...
export function getExerciseHistory(history, exerciseId, limit = 10) {
    if (!history || history.length === 0) return [];
    
    const exerciseRecords = [];
    
    for (const session of history) {
        if (!session.mainBlocks && !session.coreBlocks) continue;
        
        const allBlocks = [
            ...(session.mainBlocks || []),
            ...(session.coreBlocks || [])
        ];
        
        for (const block of allBlocks) {
            const exercise = (block.exercises || []).find(e => e.id === exerciseId);
            if (exercise && exercise.performanceData) {
                exerciseRecords.push({
                    date: session.meta?.date || session.date,
                    sessionFocus: session.meta?.focus,
                    ...exercise,
                    sessionFeedback: session.feedback
                });
            }
        }
        
        if (exerciseRecords.length >= limit) break;
    }
    
    return exerciseRecords.slice(0, limit);
}

export function getRecentlyUsedExercises(history, daysBack = 7, targetFocus = null) {
    const usedIds = new Set();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    for (const session of history) {
        const sessionDate = new Date(session.meta?.date || session.date);
        if (isNaN(sessionDate.getTime())) continue;
        if (sessionDate < cutoffDate) continue;
        
        if (targetFocus && session.meta?.focus !== targetFocus) continue;
        
        const allBlocks = [
            ...(session.mainBlocks || []),
            ...(session.coreBlocks || []),
            ...(session.warmupBlocks || [])
        ];
        
        for (const block of allBlocks) {
            for (const exercise of (block.exercises || [])) {
                if (exercise.id) {
                    usedIds.add(exercise.id);
                }
            }
        }
    }
    
    return usedIds;
}

export function detectPlateau(history, exerciseId) {
    const records = getExerciseHistory(history, exerciseId, 6);
    
    if (records.length < 4) {
        return { isPlateau: false, reason: 'Datos insuficientes', sessions: records.length };
    }
    
    let noProgressCount = 0;
    
    for (let i = 0; i < records.length - 1; i++) {
        const current = records[i];
        const previous = records[i + 1];
        
        const currentAvgReps = calculateAvgRepsFromSets(current.performanceData?.actualSets);
        const previousAvgReps = calculateAvgRepsFromSets(previous.performanceData?.actualSets);
        
        if (currentAvgReps && previousAvgReps && currentAvgReps <= previousAvgReps) {
            noProgressCount++;
        }
    }
    
    const isPlateau = noProgressCount >= 3;
    
    return {
        isPlateau,
        noProgressSessions: noProgressCount,
        totalAnalyzed: records.length,
        recommendation: isPlateau 
            ? 'Considerar cambio de variante o técnica de intensidad'
            : 'Progresión normal',
        lastRecords: records.slice(0, 3)
    };
}

function calculateAvgRepsFromSets(sets) {
    if (!sets || sets.length === 0) return null;
    const sum = sets.reduce((acc, s) => acc + (s.reps || 0), 0);
    return sum / sets.length;
}

export default {
    obtenerDatosContextuales,
    getExerciseHistory,
    getRecentlyUsedExercises,
    detectPlateau
};