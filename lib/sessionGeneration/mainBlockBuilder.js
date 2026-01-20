// ====================================================================
// MAIN BLOCK BUILDER MODULE
// Constructor del bloque principal de entrenamiento
// Implementa ordenamiento biomecánico y selección inteligente de ejercicios
// ====================================================================

import { 
    MOVEMENT_PATTERN_MAP, 
    MUSCLE_FOCUS_MAP, 
    VOLUME_CONFIG, 
    REST_PROTOCOLS,
    SESSION_SLOT_STRUCTURE,
    FATIGUE_COEFFICIENTS 
} from './constants.js';
import { calcularCargaPrecisa } from './loadCalculator.js';
import { getRecentlyUsedExercises, detectPlateau } from './dataFetcher.js';
import { generarPerfilEquipamiento } from './equipmentFilter.js';
import { normalizeText, shuffleArray } from './utils.js';
import { prioritizeExerciseOrder, selectExercisesFromInventory, isAxialLoad, isHighImpact, generateSpecificRAMP } from './generators/exerciseSelector.js';
import { translateBiomechanics } from './generators/mechanicsTranslater.js';

// Low-load session helper defaults
const LOW_LOAD_STRUCTURE_OVERRIDE = {
    totalSlots: 3,
    distribution: { priority1: 0, priority2: 1, priority3: 2 }
};

const LOW_LOAD_VOLUME_FACTOR = 0.6; // Reducir volumen general en pivot


/**
 * Construye el bloque principal de la sesión
 * @param {Object} sesionObj - Objeto de la sesión del mesociclo
 * @param {Object} contextoMesociclo - Contexto completo del mesociclo con week, focus, structureType, safetyProfile
 * @param {Array} historial - Historial del usuario
 * @param {Object} ajustes - Ajustes de readiness
 * @param {Array} inventario - Ejercicios filtrados por equipo
 * @param {string} nivelExp - Nivel de experiencia del usuario
 * @param {Array} dbEjercicios - Base de datos completa de ejercicios
 * @param {Object} perfilEquipoInput - Perfil de equipo con pesos específicos
 *   { equipamiento: [...], ubicacion: 'gym'|'home', pesosEspecificos: { dumbbells: [...], barbell: ... } }
 * @returns {Object} Bloque principal estructurado
 */
