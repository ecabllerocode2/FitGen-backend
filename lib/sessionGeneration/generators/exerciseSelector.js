// ==========================================
// MÓDULO: SELECTOR Y ORDENADOR DE EJERCICIOS (Exercise Architect)
// ==========================================

import { normalizeText } from '../utils.js';

/**
 * Determina si un ejercicio es compound o isolation basándose en sus propiedades
 * @param {Object} exercise - Ejercicio con propiedades (patronMovimiento, prioridad, nombre)
 * @returns {string} 'compound' | 'isolation'
 */
function determineExerciseMechanics(exercise) {
    // Si ya tiene mechanics/type definido, usarlo
    if (exercise.mechanics) return exercise.mechanics;
    if (exercise.type) return exercise.type;
    
    const patron = normalizeText(exercise.patronMovimiento || '');
    const nombre = normalizeText(exercise.nombre || exercise.name || '');
    const prioridad = exercise.prioridad || 2;
    
    // Patrones que son inherentemente compound (multiarticulares)
    const compoundPatterns = ['rodilla', 'cadera', 'empuje_v', 'empuje_h', 'traccion_v', 'traccion_h'];
    
    // Palabras clave para isolation exercises
    const isolationKeywords = [
        'curl', 'extension', 'raise', 'fly', 'elevacion', 'aislamiento',
        'lateral', 'frontal', 'posterior', 'bicep', 'tricep', 'deltoid',
        'calf', 'pantorrilla', 'shrug', 'encogimiento', 'crunch'
    ];
    
    // Palabras clave para compound exercises
    const compoundKeywords = [
        'squat', 'sentadilla', 'deadlift', 'peso muerto', 'press', 'row', 'remo',
        'pull', 'chin', 'lunge', 'zancada', 'step', 'thruster', 'clean', 'snatch',
        'dip', 'push-up', 'flexion', 'dominada'
    ];
    
    // Check isolation keywords first (más específico)
    if (isolationKeywords.some(kw => nombre.includes(kw))) {
        return 'isolation';
    }
    
    // Check compound keywords
    if (compoundKeywords.some(kw => nombre.includes(kw))) {
        return 'compound';
    }
    
    // Check patron de movimiento
    if (compoundPatterns.includes(patron)) {
        // Si es prioridad 1 y usa patrones compound -> compound
        if (prioridad === 1) return 'compound';
        // Si es prioridad 2-3 con patrones compound pero no keywords fuertes -> could be accessory compound
        return 'compound';
    }
    
    // Por defecto, si prioridad es 1-2 -> compound, si 3 -> isolation
    return prioridad >= 3 ? 'isolation' : 'compound';
}

/**
 * Reordena ejercicios basándose en principios de fisiología energética.
 * @param {Array} exercises - Lista de ejercicios candidatos seleccionados del inventario
 * @param {string} focusArea - General | Chest | Back | Legs etc.
 * @param {string} structureType - Neural_Strength | Hypertrophy etc.
 * @returns {Array} Lista reordenada y filtrada
 */
