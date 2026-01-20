import { db, auth } from '../../lib/firebaseAdmin.js';
import { startOfWeek, addDays } from 'date-fns';

// Importar módulos del Sistema Experto de Generación (v2)
import { 
    Goal, 
    Experience, 
    LEVEL_MAPPING, 
    OBJECTIVE_MAPPING 
} from '../../lib/mesocycleGeneration/constants.js';

import { calculateSystemicStress, determineVolumeTier } from '../../lib/mesocycleGeneration/workCapacity.js';
import { selectSplitArchitecture } from '../../lib/mesocycleGeneration/splitSelector.js';
import { mapSessionsToCalendar } from '../../lib/mesocycleGeneration/sessionScheduler.js';
import { generateSessionContent } from '../../lib/mesocycleGeneration/contentBuilder.js';
import { setSessionIntensity, determineSessionStructureType } from '../../lib/mesocycleGeneration/loadBalancer.js';
import { createMicrocycleProgression } from '../../lib/mesocycleGeneration/progression.js';
import { determinePhaseObjective } from '../../lib/mesocycleGeneration/objectiveManager.js';

// ====================================================================
// GENERADOR DE MESOCICLO ORQUESTADOR (Refactorizado)
// ====================================================================

/**
 * Genera el mesociclo completo orquestando los módulos especializados.
 */
