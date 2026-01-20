// ====================================================================
// SESSION GENERATION ORCHESTRATOR V2
// Endpoint principal que orquesta todos los módulos de generación
// Implementa los más altos estándares de ciencias del deporte
// ====================================================================

import { db } from '../../lib/firebaseAdmin.js';
import fs from 'fs';
import path from 'path';

// Importar todos los módulos de generación
import { obtenerDatosContextuales } from '../../lib/sessionGeneration/dataFetcher.js';
import { filtrarEjerciciosDisponibles, detectarAmbienteEntrenamiento } from '../../lib/sessionGeneration/equipmentFilter.js';
import { calcularAjustesAutoregulacion } from '../../lib/sessionGeneration/readinessManager.js';
import { generarCalentamiento } from '../../lib/sessionGeneration/rampGenerator.js';
import { construirBloquePrincipal } from '../../lib/sessionGeneration/mainBlockBuilder.js';
import { construirBloqueCore } from '../../lib/sessionGeneration/coreBuilder.js';
import { generarEnfriamiento } from '../../lib/sessionGeneration/coolDownGenerator.js';
import { generarNarrativaDidactica, generarTipDelDia } from '../../lib/sessionGeneration/educationContent.js';
import { parseRPE, normalizeText, generateSimpleId, formatDuration } from '../../lib/sessionGeneration/utils.js';
import { VOLUME_CONFIG, REST_PROTOCOLS } from '../../lib/sessionGeneration/constants.js';

// --- ELITE PERFORMANCE GENERATORS ---
import { optimizeDailyLoad } from '../../lib/sessionGeneration/generators/loadOptimiser.js';
import { translateBiomechanics } from '../../lib/sessionGeneration/generators/mechanicsTranslater.js';
import { generateSpecificRAMP } from '../../lib/sessionGeneration/generators/exerciseSelector.js';
// ------------------------------------

/**
 * Handler principal para generación de sesiones
 * POST /api/session/generateV2
 */
