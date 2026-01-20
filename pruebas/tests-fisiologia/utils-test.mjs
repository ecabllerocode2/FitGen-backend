// ====================================================================
// UTILIDADES PARA TESTS DE FISIOLOGÍA DEL ENTRENAMIENTO
// ====================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====================================================================
// CONSTANTES FISIOLÓGICAS (basadas en literatura científica)
// ====================================================================

export const LIMITES_SEGUROS = {
    // Incremento máximo de carga por sesión (Haff & Triplett, 2016)
    maxIncrementoCompuesto: 0.025,  // 2.5% para ejercicios compuestos
    maxIncrementoAislamiento: 0.05, // 5% para aislamiento
    
    // RPE/RIR seguros por nivel
    rpeMaxPrincipiante: 7,
    rpeMaxIntermedio: 9,
    rpeMaxAvanzado: 10,
    
    // Volumen semanal recomendado (sets por grupo muscular)
    volumenMinimo: 10,
    volumenOptimo: { Principiante: 12, Intermedio: 16, Avanzado: 20 },
    volumenMaximo: 30,
    
    // Descansos entre series según intensidad (Schoenfeld, 2016)
    descansoFuerza: { min: 180, max: 300 },    // 3-5 min
    descansoHipertrofia: { min: 60, max: 120 }, // 1-2 min
    descansoResistencia: { min: 30, max: 60 }   // 30-60s
};

export const RANGOS_REPS = {
    // Rangos óptimos según objetivo (ACSM Guidelines)
    Fuerza_Maxima: { min: 1, max: 6 },
    Hipertrofia: { min: 6, max: 12 },
    Perdida_Grasa: { min: 12, max: 20 },
    Resistencia: { min: 15, max: 25 }
};

export const RPE_PORCENTAJES_1RM = {
    // Tabla RPE a %1RM (Helms et al., 2016)
    10: { reps6: 100, reps8: 92, reps10: 86 },
    9: { reps6: 96, reps8: 89, reps10: 83 },
    8: { reps6: 92, reps8: 86, reps10: 80 },
    7: { reps6: 88, reps8: 83, reps10: 77 },
    6: { reps6: 84, reps8: 80, reps10: 74 }
};

// ====================================================================
// FUNCIONES DE CARGA DE DATOS
// ====================================================================

export function cargarPerfil(nombreArchivo) {
    const rutaPerfil = path.join(__dirname, 'profiles', nombreArchivo);
    const contenido = fs.readFileSync(rutaPerfil, 'utf-8');
    return JSON.parse(contenido);
}

export function cargarMesociclo(nombreArchivo) {
    const rutaMesociclo = path.join(__dirname, 'mesocycles', nombreArchivo);
    const contenido = fs.readFileSync(rutaMesociclo, 'utf-8');
    return JSON.parse(contenido);
}

export function guardarResultado(nombreTest, resultados) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const nombreArchivo = `${nombreTest}_${timestamp}.json`;
    const ruta = path.join(__dirname, 'results', nombreArchivo);
    
    fs.writeFileSync(ruta, JSON.stringify(resultados, null, 2), 'utf-8');
    console.log(`✅ Resultados guardados en: ${nombreArchivo}`);
    
    return nombreArchivo;
}

// ====================================================================
// VALIDADORES FISIOLÓGICOS
// ====================================================================

/**
 * Valida que el RPE esté dentro de los límites seguros según nivel
 */
export function validarRPESeguro(rpe, nivelExperiencia) {
    const limites = {
        'Principiante': LIMITES_SEGUROS.rpeMaxPrincipiante,
        'Intermedio': LIMITES_SEGUROS.rpeMaxIntermedio,
        'Avanzado': LIMITES_SEGUROS.rpeMaxAvanzado
    };
    
    const maxSeguro = limites[nivelExperiencia] || 7;
    
    return {
        valido: rpe <= maxSeguro,
        rpe,
        maxSeguro,
        mensaje: rpe > maxSeguro 
            ? `⚠️ RPE ${rpe} excede límite seguro de ${maxSeguro} para ${nivelExperiencia}`
            : `✅ RPE ${rpe} dentro de límite seguro (≤${maxSeguro})`
    };
}

/**
 * Valida que el incremento de carga sea seguro
 */
export function validarIncrementoCarga(pesoAnterior, pesoNuevo, esCompuesto = true) {
    const maxIncremento = esCompuesto 
        ? LIMITES_SEGUROS.maxIncrementoCompuesto 
        : LIMITES_SEGUROS.maxIncrementoAislamiento;
    
    const incrementoPorcentaje = (pesoNuevo - pesoAnterior) / pesoAnterior;
    
    return {
        valido: incrementoPorcentaje <= maxIncremento,
        incrementoPorcentaje,
        maxIncremento,
        pesoAnterior,
        pesoNuevo,
        mensaje: incrementoPorcentaje > maxIncremento
            ? `⚠️ Incremento ${(incrementoPorcentaje * 100).toFixed(1)}% excede límite seguro de ${(maxIncremento * 100).toFixed(1)}%`
            : `✅ Incremento ${(incrementoPorcentaje * 100).toFixed(1)}% dentro de límite seguro`
    };
}