const generarMesocicloCompleto = (usuario, mesocicloAnterior, nextCycleConfig) => {
    console.log('[Generate Módulo] Iniciando orquestación del algoritmo...');

    // 1. ANÁLISIS DE PERFIL & NORMALIZACIÓN
    const rawLevel = usuario.experienceLevel;
    const experienceLevel = LEVEL_MAPPING[typeof rawLevel === 'string' ? rawLevel.toLowerCase() : ''] || Experience.INTERMEDIATE;
    
    // Determinar Objetivo de la Fase (Estrategia)
    const { objetivo: phaseGoal, razon: goalReason } = determinePhaseObjective(usuario, mesocicloAnterior, nextCycleConfig);
    
    // Preparar contexto semanal
    const weeklySchedule = usuario.weeklyScheduleContext || [];
    // Asegurar estructura
    const daysOrder = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    let normalizedSchedule = daysOrder.map(dayName => {
        const found = weeklySchedule.find(d => d.day === dayName);
        return found || { day: dayName, canTrain: false, externalLoad: 'none' };
    });

    // Regla de auditoría: Si el usuario es Principiante y marcó los 7 días como entrenables,
    // forzamos que Domingo sea día de descanso total para proteger la recuperación.
    let forcedSundayRestFor7dBeginner = false;
    try {
        if (experienceLevel === Experience.BEGINNER) {
            const allTrainable = normalizedSchedule.every(d => d.canTrain === true);
            if (allTrainable) {
                console.log('[Generate Módulo] Beginner reported 7 training days — forcing Domingo as rest day');
                normalizedSchedule = normalizedSchedule.map(d => d.day === 'Domingo' ? { ...d, canTrain: false } : d);
                forcedSundayRestFor7dBeginner = true;
            }
        }
    } catch (e) {
        console.warn('[Generate Módulo] Error evaluating forced Sunday rest rule:', e && e.message);
    }

    const daysAvailableCount = normalizedSchedule.filter(d => d.canTrain).length;
    
    if (daysAvailableCount === 0) {
        throw new Error('No hay días disponibles para entrenar. Actualice su perfil.');
    }

    // -----------------------------
    // Calculo de IMC (BMI) y flags
    // -----------------------------
    function computeBMI(profile) {
        const m = (profile && profile.heightCm) ? (profile.heightCm / 100) : null;
        const weight = profile && profile.initialWeight ? profile.initialWeight : null;
        if (!m || !weight) return null;
        return +(weight / (m * m)).toFixed(1);
    }

    const bmi = computeBMI(usuario);
    const isHighBMI = bmi != null && bmi >= 30;
    const isOlder = (usuario.age || 0) >= 50;
    const isBeginner = experienceLevel === Experience.BEGINNER;
    const applyConservativeProtocol = isBeginner && (isHighBMI || isOlder);

    if (applyConservativeProtocol) {
        console.log('[Generate Módulo] Conservative protocol active (bmi=%s age=%s) -> applying safety rules for beginners with high BMI or older age', bmi, usuario.age);
    }

    // 2. EQUIPO / ENTORNO: Determinar si el usuario entrena en casa o en gimnasio
    const isHomeDeclared = Array.isArray(usuario.homeEquipment) && usuario.homeEquipment.length > 0;
    const trainingLocation = isHomeDeclared ? 'home' : (usuario.preferredTrainingLocation || (usuario.hasHomeEquipment ? 'home' : 'gym'));

    // Construir lista de equipamiento efectiva
    const equipmentList = isHomeDeclared
        ? [ 'Peso Corporal', ...usuario.homeEquipment ]
        : (Array.isArray(usuario.availableEquipment) && usuario.availableEquipment.length > 0
            ? usuario.availableEquipment
            : [ 'Barbell', 'Dumbbells', 'Machines', 'Cable', 'Bench' ]);

    // Perfil de equipamiento sintetizado para reglas (booleanos útiles)
    const equipmentProfile = {
        location: trainingLocation,
        equipmentList,
        hasBarbell: equipmentList.some(e => /barbell|barra|olímp|olympic/i.test(e)),
        hasDumbbells: equipmentList.some(e => /dumbbell|mancuernas/i.test(e)),
        hasMachines: equipmentList.some(e => /machine|máquina|maquina|cable|polea/i.test(e)),
        bodyweightOnly: equipmentList.length === 1 && String(equipmentList[0]).toLowerCase().includes('peso')
    };

    // 3. CÁLCULO DE CAPACIDAD DE TRABAJO (Module 1)
    const systemicStress = calculateSystemicStress(normalizedSchedule);
    const targetWeeklyVolume = determineVolumeTier(experienceLevel, systemicStress, equipmentProfile);

    // Determine if Gym 3-day non-consecutive specialization applies
    const trainableIndicesLocal = normalizedSchedule.map((d,i)=> d.canTrain ? i : null).filter(i=> i !== null);
    const isConsecutiveLocal = trainableIndicesLocal.length > 0 && ((trainableIndicesLocal[trainableIndicesLocal.length-1] - trainableIndicesLocal[0]) === (trainableIndicesLocal.length - 1));
    const gym3DayNonConsec = equipmentProfile.location === 'gym' && trainableIndicesLocal.length === 3 && !isConsecutiveLocal;
    equipmentProfile.gym3DayNonConsecSpecialization = gym3DayNonConsec;

    console.log(`[Generate Módulo] Training location detected: ${equipmentProfile.location}. Equipment snapshot: ${equipmentProfile.equipmentList.join(', ')}. gym3DayNonConsecSpecialization=${gym3DayNonConsec}`);

    // Policy override: for beginners with high BMI or older users training in GYM with 5 days available,
    // prefer a safer Torso/Limbs split instead of complex hybrid PHUL
    let splitType = selectSplitArchitecture(daysAvailableCount, experienceLevel, phaseGoal, equipmentProfile);
    if (applyConservativeProtocol && equipmentProfile.location === 'gym' && daysAvailableCount === 5) {
        console.log('[Generate Módulo] Overriding splitType to TORSO_LIMBS for conservative protocol');
        splitType = 'TORSO_LIMBS';
    }

    // Record applied modifications for auditing
    const appliedModifications = [];
    if (applyConservativeProtocol) {
        appliedModifications.push({ reason: (isHighBMI ? 'high_bmi' : 'older_age'), rules: ['avoid_axial', 'avoid_high_impact', 'prefer_machines', 'low_impact_cardio', 'conservative_progression'] });
    }
    
    // 4. GENERACIÓN DE ESTRUCTURA SEMANAL BASE (Module 3)
    // Esto crea el "esqueleto" de la semana: qué se entrena qué día
    const baseWeeklySchedule = mapSessionsToCalendar(normalizedSchedule, splitType, equipmentProfile, experienceLevel);

    // Adjuntar contexto de equipamiento a cada día para que Generation use la misma fuente de verdad
    const baseWeeklyScheduleWithEquipment = baseWeeklySchedule.map(s => ({
        ...s,
        context: {
            ...(s.context || {}),
            equipmentProfile
        }
    }));

    // Create a safetyProfile object and attach it to every session context (frontend can rely on presence)
    const baseSafetyProfile = {
        avoidAxial: !!applyConservativeProtocol,            // avoid axial loads when conservative protocol active
        avoidHighImpact: !!applyConservativeProtocol,       // avoid high-impact/plyo
        preferMachines: !!applyConservativeProtocol,        // prefer machines over free-weight for safety
        loadCoef: applyConservativeProtocol ? 0.85 : 1.0,   // multiplier applied by builders/optimisers
        lowImpactCardio: !!applyConservativeProtocol,       // enforce LISS preference
        reason: applyConservativeProtocol ? (isHighBMI ? 'high_bmi' : 'older_age') : 'none'
    };

    // Attach safetyProfile to each day's context (always present, but may be neutral)
    baseWeeklyScheduleWithEquipment.forEach(s => {
        s.context = { ...(s.context || {}), safetyProfile: baseSafetyProfile };
    });

    // Additional conservative rule for GYM: limit 'hard' sessions per week to 2 and convert others to low-load pivots
    if (applyConservativeProtocol && equipmentProfile.location === 'gym') {
        const trainable = baseWeeklyScheduleWithEquipment.filter(d => !d.isRestDay);
        const n = trainable.length;
        if (n > 2) {
            // Choose heavy days: first and middle-ish to spread load
            const heavyPositions = [0];
            if (n >= 3) heavyPositions.push(Math.floor(n / 2));
            if (heavyPositions.length < 2 && n >= 2) heavyPositions.push(1);

            // Mark non-heavy sessions as low-load pivot
            baseWeeklyScheduleWithEquipment.forEach(d => {
                if (d.isRestDay) return;
                const pos = trainable.indexOf(d);
                if (!heavyPositions.includes(pos)) {
                    d.context = { ...(d.context || {}), lowLoadPivot: true, lowLoadReason: 'conservative_gym_protocol' };
                } else {
                    d.context = { ...(d.context || {}), lowLoadPivot: false };
                }
            });

            appliedModifications.push({ reason: 'reduce_gym_hard_sessions', details: `kept ${heavyPositions.length} heavy sessions per week` });
            console.log(`[Generate Módulo] Conservative gym protocol: converted ${n - heavyPositions.length} sessions to low-load pivots`);
        }
    }

    // 5. CONSTRUCCIÓN DE MICROCICLOS (Modules 4, 5, Sub-routine)
    const microcycles = [];
    const DURATION_WEEKS = 4;

    for (let currentWeek = 1; currentWeek <= DURATION_WEEKS; currentWeek++) {
        
        // Obtener progresión semanal (Ondulación)
        let progression = createMicrocycleProgression(currentWeek);

        // Ajuste conservador para usuarios en casa y principiantes: suavizar semana 3 para evitar sobrecarga del SNC
        if (equipmentProfile && equipmentProfile.location === 'home' && experienceLevel === Experience.BEGINNER && currentWeek === 3) {
            console.log('[Generate Módulo] Home Beginner detected: applying conservative adjustments to week 3 progression');
            progression = {
                ...progression,
                intensityModifier: Math.min(progression.intensityModifier, 0.5), // cap intensity increase
                volumeModifier: Math.max(0.75, (progression.volumeModifier || 1) * 0.95), // slight volume dampening
                notes: `${progression.notes} | NOTE: Applied conservative home adjustment to reduce CNS stress in week 3.`
            };
        }

        // Additional conservative policy: high BMI or older beginners -> dampen week 3 more (both home and gym)
        if (applyConservativeProtocol && currentWeek === 3) {
            console.log('[Generate Módulo] Conservative protocol: applying extra moderation to week 3 progression');
            progression = {
                ...progression,
                intensityModifier: Math.min(progression.intensityModifier, 0.7),
                volumeModifier: Math.max(0.7, (progression.volumeModifier || 1) * 0.9),
                notes: `${progression.notes} | NOTE: Applied conservative protocol adjustments for high BMI/older beginner.`
            };
        }

        // Generar sesiones para esta semana específica
        const sessions = baseWeeklyScheduleWithEquipment.map(baseSession => {
            if (baseSession.isRestDay) return baseSession; // Mantener descansos

            // Calcular Intensidad (RPE) - Module 5 & Load Balancer
            const dayLoad = baseSession.context?.externalFatigue || 'none';
            
            // Base RPE del nivel + Modificador de la semana + Ajuste por carga diaria
            let baseRpe = setSessionIntensity(experienceLevel, dayLoad, baseSession.sessionFocus);
            // Aplicar modificador de fase (semana)
            let finalRpe = baseRpe + (progression.intensityModifier || 0);
            
            // Clamp RPE
            finalRpe = Math.max(5, Math.min(10, finalRpe));
            finalRpe = Number(finalRpe.toFixed(1));

            const targetRIR = Math.max(0, Math.round(10 - finalRpe));
            
            // Definir estructura (Neural vs Metabólico)
            const structureType = determineSessionStructureType(finalRpe);

            // Generar Contenido Rico (Músculos, Core, Cardio) - Module 4
            // Pasamos el foco declarado por el usuario para permitir reglas de especialización segura
            const content = generateSessionContent(baseSession.sessionFocus, phaseGoal, experienceLevel, usuario.focusArea);

            // Annotate content with the safetyProfile (always present on the session context)
            const sProfile = baseSession.context && baseSession.context.safetyProfile ? baseSession.context.safetyProfile : null;
            if (sProfile) {
                content.safetyProfile = sProfile;
                // If flagged, enforce low-impact cardio and ensure minimum duration
                if (sProfile.lowImpactCardio) {
                    if (content.cardio && content.cardio.included) {
                        content.cardio.type = 'LISS_low_impact';
                        content.cardio.duration = Math.max(content.cardio.duration, 20);
                    } else {
                        content.cardio = { included: true, type: 'LISS_low_impact', duration: 15 };
                    }
                }
            }

            return {
                ...baseSession,
                structureType: structureType,
                intensityRpe: finalRpe,
                targetRIR: targetRIR,
                contentData: content, // Metadata para el generador de sesiones
                // Mantener compatibilidad con frontend/generador antiguo si es necesario
                includeCore: content.core.included,
                coreFocus: content.core.focus,
                includeCardio: content.cardio.included,
                cardioType: content.cardio.type,
                cardioDurationMin: content.cardio.duration
            };
        });

        const weeklyIntensityAvg = sessions
            .filter(s => !s.isRestDay)
            .reduce((acc, s) => acc + (s.intensityRpe || 0), 0) / (sessions.filter(s => !s.isRestDay).length || 1);

        // Detectar si se aplicará especialización (Home-only policy)
        let specializationMeta = null;
        try {
            const sampleSafe = (sessions || []).find(s => s && s.contentData && s.contentData.safeSpecialization);
            if (sampleSafe) {
                const ss = sampleSafe.contentData.safeSpecialization;
                if (ss && ss.userDeclaredFocus && ss.capExtraVolumePct && ss.capExtraVolumePct > 0) {
                    if (equipmentProfile && equipmentProfile.location === 'home') {
                        specializationMeta = {
                            target: ss.userDeclaredFocus,
                            extraPct: ss.capExtraVolumePct,
                            applied: true,
                            note: 'Home specialization volume applied at session-exercise level (see main block generation)'
                        };
                    } else if (equipmentProfile && equipmentProfile.gym3DayNonConsecSpecialization) {
                        specializationMeta = {
                            target: ss.userDeclaredFocus,
                            extraPct: ss.capExtraVolumePct,
                            applied: true,
                            note: 'Gym 3-day non-consecutive specialization applied at session-exercise level (see main block generation)'
                        };
                    }
                }
            }
        } catch (e) {
            console.warn('[Generate Mesocycle] Error detecting specialization meta', e && e.message);
        }

        // Compute base weekly sets and apply specialization extra if applicable
        let baseWeeklySetsVal = Math.round(targetWeeklyVolume * (progression.volumeModifier || 1));
        if (specializationMeta && specializationMeta.applied && specializationMeta.extraPct) {
            baseWeeklySetsVal = Math.max(1, Math.round(baseWeeklySetsVal * (1 + specializationMeta.extraPct)));
            console.log(`[Generate Módulo] Applied specialization extra to baseWeeklySets: newBaseWeeklySets=${baseWeeklySetsVal}`);
        }

        microcycles.push({
            week: currentWeek,
            focus: progression.focus,
            intensityRpe: `${weeklyIntensityAvg.toFixed(1)}/10`, // Formato string para compatibilidad UI
            intensityRpeValue: weeklyIntensityAvg,
            targetRIR: Math.max(1, Math.round(10 - weeklyIntensityAvg)),
            notes: progression.notes,
            sessions: sessions,
            // Volume config provisional
            volumeConfig: {
                baseWeeklySets: baseWeeklySetsVal,
                specialization: specializationMeta
            }
        });
    }

    // 6. CONSTRUCCIÓN FINAL DEL OBJETO MESOCICLO
    const today = new Date();
    const startDate = startOfWeek(today, { weekStartsOn: 1 });
    const endDate = addDays(startDate, DURATION_WEEKS * 7);

    return {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        progress: 0.0,
        currentWeek: 1,
        mesocyclePlan: {
            durationWeeks: DURATION_WEEKS,
            mesocycleGoal: phaseGoal,
            goalReason: goalReason,
            strategy: `${splitType}`, // Nombre del Split
            splitDescription: `Arquitectura: ${splitType}. Enfoque: ${phaseGoal}`,
            methodDescription: `Estilo: ${experienceLevel}`,
            microcycles: microcycles
        },
        llmModelUsed: 'v9-system-expert-modular',
        generationDate: today.toISOString(),
        status: 'active',
        metadata: {
            userLevel: experienceLevel,
            userGoal: phaseGoal,
            systemicStressScore: systemicStress,
            splitSelected: splitType,
            baseVolume: targetWeeklyVolume,
            trainingLocation: equipmentProfile.location,
            equipmentList: equipmentProfile.equipmentList,
            equipmentProfile: equipmentProfile,
            // Indicador de corrección de auditoría: Domingo forzado como descanso para Principiantes con 7 días
            forcedSundayRestFor7dBeginner: forcedSundayRestFor7dBeginner,
            // Modificaciones aplicadas por auditoría (BMI/edad/level)
            appliedModifications: appliedModifications,
            // Summary safety profile flags (consistent contract for frontend)
            safetyProfile: baseSafetyProfile
        }
    };
};