export default async function handler(req, res) {
    // Solo permitir POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const startTime = Date.now();
        
        // ================================================================
        // 1. VALIDACIÓN Y EXTRACCIÓN DE PARÁMETROS
        // ================================================================
        const {
            userId,
            sessionIndex,       // Índice de la sesión dentro del microciclo
            microcycleIndex,    // Índice del microciclo actual
            energyLevel,        // Nivel de energía (1-5)
            sorenessLevel,      // Nivel de DOMS (1-5)
            sleepQuality,       // Calidad de sueño (1-5)
            stressLevel,        // Nivel de estrés (1-5)
            availableTime,      // Tiempo disponible en minutos
            externalFatigue     // Fatiga externa del día (none/moderate/high/extreme)
        } = req.body;

        // Validaciones
        if (!userId) {
            return res.status(400).json({ 
                error: 'userId es requerido',
                code: 'MISSING_USER_ID'
            });
        }

        // ================================================================
        // 2. OBTENCIÓN DE DATOS CONTEXTUALES
        // ================================================================
        console.log(`[SessionGen V2] Iniciando generación para usuario: ${userId}`);
        
        const contextualData = await obtenerDatosContextuales(userId);
        
        if (!contextualData.success) {
            return res.status(404).json({
                error: contextualData.error,
                code: 'CONTEXT_ERROR'
            });
        }

        const { usuario, mesocicloActivo, catalogoEjercicios, historialSesiones, recentSessions } = contextualData;

        // Inyectar zona horaria enviada por frontend (si existe) para asegurar que las decisiones de "hoy" se hagan en la TZ del usuario
        const clientTimezone = req.body.timezone || usuario.timezone || usuario.profileData?.timezone || 'UTC';
        // Añadir al objeto usuario para uso en todas las funciones subsiguientes
        usuario.timezone = clientTimezone;

        // Persistir en el perfil del usuario si aún no existe (mejora: evita tener que enviarlo siempre desde frontend)
        try {
            if (!usuario.profileData?.timezone && clientTimezone) {
                await db.collection('users').doc(userId).set({ profileData: { timezone: clientTimezone } }, { merge: true });
                console.log(`[SessionGen V2] Persisted timezone for user ${userId}: ${clientTimezone}`);
                usuario.profileData = usuario.profileData || {};
                usuario.profileData.timezone = clientTimezone;
            }
        } catch (e) {
            console.warn('[SessionGen V2] Could not persist timezone to user profile:', e && e.message ? e.message : e);
        }

        // Validar que hay mesociclo activo
        if (!mesocicloActivo) {
            return res.status(400).json({
                error: 'No hay mesociclo activo. Genera uno primero.',
                code: 'NO_ACTIVE_MESOCYCLE'
            });
        }

        // ================================================================
        // 2.5. OBTENER UBICACIÓN Y EQUIPAMIENTO DEL PERFIL
        // ================================================================
        // CRÍTICO: Obtener del perfil para mantener consistencia en sobrecarga progresiva
        const location = usuario.preferredTrainingLocation || 'gym';
        const availableEquipment = usuario.availableEquipment || [];
        const homeWeights = usuario.homeWeights || null;

        // Validar que el perfil tenga la información necesaria
        if (!location || !['gym', 'home'].includes(location)) {
            return res.status(400).json({
                error: 'El perfil del usuario no tiene una ubicación de entrenamiento válida (preferredTrainingLocation)',
                code: 'INVALID_PROFILE_LOCATION'
            });
        }

        if (!availableEquipment || !Array.isArray(availableEquipment) || availableEquipment.length === 0) {
            return res.status(400).json({
                error: 'El perfil del usuario no tiene equipamiento configurado (availableEquipment)',
                code: 'MISSING_PROFILE_EQUIPMENT'
            });
        }

        console.log(`[SessionGen V2] Ubicación desde perfil: ${location}, Equipamiento: ${availableEquipment.join(', ')}`);


        // ================================================================
        // 3. DETERMINAR SESIÓN Y MICROCICLO ACTUAL
        // ================================================================
        const { microciclo, sesion, microcycleIdx, sessionIdx } = determinarSesionActual(
            mesocicloActivo,
            microcycleIndex,
            sessionIndex,
            usuario // Pasar usuario para cálculo correcto según zona horaria del usuario
        );

        if (!sesion) {
            return res.status(400).json({
                error: 'No se pudo determinar la sesión actual',
                code: 'SESSION_NOT_FOUND'
            });
        }

        console.log(`[SessionGen V2] Sesión: ${sesion.sessionFocus}, Microciclo ${microcycleIdx + 1}, Fase: ${microciclo.focus}`);
        console.log(`[SessionGen V2] structureType: ${sesion.structureType || 'undefined'}`);

        // ================================================================
        // 4. DETECTAR AMBIENTE Y FILTRAR EJERCICIOS
        // ================================================================
        // Normalizar equipamiento según ubicación
        // - Siempre incluir "Peso Corporal" (bodyweight)
        // - Si gym: excluir equipos típicos de casa (bandas, kettlebells, mini loops, foam roller)
        // - Si home: usar exactamente lo que envía el frontend
        const equipamientoNormalizado = normalizarEquipamientoPorUbicacion(
            availableEquipment,
            location
        );
        
        // Crear perfil de pesos específicos para casa
        const perfilPesosEspecificos = location === 'home' && homeWeights ? {
            dumbbells: homeWeights.dumbbells || [],  // Array de pesos disponibles [5, 10, 15]
            barbell: homeWeights.barbell || null,    // Peso de barra + discos si aplica
            kettlebells: homeWeights.kettlebells || []
        } : null;
        
        // detectarAmbienteEntrenamiento espera solo el array de equipamiento
        const tipoAmbiente = location === 'gym' 
            ? 'gym' 
            : detectarAmbienteEntrenamiento(equipamientoNormalizado);

        // filtrarEjerciciosDisponibles espera (catalogo, ubicacion, inventario)
        const ejerciciosFiltrados = filtrarEjerciciosDisponibles(
            catalogoEjercicios,
            location,
            equipamientoNormalizado
        );

        console.log(`[SessionGen V2] Ambiente: ${tipoAmbiente}, Ubicación: ${location}, Ejercicios disponibles: ${ejerciciosFiltrados.length}`);
        console.log(`[SessionGen V2] Equipamiento normalizado: ${equipamientoNormalizado.join(', ')}`);

        // Clasificar ejercicios por bloque
        const ejerciciosPorBloque = clasificarEjerciciosPorBloque(ejerciciosFiltrados);

        // ================================================================
        // 5. CALCULAR AJUSTES DE AUTOREGULACIÓN
        // ================================================================
        // Preparar parámetros para calcularAjustesAutoregulacion
        // Firma: (nivelEnergia, nivelDolor, zonaDolor, musculosSesionHoy, faseMesociclo, contextExtra)
        const nivelEnergia = energyLevel || 3;
        const nivelDolor = sorenessLevel || 2;
        const zonaDolor = null; // El frontend no envía zona específica de dolor
        const musculosSesionHoy = obtenerMusculosDeSesion(sesion.sessionFocus);
        const faseMesociclo = microciclo.focus || '';
        
        const contextExtra = {
            historial: historialSesiones || [],
            cargaExterna: externalFatigue || null, // ← CONECTAR: externalFatigue = cargaExterna
            sleepQuality: sleepQuality || 3,
            stressLevel: stressLevel || 3
        }; 

        const ajustesReadiness = calcularAjustesAutoregulacion(
            nivelEnergia,
            nivelDolor,
            zonaDolor,
            musculosSesionHoy,
            faseMesociclo,
            contextExtra
        );

        console.log(`[SessionGen V2] Readiness: ${ajustesReadiness.readinessCategoria}, Factor volumen: ${ajustesReadiness.factorVolumen}`);

        // ================================================================
        // 6. CALCULAR PARÁMETROS DE ENTRENAMIENTO
        // ================================================================
        const nivel = usuario.experienceLevel || 'Intermedio';
        const objetivo = usuario.fitnessGoal || 'Hipertrofia';
        
        const rpeBase = parseRPE(microciclo.intensityRpe) || 7;
        const rirBase = microciclo.targetRIR ?? (10 - rpeBase);
        
        // Aplicar ajustes de readiness
        const rpeAjustado = Math.max(5, rpeBase + ajustesReadiness.deltaRPE);
        const rirAjustado = Math.max(1, rirBase + ajustesReadiness.deltaRIR);

        // ================================================================
        // 7. GENERAR BLOQUE DE CALENTAMIENTO (RAMP) - SIN POTENTIATE
        // ================================================================
        // NOTA: La fase Potentiate se generará DESPUÉS del bloque principal
        // para poder usar el primer ejercicio en series de aproximación
        // Firma: generarCalentamiento(sesionFocus, lesionesUsuario, inventarioEjercicios, opciones)
        let calentamientoPreliminar = generarCalentamiento(
            sesion.sessionFocus,
            usuario.injuriesOrLimitations || [],
            ejerciciosPorBloque.calentamiento,
            {
                nivel: nivel,
                ambiente: tipoAmbiente,
                skipPotentiate: true // Flag interno para omitir Potentiate temporalmente
            }
        );

        // ================================================================
        // 7.5 LOGICA DE CONSISTENCIA Y VARIACIÓN
        // ================================================================
        let forcedMainBlock = null;
        let blacklistedExerciseIds = [];
        
        // ID del mesociclo actual para comparaciones
        const currentMesoId = mesocicloActivo.id || `meso_${new Date(mesocicloActivo.startDate || mesocicloActivo.generationDate).getTime()}`;

        // A) Consistencia Intra-Mesociclo (Semana 2+)
        if (microcycleIdx > 0) {
            
            // Estrategia híbrida: Metadatos (preferido) o Fechas (fallback)
            const week1Session = (recentSessions || []).find(s => {
                
                // Opción A: Match por metadatos explícitos
                if (s.mesocycleId && s.microcycleIndex !== undefined && s.sessionIndex !== undefined) {
                    return s.mesocycleId === currentMesoId && 
                           s.microcycleIndex === 0 && 
                           s.sessionIndex === sessionIdx;
                }
                
                // Opción B: Fallback a Fechas si no hay metadatos (legacy)
                const startMeso = new Date(mesocicloActivo.startDate);
                const endWeek1 = new Date(startMeso);
                endWeek1.setDate(endWeek1.getDate() + 7);
                const d = new Date(s.completedAt);
                
                // NOTA: Esta lógica de fechas es frágil en scripts de prueba donde todo ocurre el mismo día
                // Por eso la opción A es crítica
                return d >= startMeso && d < endWeek1;
            });

            if (week1Session && week1Session.mainBlock) {
                console.log(`[GenerateV2] Encontrada sesión de referencia CONSISTENTE (Week 1, Session ${sessionIdx})`);

                // Normalizar distintos formatos de mainBlock almacenados en historial:
                // - Forma esperada: Array de bloques [{ ejercicios: [...] }, ...]
                // - Forma legacy: { tipo: 'estaciones', bloques: [ { ejercicios: [...] }, ... ] }
                // - Otras variantes: objeto con 'ejercicios' directamente
                const mb = week1Session.mainBlock;
                let normalizedBlocks = null;

                if (Array.isArray(mb)) {
                    normalizedBlocks = mb;
                } else if (mb && Array.isArray(mb.bloques)) {
                    // Transformar bloques -> formato esperado
                    normalizedBlocks = mb.bloques.map(b => ({ ...b, ejercicios: b.ejercicios || [] }));
                    console.log(`[GenerateV2] Normalizado mainBlock desde 'bloques' (${normalizedBlocks.length} bloques).`);
                } else if (mb && mb.ejercicios) {
                    // Caso: un único bloque representado como objeto
                    normalizedBlocks = Array.isArray(mb.ejercicios) ? [ { ejercicios: mb.ejercicios } ] : [ { ejercicios: [mb.ejercicios] } ];
                    console.log(`[GenerateV2] Normalizado mainBlock desde único bloque con 'ejercicios'.`);
                } else {
                    // No reconocido: usar como viene (fallback)
                    normalizedBlocks = mb;
                }

                // Guardar tanto los bloques como la metadata de la sesión fuente (ambiente/equipo)
                forcedMainBlock = {
                    blocks: normalizedBlocks,
                    sourceSessionMeta: {
                        sessionEnvironment: week1Session.sessionEnvironment || week1Session.sessionEnvironment || null,
                        equipmentSnapshot: week1Session.equipmentSnapshot || null,
                        mesocycleId: week1Session.mesocycleId || null
                    }
                };

            } else {
                console.log(`[GenerateV2] No se encontró sesión de referencia en Week 1 para Session ${sessionIdx}. Se generará nueva.`);
                
                // Fallback adicional para scripts de prueba síncronos:
                // Si la sesión 0 se acaba de completar hace milisegundos y aún no tiene metadatos correctos (race condition?),
                // intentamos buscar por 'orden' en recentSessions si coinciden en número.
                // (Omitimos esto por seguridad en producción, confiamos en la mejora de complete.js)
            }
        }
        // B) Variación Inter-Mesociclo (Para Semana 1)
        else if (microcycleIdx === 0) {
             // Recolectar ejercicios de ciclos ANTERIORES
             const blacklistSet = new Set();
             
             (recentSessions || []).forEach(s => {
                 const isPreviousCycle = s.mesocycleId && s.mesocycleId !== currentMesoId;
                 const isOldDate = !s.mesocycleId && new Date(s.completedAt) < new Date(mesocicloActivo.startDate);
                 
                 if (isPreviousCycle || isOldDate) {
                     if (s.mainBlock && Array.isArray(s.mainBlock)) {
                         s.mainBlock.forEach(b => {
                             if (b.ejercicios) {
                                 b.ejercicios.forEach(e => blacklistSet.add(e.id));
                             }
                         });
                     }
                 }
             });

            blacklistedExerciseIds = Array.from(blacklistSet);
            // Limitamos el blacklist por si acaso es enorme, pero para 30 sesiones recientes está bien
            console.log(`[GenerateV2] Variación Inter-Mesociclo: ${blacklistedExerciseIds.length} ejercicios en blacklist.`);
        }

        // ================================================================
        // 8. GENERAR BLOQUE PRINCIPAL
        // ================================================================
        
        // --- ELITE: PRE-CALCULATE OPTIMIZATIONS ---
        // Prioridad: 1) Request body (real-time), 2) Session context (planificado), 3) Default
        const effectiveExternalFatigue = externalFatigue || sesion.context?.externalFatigue || 'none';
        const effectiveEnergyLevel = energyLevel || sesion.context?.energyLevel || 3;

        console.log(`[EliteGen] Safety Switch inputs: externalFatigue=${effectiveExternalFatigue}, energy=${effectiveEnergyLevel}`);

        const eliteOptimization = optimizeDailyLoad(
            { 
                externalFatigue: effectiveExternalFatigue,
                energyLevel: effectiveEnergyLevel,
                sorenessLevel: sorenessLevel || 2
            },
            {
                rpe: rpeAjustado,
                rir: rirAjustado,
                baseVolume: 3 // Reference
            },
            (microcycleIdx || 0) + 1
        );
        
        const eliteBiomechanics = translateBiomechanics(
            sesion.structureType || 'Hypertrophy_Standard', 
            nivel
        );
        console.log(`[EliteGen] SafetySwitch: ${eliteOptimization.actionTaken} (RPE:${eliteOptimization.finalRPE}), Bio: ${eliteBiomechanics.tempo}`);
        // ------------------------------------------

        // Firma: construirBloquePrincipal(sesionObj, microciclo, historial, ajustes, inventario, nivelExp, dbEjercicios, perfilEquipo, forcedMainBlock, blacklist)
        // Combinar historial oficial con recentSessions para asegurar que la sesión recién completada
        // esté disponible inmediatamente para el cálculo de carga (sin esperar a procesos batch).
        const combinedHistorial = [ ...(recentSessions || []), ...(historialSesiones || []) ];

        const bloquePrincipal = construirBloquePrincipal(
            sesion,                           // sesionObj
            microciclo,                       // microciclo
            combinedHistorial,                // historial (include recentSessions first)
            ajustesReadiness,                 // ajustes
            ejerciciosPorBloque.principal,    // inventario (ejercicios filtrados)
            nivel,                            // nivelExp
            catalogoEjercicios,               // dbEjercicios
            {                                 // perfilEquipo con pesos específicos
                equipamiento: equipamientoNormalizado,
                ubicacion: location,
                pesosEspecificos: perfilPesosEspecificos,
                exerciseWeights: usuario?.exerciseWeights || {} // user-specific overrides (feedback adaptations)
            },
            forcedMainBlock,                  // ARG 9: Consistencia
            blacklistedExerciseIds            // ARG 10: Variación
        );

        // --- ELITE: POST-PROCESS BLOCKS ---
        // Apply Safety Switch & Biomechanical directives to the generated block
        if (bloquePrincipal) {
             const bloquesArr = Array.isArray(bloquePrincipal) ? bloquePrincipal : (bloquePrincipal.bloques || []);
             bloquesArr.forEach(bloque => {
                 console.log(`[EliteGen] Processing block: tipo=${bloque.tipo}, ejercicios=${(bloque.ejercicios||[]).length}`);
                 if (bloque.ejercicios) {
                     bloque.ejercicios.forEach(ej => {
                        console.log(`[EliteGen] Processing exercise ${ej.id} role=${ej.rolSesion || 'n/a'} current_descanso=${ej.descanso || 'n/a'}`);                        // 1. Biomechanics Translation (Tempo & Intent)
                        // Preserve calculated load, but inject execution style
                        ej.tempo = eliteBiomechanics.tempo;
                        ej.executionIntent = eliteBiomechanics.intent;

                        // Apply specific rest if defined in elite module (robust parsing + structureType enforcement)
                        const roleKey = ej.rolSesion === 'primario' ? 'primary' : 
                                        (ej.rolSesion === 'secundario' ? 'accessory' : 'isolation');

                        const rpConfig = eliteBiomechanics.restProtocols && eliteBiomechanics.restProtocols[roleKey];
                        let parsedRest = null;
                        if (rpConfig !== undefined && rpConfig !== null) {
                            if (typeof rpConfig === 'number') parsedRest = rpConfig;
                            else {
                                const digits = parseInt(String(rpConfig).replace(/\D/g,''), 10);
                                if (!isNaN(digits)) parsedRest = digits;
                            }
                        }

                        if (sesion.structureType === 'Neural_Strength') {
                            // Garantizar mínimo 180s
                            if (parsedRest && parsedRest >= 180) ej.descanso = `${parsedRest}s`;
                            else ej.descanso = '180s';
                        } else if (sesion.structureType === 'Metabolic_Volume') {
                            // Forzar valores metabólicos por rol (45s compounds, 35s isolations)
                            ej.descanso = (ej.rolSesion === 'primario') ? '45s' : '35s';
                        } else if (parsedRest) {
                            ej.descanso = `${parsedRest}s`;
                        } else {
                            ej.descanso = ej.descanso || '90s';
                        }

                        console.log(`[EliteGen] Applied rest ${ej.descanso} for ${ej.id} role=${ej.rolSesion} (parsedRest=${parsedRest})`);

                        // 2. Load Optimization (Safety Switch)
                        // Overwrite RPE/RIR if safety switch was triggered (actionTaken !== 'Standard')
                        if (eliteOptimization.actionTaken !== 'Standard') {
                            // Sobrescribir RPE/RIR con valores de safety
                            ej.rpeTarget = eliteOptimization.finalRPE;
                            ej.rirTarget = eliteOptimization.finalRIR;

                            // Reducción de volumen (aplicar SIEMPRE cuando hay fatiga alta)
                            const oldSets = ej.sets || ej.prescripcion?.series || 3;
                            let newSets = oldSets;
                            
                            if (eliteOptimization.volumePercentReduction) {
                                // Aplicar reducción porcentual (más preciso que -1 flat)
                                newSets = Math.max(1, Math.round(oldSets * (1 - eliteOptimization.volumePercentReduction)));
                                console.log(`[EliteGen] Volume reduction for ${ej.id}: ${oldSets} → ${newSets} sets (-${(eliteOptimization.volumePercentReduction*100).toFixed(0)}%)`);
                            } else if (eliteOptimization.volumeAdjustmentSamples === -1) {
                                // Fallback: quitar 1 serie
                                newSets = Math.max(1, oldSets - 1);
                                console.log(`[EliteGen] Volume reduction for ${ej.id}: ${oldSets} → ${newSets} sets (-1 set)`);
                            }
                            
                            ej.sets = newSets;
                            
                            if (ej.sets < oldSets) {
                                ej.adjustmentReason = (ej.adjustmentReason ? ej.adjustmentReason + " | " : "") + 
                                    `Safety Switch: Volume Reduced ${oldSets}→${newSets} sets due to ${eliteOptimization.actionTaken}.`;
                            }

                            // Sobrescribir prescripción si existe
                            if (ej.prescripcion) {
                                ej.prescripcion.series = newSets;
                                ej.prescripcion.rpeObjetivo = eliteOptimization.finalRPE;
                                ej.prescripcion.rirObjetivo = eliteOptimization.finalRIR;
                            }
                        }
                     });
                 }
             });
        }
        // ----------------------------------

        // ================================================================
        // 8.5 COMPLETAR CALENTAMIENTO CON FASE POTENTIATE
        // ================================================================
        // Ahora que tenemos el bloque principal, podemos generar series de aproximación
        // con el primer ejercicio del main block
        
        let fasePotentiate = [];
        let primerEjercicioMain = null;
        
        // Extraer el primer ejercicio del bloque principal
        if (bloquePrincipal) {
            const bloquesArr = Array.isArray(bloquePrincipal) ? bloquePrincipal : (bloquePrincipal.bloques || []);
            if (bloquesArr.length > 0 && bloquesArr[0].ejercicios && bloquesArr[0].ejercicios.length > 0) {
                primerEjercicioMain = bloquesArr[0].ejercicios[0];
            }
        }
        
        // Importar generarFasePotentiate para usarla directamente
        // (Ya está en el scope desde rampGenerator.js, pero necesitamos llamarla manualmente)
        if (primerEjercicioMain) {
            console.log(`[SessionGen V2] Generando series de aproximación con: ${primerEjercicioMain.nombre}`);
            
            // Generar series de aproximación manualmente con la misma lógica que en rampGenerator
            const numSeriesAprox = nivel === 'Principiante' ? 2 : 3;
            const pesoObjetivo = primerEjercicioMain.pesoObjetivo || primerEjercicioMain.peso || 100;
            
            const porcentajes = nivel === 'Principiante' ? [0.4, 0.6] : [0.4, 0.6, 0.75];
            const repsProgresion = nivel === 'Principiante' ? [8, 6] : [8, 6, 4];
            
            for (let i = 0; i < numSeriesAprox; i++) {
                const pesoSerie = Math.round(pesoObjetivo * porcentajes[i]);
                const reps = repsProgresion[i];
                
                fasePotentiate.push({
                    id: `${primerEjercicioMain.id}-warmup-set-${i + 1}`,
                    nombre: primerEjercicioMain.nombre,
                    fase: 'Potentiate',
                    tipo: 'aproximacion',
                    
                    serieNumero: i + 1,
                    totalSeries: numSeriesAprox,
                    reps: reps,
                    peso: pesoSerie,
                    porcentajeCarga: Math.round(porcentajes[i] * 100),
                    descanso: '90s',
                    
                    equipo: primerEjercicioMain.equipo,
                    imageUrl: primerEjercicioMain.imageUrl || primerEjercicioMain.url_img_0,
                    imageUrl2: primerEjercicioMain.imageUrl2 || primerEjercicioMain.url_img_1,
                    instrucciones: primerEjercicioMain.descripcion || primerEjercicioMain.instrucciones,
                    
                    notas: `Serie de aproximación ${i + 1}/${numSeriesAprox}: ${Math.round(porcentajes[i] * 100)}% del peso objetivo. Enfoque en técnica perfecta.`,
                    esSerieAproximacion: true
                });
            }
        } else {
            console.log(`[SessionGen V2] No hay primer ejercicio main para series de aproximación. Fase Potentiate omitida.`);
        }
        
        // Combinar calentamiento preliminar con fase Potentiate
        const calentamiento = [...calentamientoPreliminar, ...fasePotentiate];

        // ================================================================
        // 9. GENERAR BLOQUE DE CORE (SI APLICA)
        // ================================================================
        let bloqueCore = null;
        if (sesion.includeCore !== false && ejerciciosPorBloque.core.length > 0) {
            bloqueCore = construirBloqueCore(
                ejerciciosPorBloque.core,
                nivel,
                rpeAjustado,
                contextualData,
                ajustesReadiness
            );
        }

        // ================================================================
        // 10. GENERAR BLOQUE DE ENFRIAMIENTO
        // ================================================================
        const enfriamiento = generarEnfriamiento(
            ejerciciosPorBloque.enfriamiento,
            bloquePrincipal,
            nivel,
            8 // duración máxima en minutos
        );

        // ================================================================
        // 11. GENERAR CONTENIDO EDUCATIVO
        // ================================================================
        const contenidoEducativo = generarNarrativaDidactica(
            sesion,
            ajustesReadiness,
            bloquePrincipal,
            tipoAmbiente,
            microciclo,
            nivel
        );

        const tipDelDia = generarTipDelDia(microciclo.notes, nivel);

        // ================================================================
        // 12. ESTRUCTURAR SESIÓN FINAL
        // ================================================================
        const duracionEstimada = calcularDuracionTotal(
            calentamiento,
            bloquePrincipal,
            bloqueCore,
            enfriamiento
        );

        // Generar ID de mesociclo si no existe (el mesociclo está embebido en el documento del usuario)
        const mesocycleId = mesocicloActivo.id || 
            `meso_${new Date(mesocicloActivo.startDate || mesocicloActivo.generationDate).getTime()}`;

        const sesionGenerada = {
            // Metadatos
            id: generateSimpleId(),
            generatedAt: new Date().toISOString(),
            generationTimeMs: Date.now() - startTime,
            version: '2.0.0',
            timezone: usuario.timezone || 'UTC',
            
            // Contexto
            userId,
            mesocycleId: mesocycleId,
            microcycleIndex: microcycleIdx,
            sessionIndex: sessionIdx,
            
            // Información de la sesión
            sessionFocus: sesion.sessionFocus,
            dayOfWeek: sesion.dayOfWeek,
            phase: microciclo.focus,
            weekNumber: microciclo.weekNumber || microciclo.week,
            
            // Parámetros de entrenamiento
            trainingParameters: {
                rpeTarget: (eliteOptimization && eliteOptimization.actionTaken && eliteOptimization.actionTaken !== 'Standard') ? eliteOptimization.finalRPE : rpeAjustado,
                rirTarget: (eliteOptimization && eliteOptimization.actionTaken && eliteOptimization.actionTaken !== 'Standard') ? eliteOptimization.finalRIR : rirAjustado,
                volumeConfig: VOLUME_CONFIG[nivel],
                restProtocol: REST_PROTOCOLS[objetivo],
                ambiente: tipoAmbiente,
                readinessCategory: ajustesReadiness.readinessCategoria,
                adjustmentsApplied: ajustesReadiness.advertencias
            },
            
            // Bloques de entrenamiento
            warmup: calentamiento,
            mainBlock: bloquePrincipal,
            coreBlock: bloqueCore,
            cooldown: enfriamiento,
            
            // Contenido educativo
            education: contenidoEducativo,
            tipOfTheDay: tipDelDia,
            
            // Resumen
            summary: {
                duracionEstimada: formatDuration(duracionEstimada),
                duracionMinutos: duracionEstimada,
                ejerciciosTotales: contarEjerciciosTotales(bloquePrincipal, bloqueCore),
                seriesTotales: contarSeriesTotales(bloquePrincipal, bloqueCore),
                musculosTrabajos: extraerMusculosTrabajados(bloquePrincipal)
            }
        };

        // ================================================================
        // 13. GUARDAR SESIÓN EN FIRESTORE (OPCIONAL)
        // ================================================================
        if (req.body.saveToFirestore !== false) {
            await guardarSesionGenerada(userId, sesionGenerada);
        }

        console.log(`[SessionGen V2] Sesión generada exitosamente en ${Date.now() - startTime}ms`);

        return res.status(200).json({
            success: true,
            session: sesionGenerada
        });

    } catch (error) {
        // Log completo para depuración local
        console.error('ERROR generando sesión:', (error && error.stack) ? error.stack : error);

        // Incluir parte de la stack en la respuesta para facilitar debugging en pruebas locales
        const stackSnippet = (error && error.stack) ? error.stack.split('\n').slice(0,6).join('\n') : null;

        return res.status(500).json({ 
            error: 'Error interno generando la sesión',
            details: error.message,
            code: 'INTERNAL_ERROR',
            stack: stackSnippet
        });
    }
}

