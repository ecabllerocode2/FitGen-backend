import { db, auth } from '../../lib/firebaseAdmin.js';

// ====================================================================
// 1. MOTORES DE LÓGICA (Replicados para robustez y autonomía)
// ====================================================================

const normalizeText = (text) => {
    if (!text) return "";
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
};

const detectEnvironment = (equipmentList) => {
    if (!equipmentList || equipmentList.length === 0) return 'bodyweight';
    const eqString = JSON.stringify(equipmentList).toLowerCase();
    if (eqString.includes('gimnasio') || eqString.includes('gym')) return 'gym';
    const hasLoad = equipmentList.some(item => {
        const i = normalizeText(item);
        const isPullUp = i.includes('dominadas') || i.includes('pull');
        return (i.includes('mancuerna') || i.includes('pesa') || (i.includes('barra') && !isPullUp));
    });
    return hasLoad ? 'home_limited' : 'bodyweight';
};

// Lógica de asignación de peso exacta (Requerimiento de UX científica)
const assignLoadSuggestion = (exercise, userInventory, sessionMode) => {
    const targetEquipmentRaw = normalizeText(exercise.equipo || "");
    
    // 1. Peso Corporal
    if (targetEquipmentRaw.includes("corporal") || targetEquipmentRaw.includes("suelo") || targetEquipmentRaw.includes("sin equipo")) {
        return { equipmentName: "Peso Corporal", suggestedLoad: "Tu propio peso" };
    }

    // 2. Gym Comercial
    if (detectEnvironment(userInventory) === 'gym') {
        if (targetEquipmentRaw.includes('mancuerna')) return { equipmentName: "Mancuernas", suggestedLoad: "Peso exigente" };
        if (targetEquipmentRaw.includes('barra')) {
             if (targetEquipmentRaw.includes('dominadas')) return { equipmentName: "Barra de Dominadas", suggestedLoad: "Peso Corporal" };
             return { equipmentName: "Barra Olímpica", suggestedLoad: "Carga discos adecuados" };
        }
        return { equipmentName: exercise.equipo, suggestedLoad: "Ajustar a RPE" };
    }

    // 3. Lógica Home Limited
    let toolType = null;
    if (targetEquipmentRaw.includes("mancuerna")) toolType = "mancuerna";
    else if (targetEquipmentRaw.includes("dominadas")) toolType = "dominadas";
    else if (targetEquipmentRaw.includes("barra")) toolType = "barra_peso";
    else if (targetEquipmentRaw.includes("kettlebell") || targetEquipmentRaw.includes("pesa rusa")) toolType = "kettlebell";
    else if (targetEquipmentRaw.includes("banda") || targetEquipmentRaw.includes("liga")) toolType = "banda";

    if (!toolType) return { equipmentName: exercise.equipo, suggestedLoad: "Según disponibilidad" };

    const availableOptions = userInventory.filter(item => {
        const normItem = normalizeText(item);
        if (toolType === 'dominadas') return normItem.includes('dominadas') || normItem.includes('pull up');
        if (toolType === 'barra_peso') return normItem.includes('barra') && !normItem.includes('dominadas') && !normItem.includes('pull up');
        if (toolType === 'mancuerna') return normItem.includes('mancuerna');
        if (toolType === 'kettlebell') return normItem.includes('kettlebell') || normItem.includes('pesa rusa');
        if (toolType === 'banda') return normItem.includes('banda') || normItem.includes('liga');
        return false;
    });

    if (availableOptions.length === 0) {
        // Fallback inteligente: Sustitución de herramienta
        if (toolType === 'barra_peso') {
             const dumbbells = userInventory.filter(i => normalizeText(i).includes('mancuerna'));
             if (dumbbells.length > 0) {
                 return { equipmentName: "Mancuernas", suggestedLoad: `(Sustituyendo Barra)` };
             }
        }
        return { equipmentName: exercise.equipo, suggestedLoad: "Equipo no detectado exacto" };
    }

    // Extracción de pesos específicos si existen
    const weightedItems = availableOptions.map(item => {
        const match = item.match(/(\d+(?:\.\d+)?)\s*(?:kg|lb)/i);
        return { fullName: item, weight: match ? parseFloat(match[1]) : 0 };
    });
    
    const specificWeights = weightedItems.filter(w => w.weight > 0).sort((a, b) => a.weight - b.weight);
    const finalPool = specificWeights.length > 0 ? specificWeights : weightedItems;
    
    // Selección por intensidad
    const exType = normalizeText(exercise.tipo || "");
    const isCompound = exType.includes("multi") || exType.includes("compuesto");
    let selected = finalPool[0]; 

    if (finalPool.length > 1) {
        // En un swap, asumimos modo estándar o performance a menos que se indique lo contrario
        if (isCompound) selected = finalPool[finalPool.length - 1]; 
        else selected = finalPool[Math.max(0, finalPool.length - 2)];
    }

    return { 
        equipmentName: selected.fullName.split('(')[0].trim(), 
        suggestedLoad: `Usa: ${selected.fullName}` 
    };
};

