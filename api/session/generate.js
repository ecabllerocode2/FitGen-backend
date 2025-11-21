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
// 2. MOTOR DE FILTRADO Y SELECCIÓN
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

// Filtra ejercicios PRINCIPALES por equipo
const filterExercisesByEquipment = (exercises, userEquipmentList) => {
    const environment = detectEnvironment(userEquipmentList);
    const userKeywords = userEquipmentList.map(e => normalizeText(e));

    if (environment === 'gym') return exercises;

    return exercises.filter(ex => {
        const reqEq = normalizeText(ex.equipment || ex.equipo || "sin equipo");
        
        if (reqEq === "sin equipo" || reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "general") return true; 
        if (environment === 'bodyweight') return false;

        // Lógica específica
        if (reqEq.includes("mini")) return userKeywords.some(k => k.includes("mini"));
        if (reqEq.includes("banda") || reqEq.includes("elastica")) return userKeywords.some(k => (k.includes("banda") || k.includes("liga")) && !k.includes("mini"));
        if (reqEq.includes("mancuerna")) return userKeywords.some(k => k.includes("mancuerna"));
        if (reqEq.includes("kettlebell")) return userKeywords.some(k => k.includes("kettlebell") || k.includes("rusa"));
        if (reqEq.includes("barra")) {
            if (reqEq.includes("dominada")) return userKeywords.some(k => k.includes("dominada") || k.includes("pull up"));
            return userKeywords.some(k => k.includes("barra de peso") || k.includes("discos"));
        }

        return false;
    });
};

// --- LÓGICA PARA UTILITY (Calentamiento/Cooldown) ---
const selectUtilityExercises = (utilityPool, type, userEquipmentList, count = 2) => {
    const userKeywords = userEquipmentList.map(e => normalizeText(e));
    const targetType = normalizeText(type); // 'calentamiento' o 'estiramiento'

    const candidates = utilityPool.filter(ex => {
        // 1. Filtro por Tipo
        const exType = normalizeText(ex.tipo || "");
        if (!exType.includes(targetType)) return false;

        // 2. Filtro por Equipo (Específico para Utility)
        const exEq = normalizeText(ex.equipo || "peso corporal");
        
        // Si pide Foam Roller
        if (exEq.includes("rodillo") || exEq.includes("foam")) {
            return userKeywords.some(k => k.includes("rodillo") || k.includes("foam"));
        }
        // Si pide Mini Bandas
        if (exEq.includes("mini") || exEq.includes("banda")) {
            return userKeywords.some(k => k.includes("mini") || k.includes("banda"));
        }
        // Si es Peso Corporal (Default)
        return true;
    });

    return shuffleArray(candidates).slice(0, count).map(ex => ({
        id: ex.id,
        name: ex.nombre,
        instructions: ex.descripcion, // Mapeo para el Frontend
        durationOrReps: targetType.includes('calenta') ? "60 seg" : "45 seg por lado",
        // 👇 CORRECCIÓN 1: Mapeamos el video a 'url' explícitamente
        url: ex.url || null, 
        imageUrl: ex.imagen || null, 
        equipment: ex.equipo
    }));
};

// ----------------------------------------------------
// 3. EL "ARQUITECTO" DE SESIONES
// ----------------------------------------------------

