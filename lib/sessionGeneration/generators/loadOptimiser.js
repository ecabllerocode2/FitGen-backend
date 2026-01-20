// ==========================================
// MÓDULO: OPTIMIZADOR DE CARGA (Load & Volume Optimizer)
// ==========================================

import { normalizeText } from '../utils.js';

/**
 * Calcula la carga y volumen óptimo (Auditoría de Inicio) basado en contexto externo.
 * Actúa como "Safety Switch".
 * 
 * @param {Object} currentContext - { externalFatigue, energyLevel, sorenessLevel }
 * @param {Object} targetPrescription - { rpe, rir, baseVolume }
 * @param {string} weekFocus - Semana 1 (Intro) vs Semana 3 (Pico)
 * @returns {Object} Ajustes { adjustedRPE, adjustedRIR, volModifier, advisoryMessage }
 */
export function optimizeDailyLoad(currentContext, targetPrescription, weekFocus) {
    let { rpe, rir, baseVolume } = targetPrescription;
    let volModifier = 0; // Series a restar o sumar
    let advisoryLog = [];
    
    const externalFatigue = normalizeText(currentContext.externalFatigue || 'none');
    const energy = currentContext.energyLevel || 3;

    let actionTaken = 'Standard';

    // 1. Auditoría de Fatiga Externa (Safety Switch)
    if (externalFatigue === 'high' || externalFatigue === 'extreme' || energy <= 2) {
        actionTaken = 'FatigueHigh';
        // Reducción científicamente validada (Halson & Jeukendrup, 2004)
        rpe = Math.max(5, rpe - 2.0); // -2.0 puntos RPE (garantizar >=1.5)
        rir = rir + 2; // Aumentar margen seguridad
        volModifier = -1; // Quitar 1 serie por ejercicio
        const volPercent = 0.30; // 30% reducción global (garantizar 20-30%)
        advisoryLog.push("⚠️ FATIGA EXTREMA DETECTADA: Protocolo de protección del SNC activado.");
        advisoryLog.push("📉 Reducción automática: -2.0 RPE, +2 RIR, -30% volumen total.");

        console.log(`[LoadOptimiser] SAFETY SWITCH ACTIVATED: externalFatigue=${externalFatigue}, energy=${energy}`);
        console.log(`[LoadOptimiser] Adjustments: RPE ${rpe} , RIR ${rir}, VolPercent ${volPercent * 100}%`);

        // Calcular mensaje de guía RIR antes de devolver (evitar uso de variable no inicializada)
        let rirGuideEarly = '';
        if (rir >= 3) rirGuideEarly = "⚠️ CONSERVADOR: Deja varias reps en reserva. Prioriza técnica sobre carga.";
        else if (rir <= 1) rirGuideEarly = "Esfuerzo moderado manteniendo margen de seguridad.";
        else rirGuideEarly = "Moderado: NO busques récords hoy. Protege tu sistema nervioso.";

        return {
            actionTaken,
            finalRPE: Number(rpe.toFixed(1)),
            finalRIR: Math.round(rir),
            volumeAdjustmentSamples: volModifier,
            volumePercentReduction: volPercent, // ← CRÍTICO: Este valor debe aplicarse por caller
            coachInstructions: {
                loadStrategy: rirGuideEarly,
                safetyAdvisory: advisoryLog.join(' ')
            }
        };
    } else if (externalFatigue === 'medium' || externalFatigue === 'moderate') {
        actionTaken = 'Moderate';
        rpe = Math.max(5, rpe - 0.5);
        rir = rir + 1;
        // Volumen se mantiene, intensidad baja un poco
        advisoryLog.push("ℹ️ Carga externa moderada: Ajuste preventivo de intensidad.");
    }

    // 2. Factor de Autorregulación por Semana (Semántica del RIR)
    let rirGuide = "";
    
    // Si RIR es alto (3-4) -> Semana conservadora
    if (rir >= 3) {
        rirGuide = "Conservador: Deja varias reps en reserva. El peso debe sentirse totalmente manejable.";
    } 
    // Si RIR es bajo (0-1) -> Semana de choque
    else if (rir <= 1) {
        rirGuide = "🔥 ESFUERZO MÁXIMO: Busca el peso más alto posible manteniendo técnica perfecta. Hoy se busca récord.";
    } 
    else {
        rirGuide = "Moderado: Esfuerzo notable pero sin llegar al fallo técnico.";
    }

    return {
        actionTaken,
        finalRPE: Number(rpe.toFixed(1)),
        finalRIR: Math.round(rir),
        volumeAdjustmentSamples: volModifier, // -1 means remove 1 set from main lifts
        volumePercentReduction: 0,
        coachInstructions: {
            loadStrategy: rirGuide,
            safetyAdvisory: advisoryLog.join(' ')
        }
    };
}