export { generarMesocicloCompleto }; // Exportar para tests, aunque ahora depende de módulos

// ===================================
// HANDLER PRINCIPAL (Igual que antes)
// ===================================

export default async function handler(req, res) {

    // NOTE: for testing we also export generarMesocicloCompleto below (ESM named export)

    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido. Use POST.' });
    }
    
    // Verificar autenticación
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticación requerido.' });
    }
    
    try {
        // Verificar token
        const token = authHeader.split('Bearer ')[1];
        const decoded = await auth.verifyIdToken(token);
        const userId = decoded.uid;
        
        // Obtener datos del usuario
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuario no encontrado en la base de datos.' });
        }
        
        const userData = userDoc.data();
        const { profileData, currentMesocycle, nextCycleConfig } = userData;
        
        // Validar que existe profileData
        if (!profileData) {
            return res.status(400).json({ 
                error: 'Perfil incompleto. Complete su perfil antes de generar un mesociclo.' 
            });
        }
        
        // Validar campos mínimos requeridos
        const camposRequeridos = ['experienceLevel', 'fitnessGoal', 'weeklyScheduleContext'];
        const camposFaltantes = camposRequeridos.filter(campo => !profileData[campo]);
        
        if (camposFaltantes.length > 0) {
            return res.status(400).json({ 
                error: `Faltan campos requeridos en el perfil: ${camposFaltantes.join(', ')}` 
            });
        }
        
        // Generar el mesociclo
        console.log(`Generando mesociclo para usuario ${userId}...`);
        const mesocicloGenerado = generarMesocicloCompleto(
            profileData,
            currentMesocycle,
            nextCycleConfig
        );
        
        // Guardar en Firestore
        await db.collection('users').doc(userId).set({
            currentMesocycle: mesocicloGenerado,
            planStatus: 'active',
            nextCycleConfig: null, // Limpiar configuración de ciclo siguiente
            lastMesocycleGeneration: new Date().toISOString()
        }, { merge: true });
        
        console.log(`Mesociclo generado exitosamente para usuario ${userId}`);
        
        return res.status(200).json({
            success: true,
            message: 'Mesociclo generado exitosamente',
            plan: mesocicloGenerado,
            // Compatibilidad: algunos callers/tests esperan la propiedad 'mesocycle'
            mesocycle: mesocicloGenerado
        });
        
    } catch (error) {
        console.error('ERROR al generar mesociclo:', error);
        
        // Manejo de errores específicos
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expirado. Vuelva a iniciar sesión.' });
        }
        
        if (error.code === 'auth/argument-error') {
            return res.status(401).json({ error: 'Token inválido.' });
        }
        
        return res.status(500).json({ 
            error: 'Error interno al generar el mesociclo',
            details: error.message
        });
    }
}
