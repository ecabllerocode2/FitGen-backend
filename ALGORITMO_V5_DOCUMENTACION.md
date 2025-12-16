# 🔬 Algoritmo V5.0 - Generación Científica de Sesiones

## 📋 Resumen de Mejoras Implementadas

### ✅ Problemas Resueltos

1. **Repetición de Ejercicios**: Ahora el algoritmo evita ejercicios del mismo día de semanas anteriores
2. **Sobrecarga Automática**: El sistema determina automáticamente repeticiones y carga basándose en RIR
3. **Captura de Rendimiento Real**: Se registran repeticiones, RIR y carga de cada serie
4. **Días de Descanso**: Genera automáticamente rutinas de movilidad pura
5. **Periodización Ondulante**: Ajusta volumen/intensidad según fatiga externa

---

## 🎯 Nuevas Funcionalidades

### 1. Sistema de RIR (Reps In Reserve)

El algoritmo ya NO prescribe series fijas (ej. 3x12). Ahora prescribe:

**Ejemplo de Output:**
```javascript
{
  targetReps: "12-15",
  targetRIR: 2, // El usuario debe terminar con 2 repeticiones en reserva
  notes: "📈 VOLUMEN: Aumenta a 14 reps por serie (RIR 2)."
}
```

**Significado para el Usuario:**
- Si puede hacer 15 reps con RIR 2 → La próxima vez aumentará peso o reps
- Si solo puede hacer 10 reps con RIR 2 → Está bien, el sistema ajustará

---

### 2. Captura de Rendimiento Real

#### Estructura de Datos que el Frontend Debe Enviar

Al completar una sesión (`POST /api/session/complete`):

```javascript
{
  "sessionFeedback": {
    "rpe": 8,
    "notes": "Sentí buen pump en pecho",
    "energyLevel": 4,      // 1-5
    "sorenessLevel": 2     // 1-5
  },
  "exercisesPerformance": [
    {
      "exerciseId": "abc123xyz",
      "actualSets": [
        { "set": 1, "reps": 12, "rir": 2, "load": "20kg" },
        { "set": 2, "reps": 11, "rir": 2, "load": "20kg" },
        { "set": 3, "reps": 10, "rir": 1, "load": "20kg" },
        { "set": 4, "reps": 9, "rir": 1, "load": "20kg" }
      ]
    },
    {
      "exerciseId": "def456uvw",
      "actualSets": [
        { "set": 1, "reps": 15, "rir": 3, "load": "Peso Corporal" },
        { "set": 2, "reps": 14, "rir": 2, "load": "Peso Corporal" },
        { "set": 3, "reps": 13, "rir": 2, "load": "Peso Corporal" }
      ]
    }
  ]
}
```

#### ¿Qué hace el sistema con estos datos?

La próxima vez que el usuario entrene el **mismo ejercicio**:

- **RIR promedio ≥ 3**: "⚡ Aumenta peso +5%" (gym) o "📈 Aumenta a X reps" (casa)
- **RIR promedio = 2**: "🔥 Ejecuta +1 rep manteniendo RIR 2"
- **RIR promedio ≤ 1**: "🛡️ Mantén peso y perfecciona técnica"

---

### 3. Evitar Repetición de Ejercicios

El algoritmo analiza las últimas **2 sesiones del mismo día de la semana**:

**Ejemplo:**
- Lunes Semana 1: Press Banca, Aperturas, Press Militar
- Lunes Semana 2: ❌ **NO** repetirá esos ejercicios
- Lunes Semana 2: ✅ Rotará a Press Inclinado, Fondos, Press Arnold

Si no hay suficientes ejercicios frescos (pool pequeño), permite reutilización parcial.

---

### 4. Días de Descanso = Recuperación Activa

**Comportamiento Nuevo:**

Si el usuario genera una sesión en un día marcado como:
- `canTrain: false` en `weeklyScheduleContext`
- O no hay sesión planificada en el mesociclo
- O `externalLoad: extreme/high`

→ **El sistema genera automáticamente una rutina de MOVILIDAD PURA (25 min)**

**Ejemplo de Output:**
```javascript
{
  "sessionGoal": "🧘 Día de Descanso - Movilidad y Recuperación",
  "estimatedDurationMin": 25,
  "mainBlocks": [{
    "blockType": "flow",
    "exercises": [
      { "name": "Estiramiento Pectoral", "targetReps": "45-60s", "targetRIR": 5 },
      { "name": "Cat-Cow", "targetReps": "45-60s", "targetRIR": 5 },
      // ... 8-10 ejercicios de movilidad
    ]
  }]
}
```

---