// ----------------------------------------------------
// LÓGICA DE TEMPLATES (EVIDENCIA CIENTÍFICA)
// ----------------------------------------------------
const getSessionTemplate = (focus, goal) => {
    const f = normalizeText(focus);
    const g = normalizeText(goal);
    
    // Definimos roles:
    // 'main': Ejercicio principal, carga pesada, descanso largo.
    // 'secondary': Ejercicio compuesto complementario o unilateral.
    // 'accessory': Ejercicio de aislamiento o máquina.
    // 'finisher': Ejercicio de detalle, metabólico o core.

    let template = [];

    // =================================================
    // 1. TREN INFERIOR (LEGS)
    // =================================================
    
    // A. Énfasis Cuádriceps (Rodilla Dominante)
    if (f.includes('cuadriceps')) {
        template = [
            // 1. Patrón de Sentadilla (Bilateral) - El Rey del día
            { type: 'Multiarticular', target: ['cuadriceps', 'pierna'], count: 1, role: 'main' }, 
            // 2. Patrón Unilateral (Zancadas/Bulgaras) - Estabilidad y simetría
            { type: 'Multiarticular', target: ['cuadriceps', 'gluteo'], count: 1, role: 'secondary' }, 
            // 3. Aislamiento Cuádriceps (Extensiones) - Estrés metabólico sin carga axial
            { type: 'Aislamiento', target: ['cuadriceps'], count: 1, role: 'accessory' }, 
            // 4. Cadena Posterior (Para balancear la rodilla)
            { type: 'Aislamiento', target: ['isquios', 'femoral'], count: 1, role: 'finisher' },
            // 5. Pantorrillas (Opcional pero recomendado)
            { type: 'Aislamiento', target: ['gemelos', 'pantorrilla'], count: 1, role: 'finisher' }
        ];
    } 
    // B. Énfasis Glúteos e Isquios (Cadera Dominante)
    else if (f.includes('gluteo') || f.includes('isquio') || f.includes('femoral')) {
        template = [
            // 1. Patrón de Bisagra Pesado (Peso Muerto / Hip Thrust)
            { type: 'Multiarticular', target: ['gluteo', 'isquios', 'femoral'], count: 1, role: 'main' }, 
            // 2. Patrón Unilateral o Accesorio Compuesto (Zancada Atrás / Prensa pies altos)
            { type: 'Multiarticular', target: ['gluteo', 'pierna'], count: 1, role: 'secondary' }, 
            // 3. Flexión de Rodilla (Curl Femoral) - Aislamiento Isquios
            { type: 'Aislamiento', target: ['isquios', 'femoral'], count: 1, role: 'accessory' }, 
            // 4. Abducción de Cadera (Glúteo Medio/Minimo) - Estabilidad pélvica
            { type: 'Aislamiento', target: ['gluteo', 'abductores'], count: 1, role: 'finisher' }
        ];
    } 
    // C. Pierna General (Equilibrado)
    else if (f.includes('pierna') || f.includes('inferior')) {
        template = [
            // 1. Dominante de Rodilla (Sentadilla)
            { type: 'Multiarticular', target: ['cuadriceps', 'pierna'], count: 1, role: 'main' }, 
            // 2. Dominante de Cadera (Peso Muerto Rumano / Hip Thrust)
            { type: 'Multiarticular', target: ['isquios', 'gluteo'], count: 1, role: 'main' }, 
            // 3. Unilateral o Prensa
            { type: 'Multiarticular', target: ['pierna', 'cuadriceps'], count: 1, role: 'secondary' }, 
            // 4. Aislamiento (Extensiones o Curl)
            { type: 'Aislamiento', target: ['cuadriceps', 'isquios'], count: 1, role: 'finisher' }
        ];
    }

    // =================================================
    // 2. TREN SUPERIOR (UPPER BODY)
    // =================================================

    // D. Empuje / Push (Pecho, Hombro, Tríceps)
    else if (f.includes('empuje') || f.includes('push') || f.includes('pecho')) {
        template = [
            // 1. Empuje Horizontal Pesado (Press Banca / Flexiones lastradas)
            { type: 'Multiarticular', target: ['pecho', 'pectoral'], count: 1, role: 'main' }, 
            // 2. Empuje Vertical (Press Militar / Hombros)
            { type: 'Multiarticular', target: ['hombro', 'deltoides'], count: 1, role: 'secondary' }, 
            // 3. Aislamiento Pecho (Aperturas / Cruces) - Estiramiento bajo carga
            { type: 'Aislamiento', target: ['pecho', 'pectoral'], count: 1, role: 'accessory' }, 
            // 4. Tríceps (Extensión codo)
            { type: 'Aislamiento', target: ['triceps'], count: 1, role: 'accessory' }, 
            // 5. Deltoides Lateral (Para estética/anchura)
            { type: 'Aislamiento', target: ['hombro', 'deltoides'], count: 1, role: 'finisher' }
        ];
    }
    // E. Tracción / Pull (Espalda, Trapecio, Bíceps)
    else if (f.includes('traccion') || f.includes('pull') || f.includes('espalda')) {
        template = [
            // 1. Tracción Vertical (Dominadas / Jalón al pecho) - Anchura
            { type: 'Multiarticular', target: ['espalda', 'dorsal'], count: 1, role: 'main' }, 
            // 2. Tracción Horizontal (Remos) - Densidad/Grosor
            { type: 'Multiarticular', target: ['espalda', 'trapecio', 'remo'], count: 1, role: 'secondary' }, 
            // 3. Deltoides Posterior / Trapecio (Salud del hombro)
            { type: 'Aislamiento', target: ['espalda', 'hombro', 'posterior'], count: 1, role: 'accessory' }, 
            // 4. Bíceps (Curl básico)
            { type: 'Aislamiento', target: ['biceps'], count: 1, role: 'accessory' },
            // 5. Antebrazo o Bíceps braquial (Martillo)
            { type: 'Aislamiento', target: ['biceps', 'antebrazo'], count: 1, role: 'finisher' }
        ];
    }
    // F. Torso Completo (Upper Body General)
    else if (f.includes('torso') || f.includes('superior')) {
        template = [
            // 1. Empuje Principal
            { type: 'Multiarticular', target: ['pecho', 'pectoral'], count: 1, role: 'main' }, 
            // 2. Tracción Principal
            { type: 'Multiarticular', target: ['espalda', 'dorsal'], count: 1, role: 'main' }, 
            // 3. Empuje Secundario (Hombro)
            { type: 'Multiarticular', target: ['hombro', 'deltoides'], count: 1, role: 'secondary' }, 
            // 4. Tracción Secundaria (Remo)
            { type: 'Multiarticular', target: ['espalda', 'remo'], count: 1, role: 'secondary' }, 
            // 5. Brazos (Superserie implícita en la selección o ejercicio simple)
            { type: 'Aislamiento', target: ['triceps', 'biceps'], count: 1, role: 'finisher' }
        ];
    }

    // =================================================
    // 3. FULL BODY (CUERPO COMPLETO)
    // =================================================

    // G. Full Body
    else {
        // Estructura clásica de cuerpo completo equilibrado
        template = [
            // 1. Dominante de Rodilla (Lo más demandante metabólicamente)
            { type: 'Multiarticular', target: ['pierna', 'cuadriceps'], count: 1, role: 'main' }, 
            // 2. Empuje de Tren Superior
            { type: 'Multiarticular', target: ['empuje', 'pecho', 'hombro'], count: 1, role: 'main' }, 
            // 3. Dominante de Cadera
            { type: 'Multiarticular', target: ['isquios', 'gluteo', 'espalda'], count: 1, role: 'main' }, 
            // 4. Tracción de Tren Superior
            { type: 'Multiarticular', target: ['traccion', 'espalda'], count: 1, role: 'secondary' }, 
            // 5. Core / Abdominales (Estabilidad)
            { type: 'Aislamiento', target: ['core', 'abdominales', 'plancha'], count: 1, role: 'finisher' }
        ];
    }

    return template;
};

