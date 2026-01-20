// ==========================================
// CLASE: DEFINICIÓN DE CONSTANTES Y ENUMS
// ==========================================

export const Goal = {
    HYPERTROPHY: 'Hipertrofia',
    STRENGTH: 'Fuerza_Maxima',
    ENDURANCE: 'Resistencia',
    FAT_LOSS: 'Perdida_Grasa',
    GENERAL_HEALTH: 'Salud_General',
    ATHLETIC_PERFORMANCE: 'Rendimiento_Deportivo'
};

export const Experience = {
    BEGINNER: 'Principiante',
    INTERMEDIATE: 'Intermedio',
    ADVANCED: 'Avanzado'
};

export const Focus = {
    GENERAL: 'General',
    UPPER: 'Torso',
    LOWER: 'Pierna',
    CORE: 'Core',
    PUSH: 'Empuje',
    PULL: 'Tracción',
    FULL: 'Full Body'
};

export const Load = {
    NONE: 'none',
    LIGHT: 'low',
    MODERATE: 'medium',
    HIGH: 'high',
    EXTREME: 'extreme' // Added from existing system
};

export const LegacyLoad = {
    // Mapping existing system values to keys if needed
    'none': 0,
    'low': 1,
    'medium': 2,
    'high': 3,
    'extreme': 4
};

export const SplitType = {
    FULL_BODY: 'Full Body',
    UPPER_LOWER: 'Torso/Pierna',
    UPPER_LOWER_FULL: 'Torso/Pierna/Full',
    PPL: 'Push/Pull/Legs',
    HYBRID_PHUL: 'Híbrido (PHUL)',
    BODY_PART: 'Body Part (Bro Split)',
    TORSO_LIMBS: 'Torso/Extremidades',
    PPL_ACTIVE_REST: 'PPL + Descanso Activo'
};

export const DAYS_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const OBJECTIVE_MAPPING = {
    'Ganancia_Muscular': Goal.HYPERTROPHY,
    'Perdida_Grasa': Goal.FAT_LOSS,
    'Fuerza': Goal.STRENGTH,
    'Salud': Goal.GENERAL_HEALTH,
    'Rendimiento_Deportivo': Goal.ATHLETIC_PERFORMANCE
};

export const LEVEL_MAPPING = {
    // Spanish canonical forms
    'principiante': Experience.BEGINNER,
    'intermedio': Experience.INTERMEDIATE,
    'avanzado': Experience.ADVANCED,
    // Capitalized variants (legacy)
    'Principiante': Experience.BEGINNER,
    'Intermedio': Experience.INTERMEDIATE,
    'Avanzado': Experience.ADVANCED,
    // Alias to handle english and other variants
    'beginner': Experience.BEGINNER,
    'novice': Experience.BEGINNER,
    'intermediate': Experience.INTERMEDIATE,
    'advanced': Experience.ADVANCED
};