export function construirBloquePrincipal(
    sesionObj,
    contextoMesociclo,  // CAMBIADO: Ya no es microciclo, es contexto completo
    historial,
    ajustes,
    inventario,
    nivelExp,
    dbEjercicios,
    perfilEquipoInput,
    forcedMainBlock = null,    // Estructura de bloque anterior para consistencia (Semana 2+)
    blacklistedExerciseIds = [] // Ejercicios a evitar (Mesociclo previo)
) {
    const bloquesFinal = [];
    
    // Generar perfil de equipamiento extendido con pesos específicos
    const equipoArray = perfilEquipoInput?.equipamiento || perfilEquipoInput || [];
    const perfilEquipo = generarPerfilEquipamiento(Array.isArray(equipoArray) ? equipoArray : []);
    
    // Configuración de Blacklist (Variación inter-mesociclo)
    let inventarioActivo = [...inventario];
    if (blacklistedExerciseIds.length > 0) {
        const blacklistSet = new Set(blacklistedExerciseIds);
        inventarioActivo = inventarioActivo.filter(ex => !blacklistSet.has(ex.id));
    }
    
    // Agregar pesos específicos del frontend al perfil
    if (perfilEquipoInput?.pesosEspecificos) {
        perfilEquipo.pesosEspecificosFrontend = perfilEquipoInput.pesosEspecificos;
        perfilEquipo.ubicacion = perfilEquipoInput.ubicacion;
    }
    
    // Obtener ejercicios usados recientemente para evitar repetición
    const ejerciciosRecientes = getRecentlyUsedExercises(historial, 7, sesionObj.sessionFocus);

    // Safety profile (si existe) -> aplicar filtros globales al inventario
    const safetyProfile = sesionObj && sesionObj.context ? sesionObj.context.safetyProfile : null;
    if (safetyProfile) {
        console.log('[MainBlockBuilder] Safety profile detected -> applying inventory filters:', safetyProfile);
        if (safetyProfile.avoidAxial) {
            inventarioActivo = inventarioActivo.filter(e => !isAxialLoad(e));
            console.log('[MainBlockBuilder] Filtered axial loads from inventory due to safety profile');
        }
        if (safetyProfile.avoidHighImpact) {
            inventarioActivo = inventarioActivo.filter(e => !isHighImpact(e));
            console.log('[MainBlockBuilder] Filtered high-impact exercises from inventory due to safety profile');
        }
        // Apply load coefficient conservatively
        if (safetyProfile.loadCoef) {
            ajustes.factorVolumen = Math.min(ajustes.factorVolumen || 1, safetyProfile.loadCoef);
        }
    }

    // ====================================================================
    // MODO CONSISTENCIA: USAR ESTRUCTURA PREDEFINIDA (Forced Main Block)
    // ====================================================================
    // Aceptamos tanto forcedMainBlock como array, o un objeto { blocks, sourceSessionMeta }
    if (forcedMainBlock && ((Array.isArray(forcedMainBlock) && forcedMainBlock.length > 0) || forcedMainBlock.blocks)) {
        console.log('[MainBlockBuilder] Generando bloque en MODO CONSISTENCIA (Week match)');
        
        const bloquesOrigen = Array.isArray(forcedMainBlock) ? forcedMainBlock : (forcedMainBlock.blocks || []);
        const sourceSessionMeta = forcedMainBlock && forcedMainBlock.sourceSessionMeta ? forcedMainBlock.sourceSessionMeta : null;

        for (const bloqueAnterior of bloquesOrigen) {
            const nuevoBloque = { ...bloqueAnterior, ejercicios: [] };
            
            // Si el bloque no tiene ejercicios definidos, saltar
            if (!bloqueAnterior.ejercicios || !Array.isArray(bloqueAnterior.ejercicios)) continue;

            for (const ejAnterior of bloqueAnterior.ejercicios) {
                // 1. Intentar usar el mismo ejercicio
                // Verificar si existe en el inventario actual (compatible con equipo actual)
                const ejercicioEnInventario = inventarioActivo.find(e => e.id === ejAnterior.id);
                
                let ejercicioSeleccionado = null;

                if (ejercicioEnInventario) {
                    // Compatible: Usar el mismo
                    // Clonamos del inventario para tener datos frescos, pero mantenemos metadatos de sesión (prioridad, rol)
                    ejercicioSeleccionado = { 
                        ...ejercicioEnInventario,
                        prioridad: ejAnterior.prioridad || 1,
                        rolSesion: ejAnterior.rolSesion || 'primario',
                        tipoProgresion: ejAnterior.tipoProgresion || 'maintenance'
                    };
                } else {
                    // Incompatible (ej. cambio de Gym a Casa): Buscar reemplazo similar
                    console.log(`[MainBlockBuilder] Ejercicio ${ejAnterior.id} no disponible. Buscando reemplazo por patrón ${ejAnterior.patronMovimiento}`);
                    
                    // Intentar buscar por mismo patrón y parte del cuerpo
                    // Pseudo-invocación de selección para relleno
                    ejercicioSeleccionado = seleccionarMejorEjercicio(
                        inventarioActivo,
                        [ejAnterior.patronMovimiento],
                        [ejAnterior.parteCuerpo],
                        ejAnterior.prioridad || 2,
                        [], // No filtrar recientes en reemplazo forzado
                        new Set(), // No trackear usados globales aquí
                        historial,
                        nivelExp
                    );
                }

                if (ejercicioSeleccionado) {
                    // Recalcular carga para el nuevo microciclo usando contexto completo
                    const prescripcion = calcularCargaPrecisa(
                        ejercicioSeleccionado,
                        historial,
                        contextoMesociclo, // Pasar contexto completo del mesociclo
                        ajustes,
                        perfilEquipo,
                        sourceSessionMeta
                    );
                    console.log(`[MainBlockBuilder] prescripcion for ${ejercicioSeleccionado.id}: ${JSON.stringify(prescripcion).slice(0,200)}`);
                    
                    // Construir el objeto de ejercicio completo fusionando info base + nueva carga
                    const ejercicioFinal = {
                        ...ejercicioSeleccionado,
                        
                        // Actualizar prescripción de carga
                        reps: prescripcion.repsObjetivo,
                        peso: prescripcion.pesoSugerido,
                        rpeTarget: prescripcion.rpeObjetivo,
                        rirTarget: prescripcion.rirObjetivo,
                        tempo: prescripcion.tempo,
                        
                        // Mantener sets del bloque anterior para consistencia estructural
                        sets: ejAnterior.sets || 3,
                        descanso: ejAnterior.descanso || '90s',

                        // Metadatos de la nueva prescripción
                        justificacionCarga: prescripcion.explicacion,
                        indicadores: prescripcion.indicadores,
                        tipoProgresion: prescripcion.tipoProgresion,

                        // Disponibilidad y plan de progresión (si aplica)
                        availabilityAdjustment: prescripcion.availability || null,
                        progressionPlan: prescripcion.progressionPlan || null,

                        // Asegurar compatibilidad de imágenes
                        imageUrl: ejercicioSeleccionado.url_img_0 || ejercicioSeleccionado.imageUrl,
                        imageUrl2: ejercicioSeleccionado.url_img_1 || ejercicioSeleccionado.imageUrl2,
                        
                        // Prescripción original (entera) por si el frontend la quiere
                        prescripcion: prescripcion,

                        // Reset de tracking
                        performanceData: {
                            plannedSets: ejAnterior.sets || 3,
                            actualSets: []
                        }
                    };
                    
                    nuevoBloque.ejercicios.push(ejercicioFinal);
                }
            }
            
            if (nuevoBloque.ejercicios.length > 0) {
                bloquesFinal.push(nuevoBloque);
            }
        }

        // Si logramos reconstruir bloques, retornamos anticipadamente
        if (bloquesFinal.length > 0) {
            return bloquesFinal;
        }
    }

    // ====================================================================
    // MODO ESTÁNDAR: GENERACIÓN DINÁMICA
    // ====================================================================

    // PASO 1: MAPEO DE PATRONES DE MOVIMIENTO
    const patronesACubrir = mapearFocusAPatrones(sesionObj.sessionFocus);
    const musculosObjetivo = mapearFocusAMusculos(sesionObj.sessionFocus);
    
    // PASO 2: DETERMINAR ESTRUCTURA DE SLOTS
    let estructuraSlots = SESSION_SLOT_STRUCTURE[nivelExp] || SESSION_SLOT_STRUCTURE.Intermedio;
    let configVolumen = VOLUME_CONFIG[nivelExp] || VOLUME_CONFIG.Intermedio;

    // --- Low-Load Pivot override: si la sesión fue marcada por el Scheduler como low-load, aplicar reglas ---
    const isLowLoadPivot = (sesionObj.structureType && sesionObj.structureType === 'Low_Load_Pivot') || (sesionObj.context && sesionObj.context.lowLoadPivot);
    if (isLowLoadPivot) {
        console.log('[MainBlockBuilder] Low-Load Pivot detected -> applying low-load structure and inventory filters');
        // Forzar estructura reducida
        estructuraSlots = LOW_LOAD_STRUCTURE_OVERRIDE;
        // Forzar factor de volumen reducido
        const equipmentProfile = sesionObj.context && sesionObj.context.equipmentProfile ? sesionObj.context.equipmentProfile : null;
        if (equipmentProfile && equipmentProfile.bodyweightOnly && nivelExp === 'Principiante') {
            // Más conservador: reducir aún más el volumen para BW-only beginners
            ajustes.factorVolumen = Math.min(ajustes.factorVolumen || 1, 0.5);
            console.log('[MainBlockBuilder] Applying extra low-load factor 0.5 for BW-only beginner');
        } else {
            ajustes.factorVolumen = Math.min(ajustes.factorVolumen || 1, LOW_LOAD_VOLUME_FACTOR);
        }
        // Filtrar inventario para excluir ejercicios axiales (prohibir compresión de columna o cargas verticales pesadas)
        inventarioActivo = inventarioActivo.filter(e => !isAxialLoad(e));
    }

    // Ajustar slots por factor de volumen
    let slotsEfectivos = Math.round(estructuraSlots.totalSlots * ajustes.factorVolumen);
    slotsEfectivos = Math.max(3, slotsEfectivos); // Mínimo 3 ejercicios
    
    // Distribuir prioridades
    const distribucion = calcularDistribucionPrioridades(
        estructuraSlots.distribution,
        slotsEfectivos,
        ajustes.tipoSesionModificada
    );
    
    // PASO 3: SELECCIÓN DE EJERCICIOS POR PRIORIDAD
    const ejerciciosSeleccionados = [];
    const idsUsados = new Set();

    // Debug: show inventory size and distribution
    try {
        console.log(`[MainBlockBuilder] inventarioActivo size: ${inventarioActivo.length}, distribucion: ${JSON.stringify(distribucion)}`);
    } catch (e) {}

    
    // PRIORIDAD 1: Ejercicios multiarticulares principales (usa inventario activo)
    const selectedP1 = selectExercisesFromInventory(
        inventarioActivo,
        patronesACubrir,
        musculosObjetivo,
        1,
        distribucion.priority1,
        ejerciciosRecientes,
        idsUsados,
        historial,
        nivelExp,
        sesionObj.structureType,
        sesionObj.sessionFocus,
        safetyProfile
    );

    selectedP1.forEach(e => {
        ejerciciosSeleccionados.push({ ...e, rolSesion: 'primario' });
        idsUsados.add(e.id);
    });
    console.log(`[MainBlockBuilder] selectedP1: ${selectedP1.length}, ids: ${selectedP1.map(s=>s.id).slice(0,6).join(', ')}`);

    // PRIORIDAD 2: Ejercicios accesorios (más relajado, usar inventario completo)
    const selectedP2 = selectExercisesFromInventory(
        inventario,
        patronesACubrir,
        musculosObjetivo,
        2,
        distribucion.priority2,
        ejerciciosRecientes,
        idsUsados,
        historial,
        nivelExp,
        sesionObj.structureType,
        sesionObj.sessionFocus,
        safetyProfile
    );

    selectedP2.forEach(e => {
        ejerciciosSeleccionados.push({ ...e, rolSesion: 'secundario' });
        idsUsados.add(e.id);
    });
    console.log(`[MainBlockBuilder] selectedP2: ${selectedP2.length}, ids: ${selectedP2.map(s=>s.id).slice(0,6).join(', ')}`);

    // PRIORIDAD 3: Ejercicios de aislamiento
    const selectedP3 = selectExercisesFromInventory(
        inventario,
        patronesACubrir,
        musculosObjetivo,
        3,
        distribucion.priority3,
        ejerciciosRecientes,
        idsUsados,
        historial,
        nivelExp,
        sesionObj.structureType,
        sesionObj.sessionFocus,
        safetyProfile
    );

    selectedP3.forEach(e => {
        ejerciciosSeleccionados.push({ ...e, rolSesion: 'aislamiento' });
        idsUsados.add(e.id);
    });
    console.log(`[MainBlockBuilder] selectedP3: ${selectedP3.length}, ids: ${selectedP3.map(s=>s.id).slice(0,6).join(', ')}`);

    console.log(`[MainBlockBuilder] total ejerciciosSeleccionados: ${ejerciciosSeleccionados.length}`);
    
    // ====================================================================
    // PASO 4: ORDENAMIENTO BIOMECÁNICO & PRIORIZACIÓN ELITE
    // ====================================================================
    // Usamos el nuevo selector 'Elite' para ordenar según fatiga y foco de la sesión
    const ejerciciosOrdenados = prioritizeExerciseOrder(
        ejerciciosSeleccionados, 
        sesionObj.sessionFocus, 
        sesionObj.structureType // Pass biomechanical context (e.g. Neural_Strength)
    );

    // Enforce Metabolic isolation prevalence (>50%) si aplica
    if (sesionObj.structureType === 'Metabolic_Volume') {
        const total = ejerciciosOrdenados.length;
        const requiredIsos = Math.ceil(total * 0.5);
        let isoCount = ejerciciosOrdenados.filter(e => 
            (e.mechanics === 'isolation' || e.type === 'isolation' || e.rolSesion === 'aislamiento')
        ).length;
        
        console.log(`[MainBlockBuilder] Metabolic check: ${isoCount}/${requiredIsos} isolations required`);
        
        if (isoCount < requiredIsos) {
            // Buscar isolations en inventario no utilizados
            const isoPool = inventarioActivo.filter(e => 
                (e.mechanics === 'isolation' || e.type === 'isolation') && !idsUsados.has(e.id)
            );
            
            // Ordenar pool por scoring similar al selector principal
            const scoredIso = isoPool.map(ex => {
                let score = 0;
                if (musculosObjetivo.some(m => normalizeText(ex.parteCuerpo || '').includes(m))) score += 5;
                if (ex.url_img_0 || ex.url) score += 2;
                return { ...ex, score };
            }).sort((a, b) => b.score - a.score);
            
            // Reemplazar los últimos compound por isolation hasta alcanzar >50%
            let replacements = 0;
            for (let i = ejerciciosOrdenados.length - 1; i >= 0 && isoCount < requiredIsos && scoredIso.length > 0; i--) {
                const currentEx = ejerciciosOrdenados[i];
                // Solo reemplazar si NO es isolation
                if (currentEx.mechanics !== 'isolation' && currentEx.type !== 'isolation' && currentEx.rolSesion !== 'aislamiento') {
                    const replacement = scoredIso.shift();
                    if (replacement) {
                        ejerciciosOrdenados[i] = { ...replacement, rolSesion: 'aislamiento' };
                        idsUsados.delete(currentEx.id);
                        idsUsados.add(replacement.id);
                        isoCount++;
                        replacements++;
                        console.log(`[MainBlockBuilder] Replaced ${currentEx.id} with isolation ${replacement.id}`);
                    }
                }
            }
            
            console.log(`[MainBlockBuilder] Metabolic enforcement: ${replacements} replacements made, final iso count: ${isoCount}/${total}`);
        }
    }

    // Enforce axial-first and focus top-2 again in final ordering (deterministic guarantee)
    if (sesionObj.structureType === 'Neural_Strength' && ejerciciosOrdenados.length >= 2) {
        let newOrder = [...ejerciciosOrdenados];
        // Detect axial loads using expanded keyword set
        const axialKeywords = [
            'sentadilla','squat','peso muerto','deadlift','militar','overhead','press militar',
            'clean','snatch','jerk','good morning','front squat','back squat','romanian deadlift','sumo deadlift','thruster','push press','strict press'
        ];
        const axials = ejerciciosOrdenados.filter(e => {
            const name = normalizeText(e.nombre || e.name || '');
            const patron = normalizeText(e.patronMovimiento || '');
            const matchByName = axialKeywords.some(kw => name.includes(kw));
            const isVerticalLoad = patron.includes('cadera') || patron.includes('rodilla');
            const isOverheadPattern = patron.includes('empuje_v');
            return matchByName || (isVerticalLoad && isOverheadPattern);
        });
        let pos = 0;
        for (const a of axials) {
            if (pos >= 2) break;
            const idx = newOrder.findIndex(x => x.id === a.id);
            if (idx > pos) {
                newOrder.splice(idx, 1);
                newOrder.splice(pos, 0, a);
            }
            pos++;
        }

        // If still not enough axials, try to fetch from inventoryActivo and inject them deterministically
        const currentAxialCount = newOrder.slice(0,2).filter(e => {
            const name = normalizeText(e.nombre || e.name || '');
            return name.includes('sentadilla') || name.includes('squat') || name.includes('peso muerto') || name.includes('deadlift') || name.includes('militar') || name.includes('overhead');
        }).length;
        if (currentAxialCount < 2) {
            const axialPool = inventarioActivo.filter(e => {
                const name = normalizeText(e.nombre || e.name || '');
                return (name.includes('sentadilla') || name.includes('squat') || name.includes('peso muerto') || name.includes('deadlift') || name.includes('militar') || name.includes('overhead')) && !newOrder.find(n=>n.id===e.id);
            });
            let injectPos = 0;
            for (const ax of axialPool) {
                if (injectPos >= 2) break;
                // Replace the rightmost non-axial among first 2
                for (let i=0;i<2;i++) {
                    const cand = newOrder[i];
                    const name = normalizeText(cand.nombre || cand.name || '');
                    const isAx = name.includes('sentadilla') || name.includes('squat') || name.includes('peso muerto') || name.includes('deadlift') || name.includes('militar') || name.includes('overhead');
                    if (!isAx) {
                        // Replace
                        newOrder.splice(i, 1, ax);
                        idsUsados.add(ax.id);
                        break;
                    }
                }
                injectPos++;
            }
        }

        ejerciciosOrdenados.splice(0, ejerciciosOrdenados.length, ...newOrder);
        // Force top-2 to be primario role to satisfy Neural expectations
        ejerciciosOrdenados[0].rolSesion = 'primario';
        ejerciciosOrdenados[1].rolSesion = 'primario';
        console.log(`[MainBlockBuilder] Final enforced axial-first: first2=${ejerciciosOrdenados.slice(0,2).map(e=>e.id).join(', ')}`);

    // ====================================================================
    // SAFE SPECIALIZATION ENFORCEMENT (Science-driven safeguards):
    // - Principiante: no añadir volumen adicional por foco (cap 10%), prioridad en orden
    // - Intermedio: permitir 1-2 isolations extra si condiciones (48h rest / baja fatiga)
    // - Avanzado: permitir técnicas de intensidad en foco
    // ====================================================================
    try {
        const safeSpec = sesionObj.contentData && sesionObj.contentData.safeSpecialization ? sesionObj.contentData.safeSpecialization : null;
        const isUserFocus = safeSpec && safeSpec.isUserFocusSession;

        if (safeSpec && isUserFocus) {
            const level = safeSpec.level || 'Principiante';
            const focusMuscles = musculosObjetivo || [];

            // Determinar allowed extra isolations según nivel y condiciones del día
            let allowedExtraIsos = safeSpec.allowedExtraIsolations || 0;
            if (level === 'Intermedio') {
                const ef = (sesionObj.context && sesionObj.context.externalFatigue) ? sesionObj.context.externalFatigue.toLowerCase() : 'none';
                if (ef !== 'none' || (ajustes && ajustes.factorVolumen && ajustes.factorVolumen < 1)) {
                    // No permitir isolations extra si hay fatiga externa o factor volumen reducido
                    allowedExtraIsos = 0;
                    console.log(`[MainBlockBuilder][SafeSpec] Intermedio: externalFatigue=${ef} or factorVolumen low -> disallow extra isolations`);
                }
            }

            // Identificar isolations que impactan el foco
            const focusIsos = ejerciciosOrdenados.filter(e => {
                const parte = normalizeText(e.parteCuerpo || e.bodyPart || '');
                const isIso = (e.rolSesion === 'aislamiento' || e.mechanics === 'isolation' || e.type === 'isolation');
                const matches = focusMuscles.some(m => parte.includes(normalizeText(m)));
                return isIso && matches;
            });

            // Si exceden lo permitido, demotar y mover al final reduciendo sets
            if (focusIsos.length > allowedExtraIsos) {
                const extras = focusIsos.slice(allowedExtraIsos);
                for (const ex of extras) {
                    const idx = ejerciciosOrdenados.findIndex(x => x.id === ex.id);
                    if (idx > -1) {
                        const rem = ejerciciosOrdenados.splice(idx, 1)[0];
                        rem.rolSesion = 'secundario';
                        rem.sets = Math.max(1, (rem.sets || 3) - 1); // Reducir vol. marginalmente
                        ejerciciosOrdenados.push(rem);
                        console.log(`[MainBlockBuilder][SafeSpec] Demoted focus isolation ${rem.id} for level=${level}`);
                    }
                }
            }

            // Enforce priority start (Principiante / Intermedio)
            if (safeSpec.enforcePriorityStart) {
                const firstFocusCompoundIdx = ejerciciosOrdenados.findIndex(e => {
                    const parte = normalizeText(e.parteCuerpo || e.bodyPart || '');
                    const isCompound = !(e.mechanics === 'isolation' || e.type === 'isolation' || e.rolSesion === 'aislamiento');
                    return isCompound && focusMuscles.some(m => parte.includes(normalizeText(m)));
                });
                if (firstFocusCompoundIdx > 0) {
                    const [f] = ejerciciosOrdenados.splice(firstFocusCompoundIdx, 1);
                    ejerciciosOrdenados.splice(0, 0, f);
                    console.log(`[MainBlockBuilder][SafeSpec] Moved ${f.id} to start because it's user's focus (level=${level})`);
                }
            }

            // Advanced: marcar ejercicios de foco para permitir técnicas de intensidad en etapas posteriores
            if (safeSpec.allowIntensityTechniques) {
                ejerciciosOrdenados.forEach(e => {
                    const parte = normalizeText(e.parteCuerpo || e.bodyPart || '');
                    if (focusMuscles.some(m => parte.includes(normalizeText(m)))) {
                        e.allowIntensityTechniques = true;
                    }
                });
            }
        }
    } catch (err) {
        console.warn('[MainBlockBuilder][SafeSpec] Error applying safe specialization rules:', err.message);
    }

    }

    const focusNorm = normalizeText(sesionObj.sessionFocus || '');
    if (focusNorm && focusNorm !== 'general' && ejerciciosOrdenados.length >= 2) {
        let newOrder = [...ejerciciosOrdenados];
        const focusCandidates = ejerciciosOrdenados.filter(e => (e.parteCuerpo||'').toLowerCase().includes(focusNorm));
        let pos = 0;
        for (const fc of focusCandidates) {
            if (pos >= 2) break;
            const idx = newOrder.findIndex(x => x.id === fc.id);
            if (idx > pos) {
                newOrder.splice(idx, 1);
                newOrder.splice(pos, 0, fc);
            }
            pos++;
        }
        ejerciciosOrdenados.splice(0, ejerciciosOrdenados.length, ...newOrder);
        console.log(`[MainBlockBuilder] Final enforced focus top-2: ${sesionObj.sessionFocus} -> first2=${ejerciciosOrdenados.slice(0,2).map(e=>e.id).join(', ')}`);
    }
    
    // ====================================================================
    // PASO 5: PRESCRIPCIÓN DE CARGA Y VOLUMEN
    // ====================================================================
    console.log(`[MainBlockBuilder] before_prescription: ejerciciosSeleccionados=${ejerciciosSeleccionados.length}, ejerciciosOrdenados=${(ejerciciosOrdenados||[]).length}`);
    for (const ejercicio of ejerciciosOrdenados) {
        const prescripcion = calcularCargaPrecisa(
            ejercicio,
            historial,
            contextoMesociclo, // Pasar contexto completo del mesociclo
            ajustes,
            perfilEquipo
        );

        // --- Low-Load Pivot / Safety caps: aplicar máximos si el Scheduler marcó pivot ---
        if (sesionObj.context && sesionObj.context.maxRPE) {
            prescripcion.rpeObjetivo = Math.min(prescripcion.rpeObjetivo || 7, sesionObj.context.maxRPE);
            // Ajustar RIR en consecuencia (simple mapping)
            prescripcion.rirObjetivo = Math.max(1, Math.round(10 - prescripcion.rpeObjetivo));
            console.log(`[MainBlockBuilder] Applied MaxRPE cap to ${ejercicio.id}: rpe=${prescripcion.rpeObjetivo}, rir=${prescripcion.rirObjetivo}`);
        }

        // Si la sesión es low-load además, aseguramos sets más bajos
        if (isLowLoadPivot) {
            // Reducir sets base para preservar recuperación
            if (!ejercicio.rolSesion || ejercicio.rolSesion === 'primario') {
                // Primary compounds should be avoided earlier, but in case, reduce to 2 or 1
                // We'll let further logic compute setsFinal with reduced factor
            }
        }

        // Aplicar overrides de peso por usuario (feedback adaptation)
        try {
            const userWeights = perfilEquipo && perfilEquipo.exerciseWeights ? perfilEquipo.exerciseWeights : null;
            if (userWeights && typeof userWeights[ejercicio.id] === 'number') {
                prescripcion.pesoSugerido = userWeights[ejercicio.id];
                prescripcion.pesoSugeridoStr = `${userWeights[ejercicio.id]}kg`;
                console.log(`[MainBlockBuilder] Overriding prescripcion.pesoSugerido for ${ejercicio.id} -> ${userWeights[ejercicio.id]}kg (user override)`);
            }
        } catch (e) {
            console.warn('[MainBlockBuilder] Error applying user weight overrides', e && e.message);
        }
        
        // Determinar sets según rol y nivel
        const setsBase = ejercicio.rolSesion === 'primario' 
            ? configVolumen.setsPerExercise.compound
            : configVolumen.setsPerExercise.isolation;
        
        let setsFinal = Math.max(2, Math.round(setsBase * ajustes.factorVolumen));

        // === SPECIALIZATION VOLUME ADJUSTMENT (Home-only conservative augmentation) ===
        try {
            const safeSpec = sesionObj.contentData && sesionObj.contentData.safeSpecialization ? sesionObj.contentData.safeSpecialization : null;
            const equipmentProfile = sesionObj.context && sesionObj.context.equipmentProfile ? sesionObj.context.equipmentProfile : null;
            const gymSpecialFlag = sesionObj.context && sesionObj.context.gym3DayNonConsecSpecialization;

            // Augment specialization volume for HOME training OR for GYM when 3-day non-consecutive specialization is set
            if ((equipmentProfile && equipmentProfile.location === 'home') || gymSpecialFlag) {
                if (safeSpec && safeSpec.userDeclaredFocus && safeSpec.capExtraVolumePct && safeSpec.capExtraVolumePct > 0) {
                    // Map declared focus to muscles
                    const declaredFocusMuscles = mapearFocusAMusculos(safeSpec.userDeclaredFocus);
                    const exercisePart = normalizeText(ejercicio.parteCuerpo || ejercicio.bodyPart || '');
                    const isFocusMuscle = declaredFocusMuscles.some(m => exercisePart.includes(normalizeText(m)));
                    if (isFocusMuscle) {
                        const extraPct = Number(safeSpec.capExtraVolumePct) || 0.1; // default 10%
                        const oldSets = setsFinal;
                        setsFinal = Math.max(1, Math.round(setsFinal * (1 + extraPct)));
                        const tag = (equipmentProfile && equipmentProfile.location === 'home') ? 'HomeSpecializationVolume' : 'Gym3DayNonConsecSpecializationVolume';
                        console.log(`[MainBlockBuilder] ${tag} applied for ${ejercicio.id}: ${oldSets} -> ${setsFinal} sets (+${(extraPct*100).toFixed(0)}%)`);
                        if (!ejercicio.justificacionCarga) ejercicio.justificacionCarga = '';
                        ejercicio.justificacionCarga = (ejercicio.justificacionCarga ? ejercicio.justificacionCarga + ' | ' : '') + `${tag}:+${(extraPct*100).toFixed(0)}%`;
                    }
                }
            }
        } catch (e) {
            console.warn('[MainBlockBuilder] Error applying specialization volume adjustment', e && e.message);
        }
        
        // Determinar descanso según objetivo y tipo
        const protocoloDescanso = REST_PROTOCOLS[getObjetivoDesdeGoal(contextoMesociclo)] || REST_PROTOCOLS.Hipertrofia;
        // Usar promedio del rango óptimo para mejor adherencia científica
        const descansoBase = ejercicio.rolSesion === 'primario' 
            ? Math.round((protocoloDescanso.compound.min + protocoloDescanso.compound.max) / 2)
            : Math.round((protocoloDescanso.isolation.min + protocoloDescanso.isolation.max) / 2);
        
        let descansoFinal = Math.round(descansoBase * (ajustes.multiplicadorDescanso || 1));

        // Override from biomechanical translator (por estructura) si aplica
        try {
            const bio = translateBiomechanics(sesionObj.structureType, nivelExp);
            const roleKey = ejercicio.rolSesion === 'primario' ? 'primary' : (ejercicio.rolSesion === 'secundario' ? 'accessory' : 'isolation');
            if (bio && bio.restProtocols && bio.restProtocols[roleKey]) {
                descansoFinal = bio.restProtocols[roleKey];
                console.log(`[MainBlockBuilder] Biomech override rest for ${ejercicio.id} role=${roleKey} -> ${descansoFinal}s`);
            }
        } catch (e) {
            console.warn('[MainBlockBuilder] Error applying biomechanical rest override', e && e.message);
        }
        
        bloquesFinal.push({
            id: ejercicio.id,
            nombre: ejercicio.nombre,
            // debug source info
            _source: ejercicio._source || null,
            descripcion: ejercicio.descripcion,
            correcciones: ejercicio.correcciones || [],
            
            // Prescripción
            sets: setsFinal,
            reps: prescripcion.repsObjetivo,
            peso: prescripcion.pesoSugerido,
            rpeTarget: prescripcion.rpeObjetivo,
            rirTarget: prescripcion.rirObjetivo,
            tempo: prescripcion.tempo,
            descanso: `${descansoFinal}s`,

            
            // Metadatos
            equipo: ejercicio.equipo,
            patronMovimiento: ejercicio.patronMovimiento,
            parteCuerpo: ejercicio.parteCuerpo,
            prioridad: ejercicio.prioridad,
            rolSesion: ejercicio.rolSesion,
            
            // Progresión
            tipoProgresion: prescripcion.tipoProgresion,
            tecnica: prescripcion.tecnica,
            
            // Indicadores históricos
            indicadores: prescripcion.indicadores,
            
            // Notas y justificación
            notasTecnicas: ejercicio.correcciones?.join(' | ') || '',
            // Combine prescripcion explanation with any specialization tag injected earlier
            justificacionCarga: (function(){
                const base = prescripcion.explicacion || '';
                const spec = ejercicio.justificacionCarga || '';
                if (spec && base) return `${base} | ${spec}`;
                if (spec) return spec;
                return base;
            })(),
            specializationApplied: ejercicio.justificacionCarga ? true : false,
            
            // Imágenes
            imageUrl: ejercicio.url_img_0 || ejercicio.url,
            imageUrl2: ejercicio.url_img_1,
            
            // Estructura para tracking
            performanceData: {
                plannedSets: setsFinal,
                actualSets: []
            }
        });
    }
    
    // Si es Low-Load Pivot, insertar bloques de movilidad/core/cardio para completar la sesión de disipación
    if (isLowLoadPivot) {
        try {
            console.log('[MainBlockBuilder] Inserting mobility/core/cardio blocks for Low-Load Pivot');
            const mobility = (typeof generateSpecificRAMP === 'function') ? generateSpecificRAMP(sesionObj.sessionFocus, inventarioActivo) : [];
            if (mobility && mobility.length > 0) {
                const mobilityBlock = {
                    tipo: 'Movilidad',
                    ejercicios: mobility.map((m, i) => ({ id: `mob_${i}_${normalizeText(m.name || m.nombre || 'mob')}`, nombre: m.name || m.nombre || 'Movilidad', sets: 1, reps: m.duration || m.duration || '60s', rolSesion: 'mobility' }))
                };
                bloquesFinal.unshift(mobilityBlock);
            }

            const coreBlock = {
                tipo: 'Core Preventivo',
                ejercicios: [ { id: 'core_preventivo_1', nombre: 'Circuito Core Preventivo', sets: 1, reps: '3-4 circuits', rolSesion: 'core' } ]
            };
            bloquesFinal.splice(1, 0, coreBlock);

            const cardioBlock = {
                tipo: 'Cardio LISS',
                ejercicios: [ { id: 'liss_20m', nombre: 'Cardio LISS - 20min', sets: 1, reps: '20min', rolSesion: 'cardio' } ]
            };
            bloquesFinal.push(cardioBlock);

        } catch (e) {
            console.warn('[MainBlockBuilder] Error adding low-load support blocks', e && e.message);
        }
    }

    // ====================================================================
    // PASO 6: ESTRUCTURAR COMO BLOQUES (Estaciones o Superseries)
    // ====================================================================
    const metodoSesion = sesionObj.structureType || 'Estaciones_Puras';
    
    return estructurarBloques(bloquesFinal, metodoSesion, contextoMesociclo, ajustes);
}

