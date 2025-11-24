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
// (detectEnvironment y filterExercisesByEquipment se mantienen igual)
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


/**
 * Genera un calentamiento completo usando Utility y Bodyweight.
 */
const generateFullWarmup = (utilityPool, bodyweightPool, movilityPool, focus, isRecovery) => {
    const warmup = [];
    const normFocus = normalizeText(focus);
    
    // Regla 1: Si es recuperación forzada o programada, usamos solo ejercicios de Movilidad.
    if (isRecovery) {
        // Seleccionar 5 ejercicios de movilidad para recuperación activa
        const selectedMovility = shuffleArray(movilityPool).slice(0, 5); 
        return selectedMovility.map(ex => ({
            id: ex.id,
            name: ex.nombre || ex.name,
            instructions: ex.descripcion,
            durationOrReps: "60-90 seg por lado",
            imageUrl: ex.imagen || null, 
            equipment: ex.equipo,
            notes: "Movilidad terapéutica. Enfócate en la respiración y el rango de movimiento."
        }));
    }

    // Regla 2: Calentamiento para Sesión Normal (Utility + Activación Bodyweight)

    // A. Calentamiento General (Utility) - 3 ejercicios
    const utilityCandidates = utilityPool.filter(ex => normalizeText(ex.tipo || "").includes('calenta'));
    const selectedUtility = shuffleArray(utilityCandidates).slice(0, 3);
    
    selectedUtility.forEach(ex => {
        warmup.push({
            id: ex.id,
            name: ex.nombre || ex.name,
            instructions: ex.descripcion,
            durationOrReps: "45-60 seg",
            imageUrl: ex.imagen || null, 
            equipment: ex.equipo,
            notes: "Movilidad articular general."
        });
    });

    // B. Calentamiento Específico (Bodyweight - Baja Intensidad) - 2 ejercicios
    const specificCandidates = bodyweightPool.filter(ex => {
        const parteCuerpo = normalizeText(ex.parteCuerpo || "");
        const tipo = normalizeText(ex.tipo || "");
        
        // Debe ser de baja intensidad y relevante al foco
        const isLowIntensity = tipo.includes('general') || tipo.includes('asistida') || tipo.includes('basico');

        let isRelevantFocus = true;
        if (normFocus.includes('pierna') || normFocus.includes('inferior')) {
             isRelevantFocus = parteCuerpo.includes('pierna') || parteCuerpo.includes('gluteo');
        } else if (normFocus.includes('torso') || normFocus.includes('empuje') || normFocus.includes('traccion')) {
             isRelevantFocus = parteCuerpo.includes('pecho') || parteCuerpo.includes('espalda');
        }
        
        return isLowIntensity && isRelevantFocus && !parteCuerpo.includes('core');
    });

    const selectedSpecific = shuffleArray(specificCandidates).slice(0, 2);
    
    selectedSpecific.forEach(ex => {
        warmup.push({
            id: ex.id,
            name: ex.nombre || ex.name,
            instructions: ex.descripcion,
            durationOrReps: "10-15 reps",
            imageUrl: ex.imagen || null, 
            equipment: ex.equipo,
            notes: "Activación muscular específica del área de enfoque."
        });
    });

    // Aseguramos al menos 4-5 ejercicios en total
    return shuffleArray(warmup);
};


/**
 * Genera el bloque de Core.
 */
