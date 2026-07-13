/**
 * Auditoría de calidad — usuarios ficticios, criterios DDS/literatura.
 *
 * Uso:
 *   node scripts/dev/simulate-quality-audit.mjs           # lote 1 (15 sesiones)
 *   node scripts/dev/simulate-quality-audit.mjs --batch=2 # lote 2 (15 sesiones, auditoría externa)
 *   node scripts/dev/simulate-quality-audit.mjs --batch=3 # lote 3 (sin lesiones)
 *   node scripts/dev/simulate-quality-audit.mjs --batch=all
 */
import { writeFileSync } from 'fs';
import { generateMesocycle } from '../../domain/periodization/mesocycleGenerator.js';
import { generateSession } from '../../domain/session/sessionGenerator.js';
import { getWeekPlan } from '../../domain/periodization/microcycle.js';
import { evaluateSplitQuality } from '../../domain/periodization/splitQuality.js';
import { buildSafetyProfile } from '../../domain/athlete/safetyProfile.js';
import { loadCatalogFromDisk } from '../../infrastructure/catalog/catalogRepository.js';
import { addDays } from '../../lib/dateUtils.js';
import { getTodaySessionPlan } from '../../lib/mesocycleUtils.js';
import { validateInvariants } from '../../tests/simulation/invariants.js';
import {
  validateMuscleStimulusCoverage,
  MUSCLE_STIMULUS_CONFIG,
} from '../../domain/exerciseSelection/stimulusCoverage.js';
import { isOlympicLift } from '../../domain/exerciseSelection/selector.js';
import {
  resolveSessionGoal,
  isPushBiasedSession,
  isPullBiasedSession,
  SESSION_MUSCLE_MIN_SETS,
  isGoodMorningExercise,
} from '../../domain/session/sessionPrescription.js';
import { isBodyweightExercise } from '../../domain/exerciseSelection/bodyweight.js';
import { usesResistanceBands } from '../../domain/exerciseSelection/equipmentFilters.js';
import {
  MAX_SETS_PER_EXERCISE,
  REP_RANGES,
  RIR_PROGRESSION,
  VOLUME_LANDMARKS,
} from '../../domain/constants.js';

const SCHEDULE_3D = [
  { day: 'Lunes', canTrain: true },
  { day: 'Martes', canTrain: false },
  { day: 'Miércoles', canTrain: true },
  { day: 'Jueves', canTrain: false },
  { day: 'Viernes', canTrain: true },
  { day: 'Sábado', canTrain: false },
  { day: 'Domingo', canTrain: false },
];

const SCHEDULE_4D = [
  { day: 'Lunes', canTrain: true },
  { day: 'Martes', canTrain: false },
  { day: 'Miércoles', canTrain: true },
  { day: 'Jueves', canTrain: false },
  { day: 'Viernes', canTrain: true },
  { day: 'Sábado', canTrain: true },
  { day: 'Domingo', canTrain: false },
];

const SCHEDULE_5D = [
  { day: 'Lunes', canTrain: true },
  { day: 'Martes', canTrain: true },
  { day: 'Miércoles', canTrain: true },
  { day: 'Jueves', canTrain: true },
  { day: 'Viernes', canTrain: true },
  { day: 'Sábado', canTrain: false },
  { day: 'Domingo', canTrain: false },
];

const SCHEDULE_6D = [
  { day: 'Lunes', canTrain: true },
  { day: 'Martes', canTrain: true },
  { day: 'Miércoles', canTrain: true },
  { day: 'Jueves', canTrain: true },
  { day: 'Viernes', canTrain: true },
  { day: 'Sábado', canTrain: true },
  { day: 'Domingo', canTrain: false },
];

const SCHEDULE_2D = [
  { day: 'Lunes', canTrain: true },
  { day: 'Martes', canTrain: false },
  { day: 'Miércoles', canTrain: false },
  { day: 'Jueves', canTrain: true },
  { day: 'Viernes', canTrain: false },
  { day: 'Sábado', canTrain: false },
  { day: 'Domingo', canTrain: false },
];

/** Lote 1 — 15 sesiones semana 1 (revisión inicial) */
const BATCH1 = {
  title: 'Auditoría de calidad — 15 sesiones (Semana 1, Lote 1)',
  subtitle:
    'Revisión manual de entrenamientos generados para perfiles ficticios diversos.',
  referenceDate: '2026-07-07T12:00:00Z',
  mdPath: '../../docs/dev/quality-audit-week1.md',
  jsonPath: '../../docs/dev/quality-audit-week1.json',
  personas: [
    {
      id: 'diego_phul_fuerza',
      label: 'Diego — Avanzado, 5d, Fuerza, PHUL',
      profile: {
        age: 29,
        trainingAgeMonths: 52,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 84,
      },
    },
    {
      id: 'sofia_ppl_push',
      label: 'Sofía — Intermedia, 6d, Hipertrofia, PPL',
      profile: {
        age: 26,
        gender: 'F',
        trainingAgeMonths: 20,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 59,
        heightCm: 165,
      },
    },
    {
      id: 'carlos_novato_fb',
      label: 'Carlos — Novato, 3d, Hipertrofia, Full Body',
      profile: {
        age: 24,
        trainingAgeMonths: 2,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 72,
      },
    },
    {
      id: 'maria_torso_empuje',
      label: 'María — Intermedia, 4d, Hipertrofia, Torso/Pierna',
      profile: {
        age: 32,
        gender: 'F',
        trainingAgeMonths: 18,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 63,
      },
    },
    {
      id: 'ana_hombro',
      label: 'Ana — Intermedia, 4d, Hipertrofia, lesión hombro',
      profile: {
        age: 35,
        gender: 'F',
        trainingAgeMonths: 24,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: ['Hombro'],
        currentWeightKg: 61,
      },
    },
    {
      id: 'elena_rodilla_cadera',
      label: 'Elena — Intermedia, 4d, Hipertrofia, lesión rodilla',
      profile: {
        age: 29,
        gender: 'F',
        trainingAgeMonths: 16,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: ['Rodilla'],
        currentWeightKg: 66,
      },
    },
    {
      id: 'luis_conservador',
      label: 'Luis — 58 años, 3d, Hipertrofia, protocolo conservador',
      profile: {
        age: 58,
        trainingAgeMonths: 10,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 90,
        heightCm: 178,
      },
    },
    {
      id: 'valentina_2d',
      label: 'Valentina — Novata, 2d/semana, Hipertrofia, Full Body',
      profile: {
        age: 22,
        gender: 'F',
        trainingAgeMonths: 3,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 2,
        weeklyScheduleContext: SCHEDULE_2D,
        injuriesOrLimitations: [],
        currentWeightKg: 58,
        heightCm: 162,
      },
    },
    {
      id: 'roberto_ppl_pull_fuerza',
      label: 'Roberto — Avanzado, 6d, Fuerza, Push/Pull/Legs',
      profile: {
        age: 34,
        trainingAgeMonths: 60,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 88,
      },
    },
    {
      id: 'miguel_fuerza_fb',
      label: 'Miguel — Intermedio, 3d, Fuerza, Full Body',
      profile: {
        age: 38,
        trainingAgeMonths: 28,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 82,
      },
    },
    {
      id: 'javier_phul_lower_h',
      label: 'Javier — Intermedio, 5d, Hipertrofia, PHUL',
      profile: {
        age: 27,
        trainingAgeMonths: 22,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 76,
      },
    },
    {
      id: 'camila_ppl_legs',
      label: 'Camila — Intermedia, 6d, Hipertrofia, PPL',
      profile: {
        age: 30,
        gender: 'F',
        trainingAgeMonths: 18,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 62,
      },
    },
    {
      id: 'fernando_ondulado',
      label: 'Fernando — Intermedio, 3d, Hipertrofia, Torso/Pierna ondulado',
      profile: {
        age: 33,
        trainingAgeMonths: 20,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 80,
      },
    },
    {
      id: 'pablo_phul_lower_fuerza',
      label: 'Pablo — Intermedio, 4d, Fuerza, PHUL',
      profile: {
        age: 31,
        trainingAgeMonths: 30,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 85,
      },
    },
    {
      id: 'lucia_muneca',
      label: 'Lucía — Intermedia, 4d, Hipertrofia, limitación de muñeca',
      profile: {
        age: 36,
        gender: 'F',
        trainingAgeMonths: 16,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: ['Muñeca'],
        currentWeightKg: 60,
      },
    },
  ],
  curatedSessions: [
    { personaId: 'diego_phul_fuerza', focus: 'Upper (Fuerza)' },
    { personaId: 'sofia_ppl_push', focus: 'Push' },
    { personaId: 'carlos_novato_fb', focus: 'Full Body A' },
    { personaId: 'maria_torso_empuje', focus: 'Torso (Empuje)' },
    { personaId: 'ana_hombro', focus: 'Torso (Tracción)' },
    { personaId: 'elena_rodilla_cadera', focus: 'Pierna (Dominante Rodilla)' },
    { personaId: 'luis_conservador', focus: 'Torso (Empuje — volumen alto)' },
    { personaId: 'valentina_2d', focus: 'Full Body B' },
    { personaId: 'roberto_ppl_pull_fuerza', focus: 'Pull' },
    { personaId: 'miguel_fuerza_fb', focus: 'Full Body C' },
    { personaId: 'javier_phul_lower_h', focus: 'Lower (Hipertrofia)' },
    { personaId: 'camila_ppl_legs', focus: 'Legs' },
    { personaId: 'fernando_ondulado', focus: 'Pierna (Completa)' },
    { personaId: 'pablo_phul_lower_fuerza', focus: 'Lower (Fuerza)' },
    { personaId: 'lucia_muneca', focus: 'Torso (Empuje)' },
  ],
};