/**
 * Determina la sesión actual basada en índices, día de la semana o progreso
 */
function determinarSesionActual(mesociclo, microcycleIndexParam, sessionIndexParam, usuario = {}) {
    const microciclos = mesociclo.mesocyclePlan?.microcycles || mesociclo.microcycles || [];
    
    // Si se proporcionan ambos índices, usarlos directamente
    if (microcycleIndexParam !== undefined && sessionIndexParam !== undefined) {
        const microciclo = microciclos[microcycleIndexParam];
        if (!microciclo) {
            return { microciclo: null, sesion: null, microcycleIdx: null, sessionIdx: null };
        }
        const sesion = microciclo.sessions?.[sessionIndexParam];
        return {
            microciclo,
            sesion,
            microcycleIdx: microcycleIndexParam,
            sessionIdx: sessionIndexParam
        };
    }

    // Determinar la zona horaria del usuario (fallback a UTC)
    const tz = usuario.timezone || usuario.timeZone || usuario.preferredTimezone || usuario.preferredTimeZone || usuario.localeTimezone || (usuario.profileData && usuario.profileData.timezone) || 'UTC';

    // Obtener el día de la semana actual en la zona horaria del usuario usando Intl
    // Esto evita depender del reloj del servidor (puede estar en UTC)
    const diaHoy = new Date().toLocaleString('es-ES', { weekday: 'long', timeZone: tz });
    console.log(`[determinarsesion] usuario.timezone=${tz}, diaHoy (usuario tz)=${diaHoy}`);

    // Calcular el índice del microciclo actual basado en la fecha de inicio, usando "fechas locales" del usuario
    let microcycleIdx = 0;
    if (mesociclo.startDate) {
        const startDate = new Date(mesociclo.startDate);

        // Normalizar a cadenas YYYY-MM-DD en la zona horaria del usuario y calcular la diferencia en días
        const todayStr = new Date().toLocaleString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        const startStr = startDate.toLocaleString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

        const todayMid = Date.parse(`${todayStr}T00:00:00`);
        const startMid = Date.parse(`${startStr}T00:00:00`);
        const diffDays = Math.floor((todayMid - startMid) / (1000 * 60 * 60 * 24));

        microcycleIdx = Math.floor(diffDays / 7);
        microcycleIdx = Math.max(0, Math.min(microcycleIdx, microciclos.length - 1));
    }
    
    // Si se proporciona microcycleIndex, usar ese
    if (microcycleIndexParam !== undefined) {
        microcycleIdx = microcycleIndexParam;
    }
    
    const microciclo = microciclos[microcycleIdx];
    if (!microciclo) {
        return { microciclo: null, sesion: null, microcycleIdx: null, sessionIdx: null };
    }
    
    const sessions = microciclo.sessions || [];
    
    // Buscar la sesión del día de hoy
    for (let j = 0; j < sessions.length; j++) {
        const session = sessions[j];
        if (normalizeText(session.dayOfWeek) === normalizeText(diaHoy)) {
            return {
                microciclo,
                sesion: session,
                microcycleIdx: microcycleIdx,
                sessionIdx: j
            };
        }
    }
    
    // Si no hay sesión para hoy, buscar la primera no completada en el microciclo actual
    for (let j = 0; j < sessions.length; j++) {
        const session = sessions[j];
        if (!session.completed) {
            return {
                microciclo,
                sesion: session,
                microcycleIdx: microcycleIdx,
                sessionIdx: j
            };
        }
    }
    
    // Fallback: devolver la primera sesión del microciclo actual
    return {
        microciclo,
        sesion: sessions[0],
        microcycleIdx: microcycleIdx,
        sessionIdx: 0
    };
}

