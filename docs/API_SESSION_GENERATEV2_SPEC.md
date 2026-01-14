# API Specification: POST /api/session/generateV2

## Descripción General

Este endpoint genera una sesión de entrenamiento personalizada basada en el mesociclo activo del usuario, su nivel de readiness (formulario pre-sesión), y el equipamiento disponible.

**IMPORTANTE:** A partir de esta versión, el equipamiento disponible se recibe **exclusivamente** desde el formulario pre-sesión (frontend), ya no se utiliza el equipamiento almacenado en el documento del usuario.

---

## Request

### Headers

```
Content-Type: application/json
```

### Body (JSON)

```typescript
interface GenerateSessionRequest {
  // ===== REQUERIDOS =====
  
  /** ID del usuario en Firebase */
  userId: string;
  
  /** Ubicación de entrenamiento */
  location: 'gym' | 'home';
  
  /** 
   * Array de equipamiento disponible para esta sesión
   * Este array viene del formulario pre-sesión
   * 
   * Para GYM: El backend agregará automáticamente el equipo estándar de gimnasio.
   *           Se excluirán: bandas de resistencia, mini loop bands, kettlebells, foam roller
   *           
   * Para HOME: Se usará EXACTAMENTE lo que envíe el frontend + peso corporal (siempre incluido)
   */
  availableEquipment: string[];
  
  // ===== OPCIONALES - Formulario Pre-Sesión =====
  
  /** Nivel de energía (1-5, default: 3) */
  energyLevel?: number;
  
  /** Nivel de dolor muscular DOMS (1-5, default: 2) */
  sorenessLevel?: number;
  
  /** Calidad de sueño (1-5, default: 3) */
  sleepQuality?: number;
  
  /** Nivel de estrés (1-5, default: 3) */
  stressLevel?: number;
  
  /** Tiempo disponible en minutos */
  availableTime?: number;
  
  // ===== OPCIONALES - Control de Sesión =====
  
  /** Índice del microciclo (0-based). Si no se envía, se calcula automáticamente */
  microcycleIndex?: number;
  
  /** Índice de la sesión dentro del microciclo (0-based). Si no se envía, se calcula por día */
  sessionIndex?: number;
  
  /** Si es false, no guarda en Firestore (default: true) */
  saveToFirestore?: boolean;
  
  // ===== PESOS ESPECÍFICOS (Solo para HOME) =====
  
  /**
   * Pesos específicos disponibles en casa
   * Solo se usa cuando location === 'home'
   * Permite al sistema adaptar las cargas exactamente a los pesos disponibles
   */
  homeWeights?: {
    /** Array de pesos de mancuernas disponibles en kg (ej: [5, 10, 15, 20]) */
    dumbbells?: number[];
    
    /** Peso total de barra + discos disponibles en kg (ej: 40) */
    barbell?: number;
    
    /** Array de pesos de kettlebells disponibles en kg (ej: [8, 12, 16]) */
    kettlebells?: number[];
  };
}
```

---

## Ejemplos de Request

### Ejemplo 1: Entrenamiento en Gimnasio

```json
{
  "userId": "abc123",
  "location": "gym",
  "availableEquipment": [],
  "energyLevel": 4,
  "sorenessLevel": 2,
  "sleepQuality": 4,
  "stressLevel": 2
}
```

**Nota:** En gimnasio, `availableEquipment` puede estar vacío o contener equipamiento adicional. El backend agregará automáticamente: Mancuernas, Barra Olímpica, Poleas, Máquinas, Banco Ajustable, Rack de Potencia, Barra de Dominadas.

### Ejemplo 2: Entrenamiento en Casa - Solo Peso Corporal

```json
{
  "userId": "abc123",
  "location": "home",
  "availableEquipment": ["Peso Corporal"],
  "energyLevel": 3,
  "sorenessLevel": 3
}
```

### Ejemplo 3: Entrenamiento en Casa - Con Equipo

```json
{
  "userId": "abc123",
  "location": "home",
  "availableEquipment": [
    "Mancuernas",
    "Barra de Dominadas",
    "Bandas de Resistencia"
  ],
  "homeWeights": {
    "dumbbells": [5, 10, 15, 20]
  },
  "energyLevel": 4,
  "sorenessLevel": 1,
  "sleepQuality": 5
}
```

### Ejemplo 4: Entrenamiento en Casa - Con Barra y Mancuernas

```json
{
  "userId": "abc123",
  "location": "home",
  "availableEquipment": [
    "Mancuernas",
    "Barra Olímpica",
    "Banco Ajustable"
  ],
  "homeWeights": {
    "dumbbells": [5, 10, 15, 20, 25],
    "barbell": 60
  },
  "energyLevel": 5,
  "sorenessLevel": 1
}
```

---

## Valores Posibles para `availableEquipment`

El sistema reconoce los siguientes valores (case-insensitive):

### Equipo de Carga Principal
- `"Mancuernas"` / `"Mancuerna"` / `"Dumbbell"`
- `"Barra Olímpica"` / `"Barra"` / `"Barbell"`
- `"Kettlebell"` / `"Pesa Rusa"`

### Equipo de Tracción
- `"Barra de Dominadas"` / `"Pull Up Bar"` / `"Barra de Puerta"`
- `"TRX"` / `"Suspension Straps"`
- `"Poleas"` / `"Cable Machine"`

### Resistencia Variable
- `"Bandas de Resistencia"` / `"Resistance Bands"` / `"Ligas"`
- `"Mini Loop Bands"` / `"Mini Bands"` / `"Hip Circle"`

