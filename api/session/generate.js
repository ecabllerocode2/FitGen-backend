import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, startOfDay, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { setLogLevel } from 'firebase/firestore'; 

// Habilitar logs para depuración en el entorno de desarrollo
// setLogLevel('debug'); 

// ====================================================================
// 1. MOTORES DE LÓGICA DEPORTIVA (EVIDENCIA ÉLITE)
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

    // Ponderación: Energía (estado mental y sistémico) es crucial. Dolor (soreness) es localizado.
    // Score del 0 al 10, escalado para un rango de 1 a 5 en la entrada (1-5)
    // Formula: (E*2 + S) / 3
    const readinessScore = ((energy * 2) + soreness) / 3;

    let mode = 'standard';
    if (readinessScore <= 2.5) mode = 'survival'; // Muy cansado/Dolorido (Priorizar RECUPERACIÓN y Calidad)
    else if (readinessScore >= 4.0) mode = 'performance'; // A tope (Priorizar VOLUMEN e INTENSIDAD)

    return { score: readinessScore, mode, energy, soreness };
};

// --- B. PARÁMETROS DINÁMICOS DE SESIÓN ---
const getDynamicSessionParams = (readiness, sessionFocus, equipmentType) => {
    const { mode } = readiness;
    const isMetabolic = normalizeText(sessionFocus).includes('metabolico');
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

    // 1. AJUSTE POR MODO (Energía del usuario) - Principio de la Carga Diaria Optima
    if (mode === 'survival') {
        params.setsCompound = 3; 
        params.setsIsolation = 2;
        params.restCompound = 120; // Más descanso
        params.restIsolation = 90;
        params.rpeCompound = 6; // RIR 4 (Muy lejos del fallo)
        params.rpeIsolation = 7; // RIR 3
        params.techniqueNote = "Hoy prioriza el control y la técnica. Mantente lejos del fallo (RPE 6-7).";
    } else if (mode === 'performance') {
        params.setsCompound = 5; 
        params.setsIsolation = 4;
        params.restCompound = isMetabolic ? 60 : 120; // Más descanso si es de fuerza pura
        params.restIsolation = isMetabolic ? 45 : 75;
        params.rpeCompound = 9; // RIR 1 (Cerca del fallo)
        params.rpeIsolation = 10; // RIR 0 (Al fallo o muy cerca)
        params.techniqueNote = "Día de máxima intensidad. Busca el fallo técnico o RIR 0-1 en compuestos.";
    }

    // 2. AJUSTE POR EQUIPO LIMITADO - Principio de Manipulación de Variables Secundarias
    if (limitedWeight && !isMetabolic) {
        // Si no hay peso, compensamos con repeticiones más altas y Tempo lento.
        if (mode !== 'survival') { // No aplicar tempo si ya está en modo supervivencia
            params.repsCompound = "12-15 (Tempo 3-0-1)"; 
            params.repsIsolation = "15-25 (Drop-sets o Pausas)"; 
            params.restCompound = Math.max(45, params.restCompound - 30); // Reducir descanso para estrés metabólico
            params.techniqueNote += " Si el peso es ligero, realiza la fase excéntrica (bajada) en 3 segundos.";
        }
    }

    return params;
};

