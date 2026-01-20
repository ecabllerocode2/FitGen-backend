// ====================================================================
// FLUJO COMPLETO END-TO-END - SISTEMA DE ENTRENAMIENTO
// Prueba integrada desde creación de perfil hasta completar 4 semanas
// Validación científica de consistencia fisiológica
// ====================================================================

import { 
    validarRPESeguro, 
    validarIncrementoCarga, 
    validarRangoReps,
    validarDescansos,
    calcularVolumenSemanal,
    analizarEstructuraSesion,
    LIMITES_SEGUROS 
} from './utils-test.mjs';

const API_BASE = 'http://localhost:3000/api';

// ====================================================================
// PERFIL DE PRUEBA - Usuario real completo
// ====================================================================
const TEST_UID = `test-e2e-${Date.now()}`;

const PERFIL_PRUEBA = {
    userId: TEST_UID,
    userEmail: `test-e2e-${Date.now()}@fitgen.test`,
    profileData: {
        name: "Test E2E Usuario",
        age: 32,
        gender: "Masculino",
        experienceLevel: "Intermedio",
        
        // Objetivo principal
        fitnessGoal: "Hipertrofia",
        
        // Disponibilidad
        trainingDaysPerWeek: 4,
        sessionDuration: 60,
        weeklyScheduleContext: [
            { day: 'Lunes', canTrain: true, externalLoad: 'none' },
            { day: 'Martes', canTrain: false, externalLoad: 'none' },
            { day: 'Miércoles', canTrain: true, externalLoad: 'low' },
            { day: 'Jueves', canTrain: false, externalLoad: 'none' },
            { day: 'Viernes', canTrain: true, externalLoad: 'none' },
            { day: 'Sábado', canTrain: true, externalLoad: 'low' },
            { day: 'Domingo', canTrain: false, externalLoad: 'none' }
        ],
        
        // Ubicación y equipo
        preferredTrainingLocation: "gym",
        availableEquipment: [
            "Barra",
            "Mancuernas",
            "Banco",
            "Rack Sentadillas",
            "Maquina Cable",
            "Discos Peso"
        ],
        
        // Limitaciones
        injuriesOrLimitations: ["Hombro Derecho - Tendinitis"],
        
        // Datos físicos
        initialWeight: 78,
        height: 175,
        
        // Preferencias
        focusAreas: ["Pecho", "Espalda"]
    }
};

// ====================================================================
// TRACKING DE RESULTADOS
// ====================================================================
const resultadosE2E = {
    timestamp: new Date().toISOString(),
    perfil: null,
    mesociclo: null,
    semanas: {},
    validaciones: {
        seguridad: [],
        progresion: [],
        especificidad: [],
        consistencia: []
    },
    resumen: {
        sesionesGeneradas: 0,
        sesionesCompletadas: 0,
        errores: [],
        warnings: []
    }
};

// ====================================================================
// FUNCIONES DE API
// ====================================================================

let authToken = null;
let adminApp = null;
let db = null;

async function inicializarFirebase() {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const { getAuth } = await import('firebase-admin/auth');
    
    // Inicializar si no está inicializado
    const existingApps = getApps();
    if (existingApps.length === 0) {
        // Para emulador, no necesitamos credenciales
        process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
        process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
        adminApp = initializeApp({
            projectId: 'demo-fitgen'
        });
    } else {
        adminApp = existingApps[0];
    }
    
    db = getFirestore(adminApp);
    return { adminApp, db, auth: getAuth(adminApp) };
}

async function crearPerfilDirecto(perfil) {
    console.log('\n📝 PASO 1: Creando perfil de usuario directamente en Firestore...');
    
    const { db, auth } = await inicializarFirebase();
    
    // Crear documento de usuario
    const userData = {
        userId: perfil.userId,
        email: perfil.userEmail,
        plan: 'free',
        status: 'approved',
        profileData: perfil.profileData,
        createdAt: new Date().toISOString(),
        lastProfileUpdate: new Date().toISOString()
    };
    
    await db.collection('users').doc(perfil.userId).set(userData);
    
    // Crear custom token para autenticación
    try {
        authToken = await auth.createCustomToken(perfil.userId);
        console.log(`✅ Token de autenticación generado`);
    } catch (error) {
        // En emulador, podemos usar un token dummy
        authToken = 'test-token-' + perfil.userId;
        console.log(`ℹ️  Usando token dummy para emulador`);
    }
    
    console.log(`✅ Perfil creado directamente: ${perfil.userId}`);
    return { uid: perfil.userId, ...userData };
}