export function prioritizeExerciseOrder(exercises, focusArea, structureType) {
    if (!exercises || exercises.length === 0) return [];
    
    // Categorizar ejercicios usando la función helper
    const compounds = exercises.filter(e => {
        const mech = determineExerciseMechanics(e);
        return mech === 'compound';
    });
    const isolations = exercises.filter(e => {
        const mech = determineExerciseMechanics(e);
        return mech === 'isolation';
    });
    const others = exercises.filter(e => !compounds.includes(e) && !isolations.includes(e)); // Warmups, unknowns

    let orderedList = [];
    const focus = normalizeText(focusArea);

    // ESTRATEGIA 1: Prioridad Estándar (Fatiga Neural primero)
    // Orden: Multiarticulares -> Aislamientos
    if (focus === 'general' || focus === 'full body') {
        // Dentro de compuestos, priorizar axiales (Squat/Deadlift) si es strength
        if (structureType === 'Neural_Strength') {
            compounds.sort((a, b) => {
                const aIsAxial = isAxialLoad(a);
                const bIsAxial = isAxialLoad(b);
                return bIsAxial - aIsAxial; // True (1) primero
            });
        }
        orderedList = [...compounds, ...others, ...isolations];
    }
    
    // ESTRATEGIA 2: Foco Específico (Pre-fatiga o Prioridad Muscular)
    else if (focus !== 'general') {
        // Identificar ejercicios que atacan DIRECTAMENTE el foco
        const primaryTargetExercises = [...compounds, ...isolations].filter(e => 
             matchesMuscle(e, focus)
        );
        
        const secondaryExercises = [...compounds, ...isolations].filter(e => 
            !matchesMuscle(e, focus)
        );

        // Si es hipertrofia en un músculo específico, a veces queremos pre-activación
        // Pero la regla de oro para rendimiento es: Músculo Foco Fresco -> Ejercicio Más Demandante
        
        // Ordenamos los del target primero
        // Dentro del target, primero los compuestos
        const primaryCompounds = primaryTargetExercises.filter(e => determineExerciseMechanics(e) === 'compound');
        const primaryIsolations = primaryTargetExercises.filter(e => determineExerciseMechanics(e) === 'isolation');
        
        orderedList = [...primaryCompounds, ...primaryIsolations, ...secondaryExercises, ...others];
    }
    else {
        // Fallback
         orderedList = [...compounds, ...isolations, ...others];
    }

    // Enforce axial-first for Neural_Strength (garantizar top-2 axiales si es posible)
    if (structureType === 'Neural_Strength' && orderedList.length >= 2) {
        let newOrder = [...orderedList];
        const axials = orderedList.filter(isAxialLoad);
        let pos = 0;
        for (const a of axials) {
            if (pos >= 2) break;
            const idx = newOrder.findIndex(e => e.id === a.id);
            if (idx > pos) {
                newOrder.splice(idx, 1);
                newOrder.splice(pos, 0, a);
                pos++;
            } else if (idx === pos) {
                pos++;
            }
        }
        orderedList = newOrder;
        console.log(`[exerciseSelector] enforced axial-first for Neural: first2=${orderedList.slice(0,2).map(e=>e.id).join(', ')}`);
    }

    // Enforce focusArea top-2 if focus is specific
    const focusNorm = normalizeText(focusArea || '');
    if (focusNorm && focusNorm !== 'general' && orderedList.length >= 2) {
        let newOrder = [...orderedList];
        const focusCandidates = orderedList.filter(e => matchesMuscle(e, focusArea));
        let pos = 0;
        for (const fc of focusCandidates) {
            if (pos >= 2) break;
            const idx = newOrder.findIndex(e => e.id === fc.id);
            if (idx > pos) {
                newOrder.splice(idx, 1);
                newOrder.splice(pos, 0, fc);
                pos++;
            } else if (idx === pos) {
                pos++;
            }
        }
        orderedList = newOrder;
        
        // AÑADIR: Validación post-enforcement
        const top2Focus = orderedList.slice(0, 2).filter(e => matchesMuscle(e, focusArea));
        if (top2Focus.length < 1) {
            console.warn(`[exerciseSelector] ⚠️ Focus enforcement FAILED: ${focusArea} - only ${top2Focus.length}/2 exercises match in top-2. Available candidates: ${focusCandidates.length}`);
            console.warn(`[exerciseSelector] Top2 IDs: ${orderedList.slice(0,2).map(e=>e.id).join(', ')}, Focus candidates: ${focusCandidates.map(c=>c.id).slice(0,5).join(', ')}`);
        } else {
            console.log(`[exerciseSelector] ✅ Focus enforcement SUCCESS: ${focusArea} -> ${top2Focus.length}/2 in top-2`);
        }
        console.log(`[exerciseSelector] enforced focus-area top2: ${focusArea} -> first2=${orderedList.slice(0,2).map(e=>e.id).join(', ')}`);
    }

    return orderedList;
}

// Helpers
export function isAxialLoad(ex) {
    const name = normalizeText(ex.name || ex.nombre || '');
    const patron = normalizeText(ex.patronMovimiento || '');
    
    // Lista exhaustiva basada en biomecánica de carga axial (Schoenfeld, 2010)
    const axialKeywords = [
        'sentadilla', 'squat',
        'peso muerto', 'deadlift',
        'militar', 'overhead', 'press militar', 'military press',
        'clean', 'snatch', 'jerk',
        'good morning',
        'front squat', 'back squat',
        'romanian deadlift', 'sumo deadlift',
        'thruster',
        'push press', 'strict press', 'shoulder press',
        'press vertical', 'empuje vertical', 'press de hombro'
    ];
    
    // Patrones que indican carga axial
    const axialPatterns = ['rodilla', 'cadera', 'empuje_v'];
    
    // Verificar por nombre
    const matchByName = axialKeywords.some(kw => name.includes(kw));
    
    // Verificar si el patrón de movimiento indica carga vertical/axial
    const hasAxialPattern = axialPatterns.some(p => patron.includes(p));
    
    // Si tiene patrón axial Y prioridad 1 (compound principal), es muy probablemente axial
    const isPrimary = (ex.prioridad === 1);
    
    return matchByName || (hasAxialPattern && isPrimary);
}