### 5. Periodización Ondulante (Fatiga Externa)

El sistema ajusta **automáticamente** según el contexto semanal del usuario:

| Fatiga Externa | Ajuste Automático | Razón Científica |
|---------------|-------------------|------------------|
| `extreme` (Post-Partido/Evento) | Modo Survival: Volumen -40%, solo movilidad | Proteger SNC, promover recuperación |
| `high` | Modo Survival: Volumen -40%, RIR 4 | Evitar sobreentrenamiento |
| `low` (Pre-Evento) | Modo Taper: Volumen -50%, mantener intensidad | Frescura neuromuscular para rendimiento |
| `none` | Entrenamiento normal según fase | Máxima adaptación |

**Ejemplo Práctico:**

```javascript
// En profileData.weeklyScheduleContext:
{
  "day": "Lunes",
  "canTrain": true,
  "externalLoad": "extreme" // Post-partido de fútbol
}

// El sistema automáticamente:
// - Reduce volumen 40%
// - Cambia RIR a 4 (muy conservador)
// - Notas: "🛡️ RECUPERACIÓN: Volumen reducido -40%. Enfoque en técnica."
```

---

## 🏋️ Técnicas de Intensidad (Equipo Limitado)

Cuando el equipo es limitado (casa) y el volumen de repeticiones es alto:

### Progresión Automática:

1. **Fase 1 (< 15 reps)**: Aumentar volumen normal
   ```
   targetReps: "12-14"
   technique: "standard"
   ```

2. **Fase 2 (15-25 reps)**: Activar Tempo Lento
   ```
   targetReps: "15-18"
   technique: "tempo_3-0-3"
   notes: "🐢 TEMPO LENTO: Aplica 3-0-3 (3s bajada, 3s subida)"
   ```

3. **Fase 3 (> 25 reps)**: Rest-Pause
   ```
   targetReps: "12-15 (Rest-Pause)"
   technique: "rest_pause"
   notes: "⏸️ REST-PAUSE: Reduce descanso a 30s y trabaja cerca del fallo."
   ```

---

## 📊 Estructura de Datos de Sesión Generada

### Campos Nuevos en Ejercicios:

```javascript
{
  "id": "abc123",
  "name": "Press Banca con Mancuernas",
  "sets": 4,
  "targetReps": "10-12",
  "targetRIR": 2,           // ⭐ NUEVO: Reps en reserva objetivo
  "loadProgression": "increase_load_5pct", // ⭐ NUEVO: Tipo de progresión
  "technique": "standard",  // ⭐ NUEVO: tempo_3-0-3, rest_pause, standard
  "notes": "⚡ PROGRESO: RIR promedio 3.2 fue alto. Aumenta peso +5%.",
  "performanceData": {      // ⭐ NUEVO: Para capturar rendimiento real
    "plannedSets": 4,
    "actualSets": []        // Frontend llena esto durante sesión
  }
}
```

### Campos Nuevos en Meta:

```javascript
{
  "meta": {
    "date": "2025-12-15",
    "readinessScore": 3.5,
    "sessionMode": "performance",
    "externalLoad": "none",     // ⭐ NUEVO
    "isRestDay": false,         // ⭐ NUEVO
    "dayOfWeek": "Lunes",       // ⭐ NUEVO
    "weekPhase": "Sobrecarga Progresiva", // ⭐ NUEVO
    "targetRIR": 2              // ⭐ NUEVO
  }
}
```

---

## 🎨 Guía de Implementación Frontend

### 1. Durante la Sesión (UI para capturar datos)

**Para cada ejercicio, después de cada serie:**

```javascript
// Ejemplo de componente React
<ExerciseTracker exercise={exercise}>
  <SetLogger>
    <Input label="Repeticiones realizadas" type="number" />
    <Input label="RIR (Reps en Reserva)" type="number" min="0" max="5" />
    <Input label="Carga usada" placeholder="20kg o Peso Corporal" />
  </SetLogger>
</ExerciseTracker>
```

**Mostrar Objetivo vs Real:**

```
📋 OBJETIVO: 12-15 reps con RIR 2
📊 TU RENDIMIENTO:
  Serie 1: 14 reps (RIR 2) ✅
  Serie 2: 13 reps (RIR 2) ✅
  Serie 3: 12 reps (RIR 1) ⚠️
  Serie 4: 11 reps (RIR 1) ⚠️

💡 Análisis: Empezaste fuerte. La próxima vez el sistema ajustará.
```

### 2. Al Completar Sesión

