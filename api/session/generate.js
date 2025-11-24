import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, subHours } from 'date-fns';
import { es } from 'date-fns/locale';

// ----------------------------------------------------
// 1. HELPERS DE UTILIDAD
// ----------------------------------------------------

const setCORSHeaders = (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

const normalizeText = (text) => {
    if (!text) return "";
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};

const shuffleArray = (array) => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
};

// ----------------------------------------------------
// 2. LÓGICA DE SELECCIÓN DE EJERCICIOS (FILTROS)
// ----------------------------------------------------
// (No modificado, pero incluido por completitud)
const detectEnvironment = (equipmentList) => {
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('comercial') || eqString.includes('gym')) return 'gym';
    
    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        return i.includes('mancuerna') || i.includes('pesa') || i.includes('barra') || i.includes('disco') || i.includes('kettlebell');
    });

    if (!hasLoad) return 'bodyweight';
    return 'home_equipment'; 
};

const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises;

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipo || "sin equipo");
        
        if (reqEq === "sin equipo" || reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "general") return true;
        
        if (environment === 'bodyweight') return false;

        if (reqEq.includes("mini")) return userKeywords.some(k => k.includes("mini"));
        if (reqEq.includes("banda") || reqEq.includes("elastica")) return userKeywords.some(k => (k.includes("banda") || k.includes("liga")) && !k.includes("mini"));
        if (reqEq.includes("mancuerna")) return userKeywords.some(k => k.includes("mancuerna"));
        if (reqEq.includes("kettlebell")) return userKeywords.some(k => k.includes("kettlebell") || k.includes("rusa"));
        if (reqEq.includes("barra")) {
            if (reqEq.includes("dominada")) return userKeywords.some(k => k.includes("dominada") || k.includes("pull up"));
            return userKeywords.some(k => k.includes("barra de peso") || k.includes("discos"));
        }
        if (reqEq.includes("rodillo") || reqEq.includes("foam")) return userKeywords.some(k => k.includes("rodillo") || k.includes("foam"));

        return false;
    });
};

const selectUtilityExercises = (utilityPool, type, userEquipmentList, count = 2) => {
    const userKeywords = userEquipmentList.map(e => normalizeText(e));
    const targetType = normalizeText(type); 

    const candidates = utilityPool.filter(ex => {
        const exType = normalizeText(ex.tipo || "");
        if (!exType.includes(targetType)) return false;

        const exEq = normalizeText(ex.equipo || "peso corporal");
        if (exEq.includes("rodillo")) return userKeywords.some(k => k.includes("rodillo"));
        if (exEq.includes("banda")) return userKeywords.some(k => k.includes("mini") || k.includes("banda"));
        return true;
    });

    return shuffleArray(candidates).slice(0, count).map(ex => ({
        id: ex.id,
        name: ex.nombre,
        instructions: ex.descripcion,
        durationOrReps: targetType.includes('calenta') ? "60 seg" : "45 seg por lado",
        url: ex.url || null, 
        imageUrl: ex.imagen || null, 
        equipment: ex.equipo
    }));
};
// ----------------------------------------------------
// 3. LÓGICA DE SOBRECARGA PROGRESIVA Y TEMPLATES
// ----------------------------------------------------

/**
 * Calcula un modificador de RPE basado en el feedback de energía/dolor (1-5).
 * -2: Fatiga severa, forzar descarga.
 * -1: Fatiga moderada, bajar intensidad.
 * 0: OK.
 */
const getSessionRPEModifier = (feedback) => {
    const energyScore = feedback.energyLevel || 3;
    const sorenessScore = feedback.sorenessLevel || 3;
    
    // Regla 1: Fatiga Crítica (Ej: Energía 1 o 2 Y Dolor 4 o 5)
    if (energyScore <= 2 && sorenessScore >= 4) {
        return -2; 
    }
    // Regla 2: Fatiga Moderada (Ej: Energía baja O Dolor alto)
    if (energyScore === 3 && sorenessScore === 4) {
        return -1;
    }
    // Regla 3: Energía alta (Ej: Energía 5 y Dolor 1)
    if (energyScore === 5 && sorenessScore <= 2) {
        return 1;
    }

    return 0; // Por defecto
};