const generateCoreBlock = (bodyweightPool, rpeModifier, isRecovery) => {
    const coreCandidates = bodyweightPool.filter(ex => normalizeText(ex.parteCuerpo || "") === 'core');
    
    // Regla de exclusión: Si la fatiga es extrema o es recuperación programada, el Core es opcional o de menor volumen.
    if (coreCandidates.length === 0 || rpeModifier < -1) return [];

    // Seleccionar 2 ejercicios: 1 Anti-Extensión/Flexión y 1 Anti-Rotación/Lateral
    const antiExtension = coreCandidates.filter(ex => normalizeText(ex.nombre).includes('plancha') || normalizeText(ex.nombre).includes('abdominales')).slice(0, 1);
    const antiRotation = coreCandidates.filter(ex => normalizeText(ex.nombre).includes('giro') || normalizeText(ex.nombre).includes('rotacion') || normalizeText(ex.nombre).includes('leñador') || normalizeText(ex.nombre).includes('lateral')).slice(0, 1);
    
    let selectedCore = shuffleArray([...antiExtension, ...antiRotation]);
    
    // Si no encontramos los específicos, tomamos 2 random
    if (selectedCore.length < 2) {
        selectedCore = shuffleArray(coreCandidates).slice(0, 2);
    }
    
    const isHighFatigue = rpeModifier < 0 || isRecovery; // Si es recuperación programada, reducir volumen
    const baseSets = isHighFatigue ? 2 : 3;
    const baseReps = isHighFatigue ? "30 seg" : "45-60 seg";

    const coreExercises = selectedCore.map(ex => ({
        id: ex.id,
        name: ex.nombre || ex.name,
        instructions: ex.descripcion,
        durationOrReps: baseReps,
        imageUrl: ex.imagen || null,
        equipment: ex.equipo,
        sets: baseSets,
        targetReps: baseReps,
        rpe: isHighFatigue ? 6 : 8,
        notes: `Estabilidad de Core. Mantén la tensión durante ${baseReps}.`
    }));

    return [{
        blockType: 'station', 
        restBetweenSetsSec: 60,
        restBetweenExercisesSec: 10,
        exercises: coreExercises
    }];
};

/**
 * Genera la vuelta a la calma (enfriamiento) asegurando mínimo 5 estiramientos relevantes.
 */
const generateCooldown = (utilityPool, mainExercisesSelected) => {
    const workedMuscles = new Set();
    const muscleMap = new Map();
    
    mainExercisesSelected.forEach(ex => {
        // Usar musculoObjetivo para ser más granular. Ejemplo: 'Cuádriceps', 'Glúteo Mayor', 'Pectoral'
        const muscles = (ex.musculoObjetivo || ex.parteCuerpo || "").split(',').map(m => normalizeText(m).trim()).filter(m => m.length > 2);
        muscles.forEach(m => {
            workedMuscles.add(m);
            // Mapear músculo al ejercicio para referencia
            if (!muscleMap.has(m)) muscleMap.set(m, []);
            muscleMap.get(m).push(ex.name);
        });
    });

    const targetMuscles = Array.from(workedMuscles);
    const finalStretchList = [];
    
    // 1. Priorizar un estiramiento por cada músculo principal trabajado
    for (const muscle of targetMuscles) {
        const stretchCandidates = utilityPool.filter(ex => {
            const type = normalizeText(ex.tipo || "");
            const exMuscle = normalizeText(ex.musculoObjetivo || "");
            return type.includes('estiramiento') && exMuscle.includes(muscle);
        });
        
        if (stretchCandidates.length > 0) {
            // Tomar el primer candidato y asegurar que no se repita
            const selectedStretch = shuffleArray(stretchCandidates)[0];
            if (!finalStretchList.some(ex => ex.id === selectedStretch.id)) {
                finalStretchList.push(selectedStretch);
            }
        }
    }

    // 2. Si hay menos de 5 ejercicios, añadir estiramientos generales (cadera, hombros, espalda baja)
    if (finalStretchList.length < 5) {
        const generalAreas = ['cadera', 'espalda baja', 'hombro', 'general'];
        const generalCandidates = utilityPool.filter(ex => {
            const type = normalizeText(ex.tipo || "");
            const exMuscle = normalizeText(ex.musculoObjetivo || "");
            return type.includes('estiramiento') && generalAreas.some(area => exMuscle.includes(area));
        });
        
        const needed = 5 - finalStretchList.length;
        const additionalStretches = shuffleArray(generalCandidates).filter(ex => !finalStretchList.some(s => s.id === ex.id)).slice(0, needed);
        finalStretchList.push(...additionalStretches);
    }
    
    // Mapear al formato de salida
    return finalStretchList.slice(0, 5).map(ex => ({
        id: ex.id,
        name: ex.nombre || ex.name,
        instructions: ex.descripcion,
        durationOrReps: "30-45 seg por lado",
        imageUrl: ex.imagen || null, 
        equipment: ex.equipo,
        notes: "Estiramiento estático. Respira profundamente y relaja el músculo."
    }));
};

// (getSessionRPEModifier, calculateOverloadVariables, getSessionTemplate se mantienen igual)
// ----------------------------------------------------
// 3. LÓGICA DE SOBRECARGA PROGRESIVA Y TEMPLATES
// ----------------------------------------------------

