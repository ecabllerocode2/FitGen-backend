import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid, subDays } from 'date-fns';
import { es } from 'date-fns/locale';

// ====================================================================
// 1. MOTORES DE LÓGICA DEPORTIVA (EVIDENCIA ÉLITE + HISTORIA)
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
    const energy = feedback.energyLevel || 3;
    const soreness = feedback.sorenessLevel || 3; 

    // Score del 0 al 5
    // Energía pondera doble.
    const readinessScore = ((energy * 2) + (6 - soreness)) / 3; // Invertimos soreness (1 es bueno, 5 es malo)

    let mode = 'standard';
    if (energy <= 2 || soreness >= 4) mode = 'survival'; // Baja energía o mucho dolor
    else if (energy >= 4 && soreness <= 2) mode = 'performance'; // Alta energía y fresco

    return { score: readinessScore, mode, energy, soreness };
};

// --- B. HISTORIAL Y SOBRECARGA PROGRESIVA (NIVEL 4) ---
/**
 * Busca en el historial reciente si el usuario ya hizo este ejercicio.
 * Si lo hizo, devuelve instrucciones para superarse.
 */
const getProgressiveOverload = (exerciseId, userHistory) => {
    // Buscamos la ejecución más reciente de este ejercicio
    let lastSession = null;
    let lastExerciseData = null;

    // Recorremos el historial del más nuevo al más viejo
    for (const session of userHistory) {
        if (!session.mainBlocks) continue;
        for (const block of session.mainBlocks) {
            const found = block.exercises.find(e => e.id === exerciseId);
            if (found) {
                lastSession = session;
                lastExerciseData = found;
                break;
            }
        }
        if (lastSession) break;
    }

    if (!lastExerciseData) return null;

    // LOGICA DE PROGRESIÓN
    // Si la sesión anterior fue "Fácil" (RPE bajo) -> Subir Carga
    // Si la sesión anterior fue "Dura" (RPE alto) -> Mantener o subir Reps
    const lastRpe = lastSession.feedback?.rpe || 7;
    const lastReps = lastExerciseData.targetReps || "10";
    
    let overloadNote = "";
    
    // Extraer número de reps previas (si es posible)
    const repsMatch = lastReps.toString().match(/(\d+)/);
    const prevRepVal = repsMatch ? parseInt(repsMatch[0]) : 10;

    if (lastRpe <= 7) {
        overloadNote = `⚡ PROGRESO: La última vez (hace ${format(new Date(lastSession.meta.date), 'dd/MM')}) fue fácil (RPE ${lastRpe}). Intenta subir peso o llegar a ${prevRepVal + 2} reps.`;
    } else if (lastRpe >= 9) {
        overloadNote = `🛡️ MANTENIMIENTO: La última vez fue exigente (RPE ${lastRpe}). Mantén el peso, busca mejorar la técnica.`;
    } else {
        overloadNote = `🔥 RETO: Intenta hacer 1 repetición más que la vez pasada (${prevRepVal} reps).`;
    }

    return overloadNote;
};