/**
 * Clasifica ejercicios por su categoría de bloque
 */
function clasificarEjerciciosPorBloque(ejercicios) {
    const clasificacion = {
        calentamiento: [],
        principal: [],
        core: [],
        enfriamiento: []
    };
    
    for (const ejercicio of ejercicios) {
        const categoria = normalizeText(ejercicio.categoriaBloque || ejercicio.category || '');
        
        if (categoria.includes('calentamiento') || categoria.includes('warmup') || categoria.includes('ramp')) {
            clasificacion.calentamiento.push(ejercicio);
        } else if (categoria.includes('core') || categoria.includes('abdom')) {
            clasificacion.core.push(ejercicio);
        } else if (categoria.includes('enfriamiento') || categoria.includes('cooldown') || categoria.includes('estiramiento')) {
            clasificacion.enfriamiento.push(ejercicio);
        } else {
            // Por defecto es bloque principal
            clasificacion.principal.push(ejercicio);
        }
    }
    
    return clasificacion;
}

/**
 * Calcula la duración total estimada de la sesión
 */
function calcularDuracionTotal(calentamiento, bloquePrincipal, bloqueCore, enfriamiento) {
    let total = 0;
    
    // Calentamiento: ~10-12 min
    total += calentamiento?.duracionEstimada || 10;
    
    // Bloque principal: depende de estaciones
    if (bloquePrincipal?.estaciones) {
        for (const estacion of bloquePrincipal.estaciones) {
            for (const ejercicio of estacion.ejercicios || []) {
                const series = ejercicio.prescripcion?.series || 3;
                const descanso = ejercicio.prescripcion?.descanso || 90;
                const tiempoPorSerie = 45; // segundos promedio por serie
                total += Math.ceil((series * tiempoPorSerie + (series - 1) * descanso) / 60);
            }
        }
    }
    
    // Core: ~5-8 min
    if (bloqueCore) {
        total += bloqueCore.duracionEstimada || 6;
    }
    
    // Enfriamiento: ~5-8 min
    total += enfriamiento?.duracionEstimada || 6;
    
    return total;
}

