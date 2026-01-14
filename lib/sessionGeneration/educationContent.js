// ====================================================================
// EDUCATION CONTENT MODULE
// Generador de contenido educativo y narrativo para el usuario
// Explica la ciencia detrás de cada decisión del entrenamiento
// ====================================================================

import { normalizeText } from './utils.js';

/**
 * Genera contenido educativo y explicaciones para la sesión
 * @param {Object} sesion - Sesión generada
 * @param {Object} ajustes - Ajustes de readiness aplicados
 * @param {Object} bloquePrincipal - Bloque principal de ejercicios
 * @param {string} ubicacion - 'gym' o 'home'
 * @param {Object} microciclo - Contexto del microciclo
 * @param {string} nivel - Nivel del usuario
 * @returns {Object} Contenido educativo estructurado
 */
export function generarNarrativaDidactica(sesion, ajustes, bloquePrincipal, ubicacion, microciclo, nivel) {
    const contenido = {
        resumenFisiologico: '',
        objetivoDelDia: '',
        fasesExplicadas: [],
        consejoTecnico: '',
        cienciaDestacada: '',
        motivacion: '',
        proximoEntrenamiento: ''
    };

    // ====================================================================
    // 1. RESUMEN FISIOLÓGICO DEL DÍA
    // ====================================================================
    contenido.resumenFisiologico = generarResumenFisiologico(sesion, microciclo);

    // ====================================================================
    // 2. OBJETIVO ESPECÍFICO DEL DÍA
    // ====================================================================
    contenido.objetivoDelDia = generarObjetivoDelDia(sesion, microciclo, ajustes);

    // ====================================================================
    // 3. EXPLICACIÓN DE LA AUTOREGULACIÓN
    // ====================================================================
    contenido.consejoTecnico = generarConsejoAutoregulacion(ajustes);

    // ====================================================================
    // 4. DESGLOSE DIDÁCTICO POR FASE
    // ====================================================================
    contenido.fasesExplicadas = generarExplicacionesFases(sesion, ubicacion, microciclo);

    // ====================================================================
    // 5. CIENCIA DESTACADA DEL DÍA
    // ====================================================================
    contenido.cienciaDestacada = generarDatosCientificos(microciclo, nivel);

    // ====================================================================
    // 6. MENSAJE MOTIVACIONAL
    // ====================================================================
    contenido.motivacion = generarMensajeMotivacional(ajustes, microciclo);

    // ====================================================================
    // 7. PREPARACIÓN PARA PRÓXIMO ENTRENAMIENTO
    // ====================================================================
    contenido.proximoEntrenamiento = generarConsejosRecuperacion(sesion, microciclo);

    return contenido;
}

/**
 * Genera el resumen fisiológico principal
 */
function generarResumenFisiologico(sesion, microciclo) {
    const focusNorm = normalizeText(sesion.sessionFocus || '');
    const faseNorm = normalizeText(microciclo.focus || '');
    
    let resumen = `📊 **Hoy tu sesión se enfoca en ${sesion.sessionFocus}**. `;
    
    // Explicar la fase del mesociclo
    if (faseNorm.includes('adaptacion') || faseNorm.includes('introductoria')) {
        resumen += 'Estamos en **fase de Adaptación Anatómica**: el objetivo principal es fortalecer ' +
                  'tendones, ligamentos y tejido conectivo mientras perfeccionas los patrones motores. ' +
                  'Las cargas son moderadas para permitir este proceso de acondicionamiento estructural.';
    } else if (faseNorm.includes('acumulacion') || faseNorm.includes('volumen')) {
        resumen += 'Estamos en **fase de Acumulación de Volumen**: el estímulo principal viene del ' +
                  'volumen total de trabajo (series × reps × peso). Tu cuerpo está construyendo las ' +
                  'bases de fuerza y masa muscular que explotaremos en semanas posteriores.';
    } else if (faseNorm.includes('intensificacion') || faseNorm.includes('sobrecarga') || faseNorm.includes('pico')) {
        resumen += 'Estamos en **fase de Intensificación**: esta es la semana de máximo esfuerzo ' +
                  'del ciclo. Las cargas son las más altas y trabajamos cerca del fallo técnico. ' +
                  'Tu Sistema Nervioso Central está al máximo - espera sentirte desafiado.';
    } else if (faseNorm.includes('descarga') || faseNorm.includes('deload')) {
        resumen += 'Estamos en **semana de Descarga (Deload)**: reducimos intencionalmente el volumen ' +
                  'y la intensidad para permitir la supercompensación. Tu cuerpo se adapta y se fortalece ' +
                  'durante el descanso, no durante el entrenamiento.';
    }
    
    return resumen;
}