// --- C. PARÁMETROS DINÁMICOS ---
const getDynamicSessionParams = (readiness, sessionFocus, equipmentType) => {
    const { mode } = readiness;
    const focusNorm = normalizeText(sessionFocus);
    const isMetabolic = focusNorm.includes('metabolico') || focusNorm.includes('cardio');
    const limitedWeight = equipmentType === 'home_limited' || equipmentType === 'bodyweight';

    let params = {
        setsCompound: 4,
        setsIsolation: 3,
        repsCompound: "8-12",
        repsIsolation: "12-15",
        restCompound: 90,
        restIsolation: 60,
        techniqueNote: "",
        rpeCompound: 8, // RIR 2
        rpeIsolation: 9  // RIR 1
    };

    // 1. AJUSTE POR MODO (Energía del usuario)
    if (mode === 'survival') {
        params.setsCompound = 3; 
        params.setsIsolation = 2;
        params.restCompound = 120; 
        params.restIsolation = 90;
        params.rpeCompound = 6; // RIR 4
        params.rpeIsolation = 7; 
        params.techniqueNote = "Hoy prioriza la calidad del movimiento sobre el peso. Control total.";
    } else if (mode === 'performance') {
        params.setsCompound = 5; 
        params.setsIsolation = 4;
        params.restCompound = isMetabolic ? 60 : 150; // Descansar bien para rendir
        params.restIsolation = 75;
        params.rpeCompound = 9; // RIR 1
        params.rpeIsolation = 10; // Fallo técnico
        params.techniqueNote = "Día para batir récords personales. Ataca la carga.";
    }

    // 2. AJUSTE POR EQUIPO LIMITADO
    if (limitedWeight && !isMetabolic) {
        if (mode !== 'survival') {
            params.repsCompound = "15-20 (Tempo lento)"; 
            params.repsIsolation = "20-25 (Al fallo)"; 
            params.restCompound = 60; // Menos descanso para estres metabólico
            params.techniqueNote += " Haz las bajadas en 3 segundos (Tempo 3-0-1).";
        }
    }

    return params;
};

// --- D. LÓGICA DE SELECCIÓN DE PESO ---
const assignLoadSuggestion = (exercise, userInventory, sessionMode) => {
    const targetEquipment = normalizeText(exercise.equipo || "");
    const genericFallback = { 
        equipmentName: exercise.equipo || "Peso Corporal", 
        suggestedLoad: "Ajusta la carga al RPE." 
    };

    if (targetEquipment.includes("corporal") || targetEquipment.includes("suelo") || targetEquipment.includes("sin equipo")) {
        return { equipmentName: "Peso Corporal", suggestedLoad: "Tu propio peso" };
    }
    
    // Si es Gym, asumimos que tiene todo, pero damos consejo genérico
    if (detectEnvironment(userInventory) === 'gym') {
        if (targetEquipment.includes('mancuerna')) return { equipmentName: "Mancuernas", suggestedLoad: "Peso moderado/alto" };
        if (targetEquipment.includes('barra')) return { equipmentName: "Barra Olímpica", suggestedLoad: "Discos adecuados" };
        return genericFallback;
    }

    // Lógica Home Limited (Mancuernas fijas)
    const relevantItems = userInventory.filter(item => {
        const normItem = normalizeText(item);
        const hasWeight = normItem.match(/(\d+)\s*kg/) || normItem.match(/(\d+)\s*lbs/);
        
        // Coincidencia laxa para encontrar lo que sirve
        if (targetEquipment.includes("mancuerna") && normItem.includes("mancuerna")) return hasWeight;
        if (targetEquipment.includes("kettlebell") && (normItem.includes("kettlebell") || normItem.includes("pesa"))) return hasWeight;
        return false;
    });

    if (relevantItems.length === 0) return genericFallback;

    // Ordenar inventario por peso
    const weightedItems = relevantItems.map(item => {
        const match = item.match(/(\d+)/); 
        return { name: item, weight: match ? parseInt(match[0]) : 0 };
    }).sort((a, b) => a.weight - b.weight);

    const exType = normalizeText(exercise.tipo || "");
    let selectedItem = weightedItems[0];
    let loadNote = "";

    if (weightedItems.length > 1) {
        if (exType.includes("multi") || exType.includes("compuesto")) {
            // Compuesto = Peso alto
            selectedItem = sessionMode === 'survival' ? weightedItems[weightedItems.length - 2] || weightedItems[0] : weightedItems[weightedItems.length - 1];
            loadNote = "Peso pesado disponible.";
        } else {
            // Aislamiento = Peso medio
            const middleIndex = Math.floor((weightedItems.length - 1) / 2);
            selectedItem = weightedItems[middleIndex];
            loadNote = "Peso controlable.";
        }
    } else {
        loadNote = "Único peso disponible.";
    }

    return { 
        equipmentName: selectedItem.name, 
        suggestedLoad: `${selectedItem.name} (${loadNote})` 
    };
};

