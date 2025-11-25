import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, startOfDay, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

// ====================================================================
// 1. MOTORES DE LÓGICA DEPORTIVA
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

// --- A. CÁLCULO DE LA CONDICIÓN DEL ATLETA ---
const calculateReadiness = (feedback) => {
    // Valores por defecto si el usuario cierra el modal o hay error
    const energy = feedback.energyLevel || 3;
    const soreness = feedback.sorenessLevel || 3; // 1=Exhausto, 5=Fresco

    // Score del 0 al 10. 
    // Energía tiene peso doble (mentalidad), Dolor peso simple (local).
    // Nota: En tu modal Soreness 1=Exhausto/Dolor, 5=Nada.
    const readinessScore = ((energy * 2) + soreness) / 3;

    // Definimos el "Modo" de la sesión
    let mode = 'standard';
    if (readinessScore <= 2) mode = 'survival'; // Muy cansado
    if (readinessScore >= 4.5) mode = 'performance'; // A tope

    return { score: readinessScore, mode, energy, soreness };
};

// --- B. PARÁMETROS DINÁMICOS DE SESIÓN ---
const getDynamicSessionParams = (readiness, sessionFocus, equipmentType) => {
    const { mode } = readiness;
    const isMetabolic = normalizeText(sessionFocus).includes('metabolico');
    const isStrength = normalizeText(sessionFocus).includes('fuerza');
    const limitedWeight = equipmentType === 'home_limited' || equipmentType === 'bodyweight';

    let params = {
        setsCompound: 4,
        setsIsolation: 3,
        repsCompound: "8-12",
        repsIsolation: "12-15",
        restCompound: 90,
        restIsolation: 60,
        techniqueNote: ""
    };

    // 1. AJUSTE POR MODO (Energía del usuario)
    if (mode === 'survival') {
        params.setsCompound = 3; // Reducir volumen
        params.setsIsolation = 2;
        params.restCompound = 120; // Más descanso para sobrevivir
        params.restIsolation = 90;
        params.techniqueNote = "Hoy prioriza la calidad sobre la cantidad. No llegues al fallo.";
    } else if (mode === 'performance') {
        params.setsCompound = 5; // Aumentar volumen
        params.setsIsolation = 4;
        params.restCompound = isMetabolic ? 45 : 90; // Si es metabólico y tiene energía, dale caña.
        params.techniqueNote = "Hoy es día de romper récords. Ataca con intensidad.";
    }

    // 2. AJUSTE POR EQUIPO LIMITADO (El caso de Eder: Mancuernas 10kg)
    if (limitedWeight && !isMetabolic) {
        // Si no hay peso, compensamos con repeticiones altas o TEMPO
        params.repsCompound = "15-20 (Tempo 3-0-1)";
        params.repsIsolation = "20-25";
        params.restCompound = Math.max(45, params.restCompound - 30); // Menos descanso para estrés metabólico
        params.techniqueNote += " Controla la bajada en 3 segundos para compensar el peso ligero.";
    }

    return params;
};

