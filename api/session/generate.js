import { db, auth } from '../../lib/firebaseAdmin.js';
import { format, differenceInCalendarWeeks, parseISO, subHours } from 'date-fns';
import { es } from 'date-fns/locale';

// ----------------------------------------------------
// 1. HELPERS DE NORMALIZACIÓN Y UTILIDAD
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
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// ----------------------------------------------------
// 2. MOTOR DE FILTRADO Y SELECCIÓN (HEURÍSTICA)
// ----------------------------------------------------

// Detecta el entorno general
const detectEnvironment = (equipmentList) => {
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('comercial') || eqString.includes('gym')) return 'gym';
    
    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        return i.includes('mancuerna') || i.includes('pesa') || i.includes('barra') || i.includes('disco') || i.includes('kettlebell') || (i.includes('banda') && !i.includes('mini'));
    });

    if (!hasLoad) return 'bodyweight';
    return 'home_equipment'; // Casa con equipo
};

// Filtra ejercicios por equipo disponible (Lógica Estricta)
const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises;

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipment || ex.equipo || "sin equipo");

        // 1. Bodyweight siempre pasa
        if (reqEq === "sin equipo" || reqEq === "peso corporal" || reqEq === "propio cuerpo" || reqEq === "suelo" || reqEq === "general") {
            return true; 
        }

        // 2. Si el usuario es puramente Bodyweight, rechazar externos
        if (environment === 'bodyweight') return false;

        // 3. Lógica Específica
        
        // Mini Bandas vs Bandas Largas
        if (reqEq.includes("mini")) {
            return userKeywords.some(k => k.includes("mini"));
        }
        if (reqEq.includes("banda") || reqEq.includes("elastica") || reqEq.includes("liga")) {
            // Debe tener banda Y esa banda NO debe ser "mini" para pasar este filtro
            return userKeywords.some(k => (k.includes("banda") || k.includes("liga") || k.includes("tubo")) && !k.includes("mini"));
        }

        // Foam Roller
        if (reqEq.includes("rodillo") || reqEq.includes("foam")) {
            return userKeywords.some(k => k.includes("rodillo") || k.includes("foam"));
        }

        // Mancuernas
        if (reqEq.includes("mancuerna") || reqEq.includes("dumbbell")) {
            return userKeywords.some(k => k.includes("mancuerna") || k.includes("dumbbell"));
        }

        // Kettlebells (Aceptamos mancuerna como sustituto si no es estricto, pero aquí seremos estrictos)
        if (reqEq.includes("kettlebell") || reqEq.includes("rusa")) {
            return userKeywords.some(k => k.includes("kettlebell") || k.includes("rusa"));
        }

        // Barras (Dominadas vs Pesas)
        if (reqEq.includes("barra")) {
            if (reqEq.includes("dominada") || reqEq.includes("pull up")) {
                return userKeywords.some(k => k.includes("dominada") || k.includes("pull up") || k.includes("marco"));
            }
            return userKeywords.some(k => k.includes("barra de peso") || k.includes("olimpica") || k.includes("z") || k.includes("discos"));
        }

        return false;
    });
};

// Filtra por Nivel (Jerarquía Inclusiva)
// Si eres Avanzado, puedes hacer ejercicios de Principiante. Si eres Principiante, NO puedes hacer Avanzados.
const filterByLevel = (exercises, userLevel) => {
    const normLevel = normalizeText(userLevel);
    let allowedLevels = ['principiante']; // Base

    if (normLevel.includes('intermedio')) {
        allowedLevels.push('intermedio');
    } else if (normLevel.includes('avanzado') || normLevel.includes('elite')) {
        allowedLevels.push('intermedio', 'avanzado');
    }

    return exercises.filter(ex => {
        const exLevel = normalizeText(ex.nivel || "principiante");
        return allowedLevels.some(l => exLevel.includes(l));
    });
};

// ----------------------------------------------------
// 3. EL "ARQUITECTO" DE SESIONES (Templates)
// ----------------------------------------------------