/**
 * Cuenta el total de ejercicios en la sesión
 */
function contarEjerciciosTotales(bloquePrincipal, bloqueCore) {
    let total = 0;
    
    if (bloquePrincipal?.estaciones) {
        for (const estacion of bloquePrincipal.estaciones) {
            total += (estacion.ejercicios || []).length;
        }
    }
    
    if (bloqueCore?.ejercicios) {
        total += bloqueCore.ejercicios.length;
    }
    
    return total;
}

/**
 * Cuenta el total de series en la sesión
 */
function contarSeriesTotales(bloquePrincipal, bloqueCore) {
    let total = 0;
    
    if (bloquePrincipal?.estaciones) {
        for (const estacion of bloquePrincipal.estaciones) {
            for (const ejercicio of estacion.ejercicios || []) {
                total += ejercicio.prescripcion?.series || 0;
            }
        }
    }
    
    if (bloqueCore?.ejercicios) {
        const rondas = bloqueCore.rondas || 1;
        for (const ejercicio of bloqueCore.ejercicios) {
            total += (ejercicio.prescripcion?.series || 1) * rondas;
        }
    }
    
    return total;
}

/**
 * Extrae los músculos trabajados del bloque principal
 */
function extraerMusculosTrabajados(bloquePrincipal) {
    const musculos = new Set();
    
    if (bloquePrincipal?.estaciones) {
        for (const estacion of bloquePrincipal.estaciones) {
            for (const ejercicio of estacion.ejercicios || []) {
                const parteCuerpo = ejercicio.parteCuerpo || ejercicio.bodyPart || '';
                if (parteCuerpo) {
                    musculos.add(parteCuerpo);
                }
            }
        }
    }
    
    return Array.from(musculos);
}