/** Lote 2 — 15 sesiones nuevas para auditoría externa (tipos no cubiertos en lote 1) */
const BATCH2 = {
  title: 'Auditoría de calidad — 15 sesiones (Semana 1, Lote 2)',
  subtitle:
    'Segunda muestra para revisión externa: 15 perfiles nuevos y tipos de sesión no incluidos en el lote 1.\n\n' +
    '**Cobertura adicional:** Pull hipertrofia (PPL), Upper PHUL hipertrofia, tracción ondulada, pierna dominante cadera, Push fuerza, rodilla en día cadera, novato Torso/Pierna, pierna conservador, muñeca en tracción, Full Body B fuerza, día accesorios PHUL, Legs PPL (H y F), hombro en día pierna.',
  referenceDate: '2026-08-04T12:00:00Z',
  mdPath: '../../docs/dev/quality-audit-batch2.md',
  jsonPath: '../../docs/dev/quality-audit-batch2.json',
  personas: [
    {
      id: 'hector_ppl_pull',
      label: 'Héctor — Intermedio, 6d, Hipertrofia, Push/Pull/Legs',
      profile: {
        age: 28,
        trainingAgeMonths: 22,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 79,
      },
    },
    {
      id: 'ricardo_phul_upper_h',
      label: 'Ricardo — Avanzado, 5d, Hipertrofia, PHUL',
      profile: {
        age: 36,
        trainingAgeMonths: 72,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 92,
      },
    },
    {
      id: 'andrea_ondulado_pull',
      label: 'Andrea — Intermedia, 3d, Hipertrofia, Torso/Pierna ondulado',
      profile: {
        age: 31,
        gender: 'F',
        trainingAgeMonths: 14,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 64,
      },
    },
    {
      id: 'oscar_tp_cadera',
      label: 'Oscar — Intermedio, 4d, Hipertrofia, Torso/Pierna',
      profile: {
        age: 40,
        trainingAgeMonths: 26,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 86,
      },
    },
    {
      id: 'german_ppl_push_fuerza',
      label: 'Germán — Avanzado, 6d, Fuerza, Push/Pull/Legs',
      profile: {
        age: 32,
        trainingAgeMonths: 84,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 95,
      },
    },
    {
      id: 'isabel_rodilla_cadera',
      label: 'Isabel — Intermedia, 4d, Hipertrofia, lesión rodilla',
      profile: {
        age: 34,
        gender: 'F',
        trainingAgeMonths: 20,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: ['Rodilla'],
        currentWeightKg: 68,
      },
    },
    {
      id: 'tomas_novato_tp',
      label: 'Tomás — Novato, 4d, Hipertrofia, Torso/Pierna',
      profile: {
        age: 21,
        trainingAgeMonths: 4,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 70,
      },
    },
    {
      id: 'natalia_phul_upper_h',
      label: 'Natalia — Intermedia, 5d, Hipertrofia, PHUL',
      profile: {
        age: 27,
        gender: 'F',
        trainingAgeMonths: 18,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 57,
        heightCm: 168,
      },
    },
    {
      id: 'claudia_conservador_pierna',
      label: 'Claudia — 55 años, 3d, Hipertrofia, protocolo conservador',
      profile: {
        age: 55,
        gender: 'F',
        trainingAgeMonths: 8,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 72,
        heightCm: 165,
      },
    },
    {
      id: 'jimena_muneca_pull',
      label: 'Jimena — Intermedia, 4d, Hipertrofia, limitación de muñeca',
      profile: {
        age: 33,
        gender: 'F',
        trainingAgeMonths: 22,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: ['Muñeca'],
        currentWeightKg: 62,
      },
    },
    {
      id: 'felipe_fuerza_fb_b',
      label: 'Felipe — Intermedio, 3d, Fuerza, Full Body',
      profile: {
        age: 42,
        trainingAgeMonths: 32,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 87,
      },
    },
    {
      id: 'raquel_phul_accesorios',
      label: 'Raquel — Intermedia, 5d, Hipertrofia, PHUL',
      profile: {
        age: 29,
        gender: 'F',
        trainingAgeMonths: 16,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 60,
      },
    },
    {
      id: 'mateo_ppl_legs',
      label: 'Mateo — Intermedio, 6d, Hipertrofia, Push/Pull/Legs',
      profile: {
        age: 25,
        trainingAgeMonths: 24,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 74,
      },
    },
    {
      id: 'paula_hombro_pierna',
      label: 'Paula — Intermedia, 4d, Hipertrofia, lesión hombro',
      profile: {
        age: 37,
        gender: 'F',
        trainingAgeMonths: 28,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: ['Hombro'],
        currentWeightKg: 65,
      },
    },
    {
      id: 'bruno_ppl_legs_fuerza',
      label: 'Bruno — Avanzado, 6d, Fuerza, Push/Pull/Legs',
      profile: {
        age: 30,
        trainingAgeMonths: 96,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 91,
      },
    },
  ],
  curatedSessions: [
    { personaId: 'hector_ppl_pull', focus: 'Pull' },
    { personaId: 'ricardo_phul_upper_h', focus: 'Upper (Hipertrofia)' },
    { personaId: 'andrea_ondulado_pull', focus: 'Torso (Tracción — volumen alto)' },
    { personaId: 'oscar_tp_cadera', focus: 'Pierna (Dominante Cadera)' },
    { personaId: 'german_ppl_push_fuerza', focus: 'Push' },
    { personaId: 'isabel_rodilla_cadera', focus: 'Pierna (Dominante Cadera)' },
    { personaId: 'tomas_novato_tp', focus: 'Torso (Tracción)' },
    { personaId: 'natalia_phul_upper_h', focus: 'Upper (Hipertrofia)' },
    { personaId: 'claudia_conservador_pierna', focus: 'Pierna (Completa)' },
    { personaId: 'jimena_muneca_pull', focus: 'Torso (Tracción)' },
    { personaId: 'felipe_fuerza_fb_b', focus: 'Full Body B' },
    { personaId: 'raquel_phul_accesorios', focus: 'Full Body Accesorios' },
    { personaId: 'mateo_ppl_legs', focus: 'Legs' },
    { personaId: 'paula_hombro_pierna', focus: 'Pierna (Dominante Rodilla)' },
    { personaId: 'bruno_ppl_legs_fuerza', focus: 'Legs' },
  ],
};

