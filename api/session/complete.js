import { db, auth } from '../../lib/firebaseAdmin.js';
import admin from 'firebase-admin';

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

        // 2. Obtener datos del body
        // Se espera:
        // - sessionFeedback: { rpe, notes, energyLevel, sorenessLevel }
        // - mainBlock: Objeto con los ejercicios y sus series realizadas (reps, peso, RPE last set)
        // - totalReps: Número total de repeticiones realizadas en el bloque principal
        // - sessionEnvironment: 'home' | 'gym' (opcional)
        // - equipmentSnapshot: objeto describiendo equipo real disponible/usado en la sesión (opcional)
        const { sessionFeedback, mainBlock, totalReps, sessionEnvironment, equipmentSnapshot } = req.body; 

        if (!sessionFeedback || !mainBlock) {
            return res.status(400).json({ error: 'Faltan datos requeridos (sessionFeedback, mainBlock).' });
        }

        const totalRepsNum = typeof totalReps === 'number' ? totalReps : 0;

        // 3. Referencias a Firestore
        const userRef = db.collection('users').doc(userId);
        
        // Usamos una transacción para asegurar la integridad del array (FIFO 30) y contadores
        // Añadimos logs y comprobaciones para depuración
        const safeStringify = (obj) => {
            try { return JSON.stringify(obj); } catch (e) { return JSON.stringify(obj, (k,v)=> (typeof v==='function'? '[fn]': v)); }
        };

        console.log('[SessionComplete] mainBlock type:', Array.isArray(mainBlock) ? 'array' : typeof mainBlock);
        if (Array.isArray(mainBlock)) console.log('[SessionComplete] mainBlock length:', mainBlock.length);
        try { console.log('[SessionComplete] mainBlock sample:', safeStringify(mainBlock).slice(0, 300)); } catch (e) {}

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) throw new Error('Usuario no encontrado');

            const userData = userDoc.data();
            
            // a) Gestión del Historial Reciente (FIFO 30)
            let recentSessions = userData.recentSessions || [];

            // Validación de seguridad: Asegurar que es un array para evitar errores si hay datos corruptos
            if (!Array.isArray(recentSessions)) {
                console.warn('[SessionComplete] ALERTA: userData.recentSessions no es un array (posible corrupción o datos legacy). Resetting a []. Valor previo:', recentSessions);
                recentSessions = [];
            }
            
            // b) Snapshot de metadatos de la sesión actual
            const currentSessionMeta = userData.currentSession || {};

            // Normalizar mainBlock para almacenamiento: convertir 'performedSets' a 'performanceData.actualSets'
            function normalizeBlockStorage(block) {
                if (Array.isArray(block)) return block.map(b => normalizeBlockStorage(b));
                const out = JSON.parse(JSON.stringify(block));

                // Normalize nested structures
                if (out.bloques && Array.isArray(out.bloques)) {
                    out.bloques = out.bloques.map(b => normalizeBlockStorage(b));
                }
                if (out.estaciones && Array.isArray(out.estaciones)) {
                    out.estaciones = out.estaciones.map(b => normalizeBlockStorage(b));
                }
                // Exercises array
                if (out.ejercicios && Array.isArray(out.ejercicios)) {
                    out.ejercicios = out.ejercicios.map(e => {
                        const ee = { ...e };
                        if (ee.performedSets && !ee.performanceData) {
                            ee.performanceData = { actualSets: ee.performedSets };
                        }

                        // Si la prescripción está en modo "Exploratorio" y tenemos sets realizados con peso,
                        // inferimos un peso objetivo numérico para almacenar en recentSessions. Usamos el máximo peso
                        // detectado en las sets realizadas para mayor seguridad.
                        try {
                            const presc = ee.prescripcion || {};
                            // Buscar sets en múltiples ubicaciones posibles
                            const sets = ee.performanceData?.actualSets || ee.performedSets || [];

                            // Extraer pesos de forma más robusta
                            const pesos = sets.map(s => {
                                // Intentar múltiples campos
                                const weightValue = s.weight || s.peso || s.load || s.kg || 0;
                                // Convertir a número eliminando texto
                                const numericValue = parseFloat(String(weightValue).replace(/[^\d.]/g, ''));
                                return numericValue;
                            }).filter(p => !isNaN(p) && p > 0);

                            // Condiciones para inferir peso
                            const needsInference = 
                                presc.pesoSugerido === 'Exploratorio' || 
                                presc.pesoSugerido === 'Ajustar a RPE' || 
                                presc.pesoSugerido === undefined || 
                                presc.pesoSugerido === null ||
                                presc.esExploratorio === true;

                            if (needsInference && pesos.length > 0) {
                                // Usar promedio en lugar de máximo para mayor seguridad
                                const pesoPromedio = pesos.reduce((a, b) => a + b, 0) / pesos.length;
                                const pesoInferido = Number(pesoPromedio.toFixed(1));

                                ee.prescripcion = { 
                                    ...(ee.prescripcion || {}), 
                                    pesoSugerido: pesoInferido,
                                    pesoSugeridoStr: `${pesoInferido}kg`,
                                    esExploratorio: false,
                                    inferredFromPerformance: true // Flag para debugging
                                };
                                console.log(`[SessionComplete] ✅ Inferred peso for ${ee.id}: ${pesoInferido}kg (avg of ${pesos.length} sets)`);
                            } else if (typeof presc.pesoSugerido === 'number') {
                                console.log(`[SessionComplete] ℹ️ Exercise ${ee.id} already has numeric peso: ${presc.pesoSugerido}kg`);
                            } else {
                                console.log(`[SessionComplete] ⚠️ Exercise ${ee.id}: No peso could be inferred (sets: ${sets.length}, pesos found: ${pesos.length})`);
                            }
                        } catch (e) {
                            console.error('[SessionComplete] Error inferring peso:', e.message || e);
                        }

                        return ee;
                    });
                }
                return out;
            }

            const normalizedMainBlock = normalizeBlockStorage(mainBlock);

            const newSessionEntry = {
                completedAt: new Date().toISOString(),
                feedback: sessionFeedback,
                mainBlock: normalizedMainBlock,
                // Información sobre equipo real y ambiente (propuesto por frontend)
                sessionEnvironment: sessionEnvironment || currentSessionMeta.location || null,
                equipmentSnapshot: equipmentSnapshot || null,
                // Metadatos para consistencia y métricas
                mesocycleId: currentSessionMeta.mesocycleId,
                microcycleIndex: currentSessionMeta.microcycleIndex,
                sessionIndex: currentSessionMeta.sessionIndex,
                sessionFocus: currentSessionMeta.sessionFocus,
                weekNumber: currentSessionMeta.weekNumber
            };

            console.log('[SessionComplete] newSessionEntry preview:', safeStringify(newSessionEntry).slice(0, 300));
            console.log('[SessionComplete] Estado previo recentSessions length:', recentSessions.length);

            // Insertar al inicio (índice 0)
            recentSessions.unshift(newSessionEntry);

            // Limitar a 30 elementos (eliminar la más antigua)
            if (recentSessions.length > 30) {
                recentSessions = recentSessions.slice(0, 30);
            }

            // b) Actualización de Contadores y Current Session
            let currentSessionUpdate = {};
            if (userData.currentSession) {
                currentSessionUpdate = { 
                    ...userData.currentSession, 
                    completed: true,
                    completedAt: newSessionEntry.completedAt 
                };
            }

            // d) Metadata adicional para progresión futura
            // El sistema de progresión usa recentSessions para calcular cargas
            // Aquí solo guardamos metadatos útiles para análisis
            try {
                if (sessionFeedback && typeof sessionFeedback.rpe === 'number') {
                    const rpeFeedback = sessionFeedback.rpe;

                    // Recolectar ejercicios realizados en el bloque normalizado
                    const collected = [];
                    (function collect(block) {
                        if (Array.isArray(block)) return block.forEach(collect);
                        if (block && block.bloques && Array.isArray(block.bloques)) return block.bloques.forEach(collect);
                        if (block && block.ejercicios && Array.isArray(block.ejercicios)) {
                            block.ejercicios.forEach(e => collected.push(e));
                        }
                    })(normalizedMainBlock);

                    // Agregar análisis de rendimiento a la entrada de historial
                    const performanceAnalysis = [];
                    for (const ee of collected) {
                        const presc = ee.prescripcion || {};
                        const actualSets = ee.performanceData?.actualSets || ee.performedSets || [];
                        
                        if (actualSets.length > 0) {
                            const rirPromedio = actualSets.reduce((sum, s) => sum + (s.rir || 2), 0) / actualSets.length;
                            const rirObjetivo = presc.rirObjetivo || 2;
                            const wasEasier = rirPromedio < rirObjetivo - 0.5;
                            
                            performanceAnalysis.push({
                                exerciseId: ee.id,
                                rirAvg: rirPromedio,
                                rirTarget: rirObjetivo,
                                wasEasierThanExpected: wasEasier,
                                readyForProgression: wasEasier
                            });
                        }
                    }
                    
                    if (performanceAnalysis.length > 0) {
                        newSessionEntry.performanceAnalysis = performanceAnalysis;
                    }
                }
            } catch (e) {
                console.warn('[SessionComplete] Error while analyzing performance', e && e.message);
            }

            // c) Ejecutar actualizaciones
            const updateObj = {
                recentSessions: recentSessions, // Array actualizado FIFO
                currentSession: currentSessionUpdate,
                lastWorkoutDate: newSessionEntry.completedAt,
                
                // reps_counter: suma total de repeticiones
                reps_counter: admin.firestore.FieldValue.increment(totalRepsNum),
                
                // sesiones_counter: suma 1 sesión
                sesiones_counter: admin.firestore.FieldValue.increment(1)
            };

            transaction.update(userRef, updateObj);
        });

        return res.status(200).json({ 
            success: true, 
            message: 'Sesión completada y registrada exitosamente.' 
        });

    } catch (error) {
        console.error('Error completando sesión:', error);
        return res.status(500).json({ error: error.message });
    }
}