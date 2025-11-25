import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

// ====================================================================
// 1. MOTORES DE LÓGICA DEPORTIVA (V4.1 - PRECISION WEIGHTS)
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

    // Score del 0 al 5 (Energía pesa más)
    const readinessScore = ((energy * 2) + (6 - soreness)) / 3; 

    let mode = 'standard';
    if (energy <= 2 || soreness >= 4) mode = 'survival'; 
    else if (energy >= 4 && soreness <= 2) mode = 'performance'; 

    return { score: readinessScore, mode, energy, soreness };
};

// --- B. HISTORIAL Y SOBRECARGA ---
const getProgressiveOverload = (exerciseId, userHistory) => {
    let lastSession = null;
    let lastExerciseData = null;

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

    const lastRpe = lastSession.feedback?.rpe || 7;
    const lastReps = lastExerciseData.targetReps || "10";
    const repsMatch = lastReps.toString().match(/(\d+)/);
    const prevRepVal = repsMatch ? parseInt(repsMatch[0]) : 10;
    
    // Recuperamos el peso que usó la última vez si está registrado en las notas o sugerencia
    // (Nota: Esto es una mejora futura, por ahora nos basamos en RPE)

    if (lastRpe <= 7) {
        return `⚡ PROGRESO: La última vez fue fácil (RPE ${lastRpe}). Sube el peso o haz +2 reps (Meta: ${prevRepVal + 2}).`;
    } else if (lastRpe >= 9) {
        return `🛡️ MANTENIMIENTO: La última vez fue dura. Mantén peso, mejora técnica.`;
    } else {
        return `🔥 RETO: Intenta hacer 1 repetición más que la vez pasada (${prevRepVal + 1}).`;
    }
};

// --- C. PARÁMETROS DINÁMICOS ---
const getDynamicSessionParams = (readiness, sessionFocus, equipmentType) => {
    const { mode } = readiness;
    const focusNorm = normalizeText(sessionFocus);
    const isMetabolic = focusNorm.includes('metabolico') || focusNorm.includes('cardio');
    const limitedWeight = equipmentType === 'home_limited' || equipmentType === 'bodyweight';

    let params = {
        setsCompound: 4, setsIsolation: 3,
        repsCompound: "8-12", repsIsolation: "12-15",
        restCompound: 90, restIsolation: 60,
        techniqueNote: "",
        rpeCompound: 8, rpeIsolation: 9
    };

    if (mode === 'survival') {
        params.setsCompound = 3; params.setsIsolation = 2;
        params.restCompound = 120; params.restIsolation = 90;
        params.rpeCompound = 6; params.rpeIsolation = 7;
        params.techniqueNote = "Enfoque en técnica perfecta y control. No busques el fallo hoy.";
    } else if (mode === 'performance') {
        params.setsCompound = 5; params.setsIsolation = 4;
        params.restCompound = 150; params.restIsolation = 75;
        params.rpeCompound = 9; params.rpeIsolation = 10;
        params.techniqueNote = "Día de alto rendimiento. Ataca los pesos pesados con confianza.";
    }

    if (limitedWeight && !isMetabolic && mode !== 'survival') {
        params.repsCompound = "15-20 (Tempo 3-0-1)";
        params.repsIsolation = "20-30 (Al fallo)";
        params.restCompound = 60;
        params.techniqueNote += " Controla la bajada en 3 segundos.";
    }

    return params;
};