/** Lote 3 — 15 sesiones sin lesiones (validación programación pura, perfiles renovados) */
const BATCH3 = {
  title: 'Auditoría de calidad — 15 sesiones (Semana 1, Lote 3)',
  subtitle:
    'Tercera muestra renovada: 15 perfiles ficticios sanos (sin lesiones ni protocolo conservador).\n\n' +
    '**Cobertura:** Lower/Upper fuerza PHUL, día accesorios PHUL, PPL hipertrofia/fuerza, Torso/Pierna, Full Body novato/intermedio, ondulado, pierna dominante.',
  referenceDate: '2026-10-13T12:00:00Z',
  mdPath: '../../docs/dev/quality-audit-batch3.md',
  jsonPath: '../../docs/dev/quality-audit-batch3.json',
  personas: [
    {
      id: 'andres_tp_lower_f',
      label: 'Andrés — Avanzado, 4d, Fuerza, Torso/Pierna',
      profile: {
        age: 35,
        trainingAgeMonths: 90,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 92,
      },
    },
    {
      id: 'elena_phul_lower_h',
      label: 'Elena — Intermedia, 5d, Hipertrofia, PHUL',
      profile: {
        age: 27,
        gender: 'F',
        trainingAgeMonths: 20,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 59,
      },
    },
    {
      id: 'tomas_novato_fb',
      label: 'Tomás — Novato, 3d, Hipertrofia, Full Body',
      profile: {
        age: 22,
        trainingAgeMonths: 2,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 72,
      },
    },
    {
      id: 'paula_ppl_push',
      label: 'Paula — Intermedia, 6d, Hipertrofia, Push/Pull/Legs',
      profile: {
        age: 30,
        gender: 'F',
        trainingAgeMonths: 24,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 56,
      },
    },
    {
      id: 'oscar_fuerza_fb',
      label: 'Óscar — Intermedio, 3d, Fuerza, Full Body',
      profile: {
        age: 41,
        trainingAgeMonths: 30,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 86,
      },
    },
    {
      id: 'natalia_ppl_pull_f',
      label: 'Natalia — Avanzada, 6d, Fuerza, Push/Pull/Legs',
      profile: {
        age: 33,
        gender: 'F',
        trainingAgeMonths: 70,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 63,
      },
    },
    {
      id: 'diego_tp_empuje',
      label: 'Diego — Intermedio, 4d, Hipertrofia, Torso/Pierna',
      profile: {
        age: 32,
        trainingAgeMonths: 18,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 80,
      },
    },
    {
      id: 'clara_novato_2d',
      label: 'Clara — Novata, 2d/semana, Hipertrofia, Full Body',
      profile: {
        age: 20,
        gender: 'F',
        trainingAgeMonths: 1,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 2,
        weeklyScheduleContext: SCHEDULE_2D,
        injuriesOrLimitations: [],
        currentWeightKg: 54,
        heightCm: 162,
      },
    },
    {
      id: 'emilio_phul_upper_f',
      label: 'Emilio — Intermedio, 5d, Fuerza, PHUL',
      profile: {
        age: 36,
        trainingAgeMonths: 42,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 83,
      },
    },
    {
      id: 'rosa_phul_accesorios',
      label: 'Rosa — Avanzada, 5d, Hipertrofia, PHUL',
      profile: {
        age: 38,
        gender: 'F',
        trainingAgeMonths: 60,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 5,
        weeklyScheduleContext: SCHEDULE_5D,
        injuriesOrLimitations: [],
        currentWeightKg: 65,
      },
    },
    {
      id: 'fernando_tp_rodilla',
      label: 'Fernando — Intermedio, 4d, Hipertrofia, Torso/Pierna',
      profile: {
        age: 28,
        trainingAgeMonths: 14,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 76,
      },
    },
    {
      id: 'diana_ppl_legs',
      label: 'Diana — Intermedia, 6d, Hipertrofia, Push/Pull/Legs',
      profile: {
        age: 25,
        gender: 'F',
        trainingAgeMonths: 22,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 58,
      },
    },
    {
      id: 'guillermo_ondulado_empuje',
      label: 'Guillermo — Intermedio, 3d, Hipertrofia, Torso/Pierna ondulado',
      profile: {
        age: 34,
        trainingAgeMonths: 16,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 3,
        weeklyScheduleContext: SCHEDULE_3D,
        injuriesOrLimitations: [],
        currentWeightKg: 78,
      },
    },
    {
      id: 'hector_ppl_push_f',
      label: 'Héctor — Avanzado, 6d, Fuerza, Push/Pull/Legs',
      profile: {
        age: 37,
        trainingAgeMonths: 84,
        fitnessGoal: 'Fuerza',
        trainingDaysPerWeek: 6,
        weeklyScheduleContext: SCHEDULE_6D,
        injuriesOrLimitations: [],
        currentWeightKg: 90,
      },
    },
    {
      id: 'valeria_novato_tp',
      label: 'Valeria — Novata, 4d, Hipertrofia, Torso/Pierna',
      profile: {
        age: 22,
        gender: 'F',
        trainingAgeMonths: 3,
        fitnessGoal: 'Hipertrofia',
        trainingDaysPerWeek: 4,
        weeklyScheduleContext: SCHEDULE_4D,
        injuriesOrLimitations: [],
        currentWeightKg: 52,
        heightCm: 157,
      },
    },
  ],
  curatedSessions: [
    { personaId: 'andres_tp_lower_f', focus: 'Lower (Fuerza)' },
    { personaId: 'elena_phul_lower_h', focus: 'Lower (Hipertrofia)' },
    { personaId: 'tomas_novato_fb', focus: 'Full Body A' },
    { personaId: 'paula_ppl_push', focus: 'Push' },
    { personaId: 'oscar_fuerza_fb', focus: 'Full Body B' },
    { personaId: 'natalia_ppl_pull_f', focus: 'Pull' },
    { personaId: 'diego_tp_empuje', focus: 'Torso (Empuje)' },
    { personaId: 'clara_novato_2d', focus: 'Full Body B' },
    { personaId: 'emilio_phul_upper_f', focus: 'Upper (Fuerza)' },
    { personaId: 'rosa_phul_accesorios', focus: 'Full Body Accesorios' },
    { personaId: 'fernando_tp_rodilla', focus: 'Pierna (Dominante Rodilla)' },
    { personaId: 'diana_ppl_legs', focus: 'Legs' },
    { personaId: 'guillermo_ondulado_empuje', focus: 'Torso (Empuje — volumen alto)' },
    { personaId: 'hector_ppl_push_f', focus: 'Push' },
    { personaId: 'valeria_novato_tp', focus: 'Pierna (Dominante Rodilla)' },
  ],
};

const BASE = {
  name: 'Sim Atleta',
  gender: 'M',
  heightCm: 175,
  currentWeightKg: 78,
  timezone: 'America/Mexico_City',
};

const NICHE_RE =
  /one.?arm|single.?arm|handstand|pistol|plyo|clock push|renegade|guillotine|depth jump|turkish/i;

