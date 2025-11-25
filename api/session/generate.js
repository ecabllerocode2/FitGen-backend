import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, startOfDay, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

// ====================================================================
// 1. HELPERS DE UTILIDAD
// ====================================================================

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

// ====================================================================
// 2. LÓGICA CIENTÍFICA DE SELECCIÓN (FILTROS)
// ====================================================================

const detectEnvironment = (equipmentList) => {
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('comercial') || eqString.includes('gym')) return 'gym';
    
    // Detección basada en tus palabras clave de exercises_home_limited
    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        return i.includes('mancuerna') || i.includes('pesa') || i.includes('barra') || i.includes('disco') || i.includes('kettlebell') || i.includes('banda');
    });

    if (!hasLoad) return 'bodyweight';
    return 'home_equipment'; 
};

// Filtra ejercicios por equipo disponible
const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises;

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipo || "peso corporal");
        
        // Peso corporal siempre permitido (exercises_bodyweight_pure usa "Peso Corporal")
        if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;
        
        if (environment === 'bodyweight') return false;

        // Validaciones contra exercises_home_limited
        if (reqEq.includes("mancuerna")) return userKeywords.some(k => k.includes("mancuerna"));
        if (reqEq.includes("kettlebell")) return userKeywords.some(k => k.includes("kettlebell") || k.includes("rusa"));
        if (reqEq.includes("banda") || reqEq.includes("liga")) return userKeywords.some(k => k.includes("banda") || k.includes("liga"));
        if (reqEq.includes("barra")) return userKeywords.some(k => k.includes("barra"));
        if (reqEq.includes("foam") || reqEq.includes("rodillo")) return userKeywords.some(k => k.includes("rodillo") || k.includes("foam"));

        return false;
    });
};

// NUEVO: Filtra ejercicios por Nivel del Usuario para evitar lesiones
// Si el usuario es Principiante, eliminamos "Avanzado".
// Si es Intermedio, aceptamos Principiante e Intermedio.
const filterExercisesByLevel = (exercises, userLevel) => {
    const level = normalizeText(userLevel || "principiante");
    
    return exercises.filter(ex => {
        const exLevel = normalizeText(ex.nivel || "principiante");
        
        if (level === 'principiante') {
            return exLevel === 'principiante';
        }
        if (level === 'intermedio') {
            return exLevel !== 'avanzado';
        }
        // Avanzado recibe todo
        return true; 
    });
};

// ====================================================================
// 3. MOTORES DE GENERACIÓN (WARMUP, MAIN, COOL)
// ====================================================================

/**
 * Protocolo RAMP usando exercises_utility y exercises_bodyweight_pure
 */
const generateScientificWarmup = (utilityPool, bodyweightPool, sessionFocus) => {
    const focus = normalizeText(sessionFocus);
    let targetArea = [];
    
    // Mapeo de áreas basado en tus datos
    if (focus.includes('full') || focus.includes('cuerpo')) {
        targetArea = ['general', 'hombro', 'cadera', 'espalda', 'pecho', 'pierna'];
    } else if (focus.includes('pierna') || focus.includes('inferior')) {
        targetArea = ['cadera', 'tobillo', 'rodilla', 'gluteo', 'isquios', 'cuadriceps', 'pierna'];
    } else if (focus.includes('torso') || focus.includes('superior') || focus.includes('pecho') || focus.includes('espalda')) {
        targetArea = ['hombro', 'toracica', 'pecho', 'espalda', 'muñeca'];
    } else {
        targetArea = ['general'];
    }

    const warmupSequence = [];

    // 1. PULSE RAISER & MOBILITY (Desde exercises_utility)
    // Buscamos ejercicios de tipo "Calentamiento" que coincidan con el área
    const mobilityCandidates = utilityPool.filter(ex => {
        const type = normalizeText(ex.tipo || "");
        const part = normalizeText(ex.parteCuerpo || "");
        const name = normalizeText(ex.nombre || "");
        
        // Priorizar tipo "Calentamiento" (ej. Jumping Jacks, Rodar Foam Roller)
        if (!type.includes('calentamiento')) return false;

        const matchesArea = targetArea.some(area => part.includes(area) || name.includes(area) || part === 'general');
        return matchesArea;
    });

    const selectedMobility = shuffleArray(mobilityCandidates).slice(0, 3);
    selectedMobility.forEach(ex => {
        warmupSequence.push({
            id: ex.id,
            name: ex.nombre,
            instructions: ex.descripcion,
            durationOrReps: "60 seg / 15 reps",
            type: "Movilidad/Activación",
            imageUrl: ex.url || null,
            equipment: ex.equipo
        });
    });

    // 2. ACTIVACIÓN ESPECÍFICA (Desde exercises_bodyweight_pure)
    // Buscamos ejercicios de bajo impacto para pre-activar (ej. Escapulares, Glute Bridge)
    const activationCandidates = bodyweightPool.filter(ex => {
        const part = normalizeText(ex.parteCuerpo || "");
        const musc = normalizeText(ex.musculoObjetivo || "");
        const level = normalizeText(ex.nivel || "");
        
        if (part === 'core') return false; // Core va después
        if (level === 'avanzado') return false; // Solo activación fácil

        return targetArea.some(area => part.includes(area) || musc.includes(area));
    });

    const selectedActivation = shuffleArray(activationCandidates).slice(0, 2);
    selectedActivation.forEach(ex => {
        warmupSequence.push({
            id: ex.id,
            name: ex.nombre, // Normalizando a 'nombre' como en tus JSON
            instructions: ex.descripcion,
            durationOrReps: "12-15 reps (Lento)",
            type: "Potenciación",
            notes: "Concéntrate en sentir el músculo, no en fatigarlo.",
            imageUrl: ex.url || null,
            equipment: "Peso Corporal"
        });
    });

    return warmupSequence;
};