/**
 * Mapea el foco de sesión a músculos objetivo
 * @param {string} sessionFocus - Foco de la sesión (ej: "Pierna", "Pecho/Espalda")
 * @returns {Array} Array de músculos objetivo
 */
function obtenerMusculosDeSesion(sessionFocus) {
    const focus = normalizeText(sessionFocus || '');
    const musculos = [];
    
    if (focus.includes('pierna') || focus.includes('legs')) {
        musculos.push('cuadriceps', 'isquiotibiales', 'gluteos', 'pantorrillas');
    }
    if (focus.includes('pecho') || focus.includes('chest') || focus.includes('push')) {
        musculos.push('pecho', 'triceps', 'hombros');
    }
    if (focus.includes('espalda') || focus.includes('back') || focus.includes('pull')) {
        musculos.push('espalda', 'biceps', 'dorsales');
    }
    if (focus.includes('hombro') || focus.includes('shoulder')) {
        musculos.push('hombros', 'deltoides');
    }
    if (focus.includes('brazo') || focus.includes('arm')) {
        musculos.push('biceps', 'triceps', 'antebrazos');
    }
    if (focus.includes('core') || focus.includes('abdom')) {
        musculos.push('core', 'abdominales', 'oblicuos');
    }
    if (focus.includes('full') || focus.includes('cuerpo completo')) {
        musculos.push('pecho', 'espalda', 'piernas', 'core');
    }
    if (focus.includes('cardio')) {
        musculos.push('cardiovascular');
    }
    
    // Si no se detectó ninguno, devolver array genérico
    if (musculos.length === 0) {
        musculos.push('general');
    }
    
    return musculos;
}