const CRITERIA_LABELS = {
  rir_week1: 'RIR semana 1 acorde al objetivo (Helms et al.)',
  rep_ranges: 'Rangos de reps alineados al objetivo (Schoenfeld)',
  warmup_ramp: 'Calentamiento RAMP: Raise → Activate → Mobilize×2 → Potentiate (Jeffreys)',
  fuerza_ramps: 'Series de aproximación solo en sesiones de Fuerza',
  no_bands: 'Sin ejercicios con bandas en bloque principal',
  no_bw_load_error: 'Peso corporal sin kg prescrito',
  fuerza_no_bw_solo: 'Fuerza: sin PC como único compuesto cargable',
  stimulus_diversity: 'Diversidad de subtipos de estímulo por músculo',
  injury_patterns: 'Patrones evitados según lesión declarada',
  set_caps: 'Series por ejercicio dentro de límites (≤5 comp / ≤4 ais)',
  compound_order: 'Compuestos antes que aislamientos en el bloque',
  split_quality: 'Calendario semanal con calidad ≥ aceptable (DDS §5.7)',
  volume_mev_mrv: 'Volumen semana 1 entre MEV y MRV por músculo',
  deload_planned: 'Mesociclo con semana deload programada',
  no_olympic_novice: 'Novato sin olímpicos ni alta dificultad técnica',
  warmup_no_bands: 'Calentamiento sin bandas de resistencia (McGill)',
  warmup_no_explosive_fuerza: 'Fuerza: sin pliometría ni drills explosivos en calentamiento',
  dedicated_session_volume:
    'Push/Pull hipertrofia: mínimo efectivo por músculo/sesión (Schoenfeld)',
  push_pull_accessories:
    'Push incluye tríceps; Pull/Upper-H incluye bíceps y tríceps cuando aplica',
  physio_shoulder_injury:
    'Lesión hombro: sin elevaciones laterales ni curl agarre ancho en tracción',
  physio_knee_injury:
    'Lesión rodilla: sin step-up/zancada/saltos; prehab relevante (no cardio genérico)',
  physio_conservative:
    'Protocolo conservador: sin fondos y ≤18 series totales',
  physio_fuerza_lower:
    'Lower Fuerza: sin buenos días como bisagra principal; ≥3 ejercicios',
  physio_fb_knee:
    'Full Body: incluye patrón Rodilla (cuádriceps)',
  physio_raise_cardio:
    'Raise RAMP: cardio sistémico (máquina), no solo movilidad local',
  physio_fuerza_upper_pull:
    'Upper Fuerza: incluye tracción vertical (jalón/dominada)',
  physio_novice_pec:
    'Novato: máximo un press horizontal de pecho por sesión',
  physio_wrist_injury:
    'Lesión muñeca: sin extensión tríceps/mancuerna ni laterales a una mano',
  physio_knee_hamstring_balance:
    'Lesión rodilla en pierna dominante: isquios en cadena cerrada y sin extensiones',
  physio_fb_fuerza_vertical_pull:
    'Full Body Fuerza: incluye tracción vertical',
  physio_novato_fb_hamstrings:
    'Novato Full Body: incluye isquiotibiales directos',
  physio_novato_fb_no_quad_extension:
    'Novato Full Body: sin extensiones de cuádriceps si ya hay prensa',
  physio_phul_accesorios:
    'PHUL Accesorios: incluye tracción horizontal y patrón cadera/pierna',
  physio_dedicated_pull_volume:
    'Pull hipertrofia: mínimo 8 series directas de espalda',
  physio_fb_fuerza_density:
    'Full Body Fuerza: ≤6 ejercicios y ≤20 series totales',
  physio_novato_2d_arms:
    'Novato 2d/semana Full Body: incluye trabajo directo de brazos',
  physio_fb_fuerza_lumbar:
    'Full Body Fuerza: sin bisagra lumbar pesada si ya hay prensa y remo',
  physio_fb_fuerza_hamstrings:
    'Full Body Fuerza: incluye isquiotibiales directos',
  physio_fuerza_no_ballistic:
    'Fuerza: sin ejercicios balísticos (swings, kettlebell swing) en bloque principal',
  physio_hipertrofia_min_sets:
    'Hipertrofia: mínimo 2 series por ejercicio prescrito',
  physio_novato_fb_arms_both:
    'Novato Full Body: incluye bíceps y tríceps directos',
  physio_phul_accesorios_density:
    'PHUL Accesorios: ≤8 ejercicios y ≤20 series totales',
  physio_novato_2d_density:
    'Novato 2d/semana Full Body: ≤18 series totales',
  physio_novato_3d_fb_density:
    'Novato Full Body 3d: ≤7 ejercicios y ≤20 series totales',
  physio_fuerza_lower_main_compounds:
    'Lower Fuerza: ≥2 ejercicios en rango de fuerza (3-7 reps)',
  physio_phul_accesorios_biceps:
    'PHUL Accesorios: incluye bíceps directo',
  physio_leg_no_hinge_stepup:
    'Pierna: sin step-up tras bisagra lumbar (GM/RDL/deadlift)',
};

function formatWarmup(warmup) {
  return (warmup ?? []).map((w, i) => {
    const ramp = w.isRampSet ? ` [RAMP ${w.rampSetNumber}]` : '';
    const load = w.peso ?? (w.prescribedLoadKg != null ? `${w.prescribedLoadKg} kg` : '');
    const loadStr = load ? ` · ${load}` : '';
    return `  ${i + 1}. [${w.phase ?? w.faseRAMP}] ${w.nombre ?? w.name}${ramp} — ${w.reps ?? w.duracion ?? '?'}${loadStr}`;
  });
}

function formatMain(mainBlock) {
  return (mainBlock ?? []).map((ex, i) => {
    const load =
      ex.loadMode === 'bodyweight'
        ? 'PC'
        : ex.prescribedLoadKg != null
          ? `${ex.prescribedLoadKg} kg`
          : ex.suggestedLoadKg != null
            ? `~${ex.suggestedLoadKg} kg`
            : ex.loadMode === 'exploratory'
              ? 'Exploratorio'
              : '—';
    return `  ${i + 1}. ${ex.exerciseName} (${ex.muscleGroup}) — ${ex.sets}×${ex.repRange} · ${load} · RIR ${ex.rirTarget}`;
  });
}

function auditSessionIssues(session, catalogById) {
  const issues = [];
  for (const ex of session.mainBlock ?? []) {
    const cat = catalogById.get(ex.exerciseId);
    if (cat?.dificultadTecnica === 'Alta') issues.push(`Alta dificultad: ${ex.exerciseName}`);
    if (NICHE_RE.test(ex.exerciseName ?? '') || NICHE_RE.test(ex.exerciseId ?? '')) {
      issues.push(`Ejercicio nicho: ${ex.exerciseName}`);
    }
    if (isOlympicLift(cat ?? ex)) issues.push(`Olímpico: ${ex.exerciseName}`);
    if (ex.loadMode === 'bodyweight' && (ex.prescribedLoadKg || ex.suggestedLoadKg)) {
      issues.push(`PC con peso prescrito: ${ex.exerciseName}`);
    }
  }
  for (const muscle of Object.keys(MUSCLE_STIMULUS_CONFIG)) {
    const check = validateMuscleStimulusCoverage(session.mainBlock ?? [], muscle);
    if (!check.ok) issues.push(check.message);
  }
  return issues;
}

function repRangeMatchesGoal(repRange, expected) {
  if (repRange === expected) return true;
  const parse = (r) => String(r).split('-').map(Number);
  const [eLo, eHi] = parse(expected);
  const [rLo, rHi] = parse(repRange);
  if (!Number.isFinite(eLo) || !Number.isFinite(rLo)) return false;
  // Permite progresión de carga/reps del calculador (+1–3 reps respecto al rango base)
  return rLo >= eLo && rLo <= eLo + 3 && rHi >= eHi && rHi <= eHi + 4;
}

function expectedWeek1Rir(goal, isAccessory = false) {
  if (goal === 'Fuerza') {
    return isAccessory
      ? RIR_PROGRESSION.Fuerza.accessory.week1
      : RIR_PROGRESSION.Fuerza.main.week1;
  }
  return RIR_PROGRESSION.Hipertrofia.week1;
}