/**
 * Generador del Bloque Principal (Logic v3)
 */
const generateMainBlock = (availableExercises, sessionFocus, rpeModifier) => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;

    // Patrones de movimiento basados en exercises_home_limited
    if (focus.includes('full') || focus.includes('cuerpo')) {
        isCircuit = true;
        template = [
            { pattern: ['pierna', 'cuadriceps'], type: 'Multiarticular', role: 'main' }, // ej. Sentadilla Goblet
            { pattern: ['empuje', 'pecho', 'hombro'], type: 'Multiarticular', role: 'main' }, // ej. Press Militar
            { pattern: ['gluteo', 'isquios', 'cadera'], type: 'Multiarticular', role: 'main' }, // ej. Peso Muerto Rumano
            { pattern: ['traccion', 'espalda'], type: 'Multiarticular', role: 'main' }, // ej. Remo con Barra
            { pattern: ['brazo', 'biceps', 'triceps', 'hombro'], type: 'Aislamiento', role: 'accessory' } 
        ];
    } else if (focus.includes('torso') || focus.includes('superior')) {
        template = [
            { pattern: ['pecho', 'empuje'], type: 'Multiarticular', role: 'main' }, 
            { pattern: ['espalda', 'traccion'], type: 'Multiarticular', role: 'main' },
            { pattern: ['hombro', 'pecho'], type: 'Multiarticular', role: 'secondary' },
            { pattern: ['espalda', 'traccion'], type: 'Aislamiento', role: 'secondary' }, // ej. Vuelos Inversos
            { pattern: ['triceps', 'biceps'], type: 'Aislamiento', role: 'finisher' }, 
            { pattern: ['biceps', 'triceps'], type: 'Aislamiento', role: 'finisher' } 
        ];
    } else if (focus.includes('pierna') || focus.includes('inferior')) {
        template = [
            { pattern: ['cuadriceps', 'pierna'], type: 'Multiarticular', role: 'main' }, // ej. Zancadas
            { pattern: ['isquios', 'gluteo'], type: 'Multiarticular', role: 'main' }, // ej. RDL
            { pattern: ['pierna', 'cuadriceps'], type: 'Aislamiento', role: 'secondary' }, 
            { pattern: ['gluteo', 'cadera'], type: 'Aislamiento', role: 'secondary' }, // ej. Hip Thrust
            { pattern: ['gemelos', 'pantorrilla'], type: 'Aislamiento', role: 'finisher' } // ej. Elevación talones
        ];
    } else {
        // Fallback genérico
        template = [
            { pattern: [focus], type: 'Multiarticular', role: 'main' },
            { pattern: [focus], type: 'Multiarticular', role: 'secondary' },
            { pattern: [focus], type: 'Aislamiento', role: 'finisher' }
        ];
    }

    const selectedExercises = [];
    const usedIds = new Set();

    template.forEach(slot => {
        const candidates = availableExercises.filter(ex => {
            if (usedIds.has(ex.id)) return false;

            const exType = normalizeText(ex.tipo || "");
            const exBodyPart = normalizeText(ex.parteCuerpo || "");
            const exMuscle = normalizeText(ex.musculoObjetivo || ""); // Clave: usar musculoObjetivo de tus JSONs
            const combinedTargets = exBodyPart + " " + exMuscle;

            const typeMatch = slot.type === 'Any' ? true : exType.includes(normalizeText(slot.type));
            const muscleMatch = slot.pattern.some(p => combinedTargets.includes(p));

            return typeMatch && muscleMatch;
        });

        if (candidates.length > 0) {
            const pick = shuffleArray(candidates)[0];
            usedIds.add(pick.id);

            let sets = 3;
            let reps = "10-12";
            let rpe = 7 + rpeModifier;

            if (slot.role === 'main') {
                sets = 4;
                reps = "8-10"; 
                rpe = 8 + rpeModifier;
            } else if (slot.role === 'finisher') {
                sets = 2;
                reps = "15-20"; 
                rpe = 9 + rpeModifier;
            }

            if (rpeModifier < 0) {
                sets = Math.max(2, sets - 1);
                rpe = Math.max(5, rpe - 2);
            }

            selectedExercises.push({
                id: pick.id,
                name: pick.nombre, // Usando 'nombre' del JSON
                instructions: pick.descripcion,
                imageUrl: pick.url || null,
                equipment: pick.equipo,
                sets: sets,
                targetReps: reps,
                rpe: rpe,
                notes: slot.role === 'main' ? "Mantén la técnica estricta. Carga pesada." : "Controla la fase negativa.",
                musculoObjetivo: pick.musculoObjetivo || pick.parteCuerpo 
            });
        }
    });

    return {
        type: isCircuit ? 'circuit' : 'station',
        exercises: selectedExercises
    };
};