// --- D. LÓGICA DE SELECCIÓN DE PESO EXACTO (CORREGIDA) ---
const assignLoadSuggestion = (exercise, userInventory, sessionMode) => {
    const targetEquipmentRaw = normalizeText(exercise.equipo || "");
    
    // 1. Caso: Peso Corporal
    if (targetEquipmentRaw.includes("corporal") || targetEquipmentRaw.includes("suelo") || targetEquipmentRaw.includes("sin equipo")) {
        return { equipmentName: "Peso Corporal", suggestedLoad: "Tu propio peso" };
    }

    // 2. Caso: Gimnasio Comercial (Asumimos tiene todo)
    if (detectEnvironment(userInventory) === 'gym') {
        if (targetEquipmentRaw.includes('mancuerna')) return { equipmentName: "Mancuernas", suggestedLoad: "Peso exigente para el rango de reps" };
        if (targetEquipmentRaw.includes('barra')) return { equipmentName: "Barra Olímpica", suggestedLoad: "Carga discos adecuados" };
        if (targetEquipmentRaw.includes('cable') || targetEquipmentRaw.includes('polea')) return { equipmentName: "Polea", suggestedLoad: "Ajusta placa según RPE" };
        return { equipmentName: exercise.equipo || "Equipo Gym", suggestedLoad: "Ajustar a RPE" };
    }

    // 3. Caso: Casa (Inventario Limitado) - LÓGICA DE PRECISIÓN
    
    // A. Detectar qué herramienta específica pide el ejercicio
    let specificTool = null;
    if (targetEquipmentRaw.includes("mancuerna")) specificTool = "mancuerna";
    else if (targetEquipmentRaw.includes("barra")) specificTool = "barra"; // Cubre "barra de pesos", "barra z"
    else if (targetEquipmentRaw.includes("kettlebell") || targetEquipmentRaw.includes("pesa rusa")) specificTool = "kettlebell";
    
    // Si no pide herramienta de peso (ej. banda), retornamos genérico o buscamos banda
    if (!specificTool) {
        if (targetEquipmentRaw.includes("banda") || targetEquipmentRaw.includes("liga")) {
             // Buscar qué banda tiene
             const band = userInventory.find(i => normalizeText(i).includes("banda") || normalizeText(i).includes("liga"));
             return { equipmentName: band || "Banda Elástica", suggestedLoad: "Resistencia adecuada" };
        }
        return { equipmentName: exercise.equipo, suggestedLoad: "Según disponibilidad" };
    }

    // B. Filtrar el inventario SOLO por esa herramienta
    // Ejemplo: Si pide "Barra", filtramos strings que digan "Barra".
    const relevantItems = userInventory.filter(item => normalizeText(item).includes(specificTool));

    if (relevantItems.length === 0) {
        // Fallback: Pide barra pero no tengo. ¿Tengo mancuernas?
        if (specificTool === 'barra') {
             const dumbbells = userInventory.filter(i => normalizeText(i).includes('mancuerna'));
             if (dumbbells.length > 0) {
                 // RECURSIVIDAD SIMPLE: Llamamos a la lógica como si pidiera mancuernas
                 const mockEx = { ...exercise, equipo: "Mancuernas" };
                 const fallbackResult = assignLoadSuggestion(mockEx, userInventory, sessionMode);
                 return { 
                     equipmentName: fallbackResult.equipmentName, 
                     suggestedLoad: `${fallbackResult.suggestedLoad} (Sustituyendo Barra)` 
                 };
             }
        }
        return { equipmentName: exercise.equipo, suggestedLoad: "No tienes este equipo exacto" };
    }

    // C. Extraer pesos numéricos
    // El frontend guarda: "Mancuernas (10kg)", "Barra de Pesos Libres (40kg)"
    const weightedItems = relevantItems.map(item => {
        const match = item.match(/\((\d+(\.\d+)?)\s*(kg|lbs)\)/i) || item.match(/(\d+)\s*(kg|lbs)/i);
        const weightVal = match ? parseFloat(match[1]) : 0;
        return {
            fullName: item, // "Mancuernas (10kg)"
            weight: weightVal
        };
    }).sort((a, b) => a.weight - b.weight); // Ordenar ascendente (Ligero -> Pesado)

    // D. Selección Táctica del Peso
    const exType = normalizeText(exercise.tipo || "");
    const isCompound = exType.includes("multi") || exType.includes("compuesto");
    
    let selected = weightedItems[0]; // Default: el más ligero

    if (weightedItems.length > 1) {
        if (sessionMode === 'survival') {
            // Modo Supervivencia: Usar pesos medios/bajos siempre
            const midIndex = Math.floor((weightedItems.length - 1) / 2);
            selected = weightedItems[midIndex];
        } else {
            // Modo Normal/Performance
            if (isCompound) {
                // Compuestos (Sentadilla, Press): Usar el PESADO
                selected = weightedItems[weightedItems.length - 1]; 
            } else {
                // Aislamiento (Curl, Elevaciones): Usar MEDIO o LIGERO (evitar el máximo si hay opciones)
                // Si tengo [5, 10, 15, 20], para elevaciones laterales no quiero 20. Quiero 10.
                const idealIndex = Math.max(0, Math.floor((weightedItems.length - 1) / 2));
                selected = weightedItems[idealIndex];
            }
        }
    }

    // Si el peso es 0 (no se detectó número), devolvemos el nombre tal cual
    const displayLoad = selected.weight > 0 
        ? `Usa: ${selected.fullName}` 
        : `Usa: ${selected.fullName}`;

    return { 
        equipmentName: selected.fullName.split('(')[0].trim(), // "Mancuernas" (sin el peso para el título corto)
        suggestedLoad: displayLoad // "Usa: Mancuernas (10kg)"
    };
};

