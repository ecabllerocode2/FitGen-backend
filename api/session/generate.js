import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, subHours } from 'date-fns';
import { es } from 'date-fns/locale';
import { v4 as uuidv4 } from 'uuid'; // Para asegurar IDs únicos si fuera necesario

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
const generateFullWarmup = (utilityPool, bodyweightPool, focus, userEquipmentList, isRecovery) => {
    const warmup = [];
    const normFocus = normalizeText(focus);

    // Regla 1: Si es recuperación forzada, solo movilidad de bajo impacto/estiramiento
    if (isRecovery) {
        // En un día de recuperación forzada, damos 5 ejercicios de estiramiento suave.
        return generateCooldown(utilityPool, [], userEquipmentList); 
    }

    // A. Calentamiento General (Utility)
    // 3 ejercicios de Utility (general, banda, foam roller)
    const utilityCandidates = utilityPool.filter(ex => {
        const type = normalizeText(ex.tipo || "");
        return type.includes('calenta');
    });
    const selectedUtility = shuffleArray(utilityCandidates).slice(0, 3);
    
    selectedUtility.forEach(ex => {
        warmup.push({
            id: ex.id,
            name: ex.nombre,
            instructions: ex.descripcion,
            durationOrReps: "45-60 seg",
            imageUrl: ex.imagen || null, 
            equipment: ex.equipo,
            notes: "Movilidad articular general. Realiza controladamente."
        });
    });

    // B. Calentamiento Específico (Bodyweight - Baja Intensidad)
    // 2 ejercicios de Bodyweight que simulen el movimiento principal.
    const specificCandidates = bodyweightPool.filter(ex => {
        const parteCuerpo = normalizeText(ex.parteCuerpo || "");
        const tipo = normalizeText(ex.tipo || "");
        
        // Filtramos por Bodyweight, Baja Intensidad y relevante al foco
        const isLowIntensity = tipo.includes('general') || tipo.includes('asistida');

        let isRelevantFocus = true;
        if (normFocus.includes('pierna') || normFocus.includes('inferior')) {
             isRelevantFocus = parteCuerpo.includes('pierna') || parteCuerpo.includes('gluteo') || parteCuerpo.includes('cuadriceps');
        } else if (normFocus.includes('torso') || normFocus.includes('empuje') || normFocus.includes('traccion')) {
             isRelevantFocus = parteCuerpo.includes('pecho') || parteCuerpo.includes('espalda') || parteCuerpo.includes('hombro');
        }
        
        return isLowIntensity && isRelevantFocus && !parteCuerpo.includes('core');
    });

    const selectedSpecific = shuffleArray(specificCandidates).slice(0, 2);
    
    selectedSpecific.forEach(ex => {
        warmup.push({
            id: ex.id,
            name: ex.nombre,
            instructions: ex.descripcion,
            durationOrReps: "10-15 reps",
            imageUrl: ex.imagen || null, 
            equipment: ex.equipo,
            notes: "Activación del grupo muscular principal sin carga."
        });
    });

    return shuffleArray(warmup);
};


/**
 * Genera el bloque de Core.
 */
const generateCoreBlock = (bodyweightPool, rpeModifier) => {
    const coreCandidates = bodyweightPool.filter(ex => normalizeText(ex.parteCuerpo || "") === 'core');
    
    // Regla de exclusión: Si la fatiga es extrema, no hay core.
    if (coreCandidates.length === 0 || rpeModifier < -1) return [];

    // Seleccionar 2 ejercicios: 1 Anti-Extensión/Flexión (ej. Plancha) y 1 Anti-Rotación/Lateral (ej. Levantamiento Lateral de Pierna)
    const antiExtension = coreCandidates.filter(ex => normalizeText(ex.nombre).includes('plancha') || normalizeText(ex.nombre).includes('abdominales')).slice(0, 1);
    const antiRotation = coreCandidates.filter(ex => normalizeText(ex.nombre).includes('giro') || normalizeText(ex.nombre).includes('rotacion') || normalizeText(ex.nombre).includes('leñador') || normalizeText(ex.nombre).includes('lateral')).slice(0, 1);
    
    let selectedCore = shuffleArray([...antiExtension, ...antiRotation]);
    
    // Si no encontramos los específicos, tomamos 2 random
    if (selectedCore.length < 2) {
        selectedCore = shuffleArray(coreCandidates).slice(0, 2);
    }
    
    const isHighFatigue = rpeModifier < 0; // Usar la fatiga para ajustar el volumen/RPE
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
        notes: `Estabilidad de Core. Mantén la máxima tensión. ${isHighFatigue ? 'Reducir el tiempo si es necesario.' : ''}`
    }));

    // Se devuelve como un array de Blocks
    return [{
        blockType: 'station', 
        restBetweenSetsSec: 60,
        restBetweenExercisesSec: 10,
        exercises: coreExercises
    }];
};