function isCompoundExercise(ex, catalogById) {
  const cat = catalogById.get(ex.exerciseId);
  return (
    ex.exerciseType === 'compound' ||
    ex.fuerzaMainLift === true ||
    (cat?.prioridad ?? ex.priority ?? 3) === 1
  );
}

function evaluateScientificCriteria({
  session,
  profile,
  mesocycle,
  catalogById,
  weekSessions,
  safetyProfile,
}) {
  const mesocycleGoal = profile.fitnessGoal;
  const sessionGoal = resolveSessionGoal(session.sessionFocus, mesocycleGoal);
  const goal = sessionGoal;
  const main = session.mainBlock ?? [];
  const criteria = {};

  const weekPlan = getWeekPlan(mesocycle, 1);
  const expectedMainRir = expectedWeek1Rir(goal, false);
  const expectedAccRir = expectedWeek1Rir(goal, true);

  const sessionMuscles = session.sessionMuscles ?? [];
  const dedicated =
    isPushBiasedSession(sessionMuscles, session.sessionFocus) ||
    isPullBiasedSession(sessionMuscles, session.sessionFocus);

  const isFuerzaPullBiceps = (ex) =>
    goal === 'Fuerza' &&
    isPullBiasedSession(sessionMuscles, session.sessionFocus) &&
    ex.muscleGroup === 'Bíceps' &&
    !isCompoundExercise(ex, catalogById);

  criteria.rir_week1 = main.every((ex) => {
    const expected = isFuerzaPullBiceps(ex)
      ? expectedAccRir
      : isCompoundExercise(ex, catalogById)
        ? expectedMainRir
        : expectedAccRir;
    return Math.abs((ex.rirTarget ?? expected) - expected) <= 0.5;
  });

  const ranges = REP_RANGES[goal] ?? REP_RANGES.Hipertrofia;
  criteria.rep_ranges = main.every((ex) => {
    const isCore = ex.muscleGroup === 'Core';
    const isIso = !isCompoundExercise(ex, catalogById) && !isCore;
    const expected = isFuerzaPullBiceps(ex)
      ? ranges.isolation
      : isCore
        ? ranges.core
        : isIso
          ? ranges.isolation
          : ranges.compound;
    return repRangeMatchesGoal(ex.repRange, expected);
  });

  const warmup = session.warmup ?? [];
  const phases = warmup.filter((w) => !w.isRampSet).map((w) => w.phase ?? w.faseRAMP);
  const mobilizeCount = phases.filter((p) => p === 'Mobilize').length;
  criteria.warmup_ramp =
    phases.includes('Raise') &&
    phases.includes('Activate') &&
    mobilizeCount >= 2 &&
    phases.includes('Potentiate');

  const isFuerzaSession = goal === 'Fuerza';
  const hasRamps = warmup.some((w) => w.isRampSet);
  const priorityLift = main.find(
    (ex) =>
      (ex.priority ?? 2) === 1 &&
      (ex.prescribedLoadKg > 0 || ex.suggestedLoadKg > 0) &&
      ex.loadMode !== 'bodyweight',
  );
  if (isFuerzaSession) {
    criteria.fuerza_ramps = priorityLift ? hasRamps : true;
  } else {
    criteria.fuerza_ramps = !hasRamps;
  }

  criteria.no_bands = main.every((ex) => {
    const cat = catalogById.get(ex.exerciseId) ?? ex;
    return !usesResistanceBands(cat);
  });

  criteria.no_bw_load_error = main.every(
    (ex) =>
      ex.loadMode !== 'bodyweight' || (!ex.prescribedLoadKg && !ex.suggestedLoadKg),
  );

  if (goal === 'Fuerza') {
    const byMuscle = {};
    for (const ex of main) {
      const m = ex.muscleGroup;
      if (!byMuscle[m]) byMuscle[m] = [];
      byMuscle[m].push(ex);
    }
    criteria.fuerza_no_bw_solo = Object.values(byMuscle).every((exercises) => {
      const compounds = exercises.filter((ex) => isCompoundExercise(ex, catalogById));
      if (compounds.length === 0) return true;
      const loaded = compounds.filter((ex) => {
        const cat = catalogById.get(ex.exerciseId);
        return cat ? !isBodyweightExercise(cat) : ex.loadMode !== 'bodyweight';
      });
      return loaded.length > 0 || compounds.every((ex) => {
        const cat = catalogById.get(ex.exerciseId);
        return cat && !isBodyweightExercise(cat);
      });
    });
  } else {
    criteria.fuerza_no_bw_solo = true;
  }

  criteria.stimulus_diversity = Object.keys(MUSCLE_STIMULUS_CONFIG).every((muscle) => {
    const check = validateMuscleStimulusCoverage(main, muscle);
    return check.ok;
  });

  const avoid = new Set(safetyProfile?.avoidPatterns ?? []);
  criteria.injury_patterns = main.every((ex) => !avoid.has(ex.movementPattern));

  criteria.set_caps = main.every((ex) => {
    const compound = isCompoundExercise(ex, catalogById);
    const cap = compound ? MAX_SETS_PER_EXERCISE.compound : MAX_SETS_PER_EXERCISE.isolation;
    return (ex.sets ?? 0) <= cap;
  });

  let lastRank = -1;
  const rank = (ex) => {
    const cat = catalogById.get(ex.exerciseId);
    const p = cat?.prioridad ?? ex.priority ?? 3;
    if (p === 1) return 0;
    if (p === 2) return 1;
    return 2;
  };
  criteria.compound_order = main.every((ex) => {
    const r = rank(ex);
    const ok = r >= lastRank;
    lastRank = r;
    return ok;
  });

  const splitQuality = evaluateSplitQuality({
    splitType: mesocycle.splitType,
    goal: mesocycleGoal,
    experienceLevel: mesocycle.experienceLevel,
    trainingDaysPerWeek: profile.trainingDaysPerWeek,
    sessions: weekSessions,
  });
  criteria.split_quality = ['aceptable', 'muy_bien', 'excelente'].includes(splitQuality.grade);

  criteria.volume_mev_mrv = Object.entries(weekPlan?.volumeByMuscle ?? {}).every(
    ([muscle, vol]) => {
      const landmarks = mesocycle.volumeLandmarks?.[muscle] ?? VOLUME_LANDMARKS[muscle];
      if (!landmarks) return true;
      return vol >= landmarks.MEV * 0.85 && vol <= landmarks.MRV + 1;
    },
  );

  const lastWeek = mesocycle.microcycles?.[mesocycle.microcycles.length - 1];
  criteria.deload_planned = lastWeek?.phase === 'deload';

  if (mesocycle.experienceLevel === 'Novato') {
    criteria.no_olympic_novice = main.every((ex) => {
      const cat = catalogById.get(ex.exerciseId);
      return !isOlympicLift(cat ?? ex) && cat?.dificultadTecnica !== 'Alta';
    });
  } else {
    criteria.no_olympic_novice = true;
  }

  const warmupNonRamp = warmup.filter((w) => !w.isRampSet);
  criteria.warmup_no_bands = warmupNonRamp.every((w) => {
    const cat = catalogById.get(w.exerciseId ?? w.id);
    return !usesResistanceBands(cat ?? w);
  });

  const explosiveWarmup =
    /impulso|jerk|explosiv|potencia|pliom|salt|jump|drill de pared|aceleraci[oó]n|star jump/i;
  criteria.warmup_no_explosive_fuerza =
    goal !== 'Fuerza' ||
    warmupNonRamp.every((w) => {
      const name = w.nombre ?? w.name ?? w.exerciseName ?? '';
      const phase = w.phase ?? w.faseRAMP;
      if (!['Activate', 'Potentiate'].includes(phase)) return true;
      return !explosiveWarmup.test(name);
    });

  const minSets = SESSION_MUSCLE_MIN_SETS[goal] ?? 4;
  criteria.dedicated_session_volume =
    !dedicated ||
    goal !== 'Hipertrofia' ||
    sessionMuscles.every((muscle) => {
      if (!muscle || muscle === 'Core') return true;
      const total = main
        .filter((ex) => ex.muscleGroup === muscle)
        .reduce((sum, ex) => sum + (ex.sets ?? 0), 0);
      const hasExercise = main.some((ex) => ex.muscleGroup === muscle);
      return !hasExercise || total >= minSets;
    });

  criteria.push_pull_accessories = (() => {
    if (isPushBiasedSession(sessionMuscles, session.sessionFocus)) {
      return main.some((ex) => ex.muscleGroup === 'Tríceps');
    }
    if (/upper.*hipertrofia/i.test(session.sessionFocus ?? '')) {
      return (
        main.some((ex) => ex.muscleGroup === 'Bíceps') &&
        main.some((ex) => ex.muscleGroup === 'Tríceps')
      );
    }
    if (isPullBiasedSession(sessionMuscles, session.sessionFocus)) {
      return main.some((ex) => ex.muscleGroup === 'Bíceps');
    }
    return true;
  })();

  if (safetyProfile?.avoidPatterns?.includes('Empuje_V')) {
    criteria.injury_patterns =
      criteria.injury_patterns &&
      warmupNonRamp.every((w) => !/encogimiento|shrug/i.test(w.nombre ?? w.name ?? ''));
  }

  const shoulderInjury =
    safetyProfile?.injuries?.includes('Hombro') ||
    safetyProfile?.avoidPatterns?.includes('Empuje_V');
  const kneeInjury =
    safetyProfile?.injuries?.includes('Rodilla') ||
    safetyProfile?.modifyPatterns?.includes('Rodilla');
  const isPullSession = isPullBiasedSession(sessionMuscles, session.sessionFocus);

  criteria.physio_shoulder_injury =
    !shoulderInjury ||
    main.every((ex) => {
      const name = (ex.exerciseName ?? '').toLowerCase();
      if (/elevaci[oó]n lateral|lateral raise/i.test(name)) return false;
      if (isPullSession && /curl.*agarre ancho|wide grip.*curl/i.test(name)) return false;
      if (/jal[oó]n.*agarre ancho|lat pulldown.*wide|pull-?down.*wide/i.test(name)) return false;
      return true;
    });

  const warmupNonRampForInjury = warmup.filter((w) => !w.isRampSet);
  const shoulderWarmupOk =
    !shoulderInjury ||
    warmupNonRampForInjury.every(
      (w) => !/scaption/i.test(w.nombre ?? w.name ?? ''),
    );
  criteria.physio_shoulder_injury = criteria.physio_shoulder_injury && shoulderWarmupOk;

  const prehabItems = warmupNonRamp.filter((w) => w.isPrehab || w.phase === 'Prehab');
  criteria.physio_knee_injury =
    !kneeInjury ||
    (main.every((ex) => {
      const name = (ex.exerciseName ?? '').toLowerCase();
      if (/step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla|zancada|lunge|estocada/i.test(name)) {
        return false;
      }
      if (/extensi[oó]n.*cu[aá]driceps|leg extension/i.test(name)) return false;
      return true;
    }) &&
      main.some((ex) => ex.muscleGroup === 'Isquiotibiales') &&
      prehabItems.every((w) => {
        const name = w.nombre ?? w.name ?? '';
        if (/sprint|salt|jump|pliom|salto|impulso|skipping/i.test(name)) return false;
        if (/caminadora|bicicleta|el[ií]ptica|treadmill|bike|cinta/i.test(name)) {
          return /min/i.test(String(w.reps ?? ''));
        }
        return true;
      }));

  const totalSets = main.reduce((sum, ex) => sum + (ex.sets ?? 0), 0);
  criteria.physio_conservative =
    !safetyProfile?.conservative ||
    (totalSets <= 18 &&
      main.every((ex) => !/fondos|parallel bar|bar dip|\bdip\b/i.test(ex.exerciseName ?? '')));

  const focusLower = /lower|legs|pierna/i.test(session.sessionFocus ?? '');
  criteria.physio_fuerza_lower =
    goal !== 'Fuerza' ||
    !focusLower ||
    (main.length >= 3 &&
      !main.some((ex) => {
        const cat = catalogById.get(ex.exerciseId) ?? ex;
        return isGoodMorningExercise(cat) && (cat.prioridad ?? ex.priority ?? 3) === 1;
      }));

  criteria.physio_fb_knee =
    !/full body/i.test(session.sessionFocus ?? '') ||
    main.some((ex) => ex.movementPattern === 'Rodilla' || ex.muscleGroup === 'Cuádriceps');

  const raiseItem = warmupNonRamp.find((w) => (w.phase ?? w.faseRAMP) === 'Raise');
  criteria.physio_raise_cardio =
    !raiseItem ||
    /caminadora|bicicleta|el[ií]ptica|treadmill|bike|cinta|escaladora|elliptical|rowing|remo/i.test(
      raiseItem.nombre ?? raiseItem.name ?? '',
    ) ||
    /caminadora|bicicleta|el[ií]ptica|treadmill|bike|cinta|escaladora|elliptical|rowing|remo/i.test(
      (catalogById.get(raiseItem.exerciseId ?? raiseItem.id)?.equipo ?? []).join(' '),
    );

  const focusUpper = /upper.*fuerza/i.test(session.sessionFocus ?? '');
  criteria.physio_fuerza_upper_pull =
    !focusUpper ||
    main.some(
      (ex) =>
        ex.movementPattern === 'Traccion_V' ||
        /jal[oó]n|lat pulldown|dominada|pull-up|pullup/i.test(ex.exerciseName ?? ''),
    );

  criteria.physio_novice_pec =
    mesocycle.experienceLevel !== 'Novato' ||
    main.filter(
      (ex) =>
        ex.movementPattern === 'Empuje_H' &&
        ex.muscleGroup === 'Pecho' &&
        isCompoundExercise(ex, catalogById),
    ).length <= 1;

  const wristInjury =
    safetyProfile?.injuries?.includes('Muñeca') ||
    safetyProfile?.modifyPatterns?.includes('Empuje_H');
  criteria.physio_wrist_injury =
    !wristInjury ||
    main.every((ex) => {
      const name = (ex.exerciseName ?? '').toLowerCase();
      if (/extensi[oó]n de tr[ií]ceps a una mano|one.?arm.*tr[ií]ceps/i.test(name)) return false;
      if (/elevaciones laterales a una mano|elevaci[oó]n lateral.*una mano/i.test(name)) return false;
      if (/press de hombro unilateral|press.*hombro.*una mano|single.?arm.*shoulder press/i.test(name)) {
        return false;
      }
      return true;
    });

  criteria.physio_knee_hamstring_balance =
    !kneeInjury ||
    !/dominante rodilla/i.test(session.sessionFocus ?? '') ||
    (main.some((ex) => ex.muscleGroup === 'Isquiotibiales') &&
      main.every((ex) => !/extensi[oó]n.*cu[aá]driceps|leg extension/i.test(ex.exerciseName ?? '')));

  criteria.physio_fb_fuerza_vertical_pull =
    goal !== 'Fuerza' ||
    !/full body/i.test(session.sessionFocus ?? '') ||
    main.some(
      (ex) =>
        ex.movementPattern === 'Traccion_V' ||
        /jal[oó]n|lat pulldown|dominada|pull-up|pullup/i.test(ex.exerciseName ?? ''),
    );

  const isNovatoFb =
    mesocycle.experienceLevel === 'Novato' && /full body/i.test(session.sessionFocus ?? '');
  const hasPrensa = main.some((ex) => /prensa de piernas|leg press/i.test(ex.exerciseName ?? ''));
  criteria.physio_novato_fb_hamstrings =
    !isNovatoFb || main.some((ex) => ex.muscleGroup === 'Isquiotibiales');
  criteria.physio_novato_fb_no_quad_extension =
    !isNovatoFb ||
    !hasPrensa ||
    main.every((ex) => !/extensi[oó]n.*cu[aá]driceps|leg extension/i.test(ex.exerciseName ?? ''));

  criteria.physio_phul_accesorios =
    !/full body accesorios/i.test(session.sessionFocus ?? '') ||
    (main.some(
      (ex) =>
        ex.movementPattern === 'Traccion_H' ||
        /remo|row/i.test(ex.exerciseName ?? ''),
    ) &&
      main.some(
        (ex) =>
          ex.movementPattern === 'Cadera' ||
          ex.muscleGroup === 'Isquiotibiales' ||
          ex.muscleGroup === 'Glúteos',
      ) &&
      main.some(
        (ex) => ex.movementPattern === 'Rodilla' || ex.muscleGroup === 'Cuádriceps',
      ));

  const isDedicatedPullDay =
    goal === 'Hipertrofia' &&
    isPullBiasedSession(sessionMuscles, session.sessionFocus) &&
    !/full body|accesorios|upper/i.test(session.sessionFocus ?? '');

  criteria.physio_dedicated_pull_volume =
    !isDedicatedPullDay ||
    main
      .filter((ex) => ex.muscleGroup === 'Espalda')
      .reduce((sum, ex) => sum + (ex.sets ?? 0), 0) >= 8;

  criteria.physio_fb_fuerza_density =
    goal !== 'Fuerza' ||
    !/full body/i.test(session.sessionFocus ?? '') ||
    (main.length <= 6 &&
      main.reduce((sum, ex) => sum + (ex.sets ?? 0), 0) <= 20);

  criteria.physio_novato_2d_arms =
    mesocycle.experienceLevel !== 'Novato' ||
    (mesocycle.trainingDaysPerWeek ?? 3) > 2 ||
    !/full body/i.test(session.sessionFocus ?? '') ||
    (main.some((ex) => ex.muscleGroup === 'Bíceps') &&
      main.some((ex) => ex.muscleGroup === 'Tríceps'));

  criteria.physio_fuerza_no_ballistic =
    goal !== 'Fuerza' ||
    main.every((ex) => {
      const cat = catalogById.get(ex.exerciseId) ?? ex;
      const name = (ex.exerciseName ?? cat.nombre ?? '').toLowerCase();
      return !/swing|kettlebell swing|bal[ií]stic|snatch|clean|jerk|impulso/i.test(name);
    });

  criteria.physio_hipertrofia_min_sets =
    goal !== 'Hipertrofia' ||
    main.every((ex) => (ex.sets ?? 0) >= 2);

  criteria.physio_novato_fb_arms_both =
    mesocycle.experienceLevel !== 'Novato' ||
    !/full body/i.test(session.sessionFocus ?? '') ||
    (main.some((ex) => ex.muscleGroup === 'Bíceps') &&
      main.some((ex) => ex.muscleGroup === 'Tríceps'));

  criteria.physio_phul_accesorios_density =
    !/full body accesorios/i.test(session.sessionFocus ?? '') ||
    (main.length <= 8 &&
      main.reduce((sum, ex) => sum + (ex.sets ?? 0), 0) <= 20);

  criteria.physio_novato_2d_density =
    mesocycle.experienceLevel !== 'Novato' ||
    (mesocycle.trainingDaysPerWeek ?? 3) > 2 ||
    !/full body/i.test(session.sessionFocus ?? '') ||
    main.reduce((sum, ex) => sum + (ex.sets ?? 0), 0) <= 18;

  criteria.physio_novato_3d_fb_density =
    mesocycle.experienceLevel !== 'Novato' ||
    (mesocycle.trainingDaysPerWeek ?? 3) <= 2 ||
    !/full body/i.test(session.sessionFocus ?? '') ||
    (main.length <= 7 &&
      main.reduce((sum, ex) => sum + (ex.sets ?? 0), 0) <= 20);

  const isLowerFuerza =
    goal === 'Fuerza' && /lower|legs|pierna/i.test(session.sessionFocus ?? '');
  const fuerzaRepCount = main.filter((ex) => {
    const rr = ex.repRange ?? '';
    return /^[3-7]-/.test(rr) || rr === '3-6' || rr === '4-7' || rr === '4-6' || rr === '5-7';
  }).length;
  criteria.physio_fuerza_lower_main_compounds = !isLowerFuerza || fuerzaRepCount >= 2;

  criteria.physio_phul_accesorios_biceps =
    !/full body accesorios/i.test(session.sessionFocus ?? '') ||
    main.some((ex) => ex.muscleGroup === 'Bíceps');

  const legFocus = /pierna|lower|legs/i.test(session.sessionFocus ?? '');
  const hasLumbarHinge = main.some((ex) => {
    const name = (ex.exerciseName ?? '').toLowerCase();
    return (
      /buenos d[ií]as|good morning|rdl|rumano|stiff|peso muerto|deadlift/i.test(name)
    );
  });
  const hasStepUp = main.some((ex) =>
    /step-up|step up|subida.*rodilla|elevaci[oó]n de rodilla/i.test(ex.exerciseName ?? ''),
  );
  criteria.physio_leg_no_hinge_stepup = !legFocus || !(hasLumbarHinge && hasStepUp);

  const isFbFuerza = goal === 'Fuerza' && /full body/i.test(session.sessionFocus ?? '');
  const hasPrensaFb = main.some((ex) =>
    /prensa de piernas|leg press/i.test(ex.exerciseName ?? ''),
  );
  const hasRowFb = main.some(
    (ex) =>
      ex.movementPattern === 'Traccion_H' ||
      /remo|row/i.test(ex.exerciseName ?? ''),
  );
  criteria.physio_fb_fuerza_lumbar =
    !isFbFuerza ||
    !(hasPrensaFb && hasRowFb) ||
    main.every(
      (ex) =>
        !/peso muerto con barra|conventional deadlift|deadlift with bar/i.test(
          ex.exerciseName ?? '',
        ) ||
        /rumano|rdl|stiff|piernas r[ií]gidas/i.test(ex.exerciseName ?? ''),
    );

  criteria.physio_fb_fuerza_hamstrings =
    !isFbFuerza ||
    main.some((ex) => ex.muscleGroup === 'Isquiotibiales');

  const passed = Object.values(criteria).filter(Boolean).length;
  const total = Object.keys(criteria).length;

  return { criteria, passed, total, splitQuality };
}