/**
 * Determina si un ejercicio es de alto impacto (pliométricos, saltos, sprints, etc.)
 * Devuelve true si el ejercicio está marcado como dinámico o contiene palabras clave de alto impacto.
 */
export function isHighImpact(ex) {
    const name = normalizeText(ex.name || ex.nombre || '');
    const desc = normalizeText(ex.descripcion || ex.description || '');
    const keywords = ['salto','jump','plyo','pliométr','plyometric','sprint','box','cajon','burpee','medball','clap','plyométrico','plyo'];
    if (ex.isDynamic) return true; // heurística: muchos ejercicios dinamicos implican impacto
    return keywords.some(kw => name.includes(kw) || desc.includes(kw));
} 

function matchesMuscle(ex, targetMuscle) {
    const musculos = (ex.musculos_involucrados || []).map(m => normalizeText(m));
    const parteCuerpo = normalizeText(ex.parteCuerpo || ex.bodyPart || '');
    const target = normalizeText(targetMuscle);
    
    // Mapeo de aliases para musculos (español/inglés/variantes)
    const muscleAliases = {
        'pecho': ['pecho', 'chest', 'pectoral', 'pectorales'],
        'chest': ['pecho', 'chest', 'pectoral', 'pectorales'],
        'espalda': ['espalda', 'back', 'dorsal'],
        'back': ['espalda', 'back', 'dorsal'],
        'pierna': ['pierna', 'leg', 'cuadriceps', 'isquio', 'gluteo'],
        'leg': ['pierna', 'leg', 'cuadriceps', 'isquio', 'gluteo'],
        'hombro': ['hombro', 'shoulder', 'deltoid'],
        'shoulder': ['hombro', 'shoulder', 'deltoid'],
        'brazo': ['brazo', 'arm', 'bicep', 'tricep'],
        'arm': ['brazo', 'arm', 'bicep', 'tricep']
    };
    
    // Obtener aliases del target
    const targetAliases = muscleAliases[target] || [target];
    
    // Verificar coincidencia en músculos involucrados o parte del cuerpo
    const matchInMusculos = musculos.some(m => 
        targetAliases.some(alias => m.includes(alias))
    );
    const matchInParteCuerpo = targetAliases.some(alias => parteCuerpo.includes(alias));
    
    return matchInMusculos || matchInParteCuerpo;
} 

/**
 * Selecciona múltiples ejercicios del inventario de forma robusta y respetando
 * preferencia por `structureType` y `focusArea`. Retorna hasta `limit` ejercicios.
 */