// ====================================================================
// 2. SELECCIÓN Y FILTRADO
// ====================================================================

const detectEnvironment = (equipmentList) => {
    if (!equipmentList || equipmentList.length === 0) return 'bodyweight';
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('gym')) return 'gym';

    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        return i.includes('mancuerna') || i.includes('pesa') || i.includes('barra');
    });

    return hasLoad ? 'home_limited' : 'bodyweight';
};

const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises; 

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipo || "peso corporal");
        if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;
        if (environment === 'bodyweight') return false;

        // Home Limited
        if (reqEq.includes("mancuerna") && userKeywords.some(k => k.includes("mancuerna"))) return true;
        if (reqEq.includes("barra") && userKeywords.some(k => k.includes("barra"))) return true;
        if (reqEq.includes("banda") || reqEq.includes("liga")) return userKeywords.some(k => k.includes("banda") || k.includes("mini"));
        if (reqEq.includes("kettlebell")) return userKeywords.some(k => k.includes("kettlebell") || k.includes("pesa"));

        return false;
    });
};

const filterExercisesByLevel = (exercises, userLevel) => {
    const level = normalizeText(userLevel || "principiante");
    return exercises.filter(ex => {
        const exLevel = normalizeText(ex.nivel || "principiante");
        if (level === 'principiante') return exLevel === 'principiante';
        // Intermedios ven Principiante e Intermedio
        if (level === 'intermedio') return exLevel !== 'avanzado';
        return true; 
    });
};

// ====================================================================
// 3. GENERADORES DE BLOQUES
// ====================================================================

