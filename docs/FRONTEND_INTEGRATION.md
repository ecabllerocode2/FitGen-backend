# 📋 Documentación Frontend - Sistema de Generación de Sesiones V2

> **Última actualización:** Enero 2026  
> **Versión del Backend:** 2.0.0  
> **Endpoint:** `POST /api/session/generateV2`

---

## 📑 Índice

1. [Profile Onboarding - Estructura de `profileData`](#1-profile-onboarding---estructura-de-profiledata)
2. [Formulario Pre-Sesión - Parámetros de Autoregulación](#2-formulario-pre-sesión---parámetros-de-autoregulación)
3. [Respuesta del Endpoint - Estructura Completa](#3-respuesta-del-endpoint---estructura-completa)
4. [Ejemplos de Uso](#4-ejemplos-de-uso)
5. [Códigos de Error](#5-códigos-de-error)

---

## 1. Profile Onboarding - Estructura de `profileData`

### Campos Requeridos

El objeto `profileData` debe guardarse en Firestore con la siguiente estructura exacta:

```typescript
interface ProfileData {
  // === DATOS PERSONALES ===
  name: string;                    // Nombre del usuario
  age: number;                     // Edad en años (entero positivo)
  gender: Gender;                  // Ver opciones abajo
  heightCm: number;                // Altura en centímetros
  initialWeight: number;           // Peso inicial en kg
  
  // === EXPERIENCIA Y OBJETIVOS ===
  experienceLevel: ExperienceLevel; // Ver opciones abajo
  fitnessGoal: FitnessGoal;         // Ver opciones abajo
  focusArea: FocusArea;             // Ver opciones abajo
  
  // === CONFIGURACIÓN DE ENTRENAMIENTO ===
  trainingDaysPerWeek: number;      // 2-6 días
  sessionDuration: number;          // Minutos: 30, 45, 60, 75, 90
  preferredTrainingDays: DayOfWeek[]; // Array de días
  weeklyScheduleContext: DayContext[]; // Contexto de cada día
  
  // === EQUIPAMIENTO Y LIMITACIONES ===
  hasHomeEquipment: boolean;        // Tiene equipo en casa
  homeEquipment?: Equipment[];      // Si hasHomeEquipment es true
  injuriesOrLimitations: InjuryType; // Ver opciones abajo
  
  // === METADATOS ===
  dateCompleted: string;            // ISO timestamp
}
```

---

### ⚡ Opciones Exactas por Campo

#### `gender` - Género
```typescript
type Gender = 'Masculino' | 'Femenino' | 'Otro';
```
| Valor | Descripción |
|-------|-------------|
| `"Masculino"` | Usuario masculino |
| `"Femenino"` | Usuario femenino |
| `"Otro"` | Prefiere no especificar |

---

#### `experienceLevel` - Nivel de Experiencia
```typescript
type ExperienceLevel = 'Principiante' | 'Intermedio' | 'Avanzado';
```
| Valor | Criterio | Impacto en Algoritmo |
|-------|----------|----------------------|
| `"Principiante"` | 0-12 meses entrenando | Menos volumen, ejercicios más simples, tempo controlado |
| `"Intermedio"` | 1-3 años entrenando | Volumen y complejidad media |
| `"Avanzado"` | 3+ años entrenando | Mayor volumen, técnicas avanzadas, ejercicios complejos |

**⚠️ CRÍTICO:** Este campo afecta directamente la selección de ejercicios, volumen de series y complejidad técnica.

---

#### `fitnessGoal` - Objetivo de Entrenamiento
```typescript
type FitnessGoal = 'Fuerza' | 'Hipertrofia' | 'Resistencia' | 'Perdida_Grasa';
```
| Valor | Descripción | Impacto en Algoritmo |
|-------|-------------|----------------------|
| `"Fuerza"` | Maximizar fuerza máxima | Rangos bajos (3-6 reps), descansos largos (3-5 min) |
| `"Hipertrofia"` | Maximizar masa muscular | Rangos medios (6-12 reps), descansos medios (90-150s) |
| `"Resistencia"` | Mejorar resistencia muscular | Rangos altos (12-20 reps), descansos cortos (30-60s) |
| `"Perdida_Grasa"` | Pérdida de grasa | Circuitos, descansos cortos, mayor densidad |

---

#### `focusArea` - Área de Enfoque
```typescript
type FocusArea = 'General' | 'Tren_Superior' | 'Tren_Inferior' | 'Core';
```
| Valor | Descripción |
|-------|-------------|
| `"General"` | Entrenamiento balanceado de todo el cuerpo |
| `"Tren_Superior"` | Énfasis en pecho, espalda, hombros, brazos |
| `"Tren_Inferior"` | Énfasis en piernas y glúteos |
| `"Core"` | Énfasis adicional en trabajo de core |

---

#### `trainingDaysPerWeek` - Días de Entrenamiento por Semana
```typescript
type TrainingDays = 2 | 3 | 4 | 5 | 6;
```
| Valor | Split Generado |
|-------|----------------|
| `2` | Full Body |
| `3` | Full Body o Upper/Lower/Full |
| `4` | Upper/Lower |
| `5` | Push/Pull/Legs + Upper/Lower o Split por grupos |
| `6` | Push/Pull/Legs x2 |

---

#### `sessionDuration` - Duración de Sesión (minutos)
```typescript
type SessionDuration = 30 | 45 | 60 | 75 | 90;
```
| Valor | Descripción |
|-------|-------------|
| `30` | Sesión express - solo ejercicios principales |
| `45` | Sesión corta - principales + 1-2 accesorios |
| `60` | Sesión estándar - calentamiento completo + principales + accesorios |
| `75` | Sesión extendida - todo incluido + core |
| `90` | Sesión completa - máximo volumen y detalle |

---

#### `preferredTrainingDays` - Días Preferidos
```typescript
type DayOfWeek = 'Lunes' | 'Martes' | 'Miércoles' | 'Jueves' | 'Viernes' | 'Sábado' | 'Domingo';
```
**Formato:** Array con exactamente `trainingDaysPerWeek` elementos.

```json
// Ejemplo para 5 días:
["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]
```

---

#### `weeklyScheduleContext` - Contexto Semanal
```typescript
interface DayContext {
  day: DayOfWeek;
  canTrain: boolean;
  externalLoad: ExternalLoad;
}

type ExternalLoad = 'none' | 'light' | 'moderate' | 'heavy';
```

| `externalLoad` | Descripción | Impacto |
|----------------|-------------|---------|
| `"none"` | Sin carga externa | Entrenamiento normal |
| `"light"` | Carga ligera (caminata, yoga) | Sin ajustes |
| `"moderate"` | Carga moderada (deportes recreativos) | Reduce volumen 10-15% |
| `"heavy"` | Carga alta (partido, trabajo físico) | Reduce volumen 20-30%, reduce intensidad |

**Ejemplo completo:**
```json
[
  { "day": "Lunes", "canTrain": true, "externalLoad": "none" },
  { "day": "Martes", "canTrain": true, "externalLoad": "none" },
  { "day": "Miércoles", "canTrain": true, "externalLoad": "light" },
  { "day": "Jueves", "canTrain": true, "externalLoad": "none" },
  { "day": "Viernes", "canTrain": true, "externalLoad": "none" },
  { "day": "Sábado", "canTrain": false, "externalLoad": "moderate" },
  { "day": "Domingo", "canTrain": false, "externalLoad": "none" }
]
```

---

#### `injuriesOrLimitations` - Lesiones o Limitaciones
```typescript
type InjuryType = 
  | 'Ninguna'
  | 'Hombro'
  | 'Rodilla'
  | 'Espalda Baja'
  | 'Muñeca'
  | 'Cuello'
  | 'Cadera'
  | 'Tobillo'
  | 'Codo';
```

| Valor | Ejercicios Evitados/Modificados |
|-------|--------------------------------|
| `"Ninguna"` | Sin restricciones |
| `"Hombro"` | Evita press militar, modifica press y tracciones verticales |
| `"Rodilla"` | Modifica sentadillas profundas, lunges |
| `"Espalda Baja"` | Evita peso muerto convencional, modifica ejercicios de flexión |
| `"Muñeca"` | Modifica press con barra, flexiones |
| `"Cuello"` | Modifica ejercicios de tracción cervical |
| `"Cadera"` | Modifica sentadillas, peso muerto |
| `"Tobillo"` | Modifica ejercicios con dorsiflexión profunda |
| `"Codo"` | Modifica ejercicios de extensión de codo |

**⚠️ Para múltiples lesiones:** Guardar como string separado por comas: `"Hombro, Rodilla"`

---

#### `hasHomeEquipment` y `homeEquipment` - Equipamiento en Casa
```typescript
type Equipment = 
  | 'mancuernas'
  | 'barra_olimpica'
  | 'kettlebell'
  | 'bandas_elasticas'
  | 'banco_ajustable'
  | 'rack_sentadillas'
  | 'polea'
  | 'barra_dominadas'
  | 'step_plataforma'
  | 'pelota_suiza'
  | 'rueda_abdominal'
  | 'TRX';
```

**Ejemplo:**
```json
{
  "hasHomeEquipment": true,
  "homeEquipment": ["mancuernas", "bandas_elasticas", "barra_dominadas"]
}
```

---

### 📝 Ejemplo Completo de `profileData`

```json
{
  "name": "Juan Pérez",
  "age": 28,
  "gender": "Masculino",
  "heightCm": 178,
  "initialWeight": 82,
  "experienceLevel": "Intermedio",
  "fitnessGoal": "Hipertrofia",
  "focusArea": "General",
  "trainingDaysPerWeek": 4,
  "sessionDuration": 60,
  "preferredTrainingDays": ["Lunes", "Martes", "Jueves", "Viernes"],
  "weeklyScheduleContext": [
    { "day": "Lunes", "canTrain": true, "externalLoad": "none" },
    { "day": "Martes", "canTrain": true, "externalLoad": "none" },
    { "day": "Miércoles", "canTrain": false, "externalLoad": "none" },
    { "day": "Jueves", "canTrain": true, "externalLoad": "none" },
    { "day": "Viernes", "canTrain": true, "externalLoad": "none" },
    { "day": "Sábado", "canTrain": false, "externalLoad": "light" },
    { "day": "Domingo", "canTrain": false, "externalLoad": "none" }
  ],
  "hasHomeEquipment": true,
  "homeEquipment": ["mancuernas", "bandas_elasticas"],
  "injuriesOrLimitations": "Ninguna",
  "dateCompleted": "2026-01-13T18:16:08.161Z"
}
```

---

## 2. Formulario Pre-Sesión - Parámetros de Autoregulación

### Endpoint

```
POST /api/session/generateV2
```

### Request Body

```typescript
interface GenerateSessionRequest {
  // === REQUERIDO ===
  userId: string;                  // ID del usuario en Firebase
  
  // === AUTOREGULACIÓN (Recomendados) ===
  energyLevel: EnergyLevel;        // Nivel de energía percibido
  sorenessLevel: SorenessLevel;    // Nivel de dolor muscular (DOMS)
  sleepQuality: SleepQuality;      // Calidad del sueño
  stressLevel: StressLevel;        // Nivel de estrés
  
  // === CONTEXTO DE SESIÓN (Opcionales) ===
  location?: Location;             // Ubicación del entrenamiento
  availableTime?: number;          // Tiempo disponible en minutos
  microcycleIndex?: number;        // Índice del microciclo (0-3)
  sessionIndex?: number;           // Índice de la sesión en el microciclo
  equipmentOverride?: string[];    // Override manual de equipamiento
  
  // === CONFIGURACIÓN ===
  saveToFirestore?: boolean;       // Guardar sesión generada (default: true)
}
```

---

### ⚡ Variables de Autoregulación (CRÍTICAS)

#### `energyLevel` - Nivel de Energía
```typescript
type EnergyLevel = 1 | 2 | 3 | 4 | 5;
```

| Valor | Etiqueta UI | Descripción | Impacto en Sesión |
|-------|-------------|-------------|-------------------|
| `1` | 😴 Agotado | Sin energía, muy cansado | **Volumen -60%**, RPE -3, Sesión de recuperación activa |
| `2` | 😓 Bajo | Cansado, poca motivación | **Volumen -40%**, RPE -2, Sesión técnica reducida |
| `3` | 😐 Normal | Energía normal | Sin ajustes, sesión estándar |
| `4` | 😊 Bueno | Buena energía, motivado | Volumen +10%, permite intensidad extra |
| `5` | 🔥 Óptimo | Excelente, listo para rendir | Volumen +20%, RPE +1, modo peak performance |

**UI Recomendada:** Slider con emojis o escala visual de 5 puntos con colores (rojo → verde)

---

#### `sorenessLevel` - Nivel de Dolor Muscular (DOMS)
```typescript
type SorenessLevel = 1 | 2 | 3 | 4 | 5;
```

| Valor | Etiqueta UI | Descripción | Impacto en Sesión |
|-------|-------------|-------------|-------------------|
| `1` | ✅ Sin dolor | Músculos recuperados | Sin ajustes |
| `2` | 🟢 Leve | Ligera tensión muscular | Sin ajustes significativos |
| `3` | 🟡 Moderado | DOMS perceptible pero manejable | Puede evitar músculos afectados |
| `4` | 🟠 Alto | Dolor que limita movimiento | **Volumen -30%**, evita músculos afectados |
| `5` | 🔴 Severo | Dolor intenso | **Volumen -50%**, sesión metabólica o recuperación |

**UI Recomendada:** 
- Slider 1-5
- Opcional: Selector de zona de dolor (mapa corporal)

---

#### `sleepQuality` - Calidad del Sueño
```typescript
type SleepQuality = 1 | 2 | 3 | 4 | 5;
```

| Valor | Etiqueta UI | Descripción |
|-------|-------------|-------------|
| `1` | 😵 Muy mal | < 4 horas o muy fragmentado |
| `2` | 😞 Mal | 4-5 horas o mala calidad |
| `3` | 😐 Normal | 6-7 horas, calidad aceptable |
| `4` | 😊 Bien | 7-8 horas, buena calidad |
| `5` | 😴💤 Excelente | 8+ horas, sueño profundo reparador |

**Nota:** Este factor influye en la recuperación del SNC y se combina con energyLevel.

---

#### `stressLevel` - Nivel de Estrés
```typescript
type StressLevel = 1 | 2 | 3 | 4 | 5;
```

| Valor | Etiqueta UI | Descripción |
|-------|-------------|-------------|
| `1` | 🧘 Muy relajado | Sin estrés, muy tranquilo |
| `2` | 😌 Relajado | Bajo estrés |
| `3` | 😐 Normal | Estrés cotidiano manejable |
| `4` | 😰 Estresado | Estrés alto (trabajo, personal) |
| `5` | 🤯 Muy estresado | Estrés extremo, abrumado |

**Impacto:** Niveles 4-5 reducen la capacidad de recuperación y aumentan RIR para proteger al atleta.

---

#### `location` - Ubicación del Entrenamiento
```typescript
type Location = 'gym' | 'home' | 'outdoor';
```

| Valor | Descripción | Impacto |
|-------|-------------|---------|
| `"gym"` | Gimnasio con equipo completo | Acceso a todos los ejercicios |
| `"home"` | Casa (usa `homeEquipment` del perfil) | Filtra ejercicios según equipo disponible |
| `"outdoor"` | Exterior (parque, etc.) | Solo ejercicios con peso corporal y bandas |

**Default:** `"gym"` si no se especifica

---

### 📱 Ejemplo de UI del Formulario Pre-Sesión

```
┌─────────────────────────────────────────────┐
│         ¿Cómo te sientes hoy?               │
├─────────────────────────────────────────────┤
│                                             │
│  💪 Nivel de Energía                        │
│  ┌───┬───┬───┬───┬───┐                     │
│  │ 1 │ 2 │ 3 │ 4 │ 5 │                     │
│  │ 😴│ 😓│ 😐│ 😊│ 🔥│                     │
│  └───┴───┴───┴───┴───┘                     │
│                                             │
│  🦵 Dolor Muscular                          │
│  ┌───┬───┬───┬───┬───┐                     │
│  │ 1 │ 2 │ 3 │ 4 │ 5 │                     │
│  │ ✅│ 🟢│ 🟡│ 🟠│ 🔴│                     │
│  └───┴───┴───┴───┴───┘                     │
│                                             │
│  😴 Calidad del Sueño                       │
│  ┌───┬───┬───┬───┬───┐                     │
│  │ 1 │ 2 │ 3 │ 4 │ 5 │                     │
│  │ 😵│ 😞│ 😐│ 😊│ 💤│                     │
│  └───┴───┴───┴───┴───┘                     │
│                                             │
│  🧠 Nivel de Estrés                         │
│  ┌───┬───┬───┬───┬───┐                     │
│  │ 1 │ 2 │ 3 │ 4 │ 5 │                     │
│  │ 🧘│ 😌│ 😐│ 😰│ 🤯│                     │
│  └───┴───┴───┴───┴───┘                     │
│                                             │
│  📍 ¿Dónde entrenas hoy?                    │
│  ┌─────────┬─────────┬─────────┐           │
│  │  🏋️ Gym │ 🏠 Casa │ 🌳 Aire │           │
│  └─────────┴─────────┴─────────┘           │
│                                             │
│        [ GENERAR SESIÓN ]                   │
│                                             │
└─────────────────────────────────────────────┘
```

---

### 📤 Ejemplo de Request

```json
{
  "userId": "MztPgfyiDp4QpPmD29yAMWgpaKkY",
  "energyLevel": 4,
  "sorenessLevel": 2,
  "sleepQuality": 4,
  "stressLevel": 2,
  "location": "gym"
}
```

**Request mínimo (usa defaults):**
```json
{
  "userId": "MztPgfyiDp4QpPmD29yAMWgpaKkY"
}
```
*Nota: Si no se envían los valores de readiness, se asumen valores neutros (3).*

---

## 3. Respuesta del Endpoint - Estructura Completa

### Response Exitosa (200)

```typescript
interface GenerateSessionResponse {
  success: true;
  session: GeneratedSession;
}

interface GeneratedSession {
  // === METADATOS ===
  id: string;                      // ID único de la sesión generada
  generatedAt: string;             // Timestamp ISO de generación
  generationTimeMs: number;        // Tiempo de generación en ms
  version: string;                 // Versión del algoritmo ("2.0.0")
  
  // === CONTEXTO ===
  userId: string;
  mesocycleId: string;
  microcycleIndex: number;         // 0-3 (semana del mesociclo)
  sessionIndex: number;            // Índice de sesión en la semana
  
  // === INFORMACIÓN DE SESIÓN ===
  sessionFocus: string;            // Ej: "Pecho/Espalda", "Pierna", "Full Body"
  dayOfWeek: string;               // Ej: "Lunes"
  phase: string;                   // Fase del mesociclo
  weekNumber: number;              // Número de semana
  
  // === PARÁMETROS DE ENTRENAMIENTO ===
  trainingParameters: TrainingParameters;
  
  // === BLOQUES DE ENTRENAMIENTO ===
  warmup: WarmupBlock;             // Calentamiento RAMP
  mainBlock: MainBlock;            // Bloque principal
  coreBlock: CoreBlock | null;     // Bloque de core (puede ser null)
  cooldown: CooldownBlock;         // Enfriamiento
  
  // === CONTENIDO EDUCATIVO ===
  education: EducationContent;
  tipOfTheDay: string;
  
  // === RESUMEN ===
  summary: SessionSummary;
}
```

---

### Estructuras Detalladas

#### `TrainingParameters`
```typescript
interface TrainingParameters {
  rpeTarget: number;               // RPE objetivo ajustado (1-10)
  rirTarget: number;               // RIR objetivo ajustado
  volumeConfig: {
    setsPerMuscleGroup: { min: number; max: number };
    setsPerExercise: { compound: number; isolation: number };
    totalExercises: { min: number; max: number };
    repsRange: { strength: string; hypertrophy: string; endurance: string };
  };
  restProtocol: {
    compound: { min: number; max: number };
    isolation: { min: number; max: number };
    betweenExercises: number;
  };
  ambiente: 'gym' | 'home_equipped' | 'home_minimal' | 'bodyweight';
  readinessCategory: 'suboptimal' | 'reduced' | 'normal' | 'enhanced' | 'optimal';
  adjustmentsApplied: string[];    // Lista de ajustes aplicados
}
```

---

#### `WarmupBlock` (Calentamiento RAMP)
```typescript
interface WarmupBlock {
  tipo: 'warmup';
  nombre: string;
  duracionEstimada: number;        // minutos
  fases: RAMPPhase[];
}

interface RAMPPhase {
  fase: 'Raise' | 'Activate' | 'Mobilize' | 'Potentiate' | 'Prehab';
  duracion: string;                // Ej: "2-3 min"
  descripcion: string;
  ejercicios: WarmupExercise[];
}

interface WarmupExercise {
  id: string;
  nombre: string;
  duracion?: string;               // Para ejercicios por tiempo
  reps?: number;                   // Para ejercicios por repeticiones
  instrucciones: string;
  imagenUrl?: string;
}
```

---

#### `MainBlock` (Bloque Principal)
```typescript
interface MainBlock {
  tipo: 'main_block';
  nombre: string;
  duracionEstimada: number;
  estructura: 'estaciones' | 'superseries' | 'circuito';
  estaciones: Station[];
}

interface Station {
  numero: number;
  tipo: 'simple' | 'superset' | 'triset';
  ejercicios: MainExercise[];
}

interface MainExercise {
  id: string;
  nombre: string;
  parteCuerpo: string;
  patronMovimiento: string;
  equipo: string[];
  imagenUrl?: string;
  videoUrl?: string;
  
  prescripcion: ExercisePrescription;
  notas?: string;
}

interface ExercisePrescription {
  series: number;
  reps: number | string;           // número o rango "8-10"
  peso?: string;                   // "70kg" o "RPE 8" o "Peso corporal"
  rpeObjetivo: number;
  rirObjetivo: number;
  descanso: number;                // segundos
  tempo?: string;                  // Ej: "3-1-2-1"
  tecnicaEspecial?: string;        // Ej: "Rest-Pause", "Drop Set"
  notaUnilateral?: string;         // "Por lado" si aplica
}
```

---

#### `CoreBlock` (Bloque de Core)
```typescript
interface CoreBlock {
  tipo: 'core';
  nombre: string;
  duracionEstimada: number;
  estructura: 'secuencial' | 'circuito';
  instrucciones: string;
  rondas?: number;                 // Si es circuito
  ejercicios: CoreExercise[];
}

interface CoreExercise {
  id: string;
  nombre: string;
  prescripcion: {
    series: number;
    reps?: number;
    tiempo?: string;               // Para isométricos
    repsOTiempo: string;           // Display: "30 segundos" o "12 reps"
    descanso: number;
    rpeObjetivo: number;
    notaUnilateral?: string;
    tipo: 'isometrico' | 'dinamico';
  };
  notas: string;
  imagenUrl?: string;
}
```

---

#### `CooldownBlock` (Enfriamiento)
```typescript
interface CooldownBlock {
  tipo: 'cooldown';
  nombre: string;
  duracionEstimada: number;
  fases: CooldownPhase[];
}

interface CooldownPhase {
  fase: string;
  duracion: number;                // minutos
  icono: string;
  descripcion: string;
  contenido: {
    tipo: string;
    ejercicios?: StretchExercise[];
    opciones?: string[];
    instrucciones?: string;
    // Para respiración:
    nombre?: string;
    duracion?: number;
    beneficio?: string;
  };
}

interface StretchExercise {
  id: string;
  nombre: string;
  tiempo: string;
  musculoObjetivo?: string;
  instrucciones: string;
  imagenUrl?: string;
}
```

---

#### `EducationContent`
```typescript
interface EducationContent {
  resumenFisiologico: string;      // Explicación de la fase actual
  objetivoDelDia: string;          // Objetivo específico con RPE/RIR
  consejoTecnico: string;          // Consejos de autoregulación
  fasesExplicadas: PhaseExplanation[];
  cienciaDestacada: {
    titulo: string;
    contenido: string;
    fuente: string;
  };
  motivacion: string;              // Mensaje motivacional
  proximoEntrenamiento: {
    titulo: string;
    consejos: RecoveryTip[];
  };
}

interface PhaseExplanation {
  fase: string;
  icono: string;
  explicacion: string;
  ciencia: string;
}

interface RecoveryTip {
  icono: string;
  consejo: string;
  detalle: string;
}
```

---

#### `SessionSummary`
```typescript
interface SessionSummary {
  duracionEstimada: string;        // Ej: "52 min"
  duracionMinutos: number;         // Ej: 52
  ejerciciosTotales: number;
  seriesTotales: number;
  musculosTrabajos: string[];      // Ej: ["Pecho", "Espalda", "Core"]
}
```

---

### 📦 Ejemplo de Response Completa

```json
{
  "success": true,
  "session": {
    "id": "m1abc123xyz",
    "generatedAt": "2026-01-13T20:30:00.000Z",
    "generationTimeMs": 245,
    "version": "2.0.0",
    
    "userId": "MztPgfyiDp4QpPmD29yAMWgpaKkY",
    "mesocycleId": "current",
    "microcycleIndex": 0,
    "sessionIndex": 0,
    
    "sessionFocus": "Pecho/Espalda",
    "dayOfWeek": "Lunes",
    "phase": "Adaptación/Cargas Introductorias",
    "weekNumber": 1,
    
    "trainingParameters": {
      "rpeTarget": 6,
      "rirTarget": 4,
      "ambiente": "gym",
      "readinessCategory": "enhanced",
      "adjustmentsApplied": []
    },
    
    "warmup": {
      "tipo": "warmup",
      "nombre": "Calentamiento RAMP",
      "duracionEstimada": 10,
      "fases": [
        {
          "fase": "Raise",
          "duracion": "3 min",
          "descripcion": "Elevar temperatura corporal",
          "ejercicios": [
            {
              "id": "jumping_jacks",
              "nombre": "Jumping Jacks",
              "duracion": "60s",
              "instrucciones": "Ritmo moderado, constante"
            }
          ]
        }
        // ... más fases
      ]
    },
    
    "mainBlock": {
      "tipo": "main_block",
      "nombre": "Bloque Principal - Pecho/Espalda",
      "duracionEstimada": 35,
      "estructura": "estaciones",
      "estaciones": [
        {
          "numero": 1,
          "tipo": "simple",
          "ejercicios": [
            {
              "id": "bench_press",
              "nombre": "Press de Banca",
              "parteCuerpo": "Pecho",
              "patronMovimiento": "Empuje_H",
              "equipo": ["Barra", "Banco"],
              "imagenUrl": "https://...",
              "prescripcion": {
                "series": 4,
                "reps": "6-8",
                "rpeObjetivo": 6,
                "rirObjetivo": 4,
                "descanso": 150,
                "tempo": "2-0-1-0"
              },
              "notas": "Mantén escápulas retraídas"
            }
          ]
        }
        // ... más estaciones
      ]
    },
    
    "coreBlock": null,
    
    "cooldown": {
      "tipo": "cooldown",
      "nombre": "Enfriamiento y Recuperación",
      "duracionEstimada": 8,
      "fases": [
        {
          "fase": "Estiramientos Específicos",
          "duracion": 4,
          "icono": "🧘",
          "descripcion": "Estiramientos para pecho y espalda",
          "contenido": {
            "tipo": "estiramientos",
            "ejercicios": [
              {
                "nombre": "Estiramiento de Pectoral en Pared",
                "tiempo": "30s",
                "instrucciones": "Mantén posición sin forzar"
              }
            ]
          }
        }
      ]
    },
    
    "education": {
      "resumenFisiologico": "📊 **Hoy tu sesión se enfoca en Pecho/Espalda**...",
      "objetivoDelDia": "🎯 **Tu objetivo de hoy**: Terminar cada serie sintiendo que podrías hacer aproximadamente **4 repeticiones más** (RIR 4)...",
      "consejoTecnico": "✅ Tu estado de readiness es óptimo. Entrena con confianza siguiendo la prescripción.",
      "fasesExplicadas": [],
      "cienciaDestacada": {
        "titulo": "📚 Ciencia del día: Sobrecarga Progresiva",
        "contenido": "Tu cuerpo se adapta al estrés que le impones...",
        "fuente": "Principio fundamental de Selye (1956)"
      },
      "motivacion": "⚡ **Estado óptimo detectado**: Tu cuerpo está listo para rendir al máximo...",
      "proximoEntrenamiento": {
        "titulo": "🔄 Preparación para tu próximo entrenamiento",
        "consejos": [
          {
            "icono": "💧",
            "consejo": "Rehidratación",
            "detalle": "Bebe 500ml de agua en la próxima hora."
          }
        ]
      }
    },
    
    "tipOfTheDay": "💡 **Tip del día**: Enfócate en la técnica antes que en el peso...",
    
    "summary": {
      "duracionEstimada": "52 min",
      "duracionMinutos": 52,
      "ejerciciosTotales": 6,
      "seriesTotales": 20,
      "musculosTrabajos": ["Pecho", "Espalda"]
    }
  }
}
```

---

## 4. Ejemplos de Uso

### Ejemplo 1: Usuario con energía normal en gimnasio
```javascript
const response = await fetch('/api/session/generateV2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',
    energyLevel: 3,
    sorenessLevel: 2,
    sleepQuality: 4,
    stressLevel: 3,
    location: 'gym'
  })
});
```

### Ejemplo 2: Usuario cansado entrenando en casa
```javascript
const response = await fetch('/api/session/generateV2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',
    energyLevel: 2,       // Cansado → volumen reducido automáticamente
    sorenessLevel: 4,     // DOMS alto → evita músculos afectados
    sleepQuality: 2,
    stressLevel: 4,
    location: 'home'      // Usa equipo del perfil del usuario
  })
});
```

### Ejemplo 3: Sesión específica del mesociclo
```javascript
const response = await fetch('/api/session/generateV2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',
    energyLevel: 4,
    sorenessLevel: 1,
    sleepQuality: 5,
    stressLevel: 2,
    location: 'gym',
    microcycleIndex: 2,   // Semana 3 (intensificación)
    sessionIndex: 0       // Primera sesión de la semana
  })
});
```

---

## 5. Códigos de Error

| Código | `code` | Descripción | Solución |
|--------|--------|-------------|----------|
| 400 | `MISSING_USER_ID` | No se envió userId | Incluir userId en el body |
| 400 | `NO_ACTIVE_MESOCYCLE` | Usuario sin mesociclo activo | Generar mesociclo primero |
| 400 | `SESSION_NOT_FOUND` | No se encontró la sesión solicitada | Verificar índices |
| 404 | `CONTEXT_ERROR` | Error obteniendo datos del usuario | Verificar que el usuario existe |
| 405 | N/A | Método HTTP incorrecto | Usar POST |
| 500 | `INTERNAL_ERROR` | Error interno del servidor | Revisar logs del backend |

### Ejemplo de Error Response
```json
{
  "error": "No hay mesociclo activo. Genera uno primero.",
  "code": "NO_ACTIVE_MESOCYCLE"
}
```

---

## 📌 Checklist de Implementación Frontend

### Profile Onboarding
- [ ] `experienceLevel` con exactamente 3 opciones: `Principiante`, `Intermedio`, `Avanzado`
- [ ] `fitnessGoal` con exactamente 4 opciones: `Fuerza`, `Hipertrofia`, `Resistencia`, `Perdida_Grasa`
- [ ] `gender` con exactamente 3 opciones: `Masculino`, `Femenino`, `Otro`
- [ ] `injuriesOrLimitations` con las opciones exactas listadas
- [ ] `weeklyScheduleContext` con `externalLoad` usando: `none`, `light`, `moderate`, `heavy`
- [ ] `sessionDuration` con valores: `30`, `45`, `60`, `75`, `90`

### Formulario Pre-Sesión
- [ ] Sliders/selectores de 1-5 para: `energyLevel`, `sorenessLevel`, `sleepQuality`, `stressLevel`
- [ ] Selector de ubicación: `gym`, `home`, `outdoor`
- [ ] Enviar todos los campos de readiness (no dejar undefined)

### Manejo de Respuesta
- [ ] Parsear correctamente la estructura de `warmup`, `mainBlock`, `coreBlock`, `cooldown`
- [ ] Mostrar contenido educativo (`education`)
- [ ] Manejar `coreBlock` como posible `null`
- [ ] Usar `summary` para mostrar estadísticas rápidas

---

> **Contacto Backend:** Para dudas técnicas sobre la integración, revisar los archivos en `/lib/sessionGeneration/` para ver la lógica exacta de cada módulo.