/**
 * Mapea el foco de sesión a patrones de movimiento
 */
function mapearFocusAPatrones(sessionFocus) {
    const focusNorm = normalizeText(sessionFocus || '');
    
    for (const [key, patrones] of Object.entries(MOVEMENT_PATTERN_MAP)) {
        const keyNorm = normalizeText(key);
        const keyNoUnderscore = keyNorm.replace(/_/g, '');
        const keyWords = keyNorm.split('_').filter(Boolean);
        const allWordsPresent = keyWords.length > 0 && keyWords.every(w => focusNorm.includes(w));

        if (
            focusNorm.includes(keyNorm) ||
            focusNorm.includes(keyNoUnderscore) ||
            allWordsPresent
        ) {
            return patrones;
        }
    }
    
    // Fallback: patrones generales
    return ['Empuje_H', 'Traccion_H', 'Rodilla', 'Cadera'];
}

/**
 * Mapea el foco a músculos objetivo
 */
function mapearFocusAMusculos(sessionFocus) {
    const focusNorm = normalizeText(sessionFocus || '');
    
    for (const [key, musculos] of Object.entries(MUSCLE_FOCUS_MAP)) {
        const keyNorm = normalizeText(key);
        const keyNoUnderscore = keyNorm.replace(/_/g, '');
        const keyWords = keyNorm.split('_').filter(Boolean);
        const allWordsPresent = keyWords.length > 0 && keyWords.every(w => focusNorm.includes(w));

        if (
            focusNorm.includes(keyNorm) ||
            focusNorm.includes(keyNoUnderscore) ||
            allWordsPresent
        ) {
            return musculos;
        }
    }
    
    return ['General'];
}