async function generarMesociclo(firebaseUid) {
    console.log('\n🔄 PASO 2: Generando mesociclo...');
    const response = await fetch(`${API_BASE}/mesocycle/generate`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ firebaseUid })
    });
    
    if (!response.ok) {
        throw new Error(`Error generando mesociclo: ${response.status} ${await response.text()}`);
    }
    
    const data = await response.json();
    console.log(`✅ Mesociclo generado: ${data.mesocycleId}`);
    console.log(`   - Estructura: ${data.mesocycle.structureType}`);
    console.log(`   - Objetivo: ${data.mesocycle.primaryGoal}`);
    console.log(`   - Sesiones/semana: ${data.mesocycle.sessionsPerWeek}`);
    return data;
}

async function generarSesion(firebaseUid, mesocycleId, weekNumber, dayIndex, painAreas = []) {
    console.log(`\n🏋️  Generando sesión - Semana ${weekNumber}, Día ${dayIndex + 1}...`);
    const response = await fetch(`${API_BASE}/session/generateV2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            firebaseUid,
            mesocycleId,
            weekNumber,
            dayIndex,
            painAreas,
            forceRegeneration: false
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error generando sesión: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`   ✅ Sesión generada: ${data.session.sessionId}`);
    return data;
}

async function completarSesion(firebaseUid, sessionId, performanceData) {
    console.log(`   📊 Completando sesión ${sessionId}...`);
    const response = await fetch(`${API_BASE}/session/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            firebaseUid,
            sessionId,
            performanceData
        })
    });
    
    if (!response.ok) {
        throw new Error(`Error completando sesión: ${response.status} ${await response.text()}`);
    }
    
    const data = await response.json();
    console.log(`   ✅ Feedback procesado`);
    return data;
}

// ====================================================================
// GENERACIÓN DE FEEDBACK SIMULADO REALISTA
// ====================================================================

function generarFeedbackRealista(sesion, weekNumber) {
    const performanceData = {
        completedAt: new Date().toISOString(),
        readinessPreSession: Math.random() * 3 + 7, // 7-10
        painAreas: [],
        exercises: []
    };
    
    // Simular rendimiento por ejercicio
    sesion.mainBlock.forEach((ejercicio, index) => {
        const targetReps = parseInt(ejercicio.prescripcion.repsObjetivo) || 10;
        const targetSets = parseInt(ejercicio.prescripcion.sets) || 3;
        
        // Simulación realista de RIR y reps basada en semana
        // Semana 1: más conservador (RIR más alto)
        // Semana 2-3: óptimo
        // Semana 4: posible fatiga acumulada
        let rirBase = 2;
        if (weekNumber === 1) rirBase = 2.5;
        if (weekNumber === 4) rirBase = 1.5;
        
        const sets = [];
        for (let i = 0; i < targetSets; i++) {
            // Fatiga intra-sesión: últimas series más difíciles
            const fatigaSet = i * 0.3;
            const reps = Math.max(targetReps - Math.floor(fatigaSet), Math.floor(targetReps * 0.8));
            const rir = Math.max(0, rirBase - fatigaSet);
            
            sets.push({
                setNumber: i + 1,
                reps,
                load: ejercicio.prescripcion.pesoSugerido === 'Exploratorio' 
                    ? null 
                    : ejercicio.prescripcion.pesoSugerido,
                rir: parseFloat(rir.toFixed(1)),
                rpe: parseFloat((10 - rir).toFixed(1)),
                completed: true
            });
        }
        
        performanceData.exercises.push({
            exerciseId: ejercicio.id,
            exerciseName: ejercicio.nombre,
            sets
        });
    });
    
    return performanceData;
}

// ====================================================================
// VALIDACIONES FISIOLÓGICAS
// ====================================================================

function validarSeguridadBiomecanica(sesion, weekNumber) {
    const validaciones = [];
    
    sesion.mainBlock.forEach(ejercicio => {
        const prescripcion = ejercicio.prescripcion;
        
        // Validar RPE
        const rpeVal = validarRPESeguro(
            prescripcion.rpeObjetivo,
            weekNumber,
            ejercicio.prioridad === 1
        );
        validaciones.push({
            ejercicio: ejercicio.nombre,
            tipo: 'RPE',
            valido: rpeVal.valido,
            mensaje: rpeVal.mensaje
        });
        
        // Validar reps
        const repsVal = validarRangoReps(
            prescripcion.repsObjetivo,
            sesion.sessionGoal || 'Hipertrofia'
        );
        validaciones.push({
            ejercicio: ejercicio.nombre,
            tipo: 'Reps',
            valido: repsVal.valido,
            mensaje: repsVal.mensaje
        });
        
        // Validar descanso
        const descansoVal = validarDescansos(
            prescripcion.descansoEnSegundos,
            sesion.sessionGoal || 'Hipertrofia',
            ejercicio.prioridad === 1
        );
        validaciones.push({
            ejercicio: ejercicio.nombre,
            tipo: 'Descanso',
            valido: descansoVal.valido,
            mensaje: descansoVal.mensaje
        });
    });
    
    return validaciones;
}

