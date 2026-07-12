/**
 * FitGen domain constants — DDS sections 5, 8.
 * Gym-only, Hipertrofia + Fuerza goals.
 */

export const GOALS = {
  HIPERTROFIA: 'Hipertrofia',
  FUERZA: 'Fuerza',
};

export const EXPERIENCE_LEVELS = {
  NOVATO: 'Novato',
  INTERMEDIO: 'Intermedio',
  AVANZADO: 'Avanzado',
};

/** DDS 8.1 / 2.4 */
export const MESOCYCLE_DURATION = {
  Novato: 6,
  Intermedio: 5,
  Avanzado: 4,
};

/** DDS 8.2 — scale MEV/MRV by experience */
export const EXPERIENCE_VOLUME_FACTOR = {
  Novato: 0.8,
  Intermedio: 1.0,
  Avanzado: 1.15,
};

/** DDS 5.2 — volume landmarks (direct sets per week) */
export const VOLUME_LANDMARKS = {
  Pecho: { MV: 4, MEV: 8, MAV: [12, 18], MRV: 22 },
  Espalda: { MV: 6, MEV: 10, MAV: [14, 22], MRV: 25 },
  Hombro: { MV: 4, MEV: 8, MAV: [12, 20], MRV: 26 },
  Bíceps: { MV: 4, MEV: 8, MAV: [10, 16], MRV: 20 },
  Tríceps: { MV: 4, MEV: 6, MAV: [10, 14], MRV: 18 },
  Cuádriceps: { MV: 4, MEV: 8, MAV: [12, 18], MRV: 20 },
  Isquiotibiales: { MV: 3, MEV: 6, MAV: [8, 12], MRV: 16 },
  Glúteos: { MV: 3, MEV: 6, MAV: [10, 16], MRV: 20 },
  Pantorrillas: { MV: 4, MEV: 6, MAV: [12, 16], MRV: 20 },
  Core: { MV: 0, MEV: 4, MAV: [8, 12], MRV: 16 },
};

export const MUSCLE_GROUPS = Object.keys(VOLUME_LANDMARKS);

export const SPLIT_TYPES = {
  FULL_BODY: 'Full_Body',
  TORSO_PIERNA: 'Torso_Pierna',
  TORSO_PIERNA_ONDULADO: 'Torso_Pierna_ondulado',
  PUSH_PULL_LEGS: 'Push_Pull_Legs',
  HIBRIDO_PHUL: 'Hibrido_PHUL',
};

/** DDS 5.9 movement patterns (match catalog field names) */
export const MOVEMENT_PATTERNS = [
  'Empuje_H',
  'Empuje_V',
  'Traccion_H',
  'Traccion_V',
  'Rodilla',
  'Cadera',
  'Core',
  'General',
];