/**
 * Genera el objetivo específico del día
 */
function generarObjetivoDelDia(sesion, microciclo, ajustes) {
    const rpeObjetivo = parseRPE(microciclo.intensityRpe) || 7;
    const rirObjetivo = microciclo.targetRIR ?? 2;
    
    let objetivo = `🎯 **Tu objetivo de hoy**: Terminar cada serie sintiendo que podrías hacer ` +
                  `aproximadamente **${rirObjetivo} repeticiones más** (RIR ${rirObjetivo}). ` +
                  `Esto corresponde a un esfuerzo percibido de **RPE ${rpeObjetivo}/10**.`;
    
    // Añadir contexto de ajustes
    if (ajustes.factorVolumen < 0.8) {
        objetivo += '\n\n⚡ **Ajuste de hoy**: El volumen está reducido para respetar tu estado actual. ' +
                   'Esto no es retroceder - es entrenar inteligentemente.';
    }
    
    if (ajustes.tipoSesionModificada) {
        objetivo += `\n\n🔄 **Modo especial**: La sesión ha sido modificada a "${ajustes.tipoSesionModificada}" ` +
                   'basándose en tu feedback de readiness.';
    }
    
    return objetivo;
}

/**
 * Genera consejos basados en autoregulación
 */
function generarConsejoAutoregulacion(ajustes) {
    if (!ajustes || ajustes.advertencias.length === 0) {
        return '✅ Tu estado de readiness es óptimo. Entrena con confianza siguiendo la prescripción.';
    }
    
    let consejo = '**💡 Ajustes inteligentes de hoy:**\n\n';
    
    // Explicar cada ajuste
    if (ajustes.factorVolumen < 1.0) {
        consejo += '• **Volumen reducido**: La investigación de Zourdos et al. (2016) muestra que es mejor ' +
                  'reducir series que reducir peso cuando hay fatiga. Así mantienes las adaptaciones neurales ' +
                  'de fuerza mientras permites la recuperación.\n\n';
    }
    
    if (ajustes.deltaRIR > 0) {
        consejo += '• **RIR aumentado**: Trabajarás más lejos del fallo hoy. Esto reduce el daño muscular ' +
                  'permitiendo recuperación más rápida sin sacrificar significativamente las ganancias.\n\n';
    }
    
    if (ajustes.tipoSesionModificada === 'Hipertrofia_Metabolica') {
        consejo += '• **Modo Metabólico**: En lugar de tensión mecánica (peso pesado), hoy usamos estrés ' +
                  'metabólico. El "pump" aumenta el flujo sanguíneo y estimula crecimiento sin estresar ' +
                  'tejidos ya fatigados.\n\n';
    }
    
    if (ajustes.tempoRecomendado) {
        consejo += `• **Tempo especial (${ajustes.tempoRecomendado})**: El tiempo bajo tensión extendido ` +
                  'compensa cargas más bajas y mejora la conexión mente-músculo.\n\n';
    }
    
    return consejo;
}

/**
 * Genera explicaciones de cada fase de la sesión
 */