/**
 * Valida que el rango de reps sea apropiado para el objetivo
 */
export function validarRangoReps(reps, objetivo) {
    const rango = RANGOS_REPS[objetivo] || RANGOS_REPS.Hipertrofia;
    
    return {
        valido: reps >= rango.min && reps <= rango.max,
        reps,
        rangoMinimo: rango.min,
        rangoMaximo: rango.max,
        mensaje: (reps >= rango.min && reps <= rango.max)
            ? `✅ ${reps} reps apropiadas para ${objetivo} (rango: ${rango.min}-${rango.max})`
            : `⚠️ ${reps} reps fuera del rango óptimo para ${objetivo} (${rango.min}-${rango.max})`
    };
}

/**
 * Valida descansos según objetivo
 */
export function validarDescansos(descansoSegundos, objetivo, esEjercicioCompuesto) {
    let rangoEsperado;
    
    if (objetivo === 'Fuerza_Maxima') {
        rangoEsperado = LIMITES_SEGUROS.descansoFuerza;
    } else if (objetivo === 'Hipertrofia') {
        rangoEsperado = LIMITES_SEGUROS.descansoHipertrofia;
    } else {
        rangoEsperado = LIMITES_SEGUROS.descansoResistencia;
    }
    
    // Compuestos necesitan más descanso
    if (esEjercicioCompuesto && objetivo === 'Hipertrofia') {
        rangoEsperado.min = 90;
    }
    
    return {
        valido: descansoSegundos >= rangoEsperado.min && descansoSegundos <= rangoEsperado.max,
        descansoSegundos,
        rangoMinimo: rangoEsperado.min,
        rangoMaximo: rangoEsperado.max,
        mensaje: (descansoSegundos >= rangoEsperado.min && descansoSegundos <= rangoEsperado.max)
            ? `✅ Descanso ${descansoSegundos}s apropiado para ${objetivo}`
            : `⚠️ Descanso ${descansoSegundos}s fuera del rango óptimo (${rangoEsperado.min}-${rangoEsperado.max}s)`
    };
}

/**
 * Calcula el volumen semanal para un grupo muscular
 */
export function calcularVolumenSemanal(sesiones, grupoMuscular) {
    let setsTotal = 0;
    
    for (const sesion of sesiones) {
        if (!sesion.mainBlock) continue;
        
        const bloques = Array.isArray(sesion.mainBlock) 
            ? sesion.mainBlock 
            : (sesion.mainBlock.bloques || sesion.mainBlock.estaciones || []);
        
        for (const bloque of bloques) {
            const ejercicios = bloque.ejercicios || [];
            
            for (const ej of ejercicios) {
                const parteCuerpo = (ej.parteCuerpo || ej.bodyPart || '').toLowerCase();
                
                if (parteCuerpo.includes(grupoMuscular.toLowerCase())) {
                    setsTotal += ej.sets || ej.prescripcion?.series || 3;
                }
            }
        }
    }
    
    return setsTotal;
}

/**
 * Valida que el volumen semanal sea apropiado
 */
export function validarVolumenSemanal(volumen, nivelExperiencia) {
    const volumenOptimo = LIMITES_SEGUROS.volumenOptimo[nivelExperiencia] || 16;
    
    return {
        valido: volumen >= LIMITES_SEGUROS.volumenMinimo && volumen <= LIMITES_SEGUROS.volumenMaximo,
        volumen,
        volumenOptimo,
        volumenMinimo: LIMITES_SEGUROS.volumenMinimo,
        volumenMaximo: LIMITES_SEGUROS.volumenMaximo,
        mensaje: (volumen >= LIMITES_SEGUROS.volumenMinimo && volumen <= LIMITES_SEGUROS.volumenMaximo)
            ? `✅ Volumen ${volumen} sets/semana apropiado (óptimo: ${volumenOptimo})`
            : volumen < LIMITES_SEGUROS.volumenMinimo
                ? `⚠️ Volumen ${volumen} sets/semana insuficiente (mínimo: ${LIMITES_SEGUROS.volumenMinimo})`
                : `⚠️ Volumen ${volumen} sets/semana excesivo (máximo: ${LIMITES_SEGUROS.volumenMaximo})`
    };
}

/**
 * Extrae peso sugerido de una prescripción (maneja strings y números)
 */
export function extraerPeso(pesoSugerido) {
    if (typeof pesoSugerido === 'number') return pesoSugerido;
    if (typeof pesoSugerido === 'string') {
        const match = pesoSugerido.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
    }
    return null;
}

/**
 * Extrae descanso en segundos
 */
export function extraerDescanso(descansoStr) {
    if (typeof descansoStr === 'number') return descansoStr;
    if (typeof descansoStr === 'string') {
        const match = descansoStr.match(/(\d+)/);
        return match ? parseInt(match[1]) : 90;
    }
    return 90;
}