function validarProgresionEntreFlash(sesionActual, sesionAnterior) {
    if (!sesionAnterior) return [];
    
    const validaciones = [];
    
    // Comparar ejercicios comunes
    sesionActual.mainBlock.forEach(ejActual => {
        const ejAnterior = sesionAnterior.mainBlock.find(e => e.id === ejActual.id);
        
        if (ejAnterior) {
            const pesoActual = parseFloat(ejActual.prescripcion.pesoSugerido);
            const pesoAnterior = parseFloat(ejAnterior.prescripcion.pesoSugerido);
            
            if (!isNaN(pesoActual) && !isNaN(pesoAnterior) && pesoActual > pesoAnterior) {
                const incrementoVal = validarIncrementoCarga(
                    pesoAnterior,
                    pesoActual,
                    ejActual.prioridad === 1
                );
                
                validaciones.push({
                    ejercicio: ejActual.nombre,
                    tipo: 'Incremento Carga',
                    valido: incrementoVal.valido,
                    mensaje: incrementoVal.mensaje,
                    pesoAnterior,
                    pesoActual
                });
            }
        }
    });
    
    return validaciones;
}

function validarConsistenciaEstructural(mesociclo) {
    const validaciones = [];
    
    // Verificar que cada semana tiene la misma cantidad de sesiones
    const sesionesEsperadas = mesociclo.sessionsPerWeek;
    
    for (let week = 1; week <= 4; week++) {
        const weekData = mesociclo[`week${week}`];
        if (!weekData || !weekData.sessions) {
            validaciones.push({
                tipo: 'Estructura',
                valido: false,
                mensaje: `Semana ${week} no tiene estructura de sesiones`
            });
            continue;
        }
        
        if (weekData.sessions.length !== sesionesEsperadas) {
            validaciones.push({
                tipo: 'Estructura',
                valido: false,
                mensaje: `Semana ${week}: esperadas ${sesionesEsperadas} sesiones, encontradas ${weekData.sessions.length}`
            });
        } else {
            validaciones.push({
                tipo: 'Estructura',
                valido: true,
                mensaje: `Semana ${week}: ${weekData.sessions.length} sesiones ✓`
            });
        }
        
        // Verificar que cada sesión tiene focus definido
        weekData.sessions.forEach((sesion, idx) => {
            if (!sesion.sessionFocus) {
                validaciones.push({
                    tipo: 'Focus',
                    valido: false,
                    mensaje: `Semana ${week}, Sesión ${idx + 1}: sin sessionFocus definido`
                });
            }
        });
    }
    
    return validaciones;
}

// ====================================================================
// FLUJO PRINCIPAL
// ====================================================================