/**
 * Calcula la distribución de prioridades según slots disponibles
 */
function calcularDistribucionPrioridades(distribucionBase, slotsEfectivos, tipoModificado) {
    const ratio = slotsEfectivos / (distribucionBase.priority1 + distribucionBase.priority2 + distribucionBase.priority3);
    
    let dist = {
        priority1: Math.max(1, Math.round(distribucionBase.priority1 * ratio)),
        priority2: Math.max(1, Math.round(distribucionBase.priority2 * ratio)),
        priority3: Math.max(0, Math.round(distribucionBase.priority3 * ratio))
    };
    
    // Ajustar si la sesión es de recuperación/metabólica
    if (tipoModificado === 'Hipertrofia_Metabolica' || tipoModificado === 'Recuperacion_Activa') {
        // Menos compuestos pesados, más aislamiento
        dist.priority1 = Math.max(1, dist.priority1 - 1);
        dist.priority3 = dist.priority3 + 1;
    }
    
    // Asegurar que la suma sea igual a slotsEfectivos
    const suma = dist.priority1 + dist.priority2 + dist.priority3;
    if (suma > slotsEfectivos) {
        dist.priority3 = Math.max(0, dist.priority3 - (suma - slotsEfectivos));
    }
    
    return dist;
}

/**
 * Selecciona el mejor ejercicio según criterios biomecánicos
 */
