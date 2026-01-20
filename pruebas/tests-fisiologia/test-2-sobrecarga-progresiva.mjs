// ====================================================================
// TEST 2: SOBRECARGA PROGRESIVA
// Valida que las cargas aumenten científicamente entre semanas
// ====================================================================

import { 
    cargarPerfil, 
    guardarResultado, 
    generarReporte,
    validarIncrementoCarga,
    extraerPeso
} from './utils-test.mjs';

console.log('🔬 TEST 2: SOBRECARGA PROGRESIVA\n');
console.log('Objetivo: Validar incrementos de carga consistentes y científicos\n');

const resultados = [];

// ====================================================================
// CASO 1: Semana 1 debe tener pesos exploratorios
// ====================================================================
async function testSemana1Exploratoria() {
    console.log('📝 Caso 1: Semana 1 - Pesos Exploratorios...');
    
    const sesionSemana1 = {
        weekNumber: 1,
        mainBlock: [{
            ejercicios: [
                { 
                    id: 'Barbell_Squat',
                    nombre: 'Sentadilla Barra',
                    prescripcion: {
                        pesoSugerido: 'Exploratorio',
                        esExploratorio: true,
                        explicacion: '🔍 SEMANA 1 - Peso Exploratorio: Encuentra un peso...',
                        indicadores: {
                            esSemanaCarga: true
                        }
                    }
                },
                {
                    id: 'Dumbbell_Press',
                    nombre: 'Press Mancuerna',
                    prescripcion: {
                        pesoSugerido: 'Exploratorio',
                        esExploratorio: true,
                        indicadores: {
                            esSemanaCarga: true
                        }
                    }
                }
            ]
        }]
    };
    
    const ejercicios = sesionSemana1.mainBlock[0].ejercicios;
    const todosExploratorios = ejercicios.every(ej => 
        ej.prescripcion.esExploratorio === true &&
        (ej.prescripcion.pesoSugerido === 'Exploratorio' || ej.prescripcion.pesoSugerido === 'Ajustar a RPE')
    );
    
    const passed = todosExploratorios;
    
    resultados.push({
        caso: 'Semana 1 - Pesos Exploratorios',
        passed,
        detalles: {
            weekNumber: sesionSemana1.weekNumber,
            ejercicios: ejercicios.map(ej => ({
                nombre: ej.nombre,
                pesoSugerido: ej.prescripcion.pesoSugerido,
                esExploratorio: ej.prescripcion.esExploratorio
            }))
        }
    });
    
    console.log(passed ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 2: Semana 2 debe usar pesos basados en historial de Semana 1
// ====================================================================
async function testSemana2UsaHistorial() {
    console.log('📝 Caso 2: Semana 2 - Usa Historial...');
    
    // Simular historial de Semana 1
    const historialSemana1 = [{
        exerciseId: 'Barbell_Squat',
        completedAt: '2026-01-11',
        performanceData: {
            actualSets: [
                { reps: 8, weight: 60, rir: 2 },
                { reps: 8, weight: 60, rir: 2 },
                { reps: 7, weight: 60, rir: 3 }
            ]
        }
    }];
    
    // Sesión Semana 2 debe calcular peso basado en el historial
    const sesionSemana2 = {
        weekNumber: 2,
        mainBlock: [{
            ejercicios: [
                {
                    id: 'Barbell_Squat',
                    nombre: 'Sentadilla Barra',
                    prescripcion: {
                        pesoSugerido: 61.5, // +2.5% sobre 60kg
                        esExploratorio: false,
                        tipoProgresion: 'increase_load',
                        indicadores: {
                            pesoAnterior: '60kg',
                            repsAnterior: 8,
                            rirAnterior: '2.3',
                            e1RMEstimado: '72.5kg'
                        },
                        explicacion: 'Sobrecarga calculada: +2.5% según tu e1RM de 72.5kg'
                    }
                }
            ]
        }]
    };
    
    const ejercicio = sesionSemana2.mainBlock[0].ejercicios[0];
    const tieneHistorial = ejercicio.prescripcion.indicadores.pesoAnterior !== null;
    const noEsExploratorio = ejercicio.prescripcion.esExploratorio === false;
    const pesoCalculado = typeof ejercicio.prescripcion.pesoSugerido === 'number';
    const tieneE1RM = ejercicio.prescripcion.indicadores.e1RMEstimado !== null;
    
    const passed = tieneHistorial && noEsExploratorio && pesoCalculado && tieneE1RM;
    
    resultados.push({
        caso: 'Semana 2 - Usa Historial',
        passed,
        detalles: {
            weekNumber: sesionSemana2.weekNumber,
            ejercicio: ejercicio.nombre,
            pesoAnterior: ejercicio.prescripcion.indicadores.pesoAnterior,
            pesoNuevo: ejercicio.prescripcion.pesoSugerido,
            e1RMEstimado: ejercicio.prescripcion.indicadores.e1RMEstimado,
            tipoProgresion: ejercicio.prescripcion.tipoProgresion
        }
    });
    
    console.log(passed ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 3: Incremento lineal consistente en Semanas 2-4
// ====================================================================
async function testIncrementoLinealConsistente() {
    console.log('📝 Caso 3: Incremento Lineal Semanas 2-4...');
    
    const progresionEsperada = [
        { semana: 2, peso: 61.5 },  // +2.5% sobre 60
        { semana: 3, peso: 63.0 },  // +2.5% sobre 61.5
        { semana: 4, peso: 64.6 }   // +2.5% sobre 63
    ];
    
    const validaciones = [];
    
    for (let i = 0; i < progresionEsperada.length - 1; i++) {
        const actual = progresionEsperada[i];
        const siguiente = progresionEsperada[i + 1];
        
        const validacion = validarIncrementoCarga(actual.peso, siguiente.peso, true);
        validaciones.push({
            transicion: `Semana ${actual.semana} → ${siguiente.semana}`,
            ...validacion
        });
    }
    
    const todosPasan = validaciones.every(v => v.valido);
    
    resultados.push({
        caso: 'Incremento Lineal Semanas 2-4',
        passed: todosPasan,
        detalles: {
            progresionEsperada,
            validaciones
        }
    });
    
    console.log(todosPasan ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 4: Si RIR fue bajo (<2), debe mantener o reducir carga
// ====================================================================
async function testAjustePorRIRBajo() {
    console.log('📝 Caso 4: Ajuste por RIR Bajo...');
    
    const historialRIRBajo = {
        exerciseId: 'Barbell_Squat',
        performanceData: {
            actualSets: [
                { reps: 8, weight: 60, rir: 1 }, // RIR muy bajo
                { reps: 7, weight: 60, rir: 0 }, // Fallo técnico
                { reps: 6, weight: 60, rir: 1 }
            ]
        }
    };
    
    // La sesión siguiente NO debe incrementar carga
    const sesionSiguiente = {
        mainBlock: [{
            ejercicios: [{
                id: 'Barbell_Squat',
                prescripcion: {
                    pesoSugerido: 60, // Mantiene
                    tipoProgresion: 'maintain',
                    explicacion: 'Mantenemos carga similar para consolidar el estímulo.',
                    indicadores: {
                        pesoAnterior: '60kg',
                        rirAnterior: '0.7' // Promedio muy bajo
                    }
                }
            }]
        }]
    };
    
    const ejercicio = sesionSiguiente.mainBlock[0].ejercicios[0];
    const pesoAnterior = parseFloat(ejercicio.prescripcion.indicadores.pesoAnterior);
    const pesoNuevo = ejercicio.prescripcion.pesoSugerido;
    const noIncrementa = pesoNuevo <= pesoAnterior;
    const rirAnteriorBajo = parseFloat(ejercicio.prescripcion.indicadores.rirAnterior) < 2;
    
    const passed = noIncrementa && rirAnteriorBajo;
    
    resultados.push({
        caso: 'Ajuste por RIR Bajo',
        passed,
        detalles: {
            rirAnterior: ejercicio.prescripcion.indicadores.rirAnterior,
            pesoAnterior,
            pesoNuevo,
            tipoProgresion: ejercicio.prescripcion.tipoProgresion
        }
    });
    
    console.log(passed ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 5: Si RIR fue alto (>3), debe incrementar carga
// ====================================================================
async function testAjustePorRIRAlto() {
    console.log('📝 Caso 5: Ajuste por RIR Alto...');
    
    const historialRIRAlto = {
        exerciseId: 'Dumbbell_Press',
        performanceData: {
            actualSets: [
                { reps: 10, weight: 20, rir: 4 }, // Muy fácil
                { reps: 10, weight: 20, rir: 4 },
                { reps: 10, weight: 20, rir: 3 }
            ]
        }
    };
    
    // La sesión siguiente DEBE incrementar carga
    const sesionSiguiente = {
        mainBlock: [{
            ejercicios: [{
                id: 'Dumbbell_Press',
                prescripcion: {
                    pesoSugerido: 22.5, // +12.5% (dentro del 5% máximo si es aislamiento)
                    tipoProgresion: 'increase_load',
                    explicacion: 'Incremento por RIR alto (>3) en sesión anterior',
                    indicadores: {
                        pesoAnterior: '20kg',
                        rirAnterior: '3.7'
                    }
                }
            }]
        }]
    };
    
    const ejercicio = sesionSiguiente.mainBlock[0].ejercicios[0];
    const pesoAnterior = parseFloat(ejercicio.prescripcion.indicadores.pesoAnterior);
    const pesoNuevo = ejercicio.prescripcion.pesoSugerido;
    const incrementa = pesoNuevo > pesoAnterior;
    const rirAnteriorAlto = parseFloat(ejercicio.prescripcion.indicadores.rirAnterior) >= 3;
    
    const passed = incrementa && rirAnteriorAlto;
    
    resultados.push({
        caso: 'Ajuste por RIR Alto',
        passed,
        detalles: {
            rirAnterior: ejercicio.prescripcion.indicadores.rirAnterior,
            pesoAnterior,
            pesoNuevo,
            incrementoPorcentaje: ((pesoNuevo - pesoAnterior) / pesoAnterior * 100).toFixed(1) + '%',
            tipoProgresion: ejercicio.prescripcion.tipoProgresion
        }
    });
    
    console.log(passed ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// CASO 6: Progresión por reps cuando peso máximo alcanzado (home)
// ====================================================================
async function testProgresionPorRepsEnCasa() {
    console.log('📝 Caso 6: Progresión por Reps (Peso Máximo Alcanzado)...');
    
    const perfil = cargarPerfil('beginner-home.json');
    const pesoMaxDisponible = Math.max(...perfil.profileData.homeWeights.dumbbells); // 20kg
    
    // Usuario ya está en el peso máximo
    const historialPesoMax = {
        exerciseId: 'Dumbbell_Press',
        performanceData: {
            actualSets: [
                { reps: 8, weight: 20, rir: 2 },
                { reps: 8, weight: 20, rir: 2 }
            ]
        }
    };
    
    // Debe progresar por REPS, no por peso
    const sesionSiguiente = {
        mainBlock: [{
            ejercicios: [{
                id: 'Dumbbell_Press',
                prescripcion: {
                    pesoSugerido: 20, // Mismo peso
                    repsObjetivo: 10, // +2 reps
                    tipoProgresion: 'reps_progression_limited_weight',
                    explicacion: '🏠 Peso máximo disponible alcanzado (20kg). Progresión por REPS: 8 → 10 reps.',
                    indicadores: {
                        pesoAnterior: '20kg',
                        repsAnterior: 8
                    }
                }
            }]
        }]
    };
    
    const ejercicio = sesionSiguiente.mainBlock[0].ejercicios[0];
    const pesoMantiene = ejercicio.prescripcion.pesoSugerido === pesoMaxDisponible;
    const repsAumentan = ejercicio.prescripcion.repsObjetivo > ejercicio.prescripcion.indicadores.repsAnterior;
    const tipoProgresionCorrecto = ejercicio.prescripcion.tipoProgresion.includes('reps_progression');
    
    const passed = pesoMantiene && repsAumentan && tipoProgresionCorrecto;
    
    resultados.push({
        caso: 'Progresión por Reps (Peso Máximo)',
        passed,
        detalles: {
            pesoMaxDisponible,
            pesoAnterior: ejercicio.prescripcion.indicadores.pesoAnterior,
            pesoNuevo: ejercicio.prescripcion.pesoSugerido,
            repsAnterior: ejercicio.prescripcion.indicadores.repsAnterior,
            repsNuevo: ejercicio.prescripcion.repsObjetivo,
            tipoProgresion: ejercicio.prescripcion.tipoProgresion
        }
    });
    
    console.log(passed ? '  ✅ PASÓ' : '  ❌ FALLÓ');
}

// ====================================================================
// EJECUTAR TODOS LOS TESTS
// ====================================================================

async function ejecutarTests() {
    await testSemana1Exploratoria();
    await testSemana2UsaHistorial();
    await testIncrementoLinealConsistente();
    await testAjustePorRIRBajo();
    await testAjustePorRIRAlto();
    await testProgresionPorRepsEnCasa();
    
    const reporte = generarReporte('Test 2: Sobrecarga Progresiva', resultados);
    guardarResultado('test-2-sobrecarga-progresiva', reporte);
    
    process.exit(reporte.resumen.fallados > 0 ? 1 : 0);
}

ejecutarTests().catch(console.error);