// --- C. LÓGICA DE SELECCIÓN DE PESO ESPECÍFICO (CRÍTICO) ---
const assignLoadSuggestion = (exercise, userInventory, sessionMode) => {
    const targetEquipment = normalizeText(exercise.equipo || "");
    const genericFallback = { 
        equipmentName: exercise.equipo, 
        suggestedLoad: "Ajusta la carga al RPE indicado." 
    };

    // 1. Si el ejercicio es de PESO CORPORAL o utiliza máquinas/cables (Gym) que no son "peso libre"
    if (targetEquipment.includes("corporal") || targetEquipment.includes("suelo") || targetEquipment.includes("sin equipo")) {
        return { equipmentName: "Peso Corporal", suggestedLoad: "N/A" };
    }
    // Si es equipo de Gimnasio (Máquinas, Poleas, etc.), no podemos asignar un peso específico de forma fiable.
    if (detectEnvironment(userInventory) === 'gym' && !targetEquipment.includes('mancuerna') && !targetEquipment.includes('barra')) {
        return genericFallback;
    }

    // 2. Filtrar el inventario solo por implementos que tienen PESO DEFINIDO (mancuernas, kettlebells, barras)
    const relevantItems = userInventory.filter(item => {
        const normItem = normalizeText(item);
        const hasWeight = normItem.match(/(\d+)\s*kg/) || normItem.match(/(\d+)\s*lbs/);

        if (targetEquipment.includes("mancuerna") && normItem.includes("mancuerna")) return hasWeight;
        if (targetEquipment.includes("barra") && normItem.includes("barra")) return hasWeight;
        if (targetEquipment.includes("kettlebell") && (normItem.includes("kettlebell") || normItem.includes("pesa rusa"))) return hasWeight;
        
        // Excluir elementos sin peso variable definido (Bandas, Cajas, Bancos, etc.)
        return false;
    });

    if (relevantItems.length === 0) {
        // Si pide mancuernas pero el usuario solo tiene bandas, devuelve el fallback
        return genericFallback;
    }

    // 3. Extraer números (pesos) y ordenar
    const weightedItems = relevantItems.map(item => {
        const match = item.match(/(\d+)/); // Busca el primer número como peso
        return {
            name: item,
            weight: match ? parseInt(match[0]) : 0
        };
    }).sort((a, b) => a.weight - b.weight); // Ordenar de menor a mayor

    // 4. Decisión Táctica Avanzada (Heavy vs. Light for Goal)
    const exType = normalizeText(exercise.tipo || "");
    let selectedItem = weightedItems[0]; // Por defecto, el más ligero
    let loadNote = "";

    if (weightedItems.length > 1) {
        if (exType.includes("multi") || exType.includes("compuesto")) {
            // COMPUESTO (Fuerza/Hipertrofia): Priorizar peso HEAVY (RIR bajo)
            if (sessionMode === 'survival') {
                // Usar el segundo más pesado para dejar un margen de seguridad.
                selectedItem = weightedItems[weightedItems.length - 2] || weightedItems[0]; 
                loadNote = "Utiliza tu segundo peso más pesado disponible (Modo Supervivencia).";
            } else {
                // Usar el peso más pesado para máxima sobrecarga.
                selectedItem = weightedItems[weightedItems.length - 1];
                loadNote = "Utiliza tu peso máximo disponible para este implemento.";
            }
        } else {
            // AISLAMIENTO (Tensión Mecánica/Metabólico): Priorizar peso LIGERO/MEDIO
            // El peso ligero/medio permite un mejor control, tempo y rango de movimiento.
            const middleIndex = weightedItems.length > 2 ? Math.floor((weightedItems.length - 1) / 2) : 0;
            selectedItem = weightedItems[middleIndex];
            loadNote = "Utiliza un peso moderado-ligero para asegurar control y un RPE alto.";
        }
    } else {
        // Solo hay un peso disponible
        loadNote = `Es el único peso disponible. Concéntrate en la técnica y en el Tempo/Reps para el RPE objetivo.`;
    }

    // Formato de salida para el cliente
    return { 
        equipmentName: selectedItem.name, 
        suggestedLoad: `${selectedItem.name} (${loadNote})` 
    };
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

// FILTRADO ESTRICTO DE EQUIPO (CRÍTICO)
const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    // Si es gimnasio, se asume acceso a todo (excepto si el ejercicio pide 'Mancuernas de 10kg' y el usuario no especificó tenerlas en casa)
    // El LLM siempre debería usar el pool de Gym en este caso, por lo que devolvemos todo.
    if (environment === 'gym') return exercises; 

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipo || "peso corporal");
        // Siempre permitimos ejercicios de Peso Corporal
        if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;

        // Si es bodyweight puro, y el ejercicio no es bodyweight, lo excluimos
        if (environment === 'bodyweight' && !reqEq.includes("corporal")) return false;

        // Lógica estricta para HOME_LIMITED
        // Debe haber una coincidencia directa de implemento
        if (reqEq.includes("mancuerna") && userKeywords.some(k => k.includes("mancuerna"))) return true;
        if (reqEq.includes("barra") && userKeywords.some(k => k.includes("barra"))) return true;
        if (reqEq.includes("banda") || reqEq.includes("liga")) return userKeywords.some(k => k.includes("banda") || k.includes("mini"));
        if (reqEq.includes("kettlebell")) return userKeywords.some(k => k.includes("kettlebell") || k.includes("pesa rusa"));

        return false; // Excluir por defecto si el equipo no está en el inventario.
    });
};