// Define la estructura de la sesión basada en el foco muscular
const getSessionTemplate = (focus, goal, level) => {
    const f = normalizeText(focus);
    const isHypertrophy = normalizeText(goal).includes('muscula') || normalizeText(goal).includes('estetica');
    
    // Estructura base de slots (huecos a llenar)
    // Tipos: 'compound' (multiarticular), 'isolation' (aislamiento), 'stability' (core/funcional)
    let template = [];

    // --- LÓGICA DE TREN INFERIOR ---
    if (f.includes('pierna') || f.includes('inferior') || f.includes('cuadriceps') || f.includes('gluteo')) {
        if (f.includes('cuadriceps')) {
            template = [
                { type: 'Multiarticular', target: ['cuadriceps', 'pierna'], count: 1, role: 'main' }, // Sentadilla
                { type: 'Multiarticular', target: ['cuadriceps', 'pierna'], count: 1, role: 'secondary' }, // Zancada/Prensa
                { type: 'Aislamiento', target: ['cuadriceps'], count: 1, role: 'accessory' }, // Extensiones
                { type: 'Aislamiento', target: ['gemelos', 'pantorrilla'], count: 1, role: 'finisher' }
            ];
        } else if (f.includes('gluteo') || f.includes('isquio') || f.includes('femoral')) {
            template = [
                { type: 'Multiarticular', target: ['gluteo', 'isquios', 'femoral'], count: 1, role: 'main' }, // Peso Muerto/Hip Thrust
                { type: 'Multiarticular', target: ['pierna', 'gluteo'], count: 1, role: 'secondary' }, // Zancada atrás
                { type: 'Aislamiento', target: ['gluteo', 'abductores'], count: 1, role: 'accessory' }, // Patada/Abducción
                { type: 'Aislamiento', target: ['isquios', 'femoral'], count: 1, role: 'accessory' } // Curl femoral
            ];
        } else {
            // Pierna General
            template = [
                { type: 'Multiarticular', target: ['cuadriceps', 'pierna'], count: 1, role: 'main' },
                { type: 'Multiarticular', target: ['gluteo', 'isquios'], count: 1, role: 'main' },
                { type: 'Aislamiento', target: ['cuadriceps'], count: 1, role: 'accessory' },
                { type: 'Aislamiento', target: ['isquios', 'gluteo'], count: 1, role: 'accessory' }
            ];
        }
    } 
    // --- LÓGICA DE EMPUJE (PUSH) ---
    else if (f.includes('empuje') || f.includes('pecho') || f.includes('hombro') || f.includes('triceps')) {
        template = [
            { type: 'Multiarticular', target: ['pecho', 'pectoral'], count: 1, role: 'main' }, // Press Banca
            { type: 'Multiarticular', target: ['hombro', 'deltoides'], count: 1, role: 'secondary' }, // Press Militar
            { type: 'Aislamiento', target: ['pecho', 'pectoral'], count: 1, role: 'accessory' }, // Aperturas
            { type: 'Aislamiento', target: ['triceps'], count: 1, role: 'accessory' }, // Extensiones
            { type: 'Aislamiento', target: ['hombro', 'deltoides'], count: 1, role: 'finisher' } // Elevaciones laterales
        ];
    }
    // --- LÓGICA DE TRACCIÓN (PULL) ---
    else if (f.includes('traccion') || f.includes('espalda') || f.includes('biceps')) {
        template = [
            { type: 'Multiarticular', target: ['espalda', 'dorsal'], count: 1, role: 'main' }, // Remo/Dominada
            { type: 'Multiarticular', target: ['espalda', 'trapecio', 'dorsal'], count: 1, role: 'secondary' }, // Jalón/Remo distinto
            { type: 'Aislamiento', target: ['espalda', 'lumbares'], count: 1, role: 'accessory' }, // Facepull/Hiperextension
            { type: 'Aislamiento', target: ['biceps'], count: 1, role: 'accessory' }, // Curl
            { type: 'Aislamiento', target: ['biceps'], count: 1, role: 'finisher' } // Martillo
        ];
    }
    // --- FULL BODY / OTROS ---
    else {
        template = [
            { type: 'Multiarticular', target: ['pierna', 'cuadriceps', 'gluteo'], count: 1, role: 'main' }, // Dominante Rodilla
            { type: 'Multiarticular', target: ['empuje', 'pecho', 'hombro'], count: 1, role: 'main' }, // Empuje
            { type: 'Multiarticular', target: ['traccion', 'espalda'], count: 1, role: 'main' }, // Tracción
            { type: 'Multiarticular', target: ['pierna', 'isquios', 'gluteo'], count: 1, role: 'secondary' }, // Dominante Cadera
            { type: 'Aislamiento', target: ['core', 'abdominales'], count: 1, role: 'finisher' }
        ];
    }

    return template;
};