function seleccionarMejorEjercicio(
    inventario,
    patronesObjetivo,
    musculosObjetivo,
    prioridadBuscada,
    ejerciciosRecientes,
    idsUsados,
    historial,
    nivel
) {
    // Filtrar por prioridad
    let candidatos = inventario.filter(ex => {
        // Debe coincidir con la prioridad
        if (ex.prioridad !== prioridadBuscada) return false;
        
        // No debe estar ya seleccionado
        if (idsUsados.has(ex.id)) return false;
        
        // Debe ser del bloque principal (aceptar formas comunes: 'main_block', 'principal', o vacío)
        const categoria = normalizeText(ex.categoriaBloque || '');
        const categoriaAceptada = ['main_block', 'principal', 'mainblock', 'main block', ''];
        if (!categoriaAceptada.includes(categoria)) return false;
        
        // EXCLUSIÓN EXPLÍCITA DE CORE
        // El core tiene su propio bloque, no debe aparecer en el principal
        const parteCuerpo = normalizeText(ex.parteCuerpo || ex.bodyPart || '');
        const patron = normalizeText(ex.patronMovimiento || ex.pattern || '');
        if (parteCuerpo.includes('core') || parteCuerpo.includes('abdom') || patron.includes('core')) {
            return false;
        }

        // Debe coincidir con patrones o músculos objetivo
        const patronEj = normalizeText(ex.patronMovimiento || '');
        const parteEj = normalizeText(ex.parteCuerpo || '');
        
        const coincidePatron = patronesObjetivo.some(p => patronEj.includes(normalizeText(p)));
        const coincideMusculo = musculosObjetivo.some(m => parteEj.includes(normalizeText(m)));
        
        return coincidePatron || coincideMusculo;
    });
    
    if (candidatos.length === 0) {
        // Relajar criterios: buscar por músculos solamente
        candidatos = inventario.filter(ex => {
            if (idsUsados.has(ex.id)) return false;
            const parteEj = normalizeText(ex.parteCuerpo || '');
            return musculosObjetivo.some(m => parteEj.includes(normalizeText(m)));
        });
    }
    
    if (candidatos.length === 0) return null;
    
    // SCORING: Puntuar cada candidato
    const candidatosConScore = candidatos.map(ex => {
        let score = 0;
        
        // Bonus por no haber sido usado recientemente
        if (!ejerciciosRecientes.has(ex.id)) {
            score += 10;
        }
        
        // Bonus por tener imágenes
        if (ex.url_img_0 || ex.url) {
            score += 2;
        }
        
        // Bonus por tener correcciones (indica buena calidad de datos)
        if (ex.correcciones && ex.correcciones.length > 0) {
            score += 3;
        }
        
        // Penalización por dificultad técnica alta para principiantes
        if (nivel === 'Principiante' && ex.dificultadTecnica === 'Alta') {
            score -= 5;
        }
        
        // Bonus por ejercicios unilaterales para intermedios/avanzados
        if ((nivel === 'Intermedio' || nivel === 'Avanzado') && ex.isUnilateral) {
            score += 2;
        }
        
        // Detectar mesetas y penalizar ejercicios estancados
        const analisisMeseta = detectPlateau(historial, ex.id);
        if (analisisMeseta.isPlateau) {
            score -= 15; // Fuerte penalización para promover variación
        }
        
        return { ...ex, score };
    });
    
    // Ordenar por score y añadir algo de aleatoriedad
    candidatosConScore.sort((a, b) => b.score - a.score);
    
    // Seleccionar del top 3 aleatoriamente para añadir variedad
    const top = candidatosConScore.slice(0, 3);
    return top[Math.floor(Math.random() * top.length)];
}