export function selectExercisesFromInventory(
    inventory,
    patronesObjetivo = [],
    musculosObjetivo = [],
    prioridadBuscada = 1,
    limit = 3,
    ejerciciosRecientes = new Set(),
    idsUsados = new Set(),
    historial = [],
    nivel = 'Intermedio',
    structureType = 'Hypertrophy_Standard',
    focusArea = 'General',
    safetyProfile = null // new optional param: { avoidAxial, avoidHighImpact, preferMachines, loadCoef }
) {
    if (!inventory || inventory.length === 0) return [];

    // Normalizar inputs
    const patNorm = (patronesObjetivo || []).map(p => normalizeText(p));
    const musNorm = (musculosObjetivo || []).map(m => normalizeText(m));

    // Scoring y filtrado inicial (aceptamos varias categorias como 'principal')
    let candidatos = inventory.filter(ex => {
        if (idsUsados.has(ex.id)) return false;
        const cat = normalizeText(ex.categoriaBloque || ex.category || '');
        const categoriaAceptada = ['main_block','principal','mainblock','main block',''];
        if (!categoriaAceptada.includes(cat)) return false;

        // Excluir core
        const parteCuerpo = normalizeText(ex.parteCuerpo || ex.bodyPart || '');
        const patron = normalizeText(ex.patronMovimiento || ex.pattern || '');
        if (parteCuerpo.includes('core') || parteCuerpo.includes('abdom') || patron.includes('core')) return false;

        // Safety filters: si hay un safetyProfile aplicado, excluir ejercicios axiales o de alto impacto
        if (safetyProfile) {
            if (safetyProfile.avoidAxial && isAxialLoad(ex)) return false;
            if (safetyProfile.avoidHighImpact && isHighImpact(ex)) return false;
            // Penalizar ejercicios de técnica alta en principiantes y en protocolos conservadores
            if ((nivel === 'Principiante' || safetyProfile) && ex.dificultadTecnica === 'Alta') return false;
        }

        // Al principio permitimos coincidencia por patrón o músculo, pero no exigirla
        return true;
    });

    if (candidatos.length === 0) return [];

    // Scoring con preferencias por structureType
    const scored = candidatos.map(ex => {
        let score = 0;
        const name = (ex.nombre || ex.name || '').toLowerCase();
        const patronEj = normalizeText(ex.patronMovimiento || '');
        const parteEj = normalizeText(ex.parteCuerpo || '');

        // Priorizar coincidencia con patrones/músculos
        if (patNorm.some(p => patronEj.includes(p))) score += 8;
        if (musNorm.some(m => parteEj.includes(m))) score += 6;

        // Bonus por no haberse usado recientemente
        if (!ejerciciosRecientes.has(ex.id)) score += 5;

        // Bonus por imágenes y correcciones
        if (ex.url_img_0 || ex.url) score += 2;
        if (ex.correcciones && ex.correcciones.length > 0) score += 2;

        // Penalizar técnica para principiantes
        if (nivel === 'Principiante' && ex.dificultadTecnica === 'Alta') score -= 4;

        // Preferencias por structureType
        if (structureType === 'Neural_Strength') {
            // Axial/compound strongly preferred
            const axial = isAxialLoad(ex) ? 8 : 0; // boosted
            const compound = (determineExerciseMechanics(ex) === 'compound') ? 4 : 0;
            score += axial + compound;
        } else if (structureType === 'Metabolic_Volume') {
            // Isolation and high-rep friendly
            const isolation = (determineExerciseMechanics(ex) === 'isolation') ? 6 : 0; // boosted
            const isDynamic = ex.isDynamic ? 3 : 0;
            score += isolation + isDynamic;
        } else {
            // Hypertrophy_Standard: balanced
            const compound = (determineExerciseMechanics(ex) === 'compound') ? 2 : 0;
            score += compound;
        }

        // Safety profile boosts/penalties
        if (safetyProfile) {
            // Prefer machines when requested
            if (safetyProfile.preferMachines) {
                const hasMachine = (String(ex.equipo || ex.equipment || '').toLowerCase().includes('machine') || String(ex.equipo || '').toLowerCase().includes('maquina'));
                if (hasMachine) score += 3;
            }
            // Penalizar técnica alta ya se hizo arriba (ex.dificultadTecnica === 'Alta')
            // Si existe loadCoef, reduce effective scoring to favor conservative options
            if (safetyProfile.loadCoef && safetyProfile.loadCoef < 1) {
                score *= safetyProfile.loadCoef;
            }
        }

            // Deterministic tie-breaker (pseudo-random but reproducible by id)
        const idEntropy = (ex.id || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 100;
        score += (idEntropy / 100) * 0.8; // tiny deterministic tie-breaker

        return { ...ex, score };
    });

    // Ordenar por score (determinístico)
    scored.sort((a,b) => b.score - a.score || (a.id || '').localeCompare(b.id || ''));

    // Seleccionar hasta `limit`, evitando aleatoriedad
    const selected = [];
    for (const cand of scored) {
        if (selected.length >= limit) break;
        if (idsUsados.has(cand.id)) continue;
        selected.push(cand);
        idsUsados.add(cand.id);
    }

    // Si no alcanza el limite, rellenar con siguientes mejores candidatos
    if (selected.length < limit) {
        const leftover = scored.filter(s => !idsUsados.has(s.id));
        while (selected.length < limit && leftover.length > 0) {
            selected.push(leftover.shift());
        }
    }

    // Post-processing rules (determinísticos y garantizados cuando sea posible)

    // 1) Neural_Strength: garantizar que las primeras 2 sean axiales (cuando sea posible)
    if (structureType === 'Neural_Strength' && limit >= 2) {
        let axialPresent = selected.slice(0,2).filter(isAxialLoad).length;
        if (axialPresent < 2) {
            // Buscar axiales en scored no seleccionados
            const axialPool = scored.filter(s => !selected.find(ss => ss.id === s.id) && isAxialLoad(s));
            let replaceIdx = 1; // empezar por la segunda posición si no axial
            for (const axial of axialPool) {
                // encontrar primer índice dentro de las dos primeras que no sea axial
                for (let i = 0; i < 2; i++) {
                    if (!isAxialLoad(selected[i])) {
                        idsUsados.delete(selected[i].id);
                        selected[i] = axial;
                        idsUsados.add(axial.id);
                        axialPresent++;
                        break;
                    }
                }
                if (axialPresent >= 2) break;
            }
            if (axialPresent < 2) console.warn('[exerciseSelector] Warning: No hay suficientes ejercicios axiales en inventario para garantizar 2 primeros axiales.');
        }
    }

    // 2) Metabolic_Volume: garantizar >50% isolation
    if (structureType === 'Metabolic_Volume') {
        const requiredIsos = Math.ceil(limit * 0.5);
        let isoCount = selected.filter(s => determineExerciseMechanics(s) === 'isolation').length;
        if (isoCount < requiredIsos) {
            // buscar isolations mejor puntuadas no seleccionadas
            const isoPool = scored.filter(s => !selected.find(ss => ss.id === s.id) && determineExerciseMechanics(s) === 'isolation');
            let idxReplace = limit - 1;
            for (const iso of isoPool) {
                // reemplazar desde el final hacia atrás elementos no-isolation
                while (idxReplace >= 0 && determineExerciseMechanics(selected[idxReplace]) === 'isolation') idxReplace--;
                if (idxReplace < 0) break;
                idsUsados.delete(selected[idxReplace].id);
                selected[idxReplace] = iso;
                idsUsados.add(iso.id);
                isoCount++;
                idxReplace--;
                if (isoCount >= requiredIsos) break;
            }
            if (isoCount < requiredIsos) console.warn('[exerciseSelector] Warning: No hay suficientes isolations en inventario para cumplir Metabolic_Volume.');
        }
    }

    // 3) Focus Area: priorizar que top-2 impacten el músculo objetivo si existen
    if (focusArea && normalizeText(focusArea) !== 'general' && limit >= 2) {
        const primaryPool = scored.filter(s => matchesMuscle(s, focusArea) && !selected.find(ss => ss.id === s.id));
        let topMatches = selected.slice(0,2).filter(s => matchesMuscle(s, focusArea)).length;
        let idxPrimary = 0;
        for (let i = 0; i < 2 && topMatches < 2; i++) {
            if (!matchesMuscle(selected[i], focusArea)) {
                const candidate = primaryPool[idxPrimary++];
                if (candidate) {
                    idsUsados.delete(selected[i].id);
                    selected[i] = candidate;
                    idsUsados.add(candidate.id);
                    topMatches++;
                }
            }
        }
        if (topMatches < 2) console.warn('[exerciseSelector] Info: No hay suficientes ejercicios que impacten el focusArea para poner dos en top-2.');
    }

    const out = selected.map(s => ({ ...s }));
    console.log(`[exerciseSelector] selectExercisesFromInventory -> selected ${out.length} exercises: ${out.map(o=>o.id).slice(0,10).join(', ')}`);
    return out;
}

/**
 * Genera calentamiento específico "RAMP" basado en el patrón de movimiento
 */
export function generateSpecificRAMP(patternFocus, inventory) {
    // Retorna ejercicios de movilidad específicos
    // Ej: Si pattern == Lower Body -> Tobillo y Cadera dinámica
    const mobility = [];
    
    const p = normalizeText(patternFocus);
    
    if (p.includes('lower') || p.includes('leg') || p.includes('pierna')) {
        mobility.push({ name: "Movilidad de Tobillo (Dorsiflexión)", type: "mobility", duration: "60s" });
        mobility.push({ name: "90/90 Cadera Dinámico", type: "mobility", duration: "60s" });
        mobility.push({ name: "Sentadilla Profunda Isométrica", type: "activation", duration: "30s" });
    } else if (p.includes('push') || p.includes('pull') || p.includes('upper') || p.includes('torso')) {
         mobility.push({ name: "Dislocaciones de Hombro con Banda/Palo", type: "mobility", duration: "60s" });
         mobility.push({ name: "YTWL Escapular", type: "activation", duration: "45s" });
         mobility.push({ name: "Rotaciones Torácicas Quadruped", type: "mobility", duration: "45s" });
    } else {
         // Full body / General
         mobility.push({ name: "El Mejor Estiramiento del Mundo", type: "mobility", duration: "90s" });
         mobility.push({ name: "Caminata de Gusano (Inchworm)", type: "activation", duration: "60s" });
    }
    
    return mobility;
}