function generarExplicacionesFases(sesion, ubicacion, microciclo) {
    const fases = [];
    
    // RAMP (Calentamiento)
    fases.push({
        fase: 'Calentamiento RAMP',
        icono: '🔥',
        explicacion: 'El protocolo RAMP no es solo "estirar". Sus fases (Raise-Activate-Mobilize-Potentiate) ' +
                    'elevan tu temperatura, activan músculos débiles, mejoran el rango de movimiento y ' +
                    '"despiertan" tu Sistema Nervioso Central para maximizar el rendimiento en los ejercicios pesados.',
        ciencia: 'La investigación muestra que un calentamiento específico aumenta la potencia en ~10% ' +
                'y reduce significativamente el riesgo de lesión.'
    });
    
    // Bloque Principal
    fases.push({
        fase: 'Bloque Principal',
        icono: '💪',
        explicacion: 'Los ejercicios están ordenados por demanda neurológica: empezamos con movimientos ' +
                    'multiarticulares (sentadillas, press, remos) cuando tu SNC está fresco. Esto maximiza ' +
                    'la liberación hormonal (testosterona, hormona del crecimiento) y el reclutamiento de ' +
                    'fibras musculares tipo II.',
        ciencia: 'El principio de "ejercicios pesados primero" está respaldado por décadas de investigación ' +
                'en fisiología del ejercicio (Kraemer & Ratamess, 2004).'
    });
    
    // Contexto específico de ubicación
    if (ubicacion === 'home') {
        fases.push({
            fase: 'Entrenamiento en Casa',
            icono: '🏠',
            explicacion: 'Al no tener acceso a cargas pesadas, aplicamos "Manipulación de Variables Temporales". ' +
                        'Los tempos lentos y técnicas como Rest-Pause generan el mismo estrés metabólico necesario ' +
                        'para el crecimiento muscular, compensando la falta de peso.',
            ciencia: 'Estudios de Schoenfeld (2010) demuestran que el estrés metabólico es uno de los tres ' +
                    'mecanismos principales de hipertrofia, junto con tensión mecánica y daño muscular.'
        });
    }
    
    // Core (si aplica)
    if (sesion.includeCore) {
        fases.push({
            fase: 'Entrenamiento de Core',
            icono: '🧱',
            explicacion: 'El core no es solo "abdominales". Trabajamos la capacidad de ANTI-movimiento ' +
                        '(anti-extensión, anti-rotación, anti-flexión lateral). Esto protege tu columna ' +
                        'y transfiere fuerza eficientemente en los levantamientos principales.',
            ciencia: 'Stuart McGill, experto mundial en biomecánica espinal, enfatiza que el core debe ' +
                    'resistir movimiento, no crearlo, para máxima protección vertebral.'
        });
    }
    
    return fases;
}

/**
 * Genera datos científicos destacados del día
 */
function generarDatosCientificos(microciclo, nivel) {
    const datosCientificos = [
        {
            titulo: 'Sobrecarga Progresiva',
            dato: 'Tu cuerpo se adapta al estrés que le impones. Para seguir creciendo, debes aumentar ' +
                 'gradualmente la demanda. Esto puede ser más peso, más reps, mejor tempo, o menos descanso.',
            fuente: 'Principio fundamental de Selye (1956)'
        },
        {
            titulo: 'Relación Dosis-Respuesta',
            dato: 'El volumen óptimo para hipertrofia es 10-20 series semanales por grupo muscular. ' +
                 'Más no siempre es mejor - hay un punto de rendimientos decrecientes.',
            fuente: 'Meta-análisis de Schoenfeld et al. (2017)'
        },
        {
            titulo: 'Especificidad del Entrenamiento',
            dato: 'Tu cuerpo se adapta específicamente al tipo de estímulo que recibe. Para fuerza máxima: ' +
                 'cargas altas (>85% 1RM). Para hipertrofia: volumen moderado-alto con cargas medias (65-85% 1RM).',
            fuente: 'Principio SAID (Specific Adaptation to Imposed Demands)'
        },
        {
            titulo: 'Supercompensación',
            dato: 'Después del entrenamiento, tu rendimiento primero CAE (fatiga), luego SUBE por encima ' +
                 'del nivel inicial (supercompensación). Entrenar en el momento correcto captura estas ganancias.',
            fuente: 'Modelo de Aptitud-Fatiga de Banister'
        },
        {
            titulo: 'RIR vs RPE',
            dato: 'RIR (Reps in Reserve) es cuántas reps podrías hacer antes del fallo. RPE (Rating of ' +
                 'Perceived Exertion) es tu esfuerzo percibido. RPE = 10 - RIR. Ambos son herramientas de autoregulación.',
            fuente: 'Zourdos et al. (2016)'
        },
        {
            titulo: 'Tiempo Bajo Tensión (TUT)',
            dato: 'El músculo no sabe cuánto peso hay en la barra - solo conoce la tensión. Un tempo lento ' +
                 'con menos peso puede generar tanto estímulo como peso pesado con tempo rápido.',
            fuente: 'Investigación de Burd et al. (2012)'
        }
    ];
    
    // Seleccionar dato aleatorio
    const dato = datosCientificos[Math.floor(Math.random() * datosCientificos.length)];
    
    return {
        titulo: `📚 Ciencia del día: ${dato.titulo}`,
        contenido: dato.dato,
        fuente: dato.fuente
    };
}

/**
 * Genera mensaje motivacional contextual
 */