const filterExercisesByLevel = (exercises, userLevel) => {
    const level = normalizeText(userLevel || "principiante");
    return exercises.filter(ex => {
        const exLevel = normalizeText(ex.nivel || "principiante");
        if (level === 'principiante') return exLevel === 'principiante';
        if (level === 'intermedio') return exLevel !== 'avanzado';
        return true; // Avanzado toma todos
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

// NUEVO: Generador de Bloque Core Dinámico y Obligatorio
const generateCoreBlock = (corePool, readiness) => {
    if (corePool.length === 0) return null;

    let sets = 2; // Estándar
    let reps = "15-20 reps";
    let rpe = 7;
    let note = "Mantén la pelvis neutra y el abdomen tenso.";

    if (readiness.mode === 'performance') {
        sets = 3;
        rpe = 8;
        note = "Busca ejercicios de alta estabilidad o fuerza (ej. Plancha con carga o L-Sit).";
    } else if (readiness.mode === 'survival') {
        sets = 1; // Mínimo efectivo
        rpe = 5;
        reps = "10-12 reps o 30s";
        note = "Solo un set por ejercicio, enfócate en el control y la respiración.";
    }

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
            equipment: "Peso Corporal o Mínimo",
            sets: sets,
            targetReps: reps,
            rpe: rpe,
            notes: note
        }))
    };
};