/**
 * Ordena ejercicios según principios biomecánicos
 * 1. Mayor demanda neurológica primero
 * 2. Multiarticulares antes que aislamiento
 * 3. Peso libre antes que máquinas (si aplica)
 */
function ordenarEjerciciosBiomecanicamente(ejercicios) {
    return ejercicios.sort((a, b) => {
        // Primero por prioridad (menor = más importante)
        if (a.prioridad !== b.prioridad) {
            return a.prioridad - b.prioridad;
        }
        
        // Luego por coeficiente de fatiga del patrón de movimiento
        const fatigaA = FATIGUE_COEFFICIENTS[a.patronMovimiento] || 0.5;
        const fatigaB = FATIGUE_COEFFICIENTS[b.patronMovimiento] || 0.5;
        
        return fatigaB - fatigaA; // Mayor fatiga primero
    });
}

/**
 * Estructura los ejercicios en bloques según el método
 */
function estructurarBloques(ejercicios, metodo, microciclo, ajustes) {
    const protocoloDescanso = microciclo.restProtocol || { betweenSets: 90, betweenExercises: 60 };
    
    if (metodo === 'Superseries_Antagonistas') {
        // Agrupar en pares antagonistas
        return estructurarSuperseries(ejercicios, protocoloDescanso, ajustes);
    } else if (metodo === 'Circuito_Metabolico') {
        // Un solo bloque tipo circuito
        return estructurarCircuito(ejercicios, protocoloDescanso, ajustes);
    } else {
        // Estaciones puras (default)
        return estructurarEstaciones(ejercicios, protocoloDescanso, ajustes);
    }
}