/**
 * Genera la vuelta a la calma (enfriamiento) con estiramientos estáticos de músculos principales.
 */
const generateCooldown = (utilityPool, mainExercisesSelected) => {
    // Identificar los grupos musculares principales trabajados
    const workedMuscles = new Set();
    mainExercisesSelected.forEach(ex => {
        // Los ejercicios principales tienen la propiedad musculoObjetivo o parteCuerpo
        const muscle = normalizeText(ex.musculoObjetivo || ex.parteCuerpo || "");
        if (muscle) {
            workedMuscles.add(muscle.split(',')[0].trim());
        }
    });

    const targetMuscles = Array.from(workedMuscles);
    
    // 1. Estiramientos de Músculos Trabajados (4-5 ejercicios)
    const stretchCandidates = utilityPool.filter(ex => {
        const type = normalizeText(ex.tipo || "");
        const muscle = normalizeText(ex.musculoObjetivo || "");
        
        if (!type.includes('estiramiento')) return false;
        
        // Priorizar estiramientos estáticos de los músculos trabajados o de zonas clave (cadera, pecho)
        return targetMuscles.some(t => muscle.includes(t)) || muscle.includes('cadera') || muscle.includes('pecho');
    });

    // 2. Estiramiento General Adicional (1-2 ejercicios)
    const generalStretch = utilityPool.filter(ex => normalizeText(ex.tipo || "").includes('estiramiento') && !normalizeText(ex.musculoObjetivo || "")).slice(0, 1);
    
    const finalCandidates = shuffleArray([...stretchCandidates, ...generalStretch]);
    
    return finalCandidates.slice(0, 5).map(ex => ({
        id: ex.id,
        name: ex.nombre,
        instructions: ex.descripcion,
        durationOrReps: "30-45 seg por lado",
        imageUrl: ex.imagen || null, 
        equipment: ex.equipo,
        notes: "Estiramiento estático. Respira profundamente y relaja el músculo."
    }));
};

// ----------------------------------------------------
// 3. LÓGICA DE SOBRECARGA PROGRESIVA Y TEMPLATES
// ----------------------------------------------------

const getSessionRPEModifier = (feedback) => {
    const energyScore = feedback.energyLevel || 3;
    const sorenessScore = feedback.sorenessLevel || 3;
    
    if (energyScore <= 2 && sorenessScore >= 4) { return -2; } // Fatiga Crítica
    if (energyScore <= 3 && sorenessScore === 4) { return -1; } // Fatiga Moderada
    if (energyScore === 5 && sorenessScore <= 2) { return 1; } // Estado Óptimo

    return 0; // Por defecto
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

    // 1. ANULACIÓN POR RECUPERACIÓN FORZADA
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
    
    // 2. Si no hay historial o progresión estándar
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
    
    // ... (El resto de la lógica de progresión se mantiene) ...

    // A. Escenario: Fue muy fácil -> Aumentar Carga o RPE
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

    // C. Escenario: Progresión Estándar
    return {
        sets: defaultSets,
        targetReps: defaultReps,
        rpe: baseTargetRpe, 
        weightSuggestion: lastWeight,
        note: `Intenta superar tus sensaciones de la vez pasada. RPE objetivo: ${baseTargetRPE}.`
    };
};