// ----------------------------------------------------
// HANDLER PRINCIPAL
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

        if (!currentMesocycle) return res.status(400).json({ error: 'No hay plan activo.' });

        // --- CONTEXTO ---
        let todayDate = new Date();
        if (req.body.date) {
            const parsed = parseISO(req.body.date);
            if (isValid(parsed)) todayDate = parsed;
        }
        
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: "Plan finalizado." });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) targetSession = { sessionFocus: "Descanso / Recuperación" };

        const realTimeFeedback = req.body.realTimeFeedback || {};
        const rpeModifier = req.body.isRecovery ? -2 : 0; 
        const isRecovery = req.body.isRecovery || normalizeText(targetSession.sessionFocus).includes('recuperacion');
        const userLevel = profileData.fitnessLevel || "Principiante"; // Asegurar dato

        // --- CARGA DE EJERCICIOS (SOLO LO QUE EXISTE) ---
        // Eliminada la llamada a 'exercises_movility'
        const promises = [
            db.collection('exercises_utility').get(),        // [0]
            db.collection('exercises_bodyweight_pure').get() // [1]
        ];

        const environment = detectEnvironment(profileData.availableEquipment || []);
        if (environment === 'gym') {
            promises.push(db.collection('exercises_gym_full').get());
        } else {
            promises.push(db.collection('exercises_home_limited').get());
        }

        const results = await Promise.all(promises);

        const utilityEx = results[0].docs.map(d => ({ id: d.id, ...d.data() }));
        const bodyweightEx = results[1].docs.map(d => ({ id: d.id, ...d.data() }));
        const mainExPoolRaw = results[2].docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Unir pools para selección principal
        // Nota: Bodyweight Pure siempre es útil
        let fullMainPool = [...mainExPoolRaw, ...bodyweightEx.filter(e => normalizeText(e.parteCuerpo) !== 'core')];
        
        // FILTRO 1: EQUIPO
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        
        // FILTRO 2: NIVEL (Nuevo)
        fullMainPool = filterExercisesByLevel(fullMainPool, userLevel);
        const bodyweightFiltered = filterExercisesByLevel(bodyweightEx, userLevel);

        // --- CONSTRUCCIÓN ---
        let finalWarmup = [];
        let mainBlockData = { exercises: [], type: 'station' };
        let finalCore = [];
        let finalCooldown = [];

        if (isRecovery) {
            // RECUPERACIÓN: Usamos exercises_utility (Estiramientos/Movilidad)
            
            // Warmup suave
            finalWarmup = utilityEx.filter(e => normalizeText(e.tipo).includes('calentamiento')).slice(0, 2).map(ex => ({
                ...ex, durationOrReps: "1 min suave", instructions: ex.descripcion
            }));

            // Flujo principal de movilidad (Estiramientos dinámicos/estáticos)
            const mobilityFlow = shuffleArray(utilityEx.filter(e => normalizeText(e.tipo).includes('estiramiento'))).slice(0, 6);
            
            mainBlockData = {
                type: 'circuit',
                exercises: mobilityFlow.map(ex => ({
                    id: ex.id,
                    name: ex.nombre,
                    instructions: ex.descripcion,
                    imageUrl: ex.url,
                    sets: 2,
                    targetReps: "45 seg hold",
                    rpe: 2,
                    notes: "Respira profundo, busca relajar el músculo.",
                    musculoObjetivo: ex.parteCuerpo
                }))
            };

        } else {
            // ENTRENAMIENTO

            // 1. Calentamiento RAMP (Utility + Bodyweight Activación)
            finalWarmup = generateScientificWarmup(utilityEx, bodyweightFiltered, targetSession.sessionFocus);

            // 2. Bloque Principal
            mainBlockData = generateMainBlock(fullMainPool, targetSession.sessionFocus, rpeModifier);

            // 3. Core (Usamos exercises_bodyweight_pure, filtrando por 'Core')
            const corePool = bodyweightFiltered.filter(e => normalizeText(e.parteCuerpo) === 'core');
            if (corePool.length > 0) {
                const pickedCore = shuffleArray(corePool).slice(0, 2);
                finalCore = [{
                    blockType: 'superset',
                    restBetweenSetsSec: 45,
                    restBetweenExercisesSec: 0,
                    exercises: pickedCore.map(ex => ({
                        id: ex.id,
                        name: ex.nombre,
                        instructions: ex.descripcion,
                        imageUrl: ex.url,
                        sets: 3,
                        targetReps: "12-15 reps", // exercises_bodyweight_pure suele ser por reps
                        rpe: 8,
                        notes: "Mantén el abdomen contraído."
                    }))
                }];
            }
        }

        // 4. Enfriamiento (Utility: Estiramientos)
        // Buscamos estiramientos que coincidan con los músculos trabajados
        const workedMuscles = mainBlockData.exercises.map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
        
        let cooldownCandidates = utilityEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
        
        let priorityStretches = cooldownCandidates.filter(ex => {
            const stretchPart = normalizeText(ex.parteCuerpo || "");
            // Coincidencia simple: si trabajamos 'pecho', buscamos estiramiento de 'pecho'
            return workedMuscles.includes(stretchPart.split(' ')[0]); 
        });

        if (priorityStretches.length < 4) {
            const filler = shuffleArray(cooldownCandidates.filter(x => !priorityStretches.includes(x))).slice(0, 4 - priorityStretches.length);
            priorityStretches = [...priorityStretches, ...filler];
        }

        finalCooldown = shuffleArray(priorityStretches).slice(0, 4).map(ex => ({
            id: ex.id,
            name: ex.nombre,
            instructions: ex.descripcion,
            durationOrReps: "30 seg por lado",
            imageUrl: ex.url,
            notes: "Estiramiento estático. Relaja."
        }));

        const finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: isRecovery ? 30 : 60,
            warmup: { exercises: finalWarmup },
            mainBlocks: mainBlockData.exercises.length > 0 ? [{
                blockType: mainBlockData.type,
                restBetweenSetsSec: isRecovery ? 0 : 60,
                restBetweenExercisesSec: 0,
                exercises: mainBlockData.exercises
            }] : [],
            coreBlocks: finalCore,
            cooldown: { exercises: finalCooldown },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                version: "3.0-data-aware"
            },
            completed: false
        };

        await db.collection('users').doc(userId).update({ currentSession: finalSession });

        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}