const getSessionRPEModifier = (feedback) => {
    const energyScore = feedback.energyLevel || 3;
    const sorenessScore = feedback.sorenessLevel || 3;
    
    if (energyScore <= 2 && sorenessScore >= 4) { return -2; }
    if (energyScore <= 3 && sorenessScore === 4) { return -1; }
    if (energyScore === 5 && sorenessScore <= 2) { return 1; }

    return 0;
};

const calculateOverloadVariables = (
    exerciseId, 
    userHistoryMap, 
    defaultSets, 
    defaultReps, 
    profileData, 
    rpeModifier = 0 
) => {
    const isForcedRecovery = rpeModifier < 0;

    if (isForcedRecovery) {
        const targetRPE = Math.max(5, 8 + rpeModifier); 
        return {
            sets: Math.max(2, defaultSets - 1),
            targetReps: "15-20", 
            rpe: targetRPE,
            weightSuggestion: "Peso muy ligero (30% menos). Movilidad y Bombeo.",
            note: `¡ATENCIÓN! Sesión ajustada a RECUPERACIÓN FORZADA debido a tu baja energía/alto dolor. Enfócate en la técnica y el bombeo muscular.`
        };
    }
    
    if (!userHistoryMap || !userHistoryMap[exerciseId]) {
        return {
            sets: defaultSets,
            targetReps: defaultReps,
            rpe: 7 + rpeModifier,
            weightSuggestion: "Peso retador pero controlable",
            note: "Primera vez: Encuentra un peso con el que llegues a las reps indicadas con esfuerzo."
        };
    }

    const lastSession = userHistoryMap[exerciseId];
    const lastRpe = lastSession.rpe || 7;
    const lastWeight = lastSession.weightUsed || 0;
    
    const baseTargetRpe = 8 + rpeModifier; 
    
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
            rpe: baseTargetRpe + 1, 
            weightSuggestion: newWeight,
            note: `¡La última vez fue fácil! ${weightNote}. RPE objetivo ajustado por tu buen estado de ánimo hoy.`
        };
    }

    if (lastRpe > 9) {
        return {
            sets: defaultSets,
            targetReps: defaultReps,
            rpe: baseTargetRpe,
            weightSuggestion: lastWeight,
            note: "La última vez fue muy exigente. Mantén el peso y enfócate en mejorar la técnica."
        };
    }

    return {
        sets: defaultSets,
        targetReps: defaultReps,
        rpe: baseTargetRpe, 
        weightSuggestion: lastWeight,
        note: `Intenta superar tus sensaciones de la vez pasada. RPE objetivo: ${baseTargetRpe}.`
    };
};

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
        { type: 'Aislamiento', target: ['hombro', 'brazo'], count: 1, role: 'finisher' }
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
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const { profileData, currentMesocycle } = userDoc.data();

        if (!currentMesocycle || !currentMesocycle.mesocyclePlan) {
            return res.status(400).json({ error: 'No hay un plan activo. Genera un mesociclo primero.' });
        }
        
        // 2. OBTENER FEEDBACK Y ESTADO DE RECUPERACIÓN
        const realTimeFeedback = req.body.realTimeFeedback || {};
        const rpeModifier = getSessionRPEModifier(realTimeFeedback);
        const isForcedRecoverySession = rpeModifier < 0;

        let todayDate = req.body.date ? parseISO(req.body.date) : subHours(new Date(), 6);
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        
        if (!targetMicrocycle) {
             return res.status(400).json({ error: "Mesociclo finalizado o fecha fuera de rango." });
        }

        const dayName = format(todayDate, 'EEEE', { locale: es });
        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        // Manejo de Día de Descanso o Sesión de Recuperación Programada
        const isProgrammedRecovery = targetSession && normalizeText(targetSession.sessionFocus).includes('recuperacion');
        
        if (!targetSession || isProgrammedRecovery || isForcedRecoverySession) {
             if (!targetSession) {
                 // Crear una sesión temporal de recuperación si el día es de descanso
                 targetSession = { sessionFocus: "Descanso Activo / Movilidad" };
             }
             // Si es un día de recuperación (programada o forzada), saltamos la generación de bloques principales
             if (!isForcedRecoverySession) {
                 console.log("Sesión de recuperación o descanso activo programado.");
             }
        } else {
             if (!targetSession) {
                 return res.status(200).json({ isRestDay: true, message: "Hoy es día de descanso según tu plan." });
             }
        }

        // 4. LECTURA DE HISTORIAL (Inalterada)
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

        // 5. Carga y Filtrado de Ejercicios (Incluyendo la nueva colección 'exercises_movility')
        const environment = detectEnvironment(profileData.availableEquipment);
        
        let collectionsToFetch = [
            db.collection('exercises_utility').get(), 
            db.collection('exercises_bodyweight_pure').get(),
            db.collection('exercises_movility').get() // <--- Nueva Colección de Movilidad
        ];

        if (environment === 'gym') {
            collectionsToFetch.push(db.collection('exercises_gym_full').get());
        } else if (environment === 'home_limited') {
            collectionsToFetch.push(db.collection('exercises_home_limited').get());
        }
        
        const results = await Promise.all(collectionsToFetch);
        
        // Mapeo de resultados
        const utilityExercises = results[0].docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const bodyweightExercises = results[1].docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const movilityExercises = results[2].docs.map(doc => ({ id: doc.id, ...doc.data() }));

        let allMainExercises = [];
        for (let i = 3; i < results.length; i++) { // Las colecciones principales están a partir del índice 3
            results[i].docs.forEach(doc => allMainExercises.push({ id: doc.id, ...doc.data() }));
        }
        allMainExercises.push(...bodyweightExercises.filter(ex => normalizeText(ex.parteCuerpo || "") !== 'core'));

        const availableMain = filterExercisesByEquipment(allMainExercises, profileData.availableEquipment);

        // 6. Generar UTILITY, CORE y BLOQUE PRINCIPAL
        
        const isRecovery = isProgrammedRecovery || isForcedRecoverySession;

        // Warmup: Usar la nueva lógica avanzada con Movilidad.
        const finalWarmup = generateFullWarmup(
            utilityExercises, 
            bodyweightExercises, 
            movilityExercises, // Pasar la nueva colección
            targetSession.sessionFocus, 
            isRecovery
        );

        let mainExercisesSelected = [];
        let finalCoreBlocks = [];
        
        // Solo generar Main y Core si NO es una sesión de recuperación total
        if (!isRecovery) {
            const template = getSessionTemplate(targetSession.sessionFocus, profileData.fitnessGoal);
            
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
                        rpeModifier
                    );

                    mainExercisesSelected.push({
                        id: selected.id,
                        name: selected.nombre || selected.name,
                        description: selected.descripcion,
                        url: selected.url || null, 
                        imageUrl: selected.imagen || null,
                        equipment: selected.equipo,
                        musculoObjetivo: selected.musculoObjetivo, 
                        parteCuerpo: selected.parteCuerpo,
                        ...overloadVars
                    });
                }
            });

            // Generar Bloque de Core para sesiones de entrenamiento
            finalCoreBlocks = generateCoreBlock(bodyweightExercises, rpeModifier, false); 
        } else {
             // Generar Bloque de Core de bajo impacto para sesiones de recuperación (opcional)
             finalCoreBlocks = generateCoreBlock(bodyweightExercises, rpeModifier, true);
        }

        // Enfriamiento: Usar la lógica reforzada de Cooldown
        const finalCooldown = generateCooldown(utilityExercises, mainExercisesSelected);


        // 8. Ensamblar Respuesta Final
        const finalSession = {
            sessionGoal: isRecovery ? `Recuperación Adaptada - ${targetSession.sessionFocus}` : targetSession.sessionFocus,
            estimatedDurationMin: isRecovery ? 40 : 60,
            warmup: { exercises: finalWarmup },
            mainBlocks: mainExercisesSelected.length > 0 ? [
                {
                    blockType: 'station', 
                    restBetweenSetsSec: isForcedRecoverySession ? 45 : 90, 
                    exercises: mainExercisesSelected.map(ex => ({ 
                        ...ex,
                        note: ex.note
                    }))
                }
            ] : [], 
            coreBlocks: finalCoreBlocks,
            cooldown: { exercises: finalCooldown },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                algorithm: `v5.1-movility-cooldown-mod-${rpeModifier}` 
            },
            completed: false
        };

        // Guardar en Firestore
        await db.collection('users').doc(userId).update({ currentSession: finalSession });

        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("FATAL ERROR (Session Generate):", error);
        return res.status(500).json({ error: error.message });
    }
}