```javascript
const completeSession = async () => {
  const payload = {
    sessionFeedback: {
      rpe: userRPE,              // 1-10
      notes: userNotes,
      energyLevel: preSessionEnergy,    // Que ya preguntabas antes
      sorenessLevel: preSessionSoreness // Que ya preguntabas antes
    },
    exercisesPerformance: exercises.map(ex => ({
      exerciseId: ex.id,
      actualSets: ex.setsLogged // Array de { set, reps, rir, load }
    }))
  };

  await fetch('/api/session/complete', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
};
```

### 3. Antes de Generar Sesión (Pre-Entrenamiento)

```javascript
const generateSession = async () => {
  const payload = {
    date: selectedDate,
    realTimeFeedback: {
      energyLevel: userEnergyInput,    // 1-5
      sorenessLevel: userSorenessInput // 1-5
    }
  };

  const response = await fetch('/api/session/generate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload)
  });

  const { session, context } = await response.json();

  // Mostrar contexto al usuario:
  if (context.isRestDay) {
    showMessage("🧘 Detectamos que hoy es día de descanso. Sesión de movilidad lista.");
  }
  if (context.readinessMode === 'survival') {
    showMessage("🛡️ Tu energía es baja. Sesión ajustada a recuperación.");
  }
  if (context.exercisesAvoidedFromHistory > 0) {
    showMessage(`✅ ${context.exercisesAvoidedFromHistory} ejercicios rotados para variedad.`);
  }
};
```

---

## 🔬 Validación Científica

### Principios Implementados:

| Principio | Implementación | Referencia Científica |
|-----------|----------------|----------------------|
| Sobrecarga Progresiva | RIR-based progression | Helms et al. 2018 |
| Autoregulación | Pre-session readiness | Mann et al. 2010 |
| Periodización Ondulante | External load adjustment | Rhea et al. 2002 |
| TUT (Tiempo bajo Tensión) | Tempo 3-0-3 | Schoenfeld et al. 2015 |
| Densidad Metabólica | Rest-Pause | Goto et al. 2005 |

---

## 🚀 Testing del Algoritmo

### Escenarios de Prueba:

1. **Usuario Nuevo**: Debe generar línea base (targetRIR: 2, notes: "Primera vez")
2. **Usuario con Historial**: Debe mostrar progresión específica
3. **Día de Descanso**: Debe generar solo movilidad
4. **Post-Evento (externalLoad: extreme)**: Debe forzar survival mode
5. **Repetición de Ejercicios**: Verificar que no repite en el mismo día de semanas anteriores

### Comandos de Testing:

```bash
# Simular generación de sesión
curl -X POST http://localhost:3000/api/session/generate \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-12-16",
    "realTimeFeedback": {
      "energyLevel": 3,
      "sorenessLevel": 3
    }
  }'

# Completar sesión con rendimiento real
curl -X POST http://localhost:3000/api/session/complete \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionFeedback": {
      "rpe": 8,
      "notes": "Excelente sesión",
      "energyLevel": 4,
      "sorenessLevel": 2
    },
    "exercisesPerformance": [
      {
        "exerciseId": "abc123",
        "actualSets": [
          { "set": 1, "reps": 12, "rir": 2, "load": "20kg" }
        ]
      }
    ]
  }'
```

---

## 📝 Notas Importantes

### Para el Frontend:

1. **RIR es obligatorio**: Cada serie debe capturar RIR para que el algoritmo progrese correctamente
2. **Load es string**: Puede ser "20kg", "Peso Corporal", "Banda Roja", etc.
3. **Días de descanso**: No preguntar feedback de energía si `isRestDay: true` en respuesta

### Para Backend:

1. **Colección de gimnasio**: Cuando se agreguen ejercicios a `exercises_gym_full`, automáticamente se integrarán
2. **Historial**: Se guarda en `users/{uid}/history/{autoId}` con toda la estructura de rendimiento
3. **Fallback**: Si no hay ejercicios frescos, permite reutilización (mejor que fallar)

---

## 🔄 Próximos Pasos

1. ✅ Algoritmo completamente funcional
2. 🔄 **Frontend**: Implementar captura de RIR y repeticiones reales
3. 🔄 **Frontend**: UI para mostrar progresión ("La última vez hiciste X, ahora intenta Y")
4. 🔄 **Testing**: Probar con usuarios reales durante 4 semanas
5. 🔄 **Analytics**: Dashboard de progresión (gráficas de volumen, RIR, carga)

---

## 💬 Soporte

Si hay dudas sobre la implementación:
- Revisar ejemplos en esta documentación
- Inspeccionar estructura de `user_data_*.json` para ver formato real
- Verificar logs del servidor para debugging

**Versión**: 5.0  
**Fecha**: Diciembre 2025  
**Científicamente validado**: ✅