const generateMainBlock = (pool, sessionFocus, params) => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;
    const { 
        setsCompound, setsIsolation, repsCompound, repsIsolation, 
        rpeCompound, rpeIsolation, techniqueNote 
    } = params;

    // --- TEMPLATES INTELIGENTES ---

    if (focus.includes('full') || focus.includes('metabolico')) {
        isCircuit = true; 
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' }, 
            { pattern: ['empuje', 'pecho', 'hombro'], role: 'compound' }, 
            { pattern: ['gluteo', 'isquios', 'cadera'], role: 'compound' }, 
            { pattern: ['traccion', 'espalda'], role: 'compound' }, 
        ];
    } else if (focus.includes('torso')) {
        template = [
            { pattern: ['pecho', 'empuje'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'compound' }, 
            { pattern: ['hombro', 'pecho'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'isolation' }, 
            { pattern: ['triceps', 'biceps'], role: 'isolation' } 
        ];
    } else {
        // Pierna o General
        template = [
            { pattern: ['cuadriceps', 'pierna'], role: 'compound' },
            { pattern: ['isquios', 'gluteo'], role: 'compound' },
            { pattern: ['cuadriceps', 'pierna', 'gluteo'], role: 'isolation' },
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
            const matchesRole = slot.role === 'compound' ? type.includes('multi') : type.includes('aislamiento');
            
            return matchesPattern && matchesRole;
        });

        if (candidates.length > 0) {
            const pick = shuffleArray(candidates)[0];
            usedIds.add(pick.id);

            // CALCULAR SUGERENCIA DE CARGA ESPECÍFICA
            const loadSuggestion = assignLoadSuggestion(pick, params.userInventory, params.sessionMode);
            const isCompound = slot.role === 'compound';

            selectedExercises.push({
                id: pick.id,
                name: pick.nombre,
                instructions: pick.descripcion,
                imageUrl: pick.url || null,
                equipment: loadSuggestion.equipmentName,
                suggestedLoad: loadSuggestion.suggestedLoad, // <--- DETALLE DE CARGA
                sets: isCompound ? setsCompound : setsIsolation,
                targetReps: isCompound ? repsCompound : repsIsolation,
                rpe: isCompound ? rpeCompound : rpeIsolation,
                notes: techniqueNote,
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
        // La semana comienza en Lunes (1)
        const weeksPassed = differenceInCalendarWeeks(startOfDay(todayDate), startOfDay(startDate), { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: "Plan finalizado." });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());
        
        // Manejo de descanso o sesión no planificada
        if (!targetSession) targetSession = { sessionFocus: "Descanso / Recuperación" };

        // --- 2. INTEGRACIÓN DE FEEDBACK (EL CEREBRO DE LA PERSONALIZACIÓN) ---
        const feedback = req.body.realTimeFeedback || {};
        const isRecoveryFlag = req.body.isRecovery || normalizeText(targetSession.sessionFocus).includes('recuperacion') || normalizeText(targetSession.sessionFocus).includes('descanso');

        // Calculamos el estado del atleta (Readiness)
        const readiness = calculateReadiness(feedback);
        const equipmentType = detectEnvironment(profileData.availableEquipment);

        // Calculamos parámetros físicos (Volumen, Intensidad, Descanso, RPE)
        const sessionParams = getDynamicSessionParams(readiness, targetSession.sessionFocus, equipmentType);

        sessionParams.userInventory = profileData.availableEquipment || [];
        sessionParams.sessionMode = readiness.mode;

        let intensityLabel = "Media";
        if (readiness.mode === 'performance' || normalizeText(targetSession.sessionFocus).includes('fuerza')) {
            intensityLabel = "Alta";
        } else if (readiness.mode === 'survival' || isRecoveryFlag) {
            intensityLabel = "Baja / Recuperación";
        }

        // --- 3. OBTENCIÓN DE DATOS Y FILTRADO ESTRICTO ---
        const promises = [
            db.collection('exercises_utility').get(),        
            db.collection('exercises_bodyweight_pure').get() 
        ];

        // Decidimos qué pool de ejercicios principales cargar
        if (equipmentType === 'gym') {
            promises.push(db.collection('exercises_gym_full').get());
        } else {
            // El pool 'home_limited' es el más adecuado para casa, incluso si no tiene carga.
            promises.push(db.collection('exercises_home_limited').get());
        }

        const results = await Promise.all(promises);
        const utilityEx = results[0].docs.map(d => ({ id: d.id, ...d.data() }));
        const bodyweightEx = results[1].docs.map(d => ({ id: d.id, ...d.data() }));
        const mainExPoolRaw = results[2].docs.map(d => ({ id: d.id, ...d.data() }));

        // Unificar pools y aplicar FILTRADO ESTRICTO
        // Incluimos ejercicios de bodyweight_pure que no son core para el pool principal.
        let fullMainPool = [...mainExPoolRaw, ...bodyweightEx.filter(e => normalizeText(e.parteCuerpo) !== 'core')];
        
        // FILTRADO CLAVE: Solo ejercicios que el usuario puede realizar con su equipo específico.
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        fullMainPool = filterExercisesByLevel(fullMainPool, profileData.experienceLevel);
        
        // Filtramos Core y Utility por nivel, ya que son ejercicios que no dependen del equipo principal.
        const bodyweightFiltered = filterExercisesByLevel(bodyweightEx, profileData.experienceLevel);
        const corePool = bodyweightFiltered.filter(e => normalizeText(e.parteCuerpo) === 'core');


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
                energyLevel: readiness.energy,
                sorenessLevel: readiness.soreness,
                sessionMode: readiness.mode
            }
        };

        if (isRecoveryFlag) {
            // --- MODO RECUPERACIÓN (Mantenemos la lógica simple y efectiva) ---
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

            // 2. Main Block 
            const mainBlock = generateMainBlock(fullMainPool, targetSession.sessionFocus, sessionParams);

            const blockRestSets = mainBlock.type === 'circuit' ? Math.max(90, sessionParams.restCompound + 30) : sessionParams.restCompound;
            const blockRestEx = mainBlock.type === 'circuit' ? 15 : sessionParams.restIsolation;

            finalSession.mainBlocks = [{
                blockType: mainBlock.type,
                restBetweenSetsSec: blockRestSets,
                restBetweenExercisesSec: blockRestEx,
                exercises: mainBlock.exercises
            }];

            // 3. Core (INCLUSIÓN OBLIGATORIA)
            if (corePool.length > 0) {
                 finalSession.coreBlocks.push(generateCoreBlock(corePool, readiness));
            }

            // 4. Cooldown
            const workedMuscles = finalSession.mainBlocks.flatMap(b => b.exercises).map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
            let stretches = utilityEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
            let priority = stretches.filter(ex => workedMuscles.includes(normalizeText(ex.parteCuerpo).split(' ')[0]));
            
            if (priority.length < 4) {
                const filler = shuffleArray(stretches.filter(x => !priority.includes(x))).slice(0, 4 - priority.length);
                priority = [...priority, ...filler];
            }

            finalSession.cooldown.exercises = priority.slice(0, 4).map(ex => ({
                id: ex.id,
                name: ex.nombre,
                instructions: ex.descripcion,
                durationOrReps: "30s por lado",
                imageUrl: ex.url
            }));

            // Duración estimada
            const setsTotal = finalSession.mainBlocks.flatMap(b => b.exercises).reduce((acc, curr) => acc + curr.sets, 0) + (finalSession.coreBlocks.flatMap(b => b.exercises).reduce((acc, curr) => acc + curr.sets, 0));
            finalSession.estimatedDurationMin = 10 + (setsTotal * 2.5) + 5; 
        }

        // GUARDADO
        await db.collection('users').doc(userId).update({ currentSession: finalSession });
        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}