// NUEVO HELPER: LÓGICA DE SELECCIÓN DE PESO ESPECÍFICO
// ====================================================================
const assignLoadSuggestion = (exercise, userInventory, sessionMode) => {
    const targetEquipment = normalizeText(exercise.equipo || "");

    // 1. Filtrar el inventario del usuario para encontrar coincidencias
    // Ejemplo: Si el ejercicio pide "Mancuernas", buscamos "Mancuernas (10kg)", "Mancuernas (20kg)"
    const relevantItems = userInventory.filter(item => {
        const normItem = normalizeText(item);
        // Lógica flexible de coincidencia
        if (targetEquipment.includes("mancuerna") && normItem.includes("mancuerna")) return true;
        if (targetEquipment.includes("barra") && normItem.includes("barra")) return true;
        if (targetEquipment.includes("kettlebell") && (normItem.includes("kettlebell") || normItem.includes("pesa rusa"))) return true;
        if (targetEquipment.includes("banda") && (normItem.includes("banda") || normItem.includes("liga"))) return true;
        return false;
    });

    if (relevantItems.length === 0) return exercise.equipo; // Fallback genérico

    // 2. Extraer números (pesos) de los strings para ordenar
    // Formato esperado en array: { name: "Mancuernas 10kg", weight: 10 }
    const weightedItems = relevantItems.map(item => {
        const match = item.match(/(\d+)/); // Busca números
        return {
            name: item,
            weight: match ? parseInt(match[0]) : 0
        };
    }).sort((a, b) => a.weight - b.weight); // Ordenar de menor a mayor

    // 3. Decisión Táctica (Compound = Pesado, Isolation = Moderado/Ligero)
    const exType = normalizeText(exercise.tipo || "");
    let selectedItem = weightedItems[0]; // Por defecto el más ligero

    if (weightedItems.length > 1) {
        if (exType.includes("multi") || exType.includes("compuesto")) {
            // Para multiarticulares, usamos el peso máximo disponible (o el segundo si es 'survival')
            const index = sessionMode === 'survival' ? weightedItems.length - 2 : weightedItems.length - 1;
            selectedItem = weightedItems[Math.max(0, index)];
        } else {
            // Para aislamiento, usamos peso medio o ligero
            // Si tiene 3 pesos, agarra el de en medio. Si tiene 2, el ligero.
            const middleIndex = Math.floor((weightedItems.length - 1) / 2);
            selectedItem = weightedItems[middleIndex];
        }
    }

    return selectedItem.name; // Devuelve ej: "Mancuernas (20kg)"
};

// ====================================================================
// 2. SELECCIÓN Y FILTRADO
// ====================================================================

const detectEnvironment = (equipmentList) => {
    if (!equipmentList) return 'bodyweight';
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('gym')) return 'gym';

    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        return i.includes('mancuerna') || i.includes('pesa') || i.includes('barra') || i.includes('disco');
    });

    if (!hasLoad) return 'bodyweight';
    return 'home_limited';
};

const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises;

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipo || "peso corporal");
        if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;
        if (environment === 'bodyweight') return false;

        // Lógica estricta para casa: Si el ejercicio pide "Barra", el usuario debe tener "Barra"
        if (reqEq.includes("mancuerna")) return userKeywords.some(k => k.includes("mancuerna"));
        if (reqEq.includes("barra")) return userKeywords.some(k => k.includes("barra"));
        if (reqEq.includes("banda") || reqEq.includes("liga")) return userKeywords.some(k => k.includes("banda") || k.includes("mini"));
        if (reqEq.includes("kettlebell")) return userKeywords.some(k => k.includes("kettlebell") || k.includes("mancuerna")); // Mancuerna puede sustituir KB a veces

        return false;
    });
};

const filterExercisesByLevel = (exercises, userLevel) => {
    const level = normalizeText(userLevel || "principiante");
    return exercises.filter(ex => {
        const exLevel = normalizeText(ex.nivel || "principiante");
        if (level === 'principiante') return exLevel === 'principiante';
        if (level === 'intermedio') return exLevel !== 'avanzado';
        return true;
    });
};

// ====================================================================
// 3. GENERADORES DE BLOQUES
// ====================================================================