/**
 * Calcula las variables de entrenamiento basándose en el historial y el feedback en tiempo real.
 */
const calculateOverloadVariables = (
    exerciseId, 
    userHistoryMap, 
    defaultSets, 
    defaultReps, 
    profileData, 
    rpeModifier = 0 // MODIFICACIÓN CLAVE
) => {
    const isForcedRecovery = rpeModifier < 0; // Bandera para anular progresión

    // 1. ANULACIÓN POR RECUPERACIÓN FORZADA
    if (isForcedRecovery) {
        const targetRPE = Math.max(5, 8 + rpeModifier); // RPE 5 o 6
        return {
            sets: Math.max(2, defaultSets - 1), // Reducir un set
            targetReps: "15-20", // Alto rango de repeticiones para bombeo
            rpe: targetRPE,
            weightSuggestion: "Peso muy ligero (30% menos). Movilidad y Bombeo.",
            note: `¡ATENCIÓN! Sesión ajustada a RECUPERACIÓN FORZADA debido a tu baja energía/alto dolor (${rpeModifier}). Enfócate en la técnica.`
        };
    }
    
    // 2. Si no hay historial, devolvemos valores base (Calibración)
    if (!userHistoryMap || !userHistoryMap[exerciseId]) {
        return {
            sets: defaultSets,
            targetReps: defaultReps,
            rpe: 7,
            weightSuggestion: "Peso retador pero controlable",
            note: "Primera vez: Encuentra un peso con el que llegues a las reps indicadas con esfuerzo."
        };
    }

    // 3. Aplicamos lógica progresiva estándar
    const lastSession = userHistoryMap[exerciseId];
    const lastRpe = lastSession.rpe || 7;
    const lastWeight = lastSession.weightUsed || 0;
    const lastReps = lastSession.repsCompleted || defaultReps;
    
    const baseTargetRpe = 8 + rpeModifier; // Ajustamos el RPE objetivo con el modificador
    
    // ... Lógica de progresión (el resto es igual al código anterior, pero ahora usa la fatiga en tiempo real) ...

    // A. Escenario: Fue muy fácil (RPE < 7 y sin modificador) -> Aumentar Carga
    if (lastRpe < 7 && rpeModifier >= 0) {
        let newWeight = lastWeight;
        let weightNote = "Intenta subir el peso.";
        
        if (typeof lastWeight === 'number' && lastWeight > 0) {
            newWeight = Math.round(lastWeight * 1.05); 
            weightNote = `Sube a ${newWeight}kg si es posible.`;
        }

        return {
            sets: defaultSets,
            targetReps: defaultReps, 
            rpe: baseTargetRpe + 1, // Intentamos RPE más alto
            weightSuggestion: newWeight,
            note: `¡La última vez fue fácil! ${weightNote}. RPE objetivo ajustado por tu buen estado de ánimo hoy.`
        };
    }

    // B. Escenario: Fue muy difícil o Fallo Técnico (RPE > 9) -> Mantener o Descargar
    if (lastRpe > 9) {
        return {
            sets: defaultSets,
            targetReps: defaultReps,
            rpe: baseTargetRpe,
            weightSuggestion: lastWeight,
            note: "La última vez fue muy exigente. Mantén el peso y enfócate en mejorar la técnica."
        };
    }

    // C. Escenario: Equipo Limitado (No puedo subir peso) -> Subir Reps o Densidad
    const isHomeLimited = profileData.availableEquipment.some(e => e.includes('Limitado'));
    
    if (isHomeLimited && lastRpe < 8 && rpeModifier >= 0) {
         return {
            sets: defaultSets,
            targetReps: "Fallo - 1 (RIR 1)",
            rpe: baseTargetRpe + 1,
            weightSuggestion: lastWeight,
            note: "Si no puedes subir peso, haz las repeticiones más lentas (3 seg bajando) hasta casi el fallo."
        };
    }

    // D. Escenario: Progresión Estándar
    return {
        sets: defaultSets,
        targetReps: defaultReps,
        rpe: baseTargetRpe, // RPE objetivo base + Modificador de feedback
        weightSuggestion: lastWeight,
        note: `Intenta superar tus sensaciones de la vez pasada. RPE objetivo: ${baseTargetRpe}.`
    };
};
// (getSessionTemplate, detectEnvironment, etc. se mantienen igual)
const getSessionTemplate = (focus, goal) => {
    const f = normalizeText(focus);
    
    if (f.includes('pierna') || f.includes('cuadriceps') || f.includes('inferior')) {
        return [
            { type: 'Multiarticular', target: ['pierna', 'cuadriceps'], count: 1, role: 'main' },
            { type: 'Multiarticular', target: ['gluteo', 'isquios'], count: 1, role: 'secondary' },
            { type: 'Aislamiento', target: ['cuadriceps', 'pierna'], count: 1, role: 'accessory' },
            { type: 'Aislamiento', target: ['gemelos', 'pantorrilla'], count: 1, role: 'finisher' }
        ];
    }
    if (f.includes('torso') || f.includes('empuje') || f.includes('traccion') || f.includes('pecho')) {
        return [
            { type: 'Multiarticular', target: ['pecho', 'empuje'], count: 1, role: 'main' },
            { type: 'Multiarticular', target: ['espalda', 'traccion'], count: 1, role: 'main' },
            { type: 'Multiarticular', target: ['hombro'], count: 1, role: 'secondary' },
            { type: 'Aislamiento', target: ['brazo', 'biceps', 'triceps'], count: 1, role: 'finisher' }
        ];
    }
    return [
        { type: 'Multiarticular', target: ['pierna', 'cuadriceps'], count: 1, role: 'main' },
        { type: 'Multiarticular', target: ['empuje', 'pecho'], count: 1, role: 'main' },
        { type: 'Multiarticular', target: ['traccion', 'espalda'], count: 1, role: 'secondary' },
        { type: 'Aislamiento', target: ['core', 'abdominales'], count: 1, role: 'finisher' }
    ];
};