// ====================================================================
// 2. SELECCIÓN Y FILTRADO (CORREGIDO - BANDAS STRICT)
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
        
        // 1. Peso Corporal siempre pasa
        if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;
        if (environment === 'bodyweight') return false;

        // 2. Lógica de Bandas ESTRICTA (CORRECCIÓN IMPORTANTE)
        if (reqEq.includes("banda") || reqEq.includes("liga")) {
            const needsMini = reqEq.includes("mini") || reqEq.includes("loop") || reqEq.includes("gluteo");
            
            if (needsMini) {
                // Si el ejercicio pide MINI, el usuario debe tener MINI
                return userKeywords.some(k => k.includes("mini"));
            } else {
                // Si el ejercicio pide BANDA (larga/asas), el usuario debe tener BANDA (no solo mini)
                return userKeywords.some(k => (k.includes("banda") || k.includes("liga")) && !k.includes("mini"));
            }
        }

        // 3. Resto del equipo (Coincidencia parcial segura)
        if (reqEq.includes("mancuerna") && userKeywords.some(k => k.includes("mancuerna"))) return true;
        if (reqEq.includes("barra") && userKeywords.some(k => k.includes("barra"))) return true;
        if (reqEq.includes("kettlebell") && userKeywords.some(k => k.includes("kettlebell") || k.includes("pesa rusa"))) return true;

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
            notes: "Abdomen contraído."
        }))
    };
};