const generateWarmup = (utilityPool, bodyweightPool, focus) => {
    const normFocus = normalizeText(focus);
    let target = 'general';
    if (normFocus.includes('pierna') || normFocus.includes('full')) target = 'pierna';
    if (normFocus.includes('torso') || normFocus.includes('pecho') || normFocus.includes('empuje')) target = 'superior';

    const mobility = utilityPool.filter(ex => {
        const type = normalizeText(ex.tipo);
        const part = normalizeText(ex.parteCuerpo);
        return type.includes('calentamiento') || (type.includes('estiramiento') && part.includes(target));
    });

    const activation = bodyweightPool.filter(ex => {
        const part = normalizeText(ex.parteCuerpo);
        return target === 'pierna' ? part.includes('pierna') || part.includes('gluteo')
            : part.includes('pecho') || part.includes('espalda') || part.includes('hombro');
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

const generateCoreBlock = (corePool, readiness) => {
    if (corePool.length === 0) return null;
    
    // Configuración Core
    let sets = readiness.mode === 'survival' ? 1 : 3;
    let rpe = readiness.mode === 'performance' ? 9 : 7;
    
    const coreEx = shuffleArray(corePool).slice(0, 2);

    return {
        blockType: 'superset',
        restBetweenSetsSec: 60,
        restBetweenExercisesSec: 0,
        exercises: coreEx.map(ex => ({
            id: ex.id,
            name: ex.nombre,
            instructions: ex.descripcion,
            imageUrl: ex.url,
            equipment: "Peso Corporal",
            sets: sets,
            targetReps: "15-20 reps",
            rpe: rpe,
            notes: "Mantén el abdomen contraído todo el tiempo."
        }))
    };
};

const generateMainBlock = (pool, sessionFocus, params, userHistory) => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;
    const { 
        setsCompound, setsIsolation, repsCompound, repsIsolation, 
        rpeCompound, rpeIsolation, techniqueNote 
    } = params;

    // --- CORRECCIÓN CRÍTICA DE ESTRUCTURA (NO MÁS PULL = PIERNA) ---
    // El orden importa. Primero los más específicos.

    // 1. FULL BODY / METABÓLICO
    if (focus.includes('full') || focus.includes('metabolico') || focus.includes('acondicionamiento')) {
        isCircuit = true; 
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' }, 
            { pattern: ['empuje', 'pecho', 'hombro'], role: 'compound' }, 
            { pattern: ['traccion', 'espalda'], role: 'compound' }, 
            { pattern: ['gluteo', 'isquios'], role: 'compound' }, 
        ];
    } 
    // 2. TORSO (UPPER)
    else if (focus.includes('torso') || focus.includes('superior')) {
        template = [
            { pattern: ['pecho', 'empuje'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'compound' }, 
            { pattern: ['hombro', 'pecho'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'isolation' }, 
            { pattern: ['triceps', 'biceps'], role: 'isolation' } 
        ];
    }
    // 3. EMPUJE (PUSH) - PECHO/HOMBRO/TRICEPS
    else if (focus.includes('empuje') || focus.includes('push') || focus.includes('pecho')) {
        template = [
            { pattern: ['pecho', 'pectoral'], role: 'compound' }, 
            { pattern: ['hombro', 'deltoides'], role: 'compound' }, 
            { pattern: ['pecho', 'hombro'], role: 'isolation' }, 
            { pattern: ['triceps'], role: 'isolation' }, 
            { pattern: ['triceps'], role: 'isolation' } 
        ];
    }
    // 4. TRACCIÓN (PULL) - ESPALDA/BICEPS
    else if (focus.includes('traccion') || focus.includes('pull') || focus.includes('espalda')) {
        template = [
            { pattern: ['espalda', 'dorsal'], role: 'compound' }, 
            { pattern: ['traccion', 'remo'], role: 'compound' }, 
            { pattern: ['espalda', 'posterior'], role: 'isolation' }, 
            { pattern: ['biceps'], role: 'isolation' }, 
            { pattern: ['biceps'], role: 'isolation' } 
        ];
    }
    // 5. PIERNA (LEGS) - Default si no coincide con nada de arriba, o si es explícitamente pierna
    else {
        // Asumimos Pierna
        template = [
            { pattern: ['cuadriceps', 'sentadilla'], role: 'compound' },
            { pattern: ['isquios', 'peso muerto', 'femoral'], role: 'compound' },
            { pattern: ['prensa', 'zancada', 'gluteo'], role: 'isolation' },
            { pattern: ['gemelos', 'pantorrilla'], role: 'isolation' }
        ];
    }

    const selectedExercises = [];
    const usedIds = new Set();

    template.forEach(slot => {
        // Encontrar candidatos que coincidan con el patrón Y el rol
        const candidates = pool.filter(ex => {
            if (usedIds.has(ex.id)) return false;
            const targets = normalizeText((ex.musculoObjetivo || "") + " " + (ex.parteCuerpo || ""));
            const type = normalizeText(ex.tipo || "");

            const matchesPattern = slot.pattern.some(p => targets.includes(p));
            const matchesRole = slot.role === 'compound' ? (type.includes('multi') || type.includes('compuesto')) : type.includes('aislamiento');
            
            // Fallback: si pedimos compuesto pero no hay, aceptamos cualquiera que cumpla el patrón muscular
            return matchesPattern && (matchesRole || true);
        });

        if (candidates.length > 0) {
            // Selección aleatoria para variedad (dentro de lo lógico)
            const pick = shuffleArray(candidates)[0];
            usedIds.add(pick.id);

            const isCompound = slot.role === 'compound';
            
            // 1. Carga Base según equipo
            const loadSuggestion = assignLoadSuggestion(pick, params.userInventory, params.sessionMode);
            
            // 2. Sobrecarga Progresiva (NIVEL 4)
            const overloadNote = getProgressiveOverload(pick.id, userHistory);
            
            const finalNotes = overloadNote 
                ? `${overloadNote} ${techniqueNote}` // Prioridad a la sobrecarga
                : techniqueNote;

            selectedExercises.push({
                id: pick.id,
                name: pick.nombre,
                instructions: pick.descripcion,
                imageUrl: pick.url || null,
                url: pick.videoUrl || null, // Asegurar compatibilidad con WorkoutPlayer
                equipment: loadSuggestion.equipmentName,
                suggestedLoad: loadSuggestion.suggestedLoad,
                sets: isCompound ? setsCompound : setsIsolation,
                targetReps: isCompound ? repsCompound : repsIsolation,
                rpe: isCompound ? rpeCompound : rpeIsolation,
                notes: finalNotes,
                musculoObjetivo: pick.musculoObjetivo || pick.parteCuerpo
            });
        }
    });

    return {
        type: isCircuit ? 'circuit' : 'station',
        restSets: isCircuit ? 0 : params.restCompound,
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

    try {
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;

        // --- 1. LECTURA DE DATOS EN PARALELO (OPTIMIZACIÓN) ---
        // Leemos usuario y, en paralelo, las últimas sesiones del historial para la sobrecarga progresiva
        const userRef = db.collection('users').doc(userId);
        const [userDoc, historySnapshot] = await Promise.all([
            userRef.get(),
            userRef.collection('history').orderBy('meta.date', 'desc').limit(15).get() // Leemos las últimas 15 sesiones
        ]);

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const { profileData, currentMesocycle } = userDoc.data();
        if (!currentMesocycle) return res.status(400).json({ error: 'No hay plan activo.' });

        // Procesar historial en memoria
        const userHistory = historySnapshot.docs.map(doc => doc.data());

        // --- 2. DETERMINAR FECHA (CORRECCIÓN ZONA HORARIA) ---
        // Usamos el string enviado por el cliente como la verdad absoluta.
        const dateStringRaw = req.body.date || format(new Date(), 'yyyy-MM-dd'); // "2023-11-25"
        const sessionDate = parseISO(dateStringRaw); // Objeto Date localmente correcto para funciones fns
        
        // Calcular en qué semana del plan estamos
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(sessionDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        
        // Si ya acabó el plan, buscar el último disponible o error
        if (!targetMicrocycle) return res.status(400).json({ error: "El mesociclo ha terminado o la fecha es inválida." });

        // Obtener el nombre del día en español basado estrictamente en el string de fecha
        const dayName = format(sessionDate, 'EEEE', { locale: es }); 
        // e.g., "martes"

        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());
        
        // Si no hay sesión programada hoy
        if (!targetSession) {
            targetSession = { sessionFocus: "Descanso / Recuperación" };
        }

        // --- 3. INPUT DEL USUARIO (FEEDBACK) ---
        const feedback = req.body.realTimeFeedback || {};
        const isRecoveryFlag = req.body.isRecovery || normalizeText(targetSession.sessionFocus).includes('recuperacion') || normalizeText(targetSession.sessionFocus).includes('descanso');

        const readiness = calculateReadiness(feedback);
        const equipmentType = detectEnvironment(profileData.availableEquipment);
        
        // Calcular parámetros base (sets, reps, descansos)
        const sessionParams = getDynamicSessionParams(readiness, targetSession.sessionFocus, equipmentType);
        sessionParams.userInventory = profileData.availableEquipment || [];
        sessionParams.sessionMode = readiness.mode;

        // --- 4. CARGA DE EJERCICIOS (POOLS) ---
        const promises = [
            db.collection('exercises_utility').get(),        
            db.collection('exercises_bodyweight_pure').get() 
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

        // UNIFICACIÓN Y FILTRADO
        let fullMainPool = [...mainExPoolRaw, ...bodyweightEx.filter(e => normalizeText(e.parteCuerpo) !== 'core')];
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        fullMainPool = filterExercisesByLevel(fullMainPool, profileData.experienceLevel);
        
        const bodyweightFiltered = filterExercisesByLevel(bodyweightEx, profileData.experienceLevel);
        const corePool = bodyweightFiltered.filter(e => normalizeText(e.parteCuerpo) === 'core');

        // --- 5. CONSTRUCCIÓN DE LA SESIÓN ---
        let finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: 60,
            warmup: { exercises: [] },
            mainBlocks: [],
            coreBlocks: [],
            cooldown: { exercises: [] },
            meta: {
                date: dateStringRaw, // Guardamos string exacto "YYYY-MM-DD"
                generatedAt: new Date().toISOString(),
                readinessScore: readiness.score,
                sessionMode: readiness.mode
            }
        };

        if (isRecoveryFlag) {
            // Lógica de recuperación (Simplificada)
            const mobilityFlow = shuffleArray(utilityEx.filter(e => normalizeText(e.tipo).includes('estiramiento'))).slice(0, 8);
            finalSession.sessionGoal = "Recuperación Activa";
            finalSession.estimatedDurationMin = 25;
            finalSession.mainBlocks = [{
                blockType: 'circuit',
                restBetweenSetsSec: 0,
                restBetweenExercisesSec: 20,
                exercises: mobilityFlow.map(ex => ({
                    id: ex.id,
                    name: ex.nombre,
                    instructions: ex.descripcion,
                    imageUrl: ex.url,
                    sets: 2,
                    targetReps: "45s",
                    rpe: 2,
                    notes: "Movimiento fluido, sin dolor."
                }))
            }];
        } else {
            // --- ENTRENAMIENTO PRINCIPAL ---
            
            // 1. Warmup
            finalSession.warmup.exercises = generateWarmup(utilityEx, bodyweightFiltered, targetSession.sessionFocus);

            // 2. Main Block (CON SOBRECARGA PROGRESIVA)
            // Pasamos userHistory para que busque coincidencias
            const mainBlock = generateMainBlock(fullMainPool, targetSession.sessionFocus, sessionParams, userHistory);

            const blockRestSets = mainBlock.type === 'circuit' ? Math.max(90, sessionParams.restCompound + 30) : sessionParams.restCompound;
            const blockRestEx = mainBlock.type === 'circuit' ? 15 : sessionParams.restIsolation;

            finalSession.mainBlocks = [{
                blockType: mainBlock.type,
                restBetweenSetsSec: blockRestSets,
                restBetweenExercisesSec: blockRestEx,
                exercises: mainBlock.exercises
            }];

            // 3. Core
            if (corePool.length > 0) {
                 const coreBlock = generateCoreBlock(corePool, readiness);
                 if (coreBlock) finalSession.coreBlocks.push(coreBlock);
            }

            // 4. Cooldown
            const workedMuscles = finalSession.mainBlocks.flatMap(b => b.exercises).map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
            let stretches = utilityEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
            // Priorizar músculos trabajados
            let priority = stretches.filter(ex => workedMuscles.includes(normalizeText(ex.parteCuerpo).split(' ')[0]));
            
            if (priority.length < 3) {
                const filler = shuffleArray(stretches.filter(x => !priority.includes(x))).slice(0, 3 - priority.length);
                priority = [...priority, ...filler];
            }

            finalSession.cooldown.exercises = priority.slice(0, 4).map(ex => ({
                id: ex.id,
                name: ex.nombre,
                instructions: ex.descripcion,
                durationOrReps: "30s",
                imageUrl: ex.url
            }));

            // Duración
            const setsTotal = finalSession.mainBlocks.flatMap(b => b.exercises).reduce((acc, curr) => acc + curr.sets, 0); 
            finalSession.estimatedDurationMin = 10 + (setsTotal * 3) + 5; 
        }

        // GUARDADO FINAL
        await db.collection('users').doc(userId).update({ currentSession: finalSession });
        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}