// Determina Series y Repeticiones según el ejercicio y objetivo
const assignTrainingVariables = (exercise, role, goal, rpeContext) => {
    const goalNorm = normalizeText(goal);
    const eqNorm = normalizeText(exercise.equipo || exercise.equipment || "");
    const isBodyweight = eqNorm.includes('corporal') || eqNorm.includes('sin equipo');

    let sets = 3;
    let reps = "10-12";
    let notes = "";

    // 1. Lógica de Series
    if (role === 'main') sets = 4;
    if (role === 'finisher') sets = 2;

    // 2. Lógica de Reps
    if (goalNorm.includes('fuerza')) {
        reps = isBodyweight ? "Al fallo - 2" : "5-8";
    } else if (goalNorm.includes('resistencia') || goalNorm.includes('perdida')) {
        reps = "15-20";
    } else {
        // Hipertrofia (Default)
        if (role === 'main') reps = "8-10"; // Más pesado
        else reps = "12-15"; // Estrés metabólico
    }

    // Ajuste específico Bodyweight
    if (isBodyweight && !goalNorm.includes('resistencia')) {
        reps = "RIR 2 (Casi al fallo)"; 
    }

    return {
        sets,
        targetReps: reps,
        rpe: rpeContext ? parseInt(rpeContext.split('/')[0]) : 7,
        notes: notes
    };
};

// ----------------------------------------------------
// 4. HANDLER PRINCIPAL
// ----------------------------------------------------

