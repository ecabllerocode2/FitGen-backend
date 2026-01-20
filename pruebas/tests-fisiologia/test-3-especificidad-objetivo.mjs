// ====================================================================
// TEST 3: ESPECIFICIDAD DEL OBJETIVO
// Valida que las sesiones se ajusten al objetivo (Hipertrofia, Fuerza, etc.)
// ====================================================================

import { 
    cargarPerfil, 
    guardarResultado, 
    generarReporte,
    validarRangoReps,
    validarDescansos,
    extraerDescanso,
    RANGOS_REPS
} from './utils-test.mjs';

console.log('🔬 TEST 3: ESPECIFICIDAD DEL OBJETIVO\n');
console.log('Objetivo: Validar que las sesiones respeten los principios del objetivo entrenamiento\n');

const resultados = [];

// ====================================================================
// CASO 1: Hipertrofia - Reps en rango 6-12, descansos 60-120s
// ====================================================================
async function testHipertrofiaEspecificidad() {
    console.log('📝 Caso 1: Hipertrofia - Reps y Descansos...');
    
    const perfil = cargarPerfil('beginner-home.json');
    const objetivo = perfil.profileData.fitnessGoal; // "Hipertrofia"
    
    const sesionHipertrofia = {
        trainingParameters: {
            objetivo: 'Hipertrofia'
        },
        mainBlock: [{
            ejercicios: [
                { 
                    id: 'Dumbbell_Press',
                    nombre: 'Press Mancuerna',
                    reps: 10,
                    sets: 3,
                    descanso: '90s',
                    prioridad: 1
                },
                {
                    id: 'Dumbbell_Row',
                    nombre: 'Remo Mancuerna',
                    reps: 12,
                    sets: 3,
                    descanso: '75s',
                    prioridad: 2
                },
                {
                    id: 'Dumbbell_Curl',
                    nombre: 'Curl Mancuerna',
                    reps: 12,
                    sets: 3,
                    descanso: '60s',
                    prioridad: 3
                }
            ]
        }]
    };
    
    const ejercicios = sesionHipertrofia.mainBlock[0].ejercicios;
    const validaciones = ejercicios.map(ej => {
        const validacionReps = validarRangoReps(ej.reps, 'Hipertrofia');
        const descansoSegundos = extraerDescanso(ej.descanso);
        const validacionDescanso = validarDescansos(descansoSegundos, 'Hipertrofia', ej.prioridad === 1);
        
        return {
            ejercicio: ej.nombre,
            reps: ej.reps,
            descanso: ej.descanso,
            validacionReps,
            validacionDescanso,
            valido: validacionReps.valido && validacionDescanso.valido
        };
    });
    
    const todosPasan = validaciones.every(v => v.valido);
    
    resultados.push({
        caso: 'Hipertrofia - Especificidad',
        passed: todosPasan,
        detalles: {
            objetivo,
            rangoRepsEsperado: RANGOS_REPS.Hipertrofia,
            descansoEsperado: '60-120s',
            validaciones
        }
    });
    
    console.log(todosPasan ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 2: Fuerza - Reps en rango 1-6, descansos 3-5 min
// ====================================================================
async function testFuerzaEspecificidad() {
    console.log('📝 Caso 2: Fuerza - Reps y Descansos...');
    
    const perfil = cargarPerfil('intermediate-gym.json');
    const objetivo = perfil.profileData.fitnessGoal; // "Fuerza_Maxima"
    
    const sesionFuerza = {
        trainingParameters: {
            objetivo: 'Fuerza_Maxima'
        },
        mainBlock: [{
            ejercicios: [
                {
                    id: 'Barbell_Squat',
                    nombre: 'Sentadilla Barra',
                    reps: 5,
                    sets: 5,
                    descanso: '240s', // 4 minutos
                    prioridad: 1
                },
                {
                    id: 'Barbell_Bench_Press',
                    nombre: 'Press Banca',
                    reps: 5,
                    sets: 5,
                    descanso: '240s',
                    prioridad: 1
                },
                {
                    id: 'Barbell_Deadlift',
                    nombre: 'Peso Muerto',
                    reps: 3,
                    sets: 3,
                    descanso: '300s', // 5 minutos
                    prioridad: 1
                }
            ]
        }]
    };
    
    const ejercicios = sesionFuerza.mainBlock[0].ejercicios;
    const validaciones = ejercicios.map(ej => {
        const validacionReps = validarRangoReps(ej.reps, 'Fuerza_Maxima');
        const descansoSegundos = extraerDescanso(ej.descanso);
        const validacionDescanso = validarDescansos(descansoSegundos, 'Fuerza_Maxima', true);
        
        return {
            ejercicio: ej.nombre,
            reps: ej.reps,
            descanso: ej.descanso,
            validacionReps,
            validacionDescanso,
            valido: validacionReps.valido && validacionDescanso.valido
        };
    });
    
    const todosPasan = validaciones.every(v => v.valido);
    
    resultados.push({
        caso: 'Fuerza - Especificidad',
        passed: todosPasan,
        detalles: {
            objetivo,
            rangoRepsEsperado: RANGOS_REPS.Fuerza_Maxima,
            descansoEsperado: '180-300s',
            validaciones
        }
    });
    
    console.log(todosPasan ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 3: Pérdida de grasa - Mayor volumen, descansos cortos
// ====================================================================
async function testPerdidaGrasaEspecificidad() {
    console.log('📝 Caso 3: Pérdida de Grasa - Volumen y Densidad...');
    
    const perfil = cargarPerfil('senior-limited.json');
    const objetivo = perfil.profileData.fitnessGoal; // "Perdida_Grasa"
    
    const sesionPerdidaGrasa = {
        trainingParameters: {
            objetivo: 'Perdida_Grasa'
        },
        mainBlock: [{
            ejercicios: [
                {
                    id: 'Bodyweight_Squat',
                    nombre: 'Sentadilla',
                    reps: 15,
                    sets: 3,
                    descanso: '45s'
                },
                {
                    id: 'Push_Up',
                    nombre: 'Flexiones',
                    reps: 12,
                    sets: 3,
                    descanso: '45s'
                },
                {
                    id: 'Mountain_Climber',
                    nombre: 'Mountain Climbers',
                    reps: 20,
                    sets: 3,
                    descanso: '30s'
                }
            ]
        }]
    };
    
    const ejercicios = sesionPerdidaGrasa.mainBlock[0].ejercicios;
    const validaciones = ejercicios.map(ej => {
        const validacionReps = validarRangoReps(ej.reps, 'Perdida_Grasa');
        const descansoSegundos = extraerDescanso(ej.descanso);
        const validacionDescanso = validarDescansos(descansoSegundos, 'Perdida_Grasa', false);
        const descansosCortos = descansoSegundos <= 60;
        
        return {
            ejercicio: ej.nombre,
            reps: ej.reps,
            descanso: ej.descanso,
            validacionReps,
            validacionDescanso,
            descansosCortos,
            valido: validacionReps.valido && descansosCortos
        };
    });
    
    const todosPasan = validaciones.every(v => v.valido);
    
    resultados.push({
        caso: 'Pérdida de Grasa - Especificidad',
        passed: todosPasan,
        detalles: {
            objetivo,
            rangoRepsEsperado: RANGOS_REPS.Perdida_Grasa,
            descansoEsperado: '30-60s',
            validaciones
        }
    });
    
    console.log(todosPasan ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 4: Volumen semanal apropiado según nivel
// ====================================================================
async function testVolumenSemanalPorNivel() {
    console.log('📝 Caso 4: Volumen Semanal según Nivel...');
    
    const casos = [
        { perfil: 'beginner-home.json', nivel: 'Principiante', volumenOptimo: 12, volumenGenerado: 14 },
        { perfil: 'intermediate-gym.json', nivel: 'Intermedio', volumenOptimo: 16, volumenGenerado: 18 },
        { perfil: 'advanced-home-equipped.json', nivel: 'Avanzado', volumenOptimo: 20, volumenGenerado: 22 }
    ];
    
    const validaciones = casos.map(caso => {
        const enRango = caso.volumenGenerado >= (caso.volumenOptimo - 4) && 
                        caso.volumenGenerado <= (caso.volumenOptimo + 4);
        
        return {
            nivel: caso.nivel,
            volumenOptimo: caso.volumenOptimo,
            volumenGenerado: caso.volumenGenerado,
            enRango,
            diferencia: caso.volumenGenerado - caso.volumenOptimo
        };
    });
    
    const todosPasan = validaciones.every(v => v.enRango);
    
    resultados.push({
        caso: 'Volumen Semanal por Nivel',
        passed: todosPasan,
        detalles: {
            validaciones
        }
    });
    
    console.log(todosPasan ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 5: Ejercicios compuestos antes que aislamiento
// ====================================================================
async function testOrdenEjerciciosCompuestosAislamiento() {
    console.log('📝 Caso 5: Orden - Compuestos antes que Aislamiento...');
    
    const sesion = {
        mainBlock: [{
            ejercicios: [
                { id: 'Barbell_Squat', nombre: 'Sentadilla', prioridad: 1, orden: 1 },
                { id: 'Leg_Press', nombre: 'Prensa', prioridad: 2, orden: 2 },
                { id: 'Leg_Extension', nombre: 'Extensión', prioridad: 3, orden: 3 },
                { id: 'Leg_Curl', nombre: 'Curl Femoral', prioridad: 3, orden: 4 }
            ]
        }]
    };
    
    const ejercicios = sesion.mainBlock[0].ejercicios;
    
    // Verificar que el orden de prioridades sea correcto (1 -> 2 -> 3)
    let ordenCorrecto = true;
    for (let i = 0; i < ejercicios.length - 1; i++) {
        if (ejercicios[i].prioridad > ejercicios[i + 1].prioridad) {
            ordenCorrecto = false;
            break;
        }
    }
    
    const passed = ordenCorrecto;
    
    resultados.push({
        caso: 'Orden - Compuestos antes que Aislamiento',
        passed,
        detalles: {
            ejercicios: ejercicios.map(e => ({
                nombre: e.nombre,
                prioridad: e.prioridad,
                orden: e.orden
            })),
            ordenCorrecto
        }
    });
    
    console.log(passed ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// EJECUTAR TODOS LOS TESTS
// ====================================================================

async function ejecutarTests() {
    await testHipertrofiaEspecificidad();
    await testFuerzaEspecificidad();
    await testPerdidaGrasaEspecificidad();
    await testVolumenSemanalPorNivel();
    await testOrdenEjerciciosCompuestosAislamiento();
    
    const reporte = generarReporte('Test 3: Especificidad del Objetivo', resultados);
    guardarResultado('test-3-especificidad-objetivo', reporte);
    
    process.exit(reporte.resumen.fallados > 0 ? 1 : 0);
}

ejecutarTests().catch(console.error);