const generateWarmup = (utilityPool, bodyweightPool, focus) => {
    // Protocolo RAMP simplificado
    const normFocus = normalizeText(focus);
    let target = 'general';
    if (normFocus.includes('pierna') || normFocus.includes('full')) target = 'pierna';
    if (normFocus.includes('torso') || normFocus.includes('pecho')) target = 'superior';

    // 1. Movilidad (Utility)
    const mobility = utilityPool.filter(ex => {
        const type = normalizeText(ex.tipo);
        const part = normalizeText(ex.parteCuerpo);
        return type.includes('calentamiento') || (type.includes('estiramiento') && part.includes(target));
    });

    // 2. Activación (Bodyweight)
    const activation = bodyweightPool.filter(ex => {
        const part = normalizeText(ex.parteCuerpo);
        // Excluir core intenso
        return target === 'pierna' ? part.includes('pierna') || part.includes('gluteo')
            : part.includes('pecho') || part.includes('espalda');
    });

    const selected = [
        ...shuffleArray(mobility).slice(0, 2).map(e => ({ ...e, type: 'mobility', durationOrReps: '45s' })),
        ...shuffleArray(activation).slice(0, 2).map(e => ({ ...e, type: 'activation', durationOrReps: '15 reps' }))
    ];

    return selected.map(ex => ({
        id: ex.id,
        name: ex.nombre,
        instructions: ex.descripcion,
        durationOrReps: ex.durationOrReps,
        imageUrl: ex.url,
        equipment: "Peso Corporal"
    }));
};

const generateMainBlock = (pool, sessionFocus, params) => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;

    // --- TEMPLATES INTELIGENTES ---
    // Aseguran que Full Body toque los 5 patrones, y Torso/Pierna equilibren antagonistas.

    if (focus.includes('full') || focus.includes('metabolico')) {
        isCircuit = true; // Full body suele ser mejor en circuito o pares
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' }, // 1. Dominante Rodilla (Sentadilla)
            { pattern: ['empuje', 'pecho', 'hombro'], role: 'compound' }, // 2. Empuje
            { pattern: ['gluteo', 'isquios', 'cadera'], role: 'compound' }, // 3. Dominante Cadera (Peso Muerto)
            { pattern: ['traccion', 'espalda'], role: 'compound' }, // 4. Tracción
            { pattern: ['core', 'abdominales'], role: 'isolation' } // 5. Core/Carry
        ];
    } else if (focus.includes('torso')) {
        template = [
            { pattern: ['pecho', 'empuje'], role: 'compound' }, // Press Principal
            { pattern: ['espalda', 'traccion'], role: 'compound' }, // Remo Principal
            { pattern: ['hombro', 'pecho'], role: 'compound' }, // Press Vertical/Inclinado
            { pattern: ['espalda', 'traccion'], role: 'isolation' }, // Aislamiento Espalda (Vuelos)
            { pattern: ['triceps', 'biceps'], role: 'isolation' } // Brazos
        ];
    } else {
        // Pierna o General
        template = [
            { pattern: ['cuadriceps', 'pierna'], role: 'compound' },
            { pattern: ['isquios', 'gluteo'], role: 'compound' },
            { pattern: ['pierna', 'cuadriceps'], role: 'isolation' },
            { pattern: ['gemelos', 'pantorrilla'], role: 'isolation' }
        ];
    }

    const selectedExercises = [];
    const usedIds = new Set();

    template.forEach(slot => {
        const candidates = pool.filter(ex => {
            if (usedIds.has(ex.id)) return false;
            const targets = normalizeText((ex.musculoObjetivo || "") + " " + (ex.parteCuerpo || ""));
            const type = normalizeText(ex.tipo || "");

            const matchesPattern = slot.pattern.some(p => targets.includes(p));
            // Priorizar compuestos para roles compuestos
            const matchesRole = slot.role === 'compound' ? type.includes('multi') : true;

            return matchesPattern && matchesRole;
        });

        if (candidates.length > 0) {
            const pick = shuffleArray(candidates)[0];
            usedIds.add(pick.id);

            // CALCULAR SUGERENCIA DE CARGA ESPECÍFICA
            // userInventory viene de profileData.availableEquipment
            // sessionMode viene de readiness.mode ('performance', 'survival', 'standard')
            const specificEquipment = assignLoadSuggestion(pick, params.userInventory, params.sessionMode);

            selectedExercises.push({
                id: pick.id,
                name: pick.nombre,
                instructions: pick.descripcion,
                imageUrl: pick.url || null,
                equipment: specificEquipment, // <--- AQUÍ SE GUARDA EL ESPECÍFICO
                originalEquipment: pick.equipo, // Guardamos el genérico por si acaso
                sets: slot.role === 'compound' ? params.setsCompound : params.setsIsolation,
                targetReps: slot.role === 'compound' ? params.repsCompound : params.repsIsolation,
                rpe: slot.role === 'compound' ? 8 : 9,
                notes: params.techniqueNote,
                musculoObjetivo: pick.musculoObjetivo || pick.parteCuerpo
            });
        }
    });

    return {
        type: isCircuit ? 'circuit' : 'station',
        restSets: isCircuit ? 0 : params.restCompound, // En circuito no descansas entre ejercicios, solo al final de vuelta
        restExercises: isCircuit ? 0 : params.restIsolation,
        exercises: selectedExercises
    };
};