export default async function handler(req, res) {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token Bearer.' });

    let userId;
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await auth.verifyIdToken(token);
        userId = decoded.uid;
    } catch (e) {
        return res.status(401).json({ error: 'Token inválido.' });
    }

    try {
        // 1. Obtener Contexto del Usuario
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle } = userData;

        if (!currentMesocycle || currentMesocycle.status !== 'active') return res.status(400).json({ error: 'No hay mesociclo activo.' });

        // 2. Calcular Fecha y Sesión
        let todayDate = req.body.date ? parseISO(req.body.date) : subHours(new Date(), 6);
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        if (!targetMicrocycle) return res.status(400).json({ error: `Semana ${currentWeekNum} no encontrada.` });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

        if (!targetSession) return res.status(200).json({ isRestDay: true, message: `Hoy es ${dayName}, descanso.` });

        // 3. Carga Inteligente de Colecciones (Optimización Lectura)
        const environment = detectEnvironment(profileData.availableEquipment);
        let collectionsToFetch = [db.collection('exercises_utility').get()];
        
        if (environment === 'gym') {
            collectionsToFetch.push(db.collection('exercises_gym_full').get());
        } else if (environment === 'bodyweight') {
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        } else {
            // Home Equipment: Carga AMBAS
            collectionsToFetch.push(db.collection('exercises_home_limited').get());
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        }

        const results = await Promise.all(collectionsToFetch);
        
        // Aplanar y Normalizar Data
        let allExercises = [];
        const processSnap = (snap) => snap.forEach(doc => allExercises.push({ id: doc.id, ...doc.data() }));
        
        // La [0] es Utility, las demás son Main
        const utilityExercises = [];
        results[0].forEach(doc => utilityExercises.push({ id: doc.id, ...doc.data() }));
        
        for (let i = 1; i < results.length; i++) {
            processSnap(results[i]);
        }

        // 4. Aplicar Filtros Globales (Equipo y Nivel)
        // Aquí aplicamos la lógica de bandas, bodyweight inclusion, etc.
        let availableMain = filterExercisesByEquipment(allExercises, profileData.availableEquipment);
        availableMain = filterByLevel(availableMain, profileData.experienceLevel);

        let availableUtility = filterExercisesByEquipment(utilityExercises, profileData.availableEquipment);

        // 5. Construcción de la Sesión (Algoritmo Heurístico)
        const template = getSessionTemplate(targetSession.sessionFocus, profileData.fitnessGoal, profileData.experienceLevel);
        const mainBlockExercises = [];
        
        // Rellenar Template
        template.forEach(slot => {
            // Buscar candidatos que coincidan con Tipo y Músculo Objetivo
            const candidates = availableMain.filter(ex => {
                const exType = normalizeText(ex.tipo || "");
                const exTarget = normalizeText(ex.musculoObjetivo || "");
                const exPart = normalizeText(ex.parteCuerpo || "");
                const slotType = normalizeText(slot.type);

                // Coincidencia de Tipo (Flexible: Multiarticular vs Aislamiento)
                const typeMatch = exType.includes(slotType); // "Multiarticular" incluye "Multi"
                
                // Coincidencia de Músculo (Cualquiera de los targets del slot)
                const muscleMatch = slot.target.some(t => exTarget.includes(t) || exPart.includes(t));

                // Evitar duplicados en la sesión actual
                const alreadySelected = mainBlockExercises.some(sel => sel.id === ex.id);

                return typeMatch && muscleMatch && !alreadySelected;
            });

            if (candidates.length > 0) {
                // Seleccionar random o el mejor (aquí usamos shuffle)
                const selected = shuffleArray(candidates)[0];
                
                // Calcular Series/Reps
                const variables = assignTrainingVariables(selected, slot.role, profileData.fitnessGoal, targetMicrocycle.intensityRpe);

                mainBlockExercises.push({
                    id: selected.id,
                    name: selected.nombre || selected.name,
                    description: selected.descripcion,
                    imageUrl: selected.url || null,
                    muscleTarget: selected.musculoObjetivo,
                    equipment: selected.equipo,
                    ...variables
                });
            }
        });

        // 6. Generar Calentamiento y Enfriamiento (Contextual)
        const focusKeywords = normalizeText(targetSession.sessionFocus).split(" ");
        
        // Calentamiento: Buscar tipo 'calentamiento' y coincidencia muscular o 'full body'
        const warmupExercises = availableUtility
            .filter(ex => {
                const t = normalizeText(ex.tipo || "");
                const p = normalizeText(ex.parteCuerpo || "" + ex.musculoObjetivo || "");
                return t === 'calentamiento' && (p.includes('full') || focusKeywords.some(k => p.includes(k)));
            })
            .slice(0, 2)
            .map(ex => ({
                id: ex.id,
                name: ex.nombre,
                description: ex.descripcion,
                durationOrReps: "60 seg / 15 reps dinámicas",
                imageUrl: ex.url
            }));

        // Enfriamiento: Buscar tipo 'estiramiento'
        const cooldownExercises = availableUtility
            .filter(ex => {
                const t = normalizeText(ex.tipo || "");
                const p = normalizeText(ex.parteCuerpo || "" + ex.musculoObjetivo || "");
                return t === 'estiramiento' && (p.includes('full') || focusKeywords.some(k => p.includes(k)));
            })
            .slice(0, 2)
            .map(ex => ({
                id: ex.id,
                name: ex.nombre,
                description: ex.descripcion,
                duration: "30-45 seg por lado",
                imageUrl: ex.url
            }));

        // 7. Determinar Estructura del Bloque Principal (Circuito vs Estaciones)
        // Regla: Si es Principiante, Full Body o Perdida de Peso -> Circuito. Si no -> Station.
        const isBeginner = normalizeText(profileData.experienceLevel).includes('principiante');
        const isFatLoss = normalizeText(profileData.fitnessGoal).includes('perdida');
        const isFullBody = normalizeText(targetSession.sessionFocus).includes('full');

        const blockType = (isBeginner || isFatLoss || isFullBody) ? "circuit" : "station";

        // 8. Respuesta Final JSON
        const finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: blockType === 'circuit' ? 45 : 60,
            warmup: { exercises: warmupExercises.length ? warmupExercises : [{id: 'gen', name: 'Movilidad General', durationOrReps: '5 min'}] },
            mainBlocks: [
                {
                    blockType: blockType,
                    exercises: mainBlockExercises
                }
            ],
            cooldown: { exercises: cooldownExercises.length ? cooldownExercises : [{id: 'gen', name: 'Estiramiento Suave', duration: '5 min'}] },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                week: currentWeekNum,
                focus: targetSession.sessionFocus,
                algorithm: "v1-heuristic-rule-based" // Transparencia
            },
            completed: false
        };

        // Guardar en Firebase
        await userDocRef.update({ currentSession: finalSession });

        console.log(`>>> SESIÓN GENERADA (Algoritmo): ${userId} - ${targetSession.sessionFocus}`);
        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("FATAL ERROR:", error);
        return res.status(500).json({ error: error.message });
    }
}