const generateMainBlock = (pool, sessionFocus, params, userHistory) => {
    const focus = normalizeText(sessionFocus);
    let template = [];
    let isCircuit = false;
    const { setsCompound, setsIsolation, repsCompound, repsIsolation, rpeCompound, rpeIsolation, techniqueNote } = params;

    // Patrones de Movimiento
    if (focus.includes('full') || focus.includes('metabolico') || focus.includes('acondicionamiento')) {
        isCircuit = true; 
        template = [
            { pattern: ['pierna', 'cuadriceps'], role: 'compound' }, 
            { pattern: ['empuje', 'pecho', 'hombro'], role: 'compound' }, 
            { pattern: ['traccion', 'espalda'], role: 'compound' }, 
            { pattern: ['gluteo', 'isquios'], role: 'compound' }, 
        ];
    } else if (focus.includes('torso') || focus.includes('superior')) {
        template = [
            { pattern: ['pecho', 'empuje'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'compound' }, 
            { pattern: ['hombro', 'pecho'], role: 'compound' }, 
            { pattern: ['espalda', 'traccion'], role: 'isolation' }, 
            { pattern: ['triceps', 'biceps'], role: 'isolation' } 
        ];
    } else if (focus.includes('empuje') || focus.includes('push') || focus.includes('pecho')) {
        template = [
            { pattern: ['pecho', 'pectoral'], role: 'compound' }, 
            { pattern: ['hombro', 'deltoides'], role: 'compound' }, 
            { pattern: ['pecho', 'hombro'], role: 'isolation' }, 
            { pattern: ['triceps'], role: 'isolation' }, 
            { pattern: ['triceps'], role: 'isolation' } 
        ];
    } else if (focus.includes('traccion') || focus.includes('pull') || focus.includes('espalda')) {
        template = [
            { pattern: ['espalda', 'dorsal'], role: 'compound' }, 
            { pattern: ['traccion', 'remo'], role: 'compound' }, 
            { pattern: ['espalda', 'posterior'], role: 'isolation' }, 
            { pattern: ['biceps'], role: 'isolation' }, 
            { pattern: ['biceps'], role: 'isolation' } 
        ];
    } else {
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
        const candidates = pool.filter(ex => {
            if (usedIds.has(ex.id)) return false;
            const targets = normalizeText((ex.musculoObjetivo || "") + " " + (ex.parteCuerpo || ""));
            const type = normalizeText(ex.tipo || "");
            const matchesPattern = slot.pattern.some(p => targets.includes(p));
            // Prioridad de rol, pero flexible
            return matchesPattern;
        });

        if (candidates.length > 0) {
            // Intentar buscar match perfecto de rol (compuesto vs aislamiento)
            let pick = candidates.find(c => slot.role === 'compound' ? normalizeText(c.tipo).includes('multi') : normalizeText(c.tipo).includes('aislamiento'));
            if (!pick) pick = candidates[0]; // Fallback

            usedIds.add(pick.id);
            const isCompound = slot.role === 'compound';
            
            // LÓGICA DE PESO EXACTO
            const loadSuggestion = assignLoadSuggestion(pick, params.userInventory, params.sessionMode);
            const overloadNote = getProgressiveOverload(pick.id, userHistory);
            
            const finalNotes = overloadNote ? `${overloadNote} ${techniqueNote}` : techniqueNote;

            selectedExercises.push({
                id: pick.id,
                name: pick.nombre,
                instructions: pick.descripcion,
                imageUrl: pick.url || null,
                url: pick.videoUrl || null,
                equipment: loadSuggestion.equipmentName,
                suggestedLoad: loadSuggestion.suggestedLoad, // <--- "Usa: Mancuernas (15kg)"
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

        const userRef = db.collection('users').doc(userId);
        const [userDoc, historySnapshot] = await Promise.all([
            userRef.get(),
            userRef.collection('history').orderBy('meta.date', 'desc').limit(15).get()
        ]);

        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const { profileData, currentMesocycle } = userDoc.data();
        if (!currentMesocycle) return res.status(400).json({ error: 'No hay plan activo.' });

        const userHistory = historySnapshot.docs.map(doc => doc.data());
        const dateStringRaw = req.body.date || format(new Date(), 'yyyy-MM-dd');
        const sessionDate = parseISO(dateStringRaw);

        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(sessionDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = weeksPassed + 1;

        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: "Plan finalizado o fecha inválida." });

        const dayName = format(sessionDate, 'EEEE', { locale: es });
        let targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());
        if (!targetSession) targetSession = { sessionFocus: "Descanso / Recuperación" };

        // Input de Feedback
        const feedback = req.body.realTimeFeedback || {};
        const isRecoveryFlag = req.body.isRecovery || normalizeText(targetSession.sessionFocus).includes('recuperacion');

        const readiness = calculateReadiness(feedback);
        const equipmentType = detectEnvironment(profileData.availableEquipment);
        
        const sessionParams = getDynamicSessionParams(readiness, targetSession.sessionFocus, equipmentType);
        sessionParams.userInventory = profileData.availableEquipment || [];
        sessionParams.sessionMode = readiness.mode;

        // Carga de Pools
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

        // UNIFICACIÓN Y FILTRADO (El filtro ahora es estricto con bandas)
        let fullMainPool = [...mainExPoolRaw, ...bodyweightEx.filter(e => normalizeText(e.parteCuerpo) !== 'core')];
        fullMainPool = filterExercisesByEquipment(fullMainPool, profileData.availableEquipment || []);
        fullMainPool = filterExercisesByLevel(fullMainPool, profileData.experienceLevel);
        
        const bodyweightFiltered = filterExercisesByLevel(bodyweightEx, profileData.experienceLevel);
        const corePool = bodyweightFiltered.filter(e => normalizeText(e.parteCuerpo) === 'core');

        // Construcción
        let finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: 60,
            warmup: { exercises: [] },
            mainBlocks: [],
            coreBlocks: [],
            cooldown: { exercises: [] },
            meta: {
                date: dateStringRaw,
                generatedAt: new Date().toISOString(),
                readinessScore: readiness.score,
                sessionMode: readiness.mode
            }
        };

        if (isRecoveryFlag) {
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
                    notes: "Movimiento fluido."
                }))
            }];
        } else {
            finalSession.warmup.exercises = generateWarmup(utilityEx, bodyweightFiltered, targetSession.sessionFocus);
            
            // MAIN BLOCK
            const mainBlock = generateMainBlock(fullMainPool, targetSession.sessionFocus, sessionParams, userHistory);

            const blockRestSets = mainBlock.type === 'circuit' ? Math.max(90, sessionParams.restCompound + 30) : sessionParams.restCompound;
            const blockRestEx = mainBlock.type === 'circuit' ? 15 : sessionParams.restIsolation;

            finalSession.mainBlocks = [{
                blockType: mainBlock.type,
                restBetweenSetsSec: blockRestSets,
                restBetweenExercisesSec: blockRestEx,
                exercises: mainBlock.exercises
            }];

            if (corePool.length > 0) {
                 const coreBlock = generateCoreBlock(corePool, readiness);
                 if (coreBlock) finalSession.coreBlocks.push(coreBlock);
            }

            const workedMuscles = finalSession.mainBlocks.flatMap(b => b.exercises).map(e => normalizeText(e.musculoObjetivo || "")).join(" ");
            let stretches = utilityEx.filter(ex => normalizeText(ex.tipo).includes('estiramiento'));
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

            const setsTotal = finalSession.mainBlocks.flatMap(b => b.exercises).reduce((acc, curr) => acc + curr.sets, 0); 
            finalSession.estimatedDurationMin = 10 + (setsTotal * 3) + 5; 
        }

        await db.collection('users').doc(userId).update({ currentSession: finalSession });
        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("ERROR GENERATING SESSION:", error);
        return res.status(500).json({ error: error.message });
    }
}