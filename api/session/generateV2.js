// ====================================================================
// SESSION GENERATION ORCHESTRATOR V2
// Endpoint principal que orquesta todos los módulos de generación
// Implementa los más altos estándares de ciencias del deporte
// ====================================================================

import { db } from '../../lib/firebaseAdmin.js';

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
            location,           // 'gym' | 'home'
            availableEquipment, // Array de equipo disponible desde formulario pre-sesión (REQUERIDO)
            homeWeights         // Pesos específicos en casa: { dumbbells: [5, 10, 15], barbell: 20 }
        } = req.body;

        // Validaciones
        if (!userId) {
            return res.status(400).json({ 
                error: 'userId es requerido',
                code: 'MISSING_USER_ID'
            });
        }

        // Validar que se envíe ubicación
        if (!location || !['gym', 'home'].includes(location)) {
            return res.status(400).json({
                error: 'location es requerido y debe ser "gym" o "home"',
                code: 'INVALID_LOCATION'
            });
        }

        // Validar que se envíe equipamiento disponible
        if (!availableEquipment || !Array.isArray(availableEquipment)) {
            return res.status(400).json({
                error: 'availableEquipment es requerido y debe ser un array',
                code: 'MISSING_EQUIPMENT'
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

        const { usuario, mesocicloActivo, catalogoEjercicios, historialSesiones } = contextualData;

        // Validar que hay mesociclo activo
        if (!mesocicloActivo) {
            return res.status(400).json({
                error: 'No hay mesociclo activo. Genera uno primero.',
                code: 'NO_ACTIVE_MESOCYCLE'
            });
        }

        // ================================================================
        // 3. DETERMINAR SESIÓN Y MICROCICLO ACTUAL
        // ================================================================
        const { microciclo, sesion, microcycleIdx, sessionIdx } = determinarSesionActual(
            mesocicloActivo,
            microcycleIndex,
            sessionIndex
        );

        if (!sesion) {
            return res.status(400).json({
                error: 'No se pudo determinar la sesión actual',
                code: 'SESSION_NOT_FOUND'
            });
        }

        console.log(`[SessionGen V2] Sesión: ${sesion.sessionFocus}, Microciclo ${microcycleIdx + 1}, Fase: ${microciclo.focus}`);

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
            cargaExterna: null, // Podría venir del weeklyScheduleContext
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
        // 7. GENERAR BLOQUE DE CALENTAMIENTO (RAMP)
        // ================================================================
        // Firma: generarCalentamiento(sesionFocus, lesionesUsuario, inventarioEjercicios, opciones)
        const calentamiento = generarCalentamiento(
            sesion.sessionFocus,
            usuario.injuriesOrLimitations || [],
            ejerciciosPorBloque.calentamiento,
            {
                nivel: nivel,
                ambiente: tipoAmbiente
            }
        );

        // ================================================================
        // 8. GENERAR BLOQUE PRINCIPAL
        // ================================================================
        // Firma: construirBloquePrincipal(sesionObj, microciclo, historial, ajustes, inventario, nivelExp, dbEjercicios, perfilEquipo)
        const bloquePrincipal = construirBloquePrincipal(
            sesion,                           // sesionObj
            microciclo,                       // microciclo
            historialSesiones || [],          // historial
            ajustesReadiness,                 // ajustes
            ejerciciosPorBloque.principal,    // inventario (ejercicios filtrados)
            nivel,                            // nivelExp
            catalogoEjercicios,               // dbEjercicios
            {                                 // perfilEquipo con pesos específicos
                equipamiento: equipamientoNormalizado,
                ubicacion: location,
                pesosEspecificos: perfilPesosEspecificos
            }
        );

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
                rpeTarget: rpeAjustado,
                rirTarget: rirAjustado,
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
        console.error('[SessionGen V2] Error:', error);
        return res.status(500).json({
            error: 'Error interno generando la sesión',
            details: error.message,
            code: 'INTERNAL_ERROR'
        });
    }
}

/**
 * Determina la sesión actual basada en índices, día de la semana o progreso
 */
function determinarSesionActual(mesociclo, microcycleIndexParam, sessionIndexParam) {
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
    
    // Obtener el día de la semana actual en español
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const hoy = new Date();
    const diaHoy = diasSemana[hoy.getDay()];
    
    // Calcular el índice del microciclo actual basado en la fecha de inicio
    let microcycleIdx = 0;
    if (mesociclo.startDate) {
        const startDate = new Date(mesociclo.startDate);
        const diffTime = hoy.getTime() - startDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
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
        
        // 1. Guardar en la subcolección generatedSessions (historial)
        const sessionRef = userRef.collection('generatedSessions').doc(sesion.id);
        await sessionRef.set({
            ...sesionLimpia,
            savedAt: new Date().toISOString()
        });
        
        // 2. Actualizar currentSession en el documento del usuario
        // Esto es lo que el frontend verifica para saber si la sesión está lista
        const currentSessionData = removeUndefinedValues({
            ...sesionLimpia,
            meta: {
                date: new Date().toISOString(), // Fecha de hoy para que el frontend la detecte
                generatedAt: sesion.generatedAt,
                sessionId: sesion.id,
                focus: sesion.sessionFocus
            },
            completed: false
        });
        
        await userRef.update({
            currentSession: currentSessionData
        });
        
        console.log(`[SessionGen V2] Sesión guardada: ${sesion.id} y actualizada en currentSession`);
    } catch (error) {
        console.error('[SessionGen V2] Error guardando sesión:', error);
        // No fallar la petición si no se puede guardar
    }
}