const checkEquipmentAvailability = (exercise, userInventory) => {
    const environment = detectEnvironment(userInventory);
    if (environment === 'gym') return true; // Asumimos que en gym hay todo

    const reqEq = normalizeText(exercise.equipo || "peso corporal");
    const userKeywords = userInventory.map(e => normalizeText(e));

    // Validaciones estrictas
    if (reqEq.includes("corporal") || reqEq === "suelo" || reqEq === "sin equipo") return true;
    
    if (reqEq.includes("dominadas") || (reqEq.includes("barra") && reqEq.includes("pull"))) {
        return userKeywords.some(k => k.includes("dominadas") || k.includes("pull up"));
    }
    if (reqEq.includes("barra") && !reqEq.includes("dominadas")) {
        return userKeywords.some(k => k.includes("barra") && !k.includes("dominadas") && !k.includes("pull"));
    }
    if (reqEq.includes("banda") || reqEq.includes("liga")) {
        const needsMini = reqEq.includes("mini") || reqEq.includes("gluteo");
        if (needsMini) return userKeywords.some(k => k.includes("mini"));
        return userKeywords.some(k => (k.includes("banda") || k.includes("liga")) && !k.includes("mini"));
    }
    if (reqEq.includes("mancuerna") && userKeywords.some(k => k.includes("mancuerna"))) return true;
    if (reqEq.includes("kettlebell") && userKeywords.some(k => k.includes("kettlebell") || k.includes("pesa rusa"))) return true;

    return false;
};