// ====================================================================
// 4. HANDLER PRINCIPAL
// ====================================================================

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

        // --- 1. DETERMINAR CONTEXTO DE FECHA ---
        let todayDate = new Date();
        if (req.body.date) {
            const parsed = parseISO(req.body.date);
            if (isValid(parsed)) todayDate = parsed;
        }

        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        // Si no hay microciclo (fin del plan), devolver error o último
        if (!targetMicrocycle) return res.status(400).json({ error: "Plan finalizado." });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        // Manejo de descanso
        if (!targetSession) targetSession = { sessionFocus: "Descanso / Recuperación" };

        // --- 2. INTEGRACIÓN DE FEEDBACK (EL CEREBRO DE LA PERSONALIZACIÓN) ---
        const feedback = req.body.realTimeFeedback || {};
        const isRecoveryFlag = req.body.isRecovery || normalizeText(targetSession.sessionFocus).includes('recuperacion') || normalizeText(targetSession.sessionFocus).includes('descanso');

        // Calculamos el estado del atleta
        const readiness = calculateReadiness(feedback);
        const equipmentType = detectEnvironment(profileData.availableEquipment);

        // Calculamos parámetros físicos (Volumen, Intensidad, Descanso)
        const sessionParams = getDynamicSessionParams(readiness, targetSession.sessionFocus, equipmentType);

        sessionParams.userInventory = profileData.availableEquipment || [];
        sessionParams.sessionMode = readiness.mode;

        let intensityLabel = "Media";
        if (readiness.mode === 'performance' || normalizeText(targetSession.sessionFocus).includes('fuerza')) {
            intensityLabel = "Alta";
        } else if (readiness.mode === 'survival' || isRecoveryFlag) {
            intensityLabel = "Baja / Recuperación";
        }

        // --- 3. OBTENCIÓN DE DATOS ---
        const promises = [
            db.collection('exercises_utility').get(),        // [0]
            db.collection('exercises_bodyweight_pure').get() // [1]
        ];

        if (equipmentType === 'gym') {
            promises.push(db.collection('exercises_gym_full').get());
        } else {
            promises.push(db.collection('exercises_home_limited').get());
        }

        const results = await Promise.all(promises);
        const utilityEx = results[0].docs.map(d => ({ id: d.id, ...d.data() }));
        const bodyweightEx = results[1].docs.map(d => ({ id: d.id, ...d.data() }));
        const mainExPoolRaw = results[2].docs.map(d => ({ id: d.id, ...d.data() }));

        // Unificar pools y filtrar
        let fullMainPool = [...mainExPoolRaw, ...bodyweightEx.filter(e => normalizeText(e.parteCuerpo) !== 'core')];
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        fullMainPool = filterExercisesByLevel(fullMainPool, profileData.experienceLevel);
        const bodyweightFiltered = filterExercisesByLevel(bodyweightEx, profileData.experienceLevel);

        // --- 4. CONSTRUCCIÓN DE LA SESIÓN ---

        let finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: 60,
            warmup: { exercises: [] },
            mainBlocks: [],
            coreBlocks: [],
            intensityLevel: intensityLabel,
            cooldown: { exercises: [] },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                readinessScore: readiness.score,
                sessionMode: readiness.mode
            }
        };

        if (isRecoveryFlag) {
            // --- MODO RECUPERACIÓN (Lógica Simplificada) ---
            const mobilityFlow = shuffleArray(utilityEx.filter(e => normalizeText(e.tipo).includes('estiramiento'))).slice(0, 8);

            finalSession.sessionGoal = "Recuperación Activa & Movilidad";
            finalSession.estimatedDurationMin = 30;
            finalSession.mainBlocks = [{
                blockType: 'circuit',
                restBetweenSetsSec: 0,
                restBetweenExercisesSec: 15,
                exercises: mobilityFlow.map(ex => ({
                    id: ex.id,
                    name: ex.nombre,
                    instructions: ex.descripcion,
                    imageUrl: ex.url,
                    sets: 2,
                    targetReps: "45 seg",
                    rpe: 2,
                    notes: "Movimiento fluido y controlado.",
                    musculoObjetivo: ex.parteCuerpo
                }))
            }];

        } else {
            // --- MODO ENTRENAMIENTO ---

            // 1. Warmup
            finalSession.warmup.exercises = generateWarmup(utilityEx, bodyweightFiltered, targetSession.sessionFocus);

            // 2. Main Block (Usando los parámetros dinámicos calculados)
            const mainBlock = generateMainBlock(fullMainPool, targetSession.sessionFocus, sessionParams);

            // Ajuste fino de descansos para el JSON final
            // Si es circuito: descanso entre ejercicios 0, descanso entre VUELTAS (sets) alto.
            // Si es estación: descanso entre sets normal, descanso entre ejercicios normal.
            const blockRestSets = mainBlock.type === 'circuit' ? Math.max(90, sessionParams.restCompound + 30) : sessionParams.restCompound;
            const blockRestEx = mainBlock.type === 'circuit' ? 15 : sessionParams.restIsolation;

            finalSession.mainBlocks = [{
                blockType: mainBlock.type,
                restBetweenSetsSec: blockRestSets,
                restBetweenExercisesSec: blockRestEx,
                exercises: mainBlock.exercises
            }];

            // 3. Core (Si readiness lo permite y no es pierna mortal)
            if (readiness.score > 3) {
                const corePool = bodyweightFiltered.filter(e => normalizeText(e.parteCuerpo) === 'core');
                if (corePool.length > 0) {
                    const coreEx = shuffleArray(corePool).slice(0, 2);
                    finalSession.coreBlocks = [{
                        blockType: 'superset',
                        restBetweenSetsSec: 60,
                        restBetweenExercisesSec: 0,
                        exercises: coreEx.map(ex => ({
                            id: ex.id,
                            name: ex.nombre,
                            instructions: ex.descripcion,
                            imageUrl: ex.url,
                            sets: 2, // Core volumen moderado
                            targetReps: "15-20 reps",
                            rpe: 7,
                            notes: "Estabilidad."
                        }))
                    }];
                }
            }

            // 4. Cooldown
            const workedMuscles = mainBlock.exercises.map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
            let stretches = utilityEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
            // Priorizar músculos trabajados
            let priority = stretches.filter(ex => workedMuscles.includes(normalizeText(ex.parteCuerpo).split(' ')[0]));
            if (priority.length < 4) {
                const filler = shuffleArray(stretches.filter(x => !priority.includes(x))).slice(0, 4 - priority.length);
                priority = [...priority, ...filler];
            }
            finalSession.cooldown.exercises = priority.map(ex => ({
                id: ex.id,
                name: ex.nombre,
                instructions: ex.descripcion,
                durationOrReps: "30s por lado",
                imageUrl: ex.url
            }));

            // Duración estimada
            const setsTotal = mainBlock.exercises.reduce((acc, curr) => acc + curr.sets, 0) + (finalSession.coreBlocks[0]?.exercises.length * 2 || 0);
            finalSession.estimatedDurationMin = 10 + (setsTotal * 2.5) + 5; // Warmup + (Sets * avg time) + Cool
        }

        // GUARDADO
        await db.collection('users').doc(userId).update({ currentSession: finalSession });
        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}