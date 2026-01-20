import { Experience, Goal, Focus } from './constants.js';

/**
 * Genera la definición de contenido para una sesión (Músculos, Core, Cardio).
 * @param {Object} session - Objeto de sesión básico
 * @param {string} sessionFocusName - Nombre del foco (ej: "Torso (Fuerza)")
 * @param {string} userGoal 
 * @param {string} userExperience 
 * @returns {Object} Datos enriquecidos { muscles: [], core: {}, cardio: {} }
 */
export function generateSessionContent(sessionFocusName, userGoal, userExperience, userDeclaredFocus = null) {
    const focusLower = (sessionFocusName || '').toLowerCase();
    const userFocusLower = (userDeclaredFocus || '').toLowerCase();

    // Determinar si la sesión coincide con el foco declarado por el usuario
    const focusMatchKeywords = ['upper','torso','empuje','tracción','push','pull','pecho','hombro','espalda','tren_superior','tren superior'];
    const userFocusKeywords = [userFocusLower];

    const isUserFocusSession = (userDeclaredFocus && (focusMatchKeywords.some(k => focusLower.includes(k)) && userFocusLower.length > 0)) || false;    
    
    let muscleGroups = [];
    let patternFocus = 'General';
    let coreWork = { included: false, timing: 'End', focus: 'Stability' };
    let cardioWork = { included: false, type: 'None', duration: 0 };

    // A. Definición de Grupos Musculares por Tipo de Sesión
    // Mapeo básico basado en el nombre
    if (focusLower.includes('torso') || focusLower.includes('upper') || focusLower.includes('empuje') || focusLower.includes('tracción') || focusLower.includes('push') || focusLower.includes('pull')) {
        if (focusLower.includes('empuje') || focusLower.includes('push')) {
            muscleGroups = ['Chest', 'Front Delts', 'Side Delts', 'Triceps'];
            patternFocus = 'Push';
        } else if (focusLower.includes('tracción') || focusLower.includes('pull') || focusLower.includes('back')) {
            muscleGroups = ['Lats', 'Rhomboids', 'Rear Delts', 'Biceps'];
            patternFocus = 'Pull';
        } else {
            // Torso completo
            muscleGroups = ['Chest', 'Back', 'Shoulders', 'Arms'];
            patternFocus = 'Upper Body';
        }
    } else if (focusLower.includes('pierna') || focusLower.includes('legs') || focusLower.includes('lower')) {
        muscleGroups = ['Quads', 'Hamstrings', 'Glutes', 'Calves'];
        patternFocus = 'Lower Body';
    } else if (focusLower.includes('full body') || focusLower.includes('full')) {
        muscleGroups = ['Quads', 'Hams', 'Chest', 'Back', 'Shoulders'];
        patternFocus = 'Full Body';
    } else if (focusLower.includes('pecho') && focusLower.includes('triceps')) {
         muscleGroups = ['Chest', 'Triceps', 'Front Delts'];
         patternFocus = 'Isolation';
    }
    // ... más casos pueden agregarse

    // B. Ajuste por ÁREA DE ENFOQUE (Priorización implícita en mesociclo plan)
    // (Simplificado para este módulo, el generador de sesiones hará la selección final de ejercicios)

    // C. Lógica de CORE
    // Nunca entrenar Core intenso antes de Sentadilla o Peso Muerto
    const isHeavyAxial = focusLower.includes('fuerza') && (focusLower.includes('pierna') || focusLower.includes('full body'));
    const isLegs = focusLower.includes('pierna') || focusLower.includes('legs');

    if (isHeavyAxial) {
        coreWork.included = true;
        coreWork.timing = 'End'; // Al final solamente
        coreWork.focus = 'Anti-Movement'; // Estabilidad
    } else {
         // En días de Torso o brazos, se puede hacer más trabajo de core
         coreWork.included = true;
         coreWork.timing = 'End';
         coreWork.focus = 'Dynamic'; 
    }
    
    // Si la sesión es explícitamente de Core/Cardio
    if (focusLower.includes('core') || focusLower.includes('abs')) {
        coreWork.included = true;
        coreWork.timing = 'Main';
        coreWork.focus = 'Comprehensive';
    }

    // D. Cardio Check
    if (userGoal === Goal.FAT_LOSS || userGoal === Goal.GENERAL_HEALTH) {
        // Cardio LISS después de pesas en días de pierna para no interferir, o días de upper
        cardioWork.included = true;
        cardioWork.type = isLegs ? 'LISS' : 'HIIT_Optional';
        cardioWork.duration = isLegs ? 20 : 15;
    }

    // E. Safe Specialization metadata (para salvaguardas según nivel de experiencia)
    // Se utiliza en el Main Block Builder para limitar volumen extra y forzar prioridad segura
    const safeSpecialization = {
        userDeclaredFocus: userDeclaredFocus || null,
        isUserFocusSession: isUserFocusSession
    };

    if (userExperience === Experience.BEGINNER) {
        safeSpecialization.level = 'Principiante';
        safeSpecialization.capExtraVolumePct = 0.10; // Máximo 10% incremento por foco
        safeSpecialization.enforcePriorityStart = true; // Colocar ejercicios de foco al inicio
        safeSpecialization.allowedExtraIsolations = 0; // No añadir isolations adicionales por foco
    } else if (userExperience === Experience.INTERMEDIATE) {
        safeSpecialization.level = 'Intermedio';
        safeSpecialization.capExtraVolumePct = 0.20; // Hasta 20% incremento condicional
        safeSpecialization.enforcePriorityStart = true;
        safeSpecialization.allowedExtraIsolations = 2; // Permitir 1-2 isolations extra si condiciones ok
        safeSpecialization.require48hRestForFocus = true;
    } else {
        safeSpecialization.level = 'Avanzado';
        safeSpecialization.allowIntensityTechniques = true; // Dropsets/rest-pause permitidos en foco
        safeSpecialization.enforcePriorityStart = false;
        safeSpecialization.allowedExtraIsolations = 3; // Más libertad
    }

    return {
        muscleGroups,
        patternFocus,
        core: coreWork,
        cardio: cardioWork,
        // Metadatos para las capas superiores
        safeSpecialization
    };
}
