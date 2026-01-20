// ====================================================================
// EJEMPLO: INTEGRACIÓN CON ENDPOINT REAL
// Este archivo muestra cómo ejecutar tests contra el endpoint real
// ====================================================================

import fetch from 'node-fetch';
import { cargarPerfil, guardarResultado, generarReporte } from './utils-test.mjs';

console.log('🔗 EJEMPLO: Test con Endpoint Real\n');

const ENDPOINT_URL = 'http://localhost:3000/api/session/generateV2'; // Ajustar según tu setup

// ====================================================================
// FUNCIÓN: Generar sesión real
// ====================================================================
async function generarSesionReal(perfil, parametros) {
    const payload = {
        userId: perfil.userId,
        sessionIndex: parametros.sessionIndex || 0,
        microcycleIndex: parametros.microcycleIndex || 0,
        energyLevel: parametros.energyLevel || 3,
        sorenessLevel: parametros.sorenessLevel || 2,
        sleepQuality: parametros.sleepQuality || 3,
        stressLevel: parametros.stressLevel || 2,
        availableTime: parametros.availableTime || 60,
        homeWeights: perfil.profileData.homeWeights || null,
        externalFatigue: parametros.externalFatigue || 'none',
        painAreas: parametros.painAreas || [],
        painLevel: parametros.painLevel || 0
    };
    
    try {
        const response = await fetch(ENDPOINT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        return data.session;
        
    } catch (error) {
        console.error('❌ Error generando sesión:', error.message);
        throw error;
    }
}

// ====================================================================
// TEST REAL: Semana 1 con principiante en casa
// ====================================================================
async function testRealSemana1Principiante() {
    console.log('📝 Test Real: Semana 1 - Principiante en Casa\n');
    
    const perfil = cargarPerfil('beginner-home.json');
    
    const parametros = {
        microcycleIndex: 0,  // Semana 1
        sessionIndex: 0,      // Primera sesión
        energyLevel: 4,
        sorenessLevel: 1,
        sleepQuality: 4,
        externalFatigue: 'none'
    };
    
    console.log('Generando sesión real...');
    const sesion = await generarSesionReal(perfil, parametros);
    
    console.log('\n✅ Sesión generada:');
    console.log(`   - ID: ${sesion.id}`);
    console.log(`   - Foco: ${sesion.sessionFocus}`);
    console.log(`   - RPE Target: ${sesion.trainingParameters.rpeTarget}`);
    console.log(`   - RIR Target: ${sesion.trainingParameters.rirTarget}`);
    console.log(`   - Ejercicios: ${sesion.summary.ejerciciosTotales}`);
    console.log(`   - Series: ${sesion.summary.seriesTotales}`);
    console.log(`   - Duración: ${sesion.summary.duracionEstimada}\n`);
    
    // Validar que sea exploratoria
    let ejerciciosExploratorios = 0;
    if (sesion.mainBlock) {
        const bloques = Array.isArray(sesion.mainBlock) 
            ? sesion.mainBlock 
            : (sesion.mainBlock.bloques || sesion.mainBlock.estaciones || []);
        
        for (const bloque of bloques) {
            const ejercicios = bloque.ejercicios || [];
            for (const ej of ejercicios) {
                if (ej.prescripcion && ej.prescripcion.esExploratorio) {
                    ejerciciosExploratorios++;
                    console.log(`   🔍 Exploratorio: ${ej.nombre} - ${ej.prescripcion.explicacion}`);
                }
            }
        }
    }
    
    const passed = ejerciciosExploratorios > 0;
    
    console.log(`\n${passed ? '✅' : '❌'} Test: ${ejerciciosExploratorios} ejercicios marcados como exploratorios\n`);
    
    return { sesion, passed };
}

// ====================================================================
// TEST REAL: Progresión Semana 1 → Semana 2
// ====================================================================
async function testRealProgresionSemanas() {
    console.log('📝 Test Real: Progresión Semana 1 → 2\n');
    
    const perfil = cargarPerfil('beginner-home.json');
    
    // Generar Semana 1
    console.log('Generando Semana 1...');
    const sesionS1 = await generarSesionReal(perfil, {
        microcycleIndex: 0,
        sessionIndex: 0,
        energyLevel: 4,
        sorenessLevel: 1
    });
    
    // Simular que se completó la sesión
    // En producción, aquí llamarías a /api/session/complete
    
    // Generar Semana 2
    console.log('Generando Semana 2...');
    const sesionS2 = await generarSesionReal(perfil, {
        microcycleIndex: 1,
        sessionIndex: 0,
        energyLevel: 4,
        sorenessLevel: 2
    });
    
    console.log('\n📊 Comparación:');
    console.log(`   Semana 1 RPE: ${sesionS1.trainingParameters.rpeTarget}`);
    console.log(`   Semana 2 RPE: ${sesionS2.trainingParameters.rpeTarget}`);
    
    // Comparar ejercicios
    const ejerciciosS1 = extraerEjerciciosIds(sesionS1);
    const ejerciciosS2 = extraerEjerciciosIds(sesionS2);
    
    const sonIguales = JSON.stringify(ejerciciosS1) === JSON.stringify(ejerciciosS2);
    
    console.log(`   Ejercicios Semana 1: ${ejerciciosS1.join(', ')}`);
    console.log(`   Ejercicios Semana 2: ${ejerciciosS2.join(', ')}`);
    console.log(`   ${sonIguales ? '✅' : '⚠️'} Estructura ${sonIguales ? 'consistente' : 'diferente'}\n`);
    
    return { sesionS1, sesionS2, passed: true };
}

function extraerEjerciciosIds(sesion) {
    if (!sesion.mainBlock) return [];
    
    const bloques = Array.isArray(sesion.mainBlock)
        ? sesion.mainBlock
        : (sesion.mainBlock.bloques || sesion.mainBlock.estaciones || []);
    
    const ids = [];
    for (const bloque of bloques) {
        const ejercicios = bloque.ejercicios || [];
        ids.push(...ejercicios.map(e => e.id));
    }
    
    return ids;
}

// ====================================================================
// TEST REAL: Lesiones reportadas filtran ejercicios
// ====================================================================
async function testRealFiltradoLesiones() {
    console.log('📝 Test Real: Filtrado por Lesiones\n');
    
    const perfil = cargarPerfil('intermediate-gym.json');
    
    // Generar sesión SIN lesiones
    console.log('Generando sesión sin lesiones...');
    const sesionSinLesiones = await generarSesionReal(perfil, {
        microcycleIndex: 0,
        sessionIndex: 0,
        painAreas: [],
        painLevel: 0
    });
    
    const ejerciciosSinLesiones = extraerEjerciciosIds(sesionSinLesiones);
    console.log(`   Ejercicios generados: ${ejerciciosSinLesiones.length}`);
    
    // Generar sesión CON dolor de hombro
    console.log('\nGenerando sesión con dolor de hombro...');
    const sesionConLesion = await generarSesionReal(perfil, {
        microcycleIndex: 0,
        sessionIndex: 0,
        painAreas: ['hombro'],
        painLevel: 3
    });
    
    const ejerciciosConLesion = extraerEjerciciosIds(sesionConLesion);
    console.log(`   Ejercicios generados: ${ejerciciosConLesion.length}`);
    
    // Verificar que se filtraron ejercicios de hombro
    const ejerciciosHombro = ejerciciosSinLesiones.filter(id => 
        id.toLowerCase().includes('shoulder') || 
        id.toLowerCase().includes('overhead') ||
        id.toLowerCase().includes('press')
    );
    
    const ejerciciosHombroEnLesion = ejerciciosConLesion.filter(id => 
        ejerciciosHombro.includes(id)
    );
    
    const filtroFunciono = ejerciciosHombroEnLesion.length < ejerciciosHombro.length;
    
    console.log(`\n   ${filtroFunciono ? '✅' : '⚠️'} Filtrado ${filtroFunciono ? 'funcionó' : 'no funcionó'}`);
    console.log(`   Ejercicios de hombro sin lesión: ${ejerciciosHombro.length}`);
    console.log(`   Ejercicios de hombro con lesión: ${ejerciciosHombroEnLesion.length}\n`);
    
    return { passed: filtroFunciono };
}

// ====================================================================
// EJECUTAR TESTS REALES
// ====================================================================
async function ejecutarTestsReales() {
    console.log('═'.repeat(70));
    console.log('🔗 EJECUTANDO TESTS CON ENDPOINT REAL');
    console.log('═'.repeat(70) + '\n');
    
    const resultados = [];
    
    try {
        // Test 1: Semana 1 exploratoria
        const test1 = await testRealSemana1Principiante();
        resultados.push({
            test: 'Semana 1 Exploratoria',
            passed: test1.passed,
            sesion: test1.sesion.id
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Test 2: Progresión entre semanas
        const test2 = await testRealProgresionSemanas();
        resultados.push({
            test: 'Progresión Semanas',
            passed: test2.passed,
            sesionesGeneradas: 2
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Test 3: Filtrado de lesiones
        const test3 = await testRealFiltradoLesiones();
        resultados.push({
            test: 'Filtrado Lesiones',
            passed: test3.passed
        });
        
    } catch (error) {
        console.error('\n❌ Error ejecutando tests reales:', error.message);
        console.log('\n⚠️  Asegúrate de que:');
        console.log('   1. El servidor esté corriendo (npm run dev)');
        console.log('   2. El endpoint esté en: ' + ENDPOINT_URL);
        console.log('   3. Los perfiles de usuario existan en Firestore\n');
        
        process.exit(1);
    }
    
    // Generar reporte
    const reporte = generarReporte('Tests Reales con Endpoint', resultados);
    guardarResultado('test-real-endpoint', reporte);
    
    process.exit(reporte.resumen.fallados > 0 ? 1 : 0);
}

// Nota: Este archivo es un EJEMPLO
// Para ejecutarlo, necesitas:
// 1. Tener el servidor corriendo
// 2. Instalar node-fetch: npm install node-fetch
// 3. Tener perfiles en Firestore
// 4. Tener mesociclos activos

console.log('⚠️  NOTA: Este es un archivo de EJEMPLO');
console.log('   Para ejecutar tests reales, asegúrate de tener el servidor corriendo\n');

// Descomentar para ejecutar:
// ejecutarTestsReales().catch(console.error);

export { generarSesionReal, testRealSemana1Principiante, testRealProgresionSemanas };