function generarMensajeMotivacional(ajustes, microciclo) {
    const faseNorm = normalizeText(microciclo.focus || '');
    
    // Mensajes según contexto
    if (ajustes.factorVolumen < 0.7) {
        return '💪 **Recuerda**: Los días difíciles no definen tu progreso - cómo los manejas, sí. ' +
               'Entrenar inteligentemente hoy te prepara para brillar mañana.';
    }
    
    if (faseNorm.includes('descarga')) {
        return '🌊 **El descanso es entrenamiento**: Los músculos crecen cuando descansas, no cuando entrenas. ' +
               'Esta semana ligera es donde la magia de la supercompensación ocurre.';
    }
    
    if (faseNorm.includes('pico') || faseNorm.includes('intensificacion')) {
        return '🔥 **Esta es TU semana**: Has construido las bases. Has acumulado trabajo. ' +
               'Ahora es momento de demostrar de qué estás hecho. Confía en tu preparación.';
    }
    
    if (ajustes.readinessCategoria === 'optimal') {
        return '⚡ **Estado óptimo detectado**: Tu cuerpo está listo para rendir al máximo. ' +
               'Aprovecha este día - no todos vienen así. ¡A por todas!';
    }
    
    // Mensaje genérico
    const mensajes = [
        '🎯 La consistencia vence al talento cuando el talento no es consistente.',
        '💪 Cada repetición te acerca a la versión más fuerte de ti mismo.',
        '🧠 El entrenamiento inteligente supera al entrenamiento duro. Estás haciendo ambos.',
        '📈 El progreso no es lineal, pero la dirección importa más que la velocidad.',
        '🏆 No entrenas para el día de hoy - entrenas para quién serás en 6 meses.'
    ];
    
    return mensajes[Math.floor(Math.random() * mensajes.length)];
}

/**
 * Genera consejos de recuperación para el próximo entrenamiento
 */
function generarConsejosRecuperacion(sesion, microciclo) {
    const consejos = [];
    
    // Hidratación
    consejos.push({
        icono: '💧',
        consejo: 'Rehidratación',
        detalle: 'Bebe 500ml de agua en la próxima hora. La hidratación es crítica para la síntesis proteica.'
    });
    
    // Nutrición
    consejos.push({
        icono: '🍗',
        consejo: 'Ventana anabólica',
        detalle: 'Consume proteína (20-40g) en las próximas 2 horas. La síntesis proteica muscular está elevada post-entrenamiento.'
    });
    
    // Sueño
    consejos.push({
        icono: '😴',
        consejo: 'Sueño reparador',
        detalle: 'Apunta a 7-9 horas de sueño. El 95% de la hormona del crecimiento se libera durante el sueño profundo.'
    });
    
    // Movilidad
    consejos.push({
        icono: '🧘',
        consejo: 'Recuperación activa',
        detalle: 'Si sientes rigidez mañana, 10 minutos de movilidad ligera aceleran la recuperación más que el descanso total.'
    });
    
    return {
        titulo: '🔄 Preparación para tu próximo entrenamiento',
        consejos
    };
}

/**
 * Genera el "Tip del Día" basado en las notas del microciclo
 */
export function generarTipDelDia(notasMicrociclo, nivel) {
    if (notasMicrociclo) {
        return `💡 **Tip del día**: ${notasMicrociclo}`;
    }
    
    // Tips genéricos por nivel
    const tipsPorNivel = {
        Principiante: [
            'Enfócate en la técnica antes que en el peso. Los kilos vendrán, la técnica hay que construirla.',
            'Si dudas entre dos pesos, elige el más ligero. Siempre puedes subir en la siguiente serie.',
            'Graba tus ejercicios principales para revisar tu técnica después.'
        ],
        Intermedio: [
            'Experimenta con diferentes rangos de repeticiones. Tu cuerpo se adapta a la variación.',
            'El progreso no siempre se mide en kilos. Mejor control, mejor tempo, menos descanso - todo cuenta.',
            'Considera un diario de entrenamiento. Los patrones que no ves, los datos sí revelan.'
        ],
        Avanzado: [
            'La autoregulación es tu mejor herramienta. Confía en tu percepción del esfuerzo.',
            'Las técnicas de intensidad son especias, no el plato principal. Úsalas estratégicamente.',
            'A veces el mejor entrenamiento es el que NO haces. Escucha a tu cuerpo.'
        ]
    };
    
    const tips = tipsPorNivel[nivel] || tipsPorNivel.Intermedio;
    return `💡 **Tip del día**: ${tips[Math.floor(Math.random() * tips.length)]}`;
}

/**
 * Parsea RPE desde string
 */
function parseRPE(rpeString) {
    if (typeof rpeString === 'number') return rpeString;
    if (!rpeString) return null;
    const match = String(rpeString).match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
}

export default {
    generarNarrativaDidactica,
    generarTipDelDia
};