// ----------------------------------------------------
// 4. HANDLER PRINCIPAL
// ----------------------------------------------------

export default async function handler(req, res) {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token.' });

    let userId;
    try {
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        userId = decoded.uid;
    } catch (e) { return res.status(401).json({ error: 'Token inválido.' }); }

    try {
        // 1. Cargar Datos del Usuario y Mesociclo
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const { profileData, currentMesocycle } = userDoc.data();

        if (!currentMesocycle || !currentMesocycle.mesocyclePlan) {
            return res.status(400).json({ error: 'No hay un plan activo. Genera un mesociclo primero.' });
        }
        
        // 2. OBTENER FEEDBACK EN TIEMPO REAL (MODIFICACIÓN CLAVE)
        const realTimeFeedback = req.body.realTimeFeedback || {}; // { energyLevel: 1-5, sorenessLevel: 1-5 }
        const rpeModifier = getSessionRPEModifier(realTimeFeedback); // -2, -1, 0, 1

        // 3. Determinar Fecha y Sesión Objetivo (igual que antes)
        let todayDate = req.body.date ? parseISO(req.body.date) : subHours(new Date(), 6);
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        
        if (!targetMicrocycle) {
             return res.status(400).json({ error: "Mesociclo finalizado o fecha fuera de rango." });
        }

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        // Manejo de Día de Descanso
        if (!targetSession) {
             return res.status(200).json({ isRestDay: true, message: "Hoy es día de descanso según tu plan." });
        }

        // 4. LECTURA DE HISTORIAL (CRÍTICO PARA PERSONALIZACIÓN)
        const historySnapshot = await db.collection('users').doc(userId).collection('history')
            .orderBy('completedAt', 'desc')
            .limit(20)
            .get();
        
        const historyMap = {};
        if (!historySnapshot.empty) {
            historySnapshot.forEach(doc => {
                const sessionData = doc.data();
                if (sessionData.mainBlocks) {
                    sessionData.mainBlocks.forEach(block => {
                        block.exercises.forEach(ex => {
                            if (!historyMap[ex.id] && ex.feedback) {
                                historyMap[ex.id] = {
                                    weightUsed: ex.feedback.actualWeight || ex.weightSuggestion, 
                                    repsCompleted: ex.feedback.actualReps || null,
                                    rpe: ex.feedback.rpe || 7
                                };
                            }
                        });
                    });
                }
            });
        }

        // 5. Carga y Filtrado de Ejercicios
        const environment = detectEnvironment(profileData.availableEquipment);
        let collectionsToFetch = [db.collection('exercises_utility').get()];

        // ... (El resto de la carga y filtrado se mantiene igual) ...
        if (environment === 'gym') {
            collectionsToFetch.push(db.collection('exercises_gym_full').get());
        } else if (environment === 'bodyweight') {
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        } else {
            collectionsToFetch.push(db.collection('exercises_home_limited').get());
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        }
        
        const results = await Promise.all(collectionsToFetch);
        const utilityExercises = results[0].docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let allMainExercises = [];
        for (let i = 1; i < results.length; i++) {
            results[i].docs.forEach(doc => allMainExercises.push({ id: doc.id, ...doc.data() }));
        }
        const availableMain = filterExercisesByEquipment(allMainExercises, profileData.availableEquipment);

        // 6. Generar UTILITY (Calentamiento/Enfriamiento)
        const finalWarmup = selectUtilityExercises(utilityExercises, 'calentamiento', profileData.availableEquipment, 2);
        const finalCooldown = selectUtilityExercises(utilityExercises, 'estiramiento', profileData.availableEquipment, 2);

        // 7. Generar BLOQUE PRINCIPAL (Con Sobrecarga y Feedback en tiempo real)
        const template = getSessionTemplate(targetSession.sessionFocus, profileData.fitnessGoal);
        const mainExercisesSelected = [];

        template.forEach(slot => {
            const candidates = availableMain.filter(ex => {
                const exType = normalizeText(ex.tipo || "");
                const exTarget = normalizeText(ex.musculoObjetivo || "" + ex.parteCuerpo || "");
                const slotType = normalizeText(slot.type);
                const typeMatch = exType.includes(slotType); 
                const muscleMatch = slot.target.some(t => exTarget.includes(t));
                const alreadySelected = mainExercisesSelected.some(sel => sel.id === ex.id);
                return typeMatch && muscleMatch && !alreadySelected;
            });

            if (candidates.length > 0) {
                const selected = shuffleArray(candidates)[0];
                
                const baseSets = slot.role === 'main' ? 4 : 3;
                const baseReps = slot.role === 'main' ? "8-10" : "12-15";
                
                const overloadVars = calculateOverloadVariables(
                    selected.id,
                    historyMap,
                    baseSets,
                    baseReps,
                    profileData,
                    rpeModifier // PASAMOS EL MODIFICADOR DE FATIGA EN TIEMPO REAL
                );

                mainExercisesSelected.push({
                    id: selected.id,
                    name: selected.nombre || selected.name,
                    description: selected.descripcion,
                    url: selected.url || null, 
                    imageUrl: selected.imagen || null,
                    equipment: selected.equipo,
                    ...overloadVars
                });
            }
        });

        // 8. Ensamblar Respuesta Final
        const isForcedRecoverySession = rpeModifier < 0;

        const finalSession = {
            sessionGoal: isForcedRecoverySession ? `Recuperación Forzada - ${targetSession.sessionFocus}` : targetSession.sessionFocus,
            estimatedDurationMin: isForcedRecoverySession ? 45 : 60, // Sesión más corta si es recuperación
            warmup: { exercises: finalWarmup },
            mainBlocks: [
                {
                    blockType: 'station', 
                    restBetweenSetsSec: isForcedRecoverySession ? 60 : 90, // Menos descanso si es bombeo
                    exercises: mainExercisesSelected
                }
            ],
            cooldown: { exercises: finalCooldown },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                algorithm: `v4-heuristic-realtime-rpe-mod-${rpeModifier}` // Flag para debug
            },
            completed: false
        };

        // Guardar en Firestore para que el frontend la consuma
        await db.collection('users').doc(userId).update({ currentSession: finalSession });

        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("FATAL ERROR (Session Generate):", error);
        return res.status(500).json({ error: error.message });
    }
}