// Determina Series, Reps y Tiempos de Descanso
const assignTrainingVariables = (exercise, role, goal, blockType) => {
    const goalNorm = normalizeText(goal);
    const isBodyweight = normalizeText(exercise.equipo || "").includes('corporal');

    let sets = role === 'main' ? 4 : 3;
    let reps = "10-12";
    let rpe = 7;

    // Lógica de Reps
    if (goalNorm.includes('fuerza') && !isBodyweight) {
        reps = "6-8";
        rpe = 8;
    } else if (goalNorm.includes('resistencia') || goalNorm.includes('perdida')) {
        reps = "15-20";
        rpe = 7;
    } else {
        reps = role === 'main' ? "8-10" : "12-15"; // Hipertrofia
    }

    if (isBodyweight && !goalNorm.includes('resistencia')) reps = "Casi al fallo (RIR 2)";

    return { sets, targetReps: reps, rpe };
};

// --- LÓGICA DE ESTRUCTURA DE BLOQUE (Station vs Circuit) ---
const determineBlockStructure = (goal, level, sessionFocus) => {
    const g = normalizeText(goal);
    const l = normalizeText(level);
    const f = normalizeText(sessionFocus);

    // 1. Circuito: Principiantes, Pérdida de Peso o Full Body
    if (l.includes('principiante') || g.includes('perdida') || f.includes('full')) {
        return {
            blockType: 'circuit',
            restBetweenExercisesSec: 15, // Transición rápida
            restBetweenSetsSec: 90 // Descanso al final de la vuelta
        };
    }

    // 2. Estaciones (Series Planas): Fuerza o Hipertrofia Estándar
    if (g.includes('fuerza') || g.includes('muscular')) {
        return {
            blockType: 'station',
            restBetweenExercisesSec: 60, // Entre ejercicios distintos
            restBetweenSetsSec: g.includes('fuerza') ? 120 : 90 // Descanso entre series del mismo ejercicio
        };
    }

    // Default
    return { blockType: 'station', restBetweenSetsSec: 60, restBetweenExercisesSec: 60 };
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
        // 1. Carga de Datos Usuario
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });
        const { profileData, currentMesocycle } = userDoc.data();

        // Validar fecha y sesión del día
        let todayDate = req.body.date ? parseISO(req.body.date) : subHours(new Date(), 6);
        const startDate = parseISO(currentMesocycle.startDate);
        const weeksPassed = differenceInCalendarWeeks(todayDate, startDate, { weekStartsOn: 1 });
        const currentWeekNum = Math.max(1, weeksPassed + 1);
        
        const targetMicrocycle = currentMesocycle.mesocyclePlan.microcycles.find(m => m.week === currentWeekNum);
        // Fallback si no hay microciclo (ej. semana 5)
        if (!targetMicrocycle) return res.status(400).json({ error: "Mesociclo finalizado o fecha inválida." });

        const dayName = format(todayDate, 'EEEE', { locale: es });
        const targetSession = targetMicrocycle.sessions.find(s => s.dayOfWeek.toLowerCase() === dayName.toLowerCase());
        
        if (!targetSession) return res.status(200).json({ isRestDay: true, message: "Día de descanso." });

        // 2. Carga de Ejercicios (Utility + Main)
        const environment = detectEnvironment(profileData.availableEquipment);
        let collectionsToFetch = [db.collection('exercises_utility').get()];

        if (environment === 'gym') collectionsToFetch.push(db.collection('exercises_gym_full').get());
        else if (environment === 'bodyweight') collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        else {
            collectionsToFetch.push(db.collection('exercises_home_limited').get());
            collectionsToFetch.push(db.collection('exercises_bodyweight_pure').get());
        }

        const results = await Promise.all(collectionsToFetch);
        
        // Procesar Utility
        const utilityExercises = [];
        results[0].forEach(doc => utilityExercises.push({ id: doc.id, ...doc.data() }));

        // Procesar Main
        let allMainExercises = [];
        for (let i = 1; i < results.length; i++) {
            results[i].forEach(doc => allMainExercises.push({ id: doc.id, ...doc.data() }));
        }

        // 3. Filtrar Main Exercises
        let availableMain = filterExercisesByEquipment(allMainExercises, profileData.availableEquipment);
        
        // 4. Generar UTILITY (Warmup / Cooldown)
        const finalWarmup = selectUtilityExercises(utilityExercises, 'calentamiento', profileData.availableEquipment, 2);
        const finalCooldown = selectUtilityExercises(utilityExercises, 'estiramiento', profileData.availableEquipment, 2);

        // 5. Generar BLOQUE PRINCIPAL
        const template = getSessionTemplate(targetSession.sessionFocus, profileData.fitnessGoal);
        const mainExercisesSelected = [];

        // Determinar estructura del bloque (Station vs Circuit)
        const blockStructure = determineBlockStructure(profileData.fitnessGoal, profileData.experienceLevel, targetSession.sessionFocus);

        // Llenar template
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
                const vars = assignTrainingVariables(selected, slot.role, profileData.fitnessGoal, blockStructure.blockType);

                mainExercisesSelected.push({
                    id: selected.id,
                    name: selected.nombre || selected.name,
                    description: selected.descripcion, // Importante para el Player
                    // 👇 CORRECCIÓN 2: Asignar 'url' a la propiedad 'url', no a 'imageUrl'
                    url: selected.url || null, 
                    imageUrl: selected.imagen || null,
                    equipment: selected.equipo,
                    ...vars
                });
            }
        });

        // 6. Ensamblar Respuesta Final
        const finalSession = {
            sessionGoal: targetSession.sessionFocus,
            estimatedDurationMin: blockStructure.blockType === 'circuit' ? 45 : 60,
            warmup: { exercises: finalWarmup },
            // Estructuramos como un array de bloques compatible con tu Frontend
            mainBlocks: [
                {
                    blockType: blockStructure.blockType, // 'station' o 'circuit'
                    restBetweenSetsSec: blockStructure.restBetweenSetsSec, // Tiempo para el Timer
                    restBetweenExercisesSec: blockStructure.restBetweenExercisesSec, // Tiempo para el Timer
                    exercises: mainExercisesSelected
                }
            ],
            cooldown: { exercises: finalCooldown },
            meta: {
                date: todayDate.toISOString(),
                generatedAt: new Date().toISOString(),
                algorithm: "v2-heuristic-structured"
            },
            completed: false
        };

        // Guardar
        await db.collection('users').doc(userId).update({ currentSession: finalSession });

        return res.status(200).json({ success: true, session: finalSession });

    } catch (error) {
        console.error("FATAL:", error);
        return res.status(500).json({ error: error.message });
    }
}