/**
 * Estructura como estaciones individuales
 */
function estructurarEstaciones(ejercicios, protocoloDescanso, ajustes) {
    const descansoBase = protocoloDescanso.betweenSets || 90;
    const multiplicador = ajustes.multiplicadorDescanso || 1;
    
    return {
        tipo: 'estaciones',
        descripcion: 'Completa todas las series de un ejercicio antes de pasar al siguiente',
        bloques: ejercicios.map(ej => ({
            tipo: 'estacion',
            ejercicios: [ej],
            descansoEntreSeries: Math.round(descansoBase * multiplicador),
            descansoEntreEjercicios: protocoloDescanso.betweenExercises || 60
        }))
    };
}

/**
 * Estructura como superseries antagonistas
 */
function estructurarSuperseries(ejercicios, protocoloDescanso, ajustes) {
    const bloques = [];
    const usados = new Set();
    
    // Mapeo de patrones antagonistas
    const antagonistas = {
        'Empuje_H': 'Traccion_H',
        'Empuje_V': 'Traccion_V',
        'Traccion_H': 'Empuje_H',
        'Traccion_V': 'Empuje_V',
        'Rodilla': 'Cadera',
        'Cadera': 'Rodilla'
    };
    
    for (const ejercicio of ejercicios) {
        if (usados.has(ejercicio.id)) continue;
        
        const patronAntagonista = antagonistas[ejercicio.patronMovimiento];
        const pareja = ejercicios.find(e => 
            !usados.has(e.id) && 
            e.id !== ejercicio.id &&
            e.patronMovimiento === patronAntagonista
        );
        
        if (pareja) {
            bloques.push({
                tipo: 'superserie',
                ejercicios: [ejercicio, pareja],
                descansoEntreSeries: 60, // Descanso corto en superseries
                descansoEntreEjercicios: 0, // Sin descanso entre ejercicios de la superserie
                descansoPostBloque: protocoloDescanso.betweenExercises || 90
            });
            usados.add(ejercicio.id);
            usados.add(pareja.id);
        } else {
            // Sin pareja - hacer estación individual
            bloques.push({
                tipo: 'estacion',
                ejercicios: [ejercicio],
                descansoEntreSeries: protocoloDescanso.betweenSets || 90
            });
            usados.add(ejercicio.id);
        }
    }
    
    return {
        tipo: 'superseries',
        descripcion: 'Alterna entre ejercicios antagonistas sin descanso',
        bloques
    };
}

/**
 * Estructura como circuito metabólico
 */
function estructurarCircuito(ejercicios, protocoloDescanso, ajustes) {
    return {
        tipo: 'circuito',
        descripcion: 'Realiza todos los ejercicios seguidos, luego descansa y repite',
        bloques: [{
            tipo: 'circuito',
            ejercicios: ejercicios,
            descansoEntreSeries: 0, // Sin descanso dentro del circuito
            descansoEntreVueltas: 90, // Descanso entre vueltas del circuito
            vueltas: 3 // Número de vueltas al circuito
        }]
    };
}

/**
 * Obtiene el objetivo desde el goal del microciclo
 */
function getObjetivoDesdeGoal(microciclo) {
    const focus = normalizeText(microciclo.focus || '');
    
    if (focus.includes('fuerza') || focus.includes('intensificacion') || focus.includes('sobrecarga')) {
        return 'Fuerza';
    }
    if (focus.includes('volumen') || focus.includes('acumulacion')) {
        return 'Hipertrofia';
    }
    if (focus.includes('descarga') || focus.includes('deload')) {
        return 'Resistencia';
    }
    
    return 'Hipertrofia';
}

export default {
    construirBloquePrincipal
};