/** Muscles trained per split session focus — gym only */
export const SPLIT_SESSIONS = {
  Full_Body: [
    { sessionFocus: 'Full Body A', muscles: ['Pecho', 'Espalda', 'Cuádriceps', 'Hombro', 'Core'], patterns: ['Empuje_H', 'Traccion_V', 'Rodilla', 'Empuje_V', 'Core'] },
    { sessionFocus: 'Full Body B', muscles: ['Espalda', 'Pecho', 'Isquiotibiales', 'Glúteos', 'Bíceps', 'Tríceps'], patterns: ['Traccion_H', 'Empuje_V', 'Cadera', 'Traccion_V', 'Core'] },
    { sessionFocus: 'Full Body C', muscles: ['Cuádriceps', 'Pecho', 'Espalda', 'Hombro', 'Pantorrillas'], patterns: ['Rodilla', 'Empuje_H', 'Traccion_H', 'Empuje_V', 'Core'] },
  ],
  Torso_Pierna: [
    { sessionFocus: 'Torso (Empuje)', muscles: ['Pecho', 'Hombro', 'Tríceps'], patterns: ['Empuje_H', 'Empuje_V'] },
    { sessionFocus: 'Pierna (Dominante Rodilla)', muscles: ['Cuádriceps', 'Glúteos', 'Pantorrillas'], patterns: ['Rodilla'] },
    { sessionFocus: 'Torso (Tracción)', muscles: ['Espalda', 'Bíceps', 'Hombro'], patterns: ['Traccion_H', 'Traccion_V'] },
    { sessionFocus: 'Pierna (Dominante Cadera)', muscles: ['Isquiotibiales', 'Glúteos', 'Pantorrillas'], patterns: ['Cadera'] },
  ],
  Torso_Pierna_ondulado: [
    { sessionFocus: 'Torso (Empuje — volumen alto)', muscles: ['Pecho', 'Hombro', 'Tríceps'], patterns: ['Empuje_H', 'Empuje_V'] },
    { sessionFocus: 'Pierna (Completa)', muscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'], patterns: ['Rodilla', 'Cadera'] },
    { sessionFocus: 'Torso (Tracción — volumen alto)', muscles: ['Espalda', 'Bíceps', 'Hombro'], patterns: ['Traccion_H', 'Traccion_V'] },
  ],
  Push_Pull_Legs: [
    { sessionFocus: 'Push', muscles: ['Pecho', 'Hombro', 'Tríceps'], patterns: ['Empuje_H', 'Empuje_V'] },
    { sessionFocus: 'Pull', muscles: ['Espalda', 'Bíceps', 'Hombro'], patterns: ['Traccion_H', 'Traccion_V'] },
    { sessionFocus: 'Legs', muscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'], patterns: ['Rodilla', 'Cadera'] },
  ],
  Hibrido_PHUL: [
    { sessionFocus: 'Upper (Fuerza)', muscles: ['Pecho', 'Espalda', 'Hombro'], patterns: ['Empuje_H', 'Traccion_H'] },
    { sessionFocus: 'Lower (Fuerza)', muscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos'], patterns: ['Rodilla', 'Cadera'] },
    { sessionFocus: 'Upper (Hipertrofia)', muscles: ['Pecho', 'Espalda', 'Bíceps', 'Tríceps', 'Hombro'], patterns: ['Empuje_H', 'Traccion_V', 'Empuje_V'] },
    { sessionFocus: 'Lower (Hipertrofia)', muscles: ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'], patterns: ['Rodilla', 'Cadera'] },
    { sessionFocus: 'Full Body Accesorios', muscles: ['Core', 'Bíceps', 'Tríceps'], patterns: ['Core', 'Empuje_V'] },
  ],
};

/** Map session focus labels to required patterns */
export const SESSION_FOCUS_PATTERN_MAP = Object.fromEntries(
  Object.values(SPLIT_SESSIONS)
    .flat()
    .map((s) => [s.sessionFocus, s.patterns]),
);

/**
 * Count how many sessions per week train each muscle for a split type.
 * @param {string} splitType
 * @returns {Record<string, number>}
 */
export function countMuscleSessionsPerWeek(splitType) {
  const sessions = SPLIT_SESSIONS[splitType] ?? [];
  const freq = {};
  for (const session of sessions) {
    for (const muscle of session.muscles ?? []) {
      freq[muscle] = (freq[muscle] ?? 0) + 1;
    }
  }
  return freq;
}

/** DDS 8.2 — RIR targets by goal */
export const RIR_PROGRESSION = {
  Hipertrofia: { week1: 4, accumulationEnd: 0.5, deloadDelta: 2.5 },
  Fuerza: {
    main: { week1: 3, accumulationEnd: 0.5, deloadDelta: 2.5 },
    accessory: { week1: 4, accumulationEnd: 1.5, deloadDelta: 2.5 },
  },
};

/** Rep ranges by goal — DDS 5 / 8.4 */
export const REP_RANGES = {
  Hipertrofia: { compound: '8-12', isolation: '10-15', core: '12-20' },
  Fuerza: { compound: '3-6', isolation: '8-12', core: '10-15' },
};

/** Rest seconds by goal */
export const REST_SECONDS = {
  Hipertrofia: { compound: 120, isolation: 90, core: 60 },
  Fuerza: { compound: 180, isolation: 120, core: 60 },
};

/** Zourdos/Helms style %1RM from RIR — keyed by rep count, values indexed by RIR 0-4 */
export const RPE_PERCENT_TABLE = {
  3: [0.93, 0.9, 0.87, 0.84, 0.81],
  4: [0.9, 0.87, 0.84, 0.81, 0.78],
  5: [0.87, 0.84, 0.81, 0.78, 0.75],
  6: [0.85, 0.82, 0.79, 0.76, 0.73],
  8: [0.8, 0.77, 0.74, 0.71, 0.68],
  10: [0.75, 0.72, 0.69, 0.66, 0.63],
  12: [0.7, 0.67, 0.64, 0.61, 0.58],
  15: [0.65, 0.62, 0.59, 0.56, 0.53],
};

/** DDS 5.8 load limits */
export const LOAD_LIMITS = {
  compound: { weekly: 0.05, session: 0.025 },
  isolation: { weekly: 0.03, session: 0.02 },
};

export const EXERCISE_TYPES = {
  COMPOUND: 'compound',
  ISOLATION: 'isolation',
};

/** Minimum plate increment (kg) for rounding */
export const DEFAULT_PLATE_INCREMENT_KG = 2.5;

/** DDS 8.1 / 10 — injury → movement restrictions */
export const INJURY_MOVEMENT_MAP = {
  Hombro: {
    avoidPatterns: ['Empuje_V'],
    modifyPatterns: ['Empuje_H'],
    prehab: ['movilidad_hombro'],
  },
  Rodilla: {
    avoidPatterns: ['Rodilla'],
    modifyPatterns: ['Cadera'],
    prehab: ['movilidad_rodilla'],
  },
  Espalda_Baja: {
    avoidPatterns: ['Cadera'],
    modifyPatterns: ['Traccion_H', 'Traccion_V'],
    prehab: ['core_estabilidad'],
  },
  Muñeca: {
    avoidPatterns: [],
    modifyPatterns: ['Empuje_H', 'Traccion_H'],
    prehab: ['movilidad_muneca'],
  },
};

export const DELOAD_VOLUME_MULTIPLIER = 0.5;

export const DAY_ORDER = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