/**
 * Elimina recursivamente los valores undefined de un objeto
 * Firestore no acepta valores undefined
 */
function removeUndefinedValues(obj) {
    if (obj === null || obj === undefined) {
        return null;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => removeUndefinedValues(item)).filter(item => item !== undefined);
    }
    
    if (typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
                cleaned[key] = removeUndefinedValues(value);
            }
        }
        return cleaned;
    }
    
    return obj;
}

/**
 * Normaliza el equipamiento según la ubicación de entrenamiento
 * - Siempre incluye "Peso Corporal" (bodyweight)
 * - Si es gym: excluye equipo típico de casa (bandas, kettlebells, mini loops, foam roller)
 * - Si es home: usa exactamente lo que envía el frontend + peso corporal
 * 
 * @param {Array} equipoFrontend - Equipamiento enviado desde el formulario pre-sesión
 * @param {string} ubicacion - 'gym' | 'home'
 * @returns {Array} Equipamiento normalizado
 */
function normalizarEquipamientoPorUbicacion(equipoFrontend, ubicacion) {
    // Siempre incluir peso corporal
    const equipoNormalizado = new Set(['Peso Corporal']);
    
    // Equipos a excluir en gimnasio (típicos de casa que no se usan en gym comercial)
    const EXCLUIR_EN_GYM = [
        'bandas de resistencia',
        'mini loop bands',
        'mini bands',
        'hip circle',
        'kettlebell',
        'pesa rusa',
        'foam roller',
        'rodillo'
    ];
    
    if (!equipoFrontend || !Array.isArray(equipoFrontend)) {
        // Si no hay equipo, devolver solo peso corporal
        return Array.from(equipoNormalizado);
    }
    
    for (const equipo of equipoFrontend) {
        if (!equipo || typeof equipo !== 'string') continue;
        
        const equipoLower = equipo.toLowerCase().trim();
        
        // Si es gimnasio, verificar si el equipo está en la lista de exclusión
        if (ubicacion === 'gym') {
            const debeExcluir = EXCLUIR_EN_GYM.some(excluido => 
                equipoLower.includes(excluido.toLowerCase())
            );
            
            if (!debeExcluir) {
                equipoNormalizado.add(equipo);
            }
        } else {
            // En casa, aceptar todo el equipo enviado
            equipoNormalizado.add(equipo);
        }
    }
    
    // En gimnasio, agregar acceso completo al equipamiento estándar de gym
    if (ubicacion === 'gym') {
        equipoNormalizado.add('Mancuernas');
        equipoNormalizado.add('Barra Olímpica');
        equipoNormalizado.add('Poleas');
        equipoNormalizado.add('Máquinas');
        equipoNormalizado.add('Banco Ajustable');
        equipoNormalizado.add('Rack de Potencia');
        equipoNormalizado.add('Barra de Dominadas');
    }
    
    return Array.from(equipoNormalizado);
}