// ====================================================================
// 2. HANDLER PRINCIPAL (SWAP LOGIC)
// ====================================================================

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Validación de Auth
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Falta token.' });

    try {
        const decoded = await auth.verifyIdToken(authHeader.split('Bearer ')[1]);
        const userId = decoded.uid;

        // --- A. RECIBIR COORDENADAS EXACTAS ---
        const { blockType, blockIndex, exerciseIndex, targetId } = req.body;

        if (blockIndex === undefined || exerciseIndex === undefined || !targetId) {
            return res.status(400).json({ error: "Faltan coordenadas del ejercicio." });
        }

        // --- B. LEER ESTADO ACTUAL DEL USUARIO ---
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const userData = userDoc.data();
        const { currentSession, availableEquipment, experienceLevel } = userData;
        
        if (!currentSession) return res.status(400).json({ error: "No hay sesión activa." });

        // --- C. LOCALIZAR EL EJERCICIO EN EL DOCUMENTO ---
        let exercisesListRef = null; 
        let targetExercise = null;

        if (blockType === 'warmup') {
            exercisesListRef = currentSession.warmup.exercises;
        } else if (blockType === 'cooldown') {
            exercisesListRef = currentSession.cooldown.exercises;
        } else if (blockType === 'main') {
            if (!currentSession.mainBlocks[blockIndex]) return res.status(404).json({ error: "Bloque no encontrado." });
            exercisesListRef = currentSession.mainBlocks[blockIndex].exercises;
        } else if (blockType === 'core') {
            if (!currentSession.coreBlocks || !currentSession.coreBlocks[blockIndex]) return res.status(404).json({ error: "Bloque Core no encontrado." });
            exercisesListRef = currentSession.coreBlocks[blockIndex].exercises;
        } else {
            return res.status(400).json({ error: "Tipo de bloque inválido." });
        }

        targetExercise = exercisesListRef[exerciseIndex];

        // Doble verificación de seguridad
        if (!targetExercise || targetExercise.id !== targetId) {
            return res.status(409).json({ error: "Sincronización fallida. Recarga la sesión." });
        }

        // --- D. BUSCAR CANDIDATOS (TODAS LAS COLECCIONES) ---
        const collections = [
            'exercises_utility', 
            'exercises_bodyweight_pure', 
            'exercises_home_limited', 
            'exercises_gym_full'
        ];

        let allCandidates = [];
        const snapshotPromises = collections.map(col => db.collection(col).get());
        const snapshots = await Promise.all(snapshotPromises);

        snapshots.forEach(snap => {
            snap.docs.forEach(doc => allCandidates.push({ id: doc.id, ...doc.data() }));
        });

        // --- E. ALGORITMO DE FILTRADO CIENTÍFICO ---
        
        // 1. Recopilar IDs ya usados en la sesión para no repetir
        const usedIds = new Set();
        currentSession.warmup.exercises.forEach(e => usedIds.add(e.id));
        currentSession.cooldown.exercises.forEach(e => usedIds.add(e.id));
        currentSession.mainBlocks.forEach(b => b.exercises.forEach(e => usedIds.add(e.id)));
        if(currentSession.coreBlocks) currentSession.coreBlocks.forEach(b => b.exercises.forEach(e => usedIds.add(e.id)));

        // Datos clave del objetivo
        const targetMuscle = normalizeText(targetExercise.musculoObjetivo || targetExercise.parteCuerpo || "");
        const targetTypeRaw = normalizeText(targetExercise.tipo || ""); 
        const isCompound = targetTypeRaw.includes('multi') || targetTypeRaw.includes('compuesto');
        const isWarmup = blockType === 'warmup' || blockType === 'cooldown';

        const validReplacements = allCandidates.filter(candidate => {
            // A. Filtro Básico
            if (usedIds.has(candidate.id)) return false; 
            
            // B. Filtro de Inventario (CRÍTICO)
            if (!checkEquipmentAvailability(candidate, availableEquipment || [])) return false;

            // C. Filtro de Nivel
            const exLevel = normalizeText(candidate.nivel || "principiante");
            const userLevel = normalizeText(experienceLevel || "principiante");
            if (userLevel === 'principiante' && exLevel === 'avanzado') return false;

            // D. Filtro Biomecánico (Músculo/Función)
            const candMuscle = normalizeText(candidate.musculoObjetivo || candidate.parteCuerpo || "");
            
            // 1. Calentamiento/Cooldown: Flexibilidad
            if (isWarmup) {
                 const candType = normalizeText(candidate.tipo || "");
                 // Match por tipo de ejercicio de utilidad
                 return candType.includes('estiramiento') || candType.includes('movilidad') || candType.includes('activacion');
            }

            // 2. Reglas Específicas del Bloque Core 🚨 CORRECCIÓN CLAVE para evitar Espalda/Dorsal
            if (blockType === 'core') {
                 // Palabras clave EXCLUIDAS (músculos de tracción/espalda alta)
                 const primaryBackMuscles = ['dorsales', 'trapecio', 'traccion']; 
                 if (primaryBackMuscles.some(m => candMuscle.includes(m))) {
                     return false; 
                 }
                 
                 // Palabras clave aceptadas para Core 
                 const coreKeywords = ['core', 'abdominales', 'oblicuos', 'lumbar'];
                 const isCoreCandidate = coreKeywords.some(keyword => candMuscle.includes(keyword));

                 // El candidato debe ser de Core para pasar el filtro estricto.
                 if (isCoreCandidate) return true;
                 
                 // Si no es un candidato de Core aceptable y no fue excluido, rechazar.
                 return false;
            }


            // 3. Main Block Logic (Match de Músculo Estricto)
            // Para Bloques Principales: Match estricto de músculo (usa targetMuscle del original)
            const muscleMatch = candMuscle.includes(targetMuscle) || targetMuscle.includes(candMuscle);
            if (!muscleMatch) return false;


            // E. Filtro de Rol (Compound vs Isolation) - SOLO para Main Blocks
            if (blockType === 'main') {
                const candType = normalizeText(candidate.tipo || "");
                const candIsCompound = candType.includes('multi') || candType.includes('compuesto');
                
                if (isCompound !== candIsCompound) return false; 
            }

            return true;
        });

        // --- F. SELECCIÓN Y FALLBACK (Ajuste para aplicar la exclusión de espalda al fallback) ---
        let selectedCandidate = null;

        if (validReplacements.length > 0) {
            // Selección aleatoria entre los válidos
            selectedCandidate = validReplacements[Math.floor(Math.random() * validReplacements.length)];
        } else {
            // FALLBACK DE EMERGENCIA:
            const relaxedReplacements = allCandidates.filter(candidate => {
                if (usedIds.has(candidate.id)) return false;
                if (!checkEquipmentAvailability(candidate, availableEquipment || [])) return false;
                const candMuscle = normalizeText(candidate.musculoObjetivo || candidate.parteCuerpo || "");
                // Regla de relajación: Coincidencia muscular básica
                return candMuscle.includes(targetMuscle) || targetMuscle.includes(candMuscle);
            });

            if (relaxedReplacements.length > 0) {
                 // Aplicar la regla de exclusión Core/Espalda (versión fuerte) al fallback también si es Core
                 const primaryBackMuscles = ['dorsales', 'trapecio', 'traccion'];
                 const coreKeywords = ['core', 'abdominales', 'oblicuos', 'lumbar'];

                 const finalFallback = relaxedReplacements.filter(candidate => {
                     if (blockType !== 'core') return true; 

                     const candMuscle = normalizeText(candidate.musculoObjetivo || candidate.parteCuerpo || "");
                     
                     // 1. Excluir si tiene músculos grandes de espalda
                     if (primaryBackMuscles.some(m => candMuscle.includes(m))) return false;
                     // 2. Aceptar solo si es un candidato de Core aceptable
                     return coreKeywords.some(keyword => candMuscle.includes(keyword));
                 });


                if (finalFallback.length > 0) {
                   selectedCandidate = finalFallback[Math.floor(Math.random() * finalFallback.length)];
                } else {
                    return res.status(400).json({ error: "No se encontraron alternativas válidas para tu equipo ni con filtros relajados." });
                }
            } else {
                return res.status(400).json({ error: "No se encontraron alternativas válidas para tu equipo." });
            }
        }

        // --- G. CONSTRUCCIÓN DEL NUEVO EJERCICIO ---
        const loadInfo = assignLoadSuggestion(selectedCandidate, availableEquipment || [], currentSession.meta?.sessionMode || 'standard');

        const newExerciseData = {
            id: selectedCandidate.id,
            name: selectedCandidate.nombre,
            instructions: selectedCandidate.descripcion,
            imageUrl: selectedCandidate.url || null,
            videoUrl: selectedCandidate.videoUrl ?? null, 
            equipment: loadInfo.equipmentName,
            
            // Mantenemos la programación del bloque original, usando ?? null para evitar errores de Firestore.
            sets: targetExercise.sets ?? null,
            targetReps: targetExercise.targetReps ?? null, 
            rpe: targetExercise.rpe ?? null,
            durationOrReps: targetExercise.durationOrReps ?? null, 
            // --------------------------------------------------------------------------------

            notes: targetExercise.notes ? `(Alt) ${targetExercise.notes}` : "Alternativa seleccionada.",
            musculoObjetivo: selectedCandidate.musculoObjetivo || selectedCandidate.parteCuerpo,
            suggestedLoad: loadInfo.suggestedLoad 
        };

        // --- H. ACTUALIZAR BASE DE DATOS ---
        if (blockType === 'warmup') {
            currentSession.warmup.exercises[exerciseIndex] = newExerciseData;
        } else if (blockType === 'cooldown') {
            currentSession.cooldown.exercises[exerciseIndex] = newExerciseData;
        } else if (blockType === 'main') {
            currentSession.mainBlocks[blockIndex].exercises[exerciseIndex] = newExerciseData;
        } else if (blockType === 'core') {
            currentSession.coreBlocks[blockIndex].exercises[exerciseIndex] = newExerciseData;
        }

        await userRef.update({ currentSession });

        // --- I. RESPUESTA AL CLIENTE ---
        return res.status(200).json({ 
            success: true, 
            newExercise: newExerciseData,
            message: "Ejercicio intercambiado con éxito." 
        });

    } catch (error) {
        console.error("SWAP ERROR:", error);
        return res.status(500).json({ error: error.message });
    }
}