# FitGen API — Integración Frontend (v3.0)

Contrato alineado con `domain/` + handlers en `api/` (post-reinicio DDS v1.0).

**Base URL:** `VITE_BACKEND_URL` o `http://localhost:3000`  
**Auth:** `Authorization: Bearer <Firebase ID Token>` en todos los endpoints excepto registro Firebase.

---

## Flujo recomendado

1. Firebase Auth → registro/login
2. `POST /api/profile/save` → perfil + **auto-aprobación** (`status: approved`, `plan: free`)
3. `POST /api/mesocycle/generate` → primer mesociclo
4. Por cada día de entreno: `POST /api/session/generateV2` (readiness) → entrenar → `POST /api/session/complete`
5. Al terminar mesociclo: `POST /api/mesocycle/evaluate` → siguiente ciclo

---

## POST `/api/profile/save`

**Auth:** opcional Bearer (si hay token, `userId` se toma del token).

### Request

```json
{
  "userId": "firebase-uid",
  "userEmail": "user@example.com",
  "action": "initial_onboarding",
  "profileData": {
    "name": "Ana",
    "age": 28,
    "gender": "Femenino",
    "heightCm": 165,
    "initialWeight": 62,
    "trainingAgeMonths": 18,
    "fitnessGoal": "Hipertrofia",
    "focusArea": "General",
    "injuriesOrLimitations": ["Hombro"],
    "trainingDaysPerWeek": 4,
    "preferredTrainingDays": ["Lunes", "Miércoles", "Viernes", "Sábado"],
    "weeklyScheduleContext": [
      { "day": "Lunes", "canTrain": true, "externalLoad": "none" },
      { "day": "Martes", "canTrain": false, "externalLoad": "none" }
    ],
    "timezone": "America/Mexico_City"
  }
}
```

**Notas:**
- Objetivos válidos: `Hipertrofia` | `Fuerza`
- `experienceLevel` se **calcula** en backend desde `trainingAgeMonths`
- Lesiones UI `Espalda Baja` → backend `Espalda_Baja`
- `externalLoad` frontend: `none|light|moderate|heavy` → backend `ninguna|ligera|moderada|alta`

### Response `200`

```json
{
  "success": true,
  "status": "approved",
  "experienceLevel": "Intermedio",
  "message": "Perfil guardado. Acceso beta activado."
}
```

---

## POST `/api/mesocycle/generate`

**Auth:** requerida.

### Request

```json
{
  "referenceDate": "2026-07-07T12:00:00.000Z"
}
```

### Response `200`

```json
{
  "success": true,
  "plan": { "mesocycleId": "...", "durationWeeks": 5, "split": "...", "volumeLandmarks": {} },
  "mesocycle": { }
}
```

---

## POST `/api/session/generateV2`

**Auth:** requerida.

### Request

```json
{
  "energyLevel": 3,
  "sorenessLevel": 2,
  "sleepQuality": 3,
  "stressLevel": 3,
  "externalFatigue": "none",
  "availableTime": 75,
  "referenceDate": "2026-07-07T12:00:00.000Z"
}
```

Escalas 1–5. `externalFatigue`: `none|low|moderate|high|extreme`.

### Response `200` — sesión

```json
{
  "success": true,
  "session": {
    "version": "3.0.0",
    "sessionId": "sess_...",
    "weekNumber": 1,
    "sessionFocus": "Push",
    "dayOfWeek": "Lunes",
    "warmup": [{ "id": "...", "nombre": "..." }],
    "mainBlock": [
      {
        "exerciseId": "...",
        "exerciseName": "...",
        "muscleGroup": "Pecho",
        "movementPattern": "Empuje_H",
        "sets": 3,
        "repRange": "8-12",
        "rirTarget": 3,
        "prescribedLoadKg": 40,
        "restSeconds": 120
      }
    ],
    "cooldown": [{ "id": "...", "nombre": "..." }],
    "completed": false
  }
}
```

### Response `200` — descanso

```json
{
  "success": true,
  "isRestDay": true,
  "dayOfWeek": "Martes",
  "message": "Día de descanso programado."
}
```

**Frontend:** usar `sessionNormalizer.ts` para convertir `mainBlock` plano a la estructura UI legacy (`bloques[].ejercicios[]`).

---

## POST `/api/session/complete`

**Auth:** requerida. Requiere `currentSession` en Firestore.

### Request

```json
{
  "sessionFeedback": {
    "pumpQuality": 3,
    "sorenessTiming": "sanó a tiempo",
    "jointPain": false,
    "perceivedWorkload": 3
  },
  "performanceData": {
    "exercises": [
      {
        "exerciseId": "ex_123",
        "exerciseName": "Press Banca",
        "sets": [
          { "setNumber": 1, "reps": 10, "load": 60, "rir": 2, "rpe": 8, "completed": true }
        ]
      }
    ]
  }
}
```

### Response `200`

```json
{
  "success": true,
  "message": "Sesión completada",
  "weeklyAdjustment": {
    "Pecho": { "modifier": 1.15, "message": "..." }
  }
}
```

---

## POST `/api/mesocycle/evaluate`

**Auth:** requerida.

### Request

```json
{
  "evaluation": {
    "generalDifficulty": 3,
    "persistentJointPain": false,
    "changeGoal": false,
    "newGoal": null
  },
  "referenceDate": "2026-08-04T12:00:00.000Z"
}
```

### Response `200`

```json
{
  "success": true,
  "evaluation": { },
  "mesocycle": { },
  "landmarkAdjustments": { }
}
```

---

## POST `/api/session/swap-exercise`

**Auth:** requerida. Intercambia un ejercicio en la sesión activa por alternativa del catálogo.

---

## Catálogo Firestore

Tres documentos bajo `catalogs/`:

| Documento | Contenido |
|-----------|-----------|
| `catalogs/calentamiento` | `{ items: [...] }` |
| `catalogs/enfriamiento` | `{ items: [...] }` |
| `catalogs/entrenamiento` | `{ items: [...] }` main + core |

Carga: `npm run curate-catalog` → `npm run upload-catalog -- --yes`

---

## GET `/api/gamification/summary`

**Auth:** Bearer requerido.

Devuelve contadores lifetime, logros desbloqueados/bloqueados y progreso.

```json
{
  "success": true,
  "counters": {
    "lifetimeSessionsCompleted": 12,
    "lifetimeActiveDays": 8,
    "currentStreakDays": 3,
    "seasonPoints": 120
  },
  "achievements": [
    {
      "id": "dedication",
      "title": "Dedicación",
      "unlocked": true,
      "progress": 10,
      "target": 10
    }
  ],
  "unlockedCount": 4,
  "nextAchievement": { "id": "warrior", "progress": 12, "target": 25 }
}
```

`POST /api/session/complete` incluye además `gamificationDelta.newAchievements` cuando se desbloquea un logro.

---

## Errores comunes

| Código | Significado |
|--------|-------------|
| 401 | Token ausente o inválido |
| 400 | Perfil incompleto / sin mesociclo / sin sesión activa |
| 405 | Método HTTP incorrecto |

---

## Referencia

- Reglas de negocio: [`docs/DDS.md`](./DDS.md)
- Checklist beta: [`docs/BETA_CHECKLIST.md`](./BETA_CHECKLIST.md)
- QA tiempo acelerado: `DEV_TOOLS=true npm run advance-time -- --user <UID> --days 7`