const getSessionTemplate = (focus, goal) => {
    const f = normalizeText(focus);
    
    // Más énfasis en ejercicios multiarticulares por bloque
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
    // Full Body / Default
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
        // 1. Cargar Datos del Usuario y Mesociclo
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const { profileData, currentMesocycle } = userDoc.data();

        if (!currentMesocycle || !currentMesocycle.mesocyclePlan) {
            return res.status(400).json({ error: 'No hay un plan activo. Genera un mesociclo primero.' });
        }
        
        // 2. OBTENER FEEDBACK EN TIEMPO REAL
        const realTimeFeedback = req.body.realTimeFeedback || {};
        const rpeModifier = getSessionRPEModifier(realTimeFeedback); // -2, -1, 0, 1
        const isForcedRecoverySession = rpeModifier < 0;

        // 3. Determinar Fecha y Sesión Objetivo
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

        // Manejo de Día de Descanso (Si no hay sesión programada Y no se forzó recuperación activa)
        if (!targetSession && !req.body.isRecovery) {
             return res.status(200).json({ isRestDay: true, message: "Hoy es día de descanso según tu plan." });
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

        // 5. Carga y Filtrado de Ejercicios (CONSOLIDADO PARA CORE Y WARMUP)
        const environment = detectEnvironment(profileData.availableEquipment);
        
        // Cargamos Utility y Bodyweight siempre, sin importar el ambiente.
        let collectionsToFetch = [
            db.collection('exercises_utility').get(), 
            db.collection('exercises_bodyweight_pure').get() 
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
        
        let allMainExercises = [];
        for (let i = 2; i < results.length; i++) {
            results[i].docs.forEach(doc => allMainExercises.push({ id: doc.id, ...doc.data() }));
        }
        // Incluir ejercicios de Bodyweight que NO sean Core en el pool principal
        allMainExercises.push(...bodyweightExercises.filter(ex => normalizeText(ex.parteCuerpo || "") !== 'core'));

        const availableMain = filterExercisesByEquipment(allMainExercises, profileData.availableEquipment);

        // 6. Generar UTILITY, CORE y BLOQUE PRINCIPAL
        
        // Warmup: Usar la nueva lógica avanzada.
        const finalWarmup = generateFullWarmup(
            utilityExercises, 
            bodyweightExercises, 
            targetSession?.sessionFocus || 'Recuperación', // Usar 'Recuperación' si no hay sesión programada
            profileData.availableEquipment, 
            isForcedRecoverySession || req.body.isRecovery // Bandera de recuperación forzada o voluntaria
        );

        // Bloque Principal
        const template = getSessionTemplate(targetSession?.sessionFocus || 'Full Body', profileData.fitnessGoal);
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
                    rpeModifier
                );

                mainExercisesSelected.push({
                    id: selected.id,
                    name: selected.nombre || selected.name,
                    description: selected.descripcion,
                    url: selected.url || null, 
                    imageUrl: selected.imagen || null,
                    equipment: selected.equipo,
                    musculoObjetivo: selected.musculoObjetivo, // Para el cooldown
                    parteCuerpo: selected.parteCuerpo,
                    ...overloadVars
                });
            }
        });
        
        // Generar Bloque de Core
        const finalCoreBlocks = generateCoreBlock(bodyweightExercises, rpeModifier);
        
        // Enfriamiento: Usar la nueva lógica de Cooldown
        const finalCooldown = generateCooldown(utilityExercises, mainExercisesSelected);


        // 8. Ensamblar Respuesta Final
        const finalSession = {
            sessionGoal: isForcedRecoverySession ? `Recuperación Adaptada - ${targetSession?.sessionFocus || 'Movilidad'}` : targetSession?.sessionFocus || 'Sesión Full Body',
            estimatedDurationMin: isForcedRecoverySession ? 40 : 60,
            warmup: { exercises: finalWarmup },
            mainBlocks: mainExercisesSelected.length > 0 ? [
                {
                    blockType: 'station', 
                    restBetweenSetsSec: isForcedRecoverySession ? 45 : 90, 
                    exercises: mainExercisesSelected.map(ex => ({ // Asegurar que la nota de fatiga esté en el ejercicio
                        ...ex,
                        note: ex.note // Usamos la nota generada por calculateOverloadVariables
                    }))
                }
            ] : [], // Si no se seleccionaron ejercicios principales (por ser día de recuperación extrema)
            coreBlocks: finalCoreBlocks, // <--- AÑADIDO BLOQUE DE CORE
            cooldown: { exercises: finalCooldown },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                algorithm: `v5-heuristic-full-template-core-mod-${rpeModifier}` 
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