function criteriaMarkdown(criteriaResult) {
  const lines = ['**Criterios científicos / DDS:**'];
  for (const [key, ok] of Object.entries(criteriaResult.criteria)) {
    const label = CRITERIA_LABELS[key] ?? key;
    lines.push(`- ${ok ? '✅' : '❌'} ${label}`);
  }
  lines.push(
    `\n_Puntuación: ${criteriaResult.passed}/${criteriaResult.total} · Split semanal: **${criteriaResult.splitQuality.grade}** (${criteriaResult.splitQuality.score}/100)_`,
  );
  if (criteriaResult.splitQuality.issues.length) {
    lines.push(
      `_Notas split: ${criteriaResult.splitQuality.issues.slice(0, 3).join('; ')}_`,
    );
  }
  return lines;
}

const catalog = await loadCatalogFromDisk();
const catalogById = new Map((catalog.entrenamiento ?? []).map((e) => [e.id, e]));

function runAuditBatch(batch) {
  const { personas, curatedSessions, title, subtitle, referenceDate, mdPath, jsonPath } = batch;

  const report = {
    batchId: batch === BATCH1 ? 1 : batch === BATCH2 ? 2 : 3,
    generatedAt: new Date().toISOString(),
    curatedSessionCount: curatedSessions.length,
    personas: [],
    curated: [],
    summary: { totalIssues: 0, invariantViolations: 0, criteriaFailures: 0 },
  };

  const markdown = [
    `# ${title}`,
    '',
    subtitle,
    'Criterios basados en DDS FitGen, landmarks de volumen (Israetel et al.),',
    'progresión RIR (Helms), orden práctico de ejercicios (Schoenfeld), calentamiento RAMP (Jeffreys)',
    'y validación fisiológica (lesiones, conservador, patrones de fuerza).',
    '',
    '---',
    '',
  ];

  const curatedKeys = new Set(curatedSessions.map((c) => `${c.personaId}::${c.focus}`));
  const curatedMatched = new Set();

  for (const persona of personas) {
    const profile = { ...BASE, ...persona.profile };
    const safetyProfile = buildSafetyProfile(profile);
    const refDate = new Date(referenceDate);
    const mesocycle = generateMesocycle(profile, refDate);
    const history = [];
    const week1Sessions = [];
    const weekPlanSessions = [];

    for (let day = 0; day < 7; day++) {
      const date = addDays(refDate, day);
      const { weekNumber, session: plan, isRestDay } = getTodaySessionPlan(
        mesocycle,
        date,
        profile.timezone,
      );
      if (isRestDay || !plan || weekNumber !== 1) continue;

      weekPlanSessions.push(plan);

      const session = generateSession({
        profile,
        mesocycle,
        weekNumber: 1,
        sessionFocus: plan.sessionFocus,
        sessionMuscles: plan.muscles ?? [],
        patterns: plan.patterns ?? [],
        readiness: { energyLevel: 3, sorenessLevel: 2, sleepQuality: 3, stressLevel: 2 },
        catalog,
        history,
        referenceDate: date,
      });

      const issues = auditSessionIssues(session, catalogById);
      const criteriaResult = evaluateScientificCriteria({
        session,
        profile,
        mesocycle,
        catalogById,
        weekSessions: weekPlanSessions,
        safetyProfile,
      });

      const sessionRecord = {
        personaId: persona.id,
        personaLabel: persona.label,
        focus: session.sessionFocus,
        day: plan.dayOfWeek ?? date.toISOString().slice(0, 10),
        split: mesocycle.splitType,
        goal: profile.fitnessGoal,
        warmupCount: session.warmup?.length ?? 0,
        mainCount: session.mainBlock?.length ?? 0,
        mainSets: (session.mainBlock ?? []).reduce((s, e) => s + (e.sets ?? 0), 0),
        warmup: session.warmup,
        mainBlock: session.mainBlock,
        issues,
        criteria: criteriaResult.criteria,
        criteriaScore: `${criteriaResult.passed}/${criteriaResult.total}`,
        splitGrade: criteriaResult.splitQuality.grade,
        duration: session.summary?.duracionEstimada,
      };

      week1Sessions.push(sessionRecord);

      const key = `${persona.id}::${session.sessionFocus}`;
      if (curatedKeys.has(key) && !curatedMatched.has(key)) {
        curatedMatched.add(key);
        report.curated.push(sessionRecord);
        report.summary.criteriaFailures += criteriaResult.total - criteriaResult.passed;

        markdown.push(`## ${persona.label}`);
        markdown.push(
          `**Sesión:** ${session.sessionFocus} · Split: ${mesocycle.splitType} · Objetivo: ${profile.fitnessGoal}`,
        );
        markdown.push(
          `Duración: ${sessionRecord.duration} · ${sessionRecord.mainCount} ejercicios · ${sessionRecord.mainSets} series\n`,
        );
        markdown.push('**Calentamiento:**');
        markdown.push(...formatWarmup(session.warmup));
        if ((session.warmup ?? []).some((w) => w.isRampSet)) {
          markdown.push('\n_(incluye series de aproximación 40/60/80%)_');
        }
        markdown.push('\n**Bloque principal:**');
        markdown.push(...formatMain(session.mainBlock));
        markdown.push('');
        markdown.push(...criteriaMarkdown(criteriaResult));
        if (issues.length) {
          markdown.push('\n⚠️ **Avisos de calidad:**', ...issues.map((i) => `- ${i}`));
        }
        markdown.push('\n---\n');
      }

      history.push({
        ...session,
        completed: true,
        mainBlock: (session.mainBlock ?? []).map((ex) => ({
          ...ex,
          actualWeightKg:
            ex.prescribedLoadKg ??
            ex.suggestedLoadKg ??
            (ex.loadMode === 'bodyweight' ? null : 30 + (ex.exerciseId?.length ?? 0)),
          actualReps: 10,
          actualRIR: 2,
        })),
      });
    }

    const violations = validateInvariants({
      history,
      mesocycles: [mesocycle],
      persona: { id: persona.id },
    });

    report.personas.push({
      id: persona.id,
      label: persona.label,
      split: mesocycle.splitType,
      goal: profile.fitnessGoal,
      experienceLevel: mesocycle.experienceLevel,
      sessions: week1Sessions,
      issues: week1Sessions.flatMap((s) => s.issues),
      violations,
      criteriaScores: week1Sessions.map((s) => ({
        focus: s.focus,
        score: s.criteriaScore,
      })),
    });
    report.summary.totalIssues += week1Sessions.flatMap((s) => s.issues).length;
    report.summary.invariantViolations += violations.length;
  }

  const missingCurated = curatedSessions.filter(
    (c) => !curatedMatched.has(`${c.personaId}::${c.focus}`),
  );
  if (missingCurated.length) {
    console.warn(
      `\n⚠ Lote ${report.batchId}: sesiones curadas no encontradas en semana 1:`,
      missingCurated.map((c) => `${c.personaId} → ${c.focus}`).join(', '),
    );
  }

  markdown.push('## Resumen global\n');
  markdown.push(`| Métrica | Valor |`);
  markdown.push(`|--------|-------|`);
  markdown.push(`| Perfiles simulados | ${personas.length} |`);
  markdown.push(`| Sesiones en documento | ${report.curated.length} |`);
  markdown.push(`| Avisos de calidad (todos los perfiles) | ${report.summary.totalIssues} |`);
  markdown.push(`| Violaciones invariantes DDS | ${report.summary.invariantViolations} |`);
  markdown.push(
    `| Criterios científicos fallidos (${curatedSessions.length} sesiones) | ${report.summary.criteriaFailures} |`,
  );
  markdown.push('');

  for (const p of report.personas) {
    const allCriteria = p.sessions.map((s) => s.criteriaScore).join(', ');
    markdown.push(
      `- **${p.label}** (${p.split}): invariantes ${p.violations.length === 0 ? '✅' : '❌ ' + p.violations.length}, criterios por sesión [${allCriteria}]`,
    );
  }

  writeFileSync(new URL(mdPath, import.meta.url), markdown.join('\n'));
  writeFileSync(new URL(jsonPath, import.meta.url), JSON.stringify(report, null, 2));

  console.log(`\n=== AUDITORÍA LOTE ${report.batchId} ===\n`);
  console.log(`Perfiles: ${personas.length} · Sesiones documento: ${report.curated.length}`);
  console.log(`Issues totales: ${report.summary.totalIssues}`);
  console.log(`Violaciones DDS: ${report.summary.invariantViolations}`);
  console.log(
    `Criterios fallidos (${curatedSessions.length} sesiones): ${report.summary.criteriaFailures}`,
  );
  console.log('\nSesiones en el documento:');
  for (const s of report.curated) {
    const failedCriteria = Object.entries(s.criteria)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    console.log(
      `  · ${s.personaLabel} → ${s.focus} [${s.criteriaScore}]${failedCriteria.length ? ` ⚠ ${failedCriteria.join(', ')}` : ''}`,
    );
  }
  console.log(`\nReporte: ${mdPath.replace('../../', '')}`);

  return report;
}

const batchArg = process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? '1';
const batches =
  batchArg === 'all'
    ? [BATCH1, BATCH2, BATCH3]
    : batchArg === '2'
      ? [BATCH2]
      : batchArg === '3'
        ? [BATCH3]
        : [BATCH1];

for (const batch of batches) {
  runAuditBatch(batch);
}