// ====================================================================
// ANALIZADORES DE SESIÓN
// ====================================================================

/**
 * Analiza la estructura completa de una sesión
 */
export function analizarEstructuraSesion(sesion) {
    const analisis = {
        tieneWarmup: !!sesion.warmup,
        tieneMainBlock: !!sesion.mainBlock,
        tieneCoreBlock: !!sesion.coreBlock,
        tieneCooldown: !!sesion.cooldown,
        ejerciciosTotales: 0,
        seriesTotales: 0,
        duracionEstimada: 0,
        ejerciciosPorPrioridad: { 1: 0, 2: 0, 3: 0 }
    };
    
    // Analizar bloque principal
    if (sesion.mainBlock) {
        const bloques = Array.isArray(sesion.mainBlock)
            ? sesion.mainBlock
            : (sesion.mainBlock.bloques || sesion.mainBlock.estaciones || []);
        
        for (const bloque of bloques) {
            const ejercicios = bloque.ejercicios || [];
            analisis.ejerciciosTotales += ejercicios.length;
            
            for (const ej of ejercicios) {
                const sets = ej.sets || ej.prescripcion?.series || 3;
                analisis.seriesTotales += sets;
                
                const prioridad = ej.prioridad || 2;
                analisis.ejerciciosPorPrioridad[prioridad] = (analisis.ejerciciosPorPrioridad[prioridad] || 0) + 1;
            }
        }
    }
    
    // Analizar core
    if (sesion.coreBlock) {
        const ejerciciosCore = sesion.coreBlock.ejercicios || [];
        analisis.ejerciciosTotales += ejerciciosCore.length;
        
        for (const ej of ejerciciosCore) {
            const sets = ej.sets || ej.prescripcion?.series || 2;
            const rondas = sesion.coreBlock.rondas || 1;
            analisis.seriesTotales += sets * rondas;
        }
    }
    
    analisis.duracionEstimada = sesion.summary?.duracionMinutos || 0;
    
    return analisis;
}

/**
 * Compara dos sesiones para validar consistencia
 */
export function compararSesiones(sesion1, sesion2) {
    const ejercicios1 = extraerEjerciciosMainBlock(sesion1);
    const ejercicios2 = extraerEjerciciosMainBlock(sesion2);
    
    const ids1 = ejercicios1.map(e => e.id);
    const ids2 = ejercicios2.map(e => e.id);
    
    const iguales = ids1.length === ids2.length && ids1.every((id, i) => id === ids2[i]);
    
    return {
        sonIguales: iguales,
        ejerciciosSesion1: ids1.length,
        ejerciciosSesion2: ids2.length,
        ejerciciosIguales: ids1.filter(id => ids2.includes(id)).length,
        ordenIgual: iguales
    };
}

function extraerEjerciciosMainBlock(sesion) {
    if (!sesion.mainBlock) return [];
    
    const bloques = Array.isArray(sesion.mainBlock)
        ? sesion.mainBlock
        : (sesion.mainBlock.bloques || sesion.mainBlock.estaciones || []);
    
    const ejercicios = [];
    for (const bloque of bloques) {
        ejercicios.push(...(bloque.ejercicios || []));
    }
    
    return ejercicios;
}

// ====================================================================
// REPORTES
// ====================================================================

export function generarReporte(nombreTest, resultados) {
    const timestamp = new Date().toISOString();
    
    let totalTests = 0;
    let testsPasados = 0;
    let testsFallados = 0;
    let advertencias = [];
    
    for (const resultado of resultados) {
        totalTests++;
        if (resultado.passed) {
            testsPasados++;
        } else {
            testsFallados++;
        }
        
        if (resultado.warnings && resultado.warnings.length > 0) {
            advertencias.push(...resultado.warnings);
        }
    }
    
    const reporte = {
        test: nombreTest,
        timestamp,
        resumen: {
            total: totalTests,
            pasados: testsPasados,
            fallados: testsFallados,
            porcentajeExito: ((testsPasados / totalTests) * 100).toFixed(1) + '%'
        },
        advertencias: advertencias.length,
        resultados
    };
    
    console.log('\n' + '='.repeat(70));
    console.log(`📊 REPORTE: ${nombreTest}`);
    console.log('='.repeat(70));
    console.log(`✅ Pasados: ${testsPasados}/${totalTests} (${reporte.resumen.porcentajeExito})`);
    console.log(`❌ Fallados: ${testsFallados}/${totalTests}`);
    console.log(`⚠️  Advertencias: ${advertencias.length}`);
    console.log('='.repeat(70) + '\n');
    
    return reporte;
}

export default {
    cargarPerfil,
    cargarMesociclo,
    guardarResultado,
    validarRPESeguro,
    validarIncrementoCarga,
    validarRangoReps,
    validarDescansos,
    calcularVolumenSemanal,
    validarVolumenSemanal,
    extraerPeso,
    extraerDescanso,
    analizarEstructuraSesion,
    compararSesiones,
    generarReporte,
    LIMITES_SEGUROS,
    RANGOS_REPS
};