/**
 * Guarda la sesión generada en Firestore
 * Guarda tanto en la subcolección generatedSessions como en currentSession del usuario
 * para que el frontend pueda detectar que la sesión está lista
 */
async function guardarSesionGenerada(userId, sesion) {
    try {
        const userRef = db.collection('users').doc(userId);
        
        // Limpiar valores undefined antes de guardar
        const sesionLimpia = removeUndefinedValues(sesion);
        
        // YA NO SE GUARDA EN generatedSessions (Historial eliminado por requerimiento)
        
        // 2. Actualizar currentSession en el documento del usuario
        // Esto es lo que el frontend verifica para saber si la sesión está lista
        const tz = sesion.timezone || sesion.timeZone || 'UTC';
        const localDate = new Date().toLocaleString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

        const currentSessionData = removeUndefinedValues({
            ...sesionLimpia,
            meta: {
                date: new Date().toISOString(), // UTC ISO
                localDate, // YYYY-MM-DD in user's timezone
                timezone: tz,
                generatedAt: sesion.generatedAt,
                sessionId: sesion.id,
                focus: sesion.sessionFocus
            },
            completed: false
        });
        
        await userRef.update({
            currentSession: currentSessionData
        });
        
        console.log(`[SessionGen V2] Sesión actualizada en currentSession (sin historial persistente)`);
    } catch (error) {
        console.error('[SessionGen V2] Error guardando sesión:', error);
        // No fallar la petición si no se puede guardar
    }
}