### Estabilidad
- `"Banco Ajustable"` / `"Banco"` / `"Bench"`
- `"Rack de Potencia"` / `"Power Rack"` / `"Squat Rack"`

### Recuperación
- `"Foam Roller"` / `"Rodillo"`

### Sin Equipo
- `"Peso Corporal"` / `"Bodyweight"` / `"Sin Equipo"`

---

## Lógica de Filtrado de Equipamiento

### En Gimnasio (`location: 'gym'`)

1. Se agrega automáticamente el equipo estándar de gimnasio
2. Se **excluyen** del catálogo de ejercicios los que requieren:
   - Bandas de resistencia
   - Mini loop bands / Hip circle
   - Kettlebells
   - Foam roller
3. El peso corporal siempre está incluido

### En Casa (`location: 'home'`)

1. Se usa **exactamente** el equipo que envía el frontend
2. El peso corporal se agrega automáticamente si no está incluido
3. Solo se muestran ejercicios que el usuario puede realizar con su equipo
4. Si se envía `homeWeights`, las cargas se ajustan a esos pesos específicos

---

## Response

### Success (200)

```typescript
interface GenerateSessionResponse {
  success: true;
  session: {
    // Metadatos
    id: string;
    generatedAt: string; // ISO 8601
    generationTimeMs: number;
    version: string;
    
    // Contexto
    userId: string;
    mesocycleId: string;
    microcycleIndex: number;
    sessionIndex: number;
    
    // Información de la sesión
    sessionFocus: string;
    dayOfWeek: string;
    phase: string;
    weekNumber: number;
    
    // Parámetros de entrenamiento
    trainingParameters: {
      rpeTarget: number;
      rirTarget: number;
      volumeConfig: object;
      restProtocol: object;
      ambiente: string;
      readinessCategory: string;
      adjustmentsApplied: string[];
    };
    
    // Bloques de entrenamiento
    warmup: WarmupBlock;
    mainBlock: MainBlock;
    coreBlock: CoreBlock | null;
    cooldown: CooldownBlock;
    
    // Contenido educativo
    education: EducationContent;
    tipOfTheDay: string;
    
    // Resumen
    summary: {
      duracionEstimada: string;
      duracionMinutos: number;
      ejerciciosTotales: number;
      seriesTotales: number;
      musculosTrabajados: string[];
    };
  };
}
```

### Errores Comunes

#### 400 - Bad Request

```json
{
  "error": "userId es requerido",
  "code": "MISSING_USER_ID"
}
```

```json
{
  "error": "location es requerido y debe ser \"gym\" o \"home\"",
  "code": "INVALID_LOCATION"
}
```

```json
{
  "error": "availableEquipment es requerido y debe ser un array",
  "code": "MISSING_EQUIPMENT"
}
```

```json
{
  "error": "No hay mesociclo activo. Genera uno primero.",
  "code": "NO_ACTIVE_MESOCYCLE"
}
```

#### 404 - Not Found

```json
{
  "error": "USER_NOT_FOUND: Usuario con ID xxx no encontrado",
  "code": "CONTEXT_ERROR"
}
```

#### 500 - Internal Server Error

```json
{
  "error": "Error interno generando la sesión",
  "details": "...",
  "code": "INTERNAL_ERROR"
}
```

---

## Flujo del Frontend Recomendado

### Paso 1: Formulario Pre-Sesión

Mostrar al usuario un formulario que capture:

1. **Ubicación**: ¿Gym o Casa?
2. **Equipamiento disponible** (si es casa): Checkboxes con opciones
3. **Pesos específicos** (opcional, si tiene mancuernas/barra en casa)
4. **Nivel de energía** (slider 1-5)
5. **Dolor muscular** (slider 1-5)
6. **Calidad de sueño** (slider 1-5)
7. **Nivel de estrés** (slider 1-5)

### Paso 2: Construir el Request

```typescript
const request = {
  userId: currentUser.uid,
  location: formData.location,
  availableEquipment: formData.selectedEquipment,
  energyLevel: formData.energy,
  sorenessLevel: formData.soreness,
  sleepQuality: formData.sleep,
  stressLevel: formData.stress,
  // Solo si es home y tiene equipo con peso
  ...(formData.location === 'home' && formData.hasWeights && {
    homeWeights: {
      dumbbells: formData.dumbbellWeights,
      barbell: formData.barbellWeight
    }
  })
};
```

### Paso 3: Enviar Request

```typescript
const response = await fetch('/api/session/generateV2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(request)
});

const data = await response.json();

if (data.success) {
  // La sesión se guarda automáticamente en currentSession del usuario
  // El frontend puede usar onSnapshot para detectar cambios
  navigateToSession(data.session);
}
```

---

## Notas Importantes

1. **Peso Corporal Siempre Incluido**: No es necesario enviar "Peso Corporal" en el array, se agrega automáticamente.

2. **Gimnasio Simplificado**: Si `location: 'gym'`, el array `availableEquipment` puede estar vacío. El backend asume acceso completo al equipo estándar.

3. **Pesos Específicos Opcionales**: `homeWeights` es opcional. Si no se envía, el sistema usará el sistema anterior de detección automática o mostrará "Ajustar a RPE".

4. **Sesión Guardada Automáticamente**: Por defecto, la sesión se guarda en `users/{userId}/currentSession` y en la subcolección `generatedSessions`.

5. **Detección Automática de Sesión**: Si no se envían `microcycleIndex` y `sessionIndex`, el sistema determina la sesión del día actual basándose en el mesociclo activo.