async function ejecutarFlujoCompleto() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🧪 PRUEBA E2E - FLUJO COMPLETO DE ENTRENAMIENTO');
    console.log('═══════════════════════════════════════════════════════════════');
    
    try {
        // ================================================================
        // PASO 1: CREAR PERFIL
        // ================================================================
        const perfilCreado = await crearPerfilDirecto(PERFIL_PRUEBA);
        resultadosE2E.perfil = perfilCreado;
        
        // ================================================================
        // PASO 2: GENERAR MESOCICLO
        // ================================================================
        const mesocicloData = await generarMesociclo(perfilCreado.uid);
        resultadosE2E.mesociclo = mesocicloData.mesocycle;
        
        // Validar consistencia estructural
        const validacionesEstructura = validarConsistenciaEstructural(mesocicloData.mesocycle);
        resultadosE2E.validaciones.consistencia.push(...validacionesEstructura);
        
        // ================================================================
        // PASO 3: GENERAR Y COMPLETAR 4 SEMANAS DE ENTRENAMIENTO
        // ================================================================
        const sessionsPerWeek = mesocicloData.mesocycle.sessionsPerWeek;
        
        for (let week = 1; week <= 4; week++) {
            console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
            console.log(`║  SEMANA ${week} - ${week === 1 ? 'CARGA EXPLORATORIA' : week === 4 ? 'DELOAD' : 'PROGRESIÓN ACTIVA'}               ║`);
            console.log(`╚═══════════════════════════════════════════════════════════╝`);
            
            resultadosE2E.semanas[`semana${week}`] = {
                sesiones: [],
                volumenTotal: 0,
                validaciones: []
            };
            
            for (let day = 0; day < sessionsPerWeek; day++) {
                try {
                    // Generar sesión
                    const sesionData = await generarSesion(
                        perfilCreado.uid,
                        mesocicloData.mesocycleId,
                        week,
                        day,
                        [] // Sin pain areas en test
                    );
                    
                    resultadosE2E.resumen.sesionesGeneradas++;
                    
                    // Validar seguridad biomecánica
                    const validacionesSeguridad = validarSeguridadBiomecanica(sesionData.session, week);
                    resultadosE2E.validaciones.seguridad.push(...validacionesSeguridad);
                    
                    // Validar progresión (comparar con sesión anterior misma semana)
                    const sesionAnterior = day > 0 
                        ? resultadosE2E.semanas[`semana${week}`].sesiones[day - 1]
                        : null;
                    
                    const validacionesProgresion = validarProgresionEntreFlash(sesionData.session, sesionAnterior);
                    resultadosE2E.validaciones.progresion.push(...validacionesProgresion);
                    
                    // Calcular volumen
                    const volumen = calcularVolumenSemanal([sesionData.session]);
                    resultadosE2E.semanas[`semana${week}`].volumenTotal += volumen.total;
                    
                    // Guardar sesión
                    resultadosE2E.semanas[`semana${week}`].sesiones.push(sesionData.session);
                    
                    // Generar feedback realista
                    const feedback = generarFeedbackRealista(sesionData.session, week);
                    
                    // Completar sesión
                    await completarSesion(
                        perfilCreado.uid,
                        sesionData.session.sessionId,
                        feedback
                    );
                    
                    resultadosE2E.resumen.sesionesCompletadas++;
                    
                    // Pequeña pausa entre sesiones para simular tiempo real
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    console.error(`   ❌ Error en Semana ${week}, Día ${day + 1}:`, error.message);
                    resultadosE2E.resumen.errores.push({
                        semana: week,
                        dia: day + 1,
                        error: error.message
                    });
                }
            }
        }
        
        // ================================================================
        // PASO 4: ANÁLISIS FINAL
        // ================================================================
        console.log('\n\n╔═══════════════════════════════════════════════════════════════════╗');
        console.log('║              ANÁLISIS CIENTÍFICO DE RESULTADOS                    ║');
        console.log('╚═══════════════════════════════════════════════════════════════════╝');
        
        generarReporteCientifico(resultadosE2E);
        
        // Guardar resultados
        const fs = await import('fs');
        const outputPath = `./results/e2e-completo_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.writeFileSync(outputPath, JSON.stringify(resultadosE2E, null, 2));
        console.log(`\n💾 Resultados guardados en: ${outputPath}`);
        
    } catch (error) {
        console.error('\n❌ ERROR CRÍTICO:', error);
        resultadosE2E.resumen.errores.push({
            tipo: 'critico',
            error: error.message,
            stack: error.stack
        });
    }
}

// ====================================================================
// REPORTE CIENTÍFICO
// ====================================================================

function generarReporteCientifico(resultados) {
    console.log('\n📊 RESUMEN DE EJECUCIÓN:');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`✅ Sesiones generadas: ${resultados.resumen.sesionesGeneradas}`);
    console.log(`✅ Sesiones completadas: ${resultados.resumen.sesionesCompletadas}`);
    console.log(`❌ Errores: ${resultados.resumen.errores.length}`);
    
    // Análisis de seguridad
    console.log('\n🛡️  VALIDACIÓN DE SEGURIDAD BIOMECÁNICA (ACSM 2009):');
    console.log('─────────────────────────────────────────────────────────────');
    const seguridadTotal = resultados.validaciones.seguridad.length;
    const seguridadPasadas = resultados.validaciones.seguridad.filter(v => v.valido).length;
    console.log(`   Total validaciones: ${seguridadTotal}`);
    console.log(`   ✅ Pasadas: ${seguridadPasadas} (${(seguridadPasadas/seguridadTotal*100).toFixed(1)}%)`);
    console.log(`   ❌ Falladas: ${seguridadTotal - seguridadPasadas}`);
    
    const fallosCriticos = resultados.validaciones.seguridad.filter(v => !v.valido);
    if (fallosCriticos.length > 0) {
        console.log('\n   ⚠️  Fallos críticos detectados:');
        fallosCriticos.slice(0, 5).forEach(fallo => {
            console.log(`      - ${fallo.ejercicio}: ${fallo.mensaje}`);
        });
    }
    
    // Análisis de progresión
    console.log('\n📈 VALIDACIÓN DE SOBRECARGA PROGRESIVA (Schoenfeld 2010):');
    console.log('─────────────────────────────────────────────────────────────');
    const progresionTotal = resultados.validaciones.progresion.length;
    if (progresionTotal > 0) {
        const progresionPasadas = resultados.validaciones.progresion.filter(v => v.valido).length;
        console.log(`   Total progresiones: ${progresionTotal}`);
        console.log(`   ✅ Seguras: ${progresionPasadas} (${(progresionPasadas/progresionTotal*100).toFixed(1)}%)`);
        console.log(`   ⚠️  Excesivas: ${progresionTotal - progresionPasadas}`);
    } else {
        console.log('   ℹ️  Sin progresiones entre sesiones (esperado en Semana 1)');
    }
    
    // Análisis de volumen semanal
    console.log('\n📊 ANÁLISIS DE VOLUMEN POR SEMANA (Helms et al. 2018):');
    console.log('─────────────────────────────────────────────────────────────');
    for (let week = 1; week <= 4; week++) {
        const semanaData = resultados.semanas[`semana${week}`];
        if (semanaData) {
            const volumen = semanaData.volumenTotal;
            const volumenRecomendado = week === 1 ? '10-15' : week === 4 ? '8-12' : '15-25';
            console.log(`   Semana ${week}: ${volumen.toFixed(0)} series totales (recomendado: ${volumenRecomendado})`);
            
            // Validación científica de volumen
            if (week === 1 && (volumen < 10 || volumen > 20)) {
                console.log(`      ⚠️  Volumen fuera de rango para fase exploratoria`);
            } else if ((week === 2 || week === 3) && (volumen < 12 || volumen > 30)) {
                console.log(`      ⚠️  Volumen fuera de rango óptimo para hipertrofia`);
            } else if (week === 4 && volumen > 15) {
                console.log(`      ⚠️  Volumen alto para semana de deload`);
            } else {
                console.log(`      ✅ Volumen apropiado`);
            }
        }
    }
    
    // Consistencia estructural
    console.log('\n🏗️  VALIDACIÓN DE CONSISTENCIA ESTRUCTURAL:');
    console.log('─────────────────────────────────────────────────────────────');
    const consistenciaTotal = resultados.validaciones.consistencia.length;
    const consistenciaPasadas = resultados.validaciones.consistencia.filter(v => v.valido).length;
    console.log(`   ✅ Pasadas: ${consistenciaPasadas}/${consistenciaTotal}`);
    
    if (consistenciaTotal - consistenciaPasadas > 0) {
        console.log('\n   ⚠️  Problemas de consistencia:');
        resultados.validaciones.consistencia.filter(v => !v.valido).forEach(fallo => {
            console.log(`      - ${fallo.mensaje}`);
        });
    }
    
    // Evaluación final
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('🎯 EVALUACIÓN FINAL:');
    console.log('═══════════════════════════════════════════════════════════════════');
    
    const tasaExitoSeguridad = seguridadPasadas / seguridadTotal * 100;
    const tasaExitoConsistencia = consistenciaPasadas / consistenciaTotal * 100;
    const promedioExito = (tasaExitoSeguridad + tasaExitoConsistencia) / 2;
    
    if (promedioExito >= 95) {
        console.log('✅ EXCELENTE - Sistema cumple con todos los estándares científicos');
    } else if (promedioExito >= 85) {
        console.log('✓ APROBADO - Sistema cumple con la mayoría de estándares (ajustes menores recomendados)');
    } else if (promedioExito >= 70) {
        console.log('⚠️  ACEPTABLE - Sistema requiere mejoras significativas');
    } else {
        console.log('❌ INSUFICIENTE - Sistema requiere revisión completa');
    }
    
    console.log(`\nTasa de éxito promedio: ${promedioExito.toFixed(1)}%`);
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    // Referencias científicas
    console.log('📚 REFERENCIAS CIENTÍFICAS APLICADAS:');
    console.log('   • ACSM (2009) - Progression Models in Resistance Training');
    console.log('   • Schoenfeld (2010) - Mechanisms of Hypertrophy');
    console.log('   • Helms et al. (2018) - Evidence-based Volume Landmarks');
    console.log('   • Haff & Triplett (2016) - Essentials of Strength Training');
    console.log('   • Zourdos et al. (2016) - RPE-Based Training\n');
}

// ====================================================================
// EJECUCIÓN
// ====================================================================

ejecutarFlujoCompleto().catch(error => {
    console.error('Error no capturado:', error);
    process.exit(1);
});
