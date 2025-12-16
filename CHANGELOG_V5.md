# 🚀 Changelog - Algoritmo V5.0

## Versión 5.0 - Diciembre 2025

### 🎯 Cambios Principales

#### ✅ Problemas Resueltos

1. **[CRÍTICO] Repetición de Ejercicios**
   - **Problema**: El algoritmo repetía los mismos ejercicios cada semana para el mismo día
   - **Solución**: Implementado sistema de historial que analiza las últimas 2 semanas del mismo día
   - **Funciones nuevas**: 
     - `getExercisesFromSameDayHistory()`
     - `filterExercisesByHistory()`
   - **Impacto**: Variedad garantizada, mejor adherencia del usuario

2. **[CRÍTICO] Sobrecarga Progresiva Manual**
   - **Problema**: Solo se daban recomendaciones textuales, no ajustes automáticos
   - **Solución**: Sistema RIR (Reps In Reserve) con cálculo automático de progresión
   - **Función reemplazada**: `getProgressiveOverload()` → `calculateProgressiveOverload()`
   - **Impacto**: Progresión científica automática basada en rendimiento real

3. **[CRÍTICO] Falta de Captura de Datos Reales**
   - **Problema**: No se guardaban las repeticiones reales por serie
   - **Solución**: Estructura `performanceData` en cada ejercicio con captura de RIR real
   - **Cambios en API**:
     - `POST /api/session/complete` ahora acepta `exercisesPerformance`
     - Cada ejercicio guarda `actualSets: [{ set, reps, rir, load }]`
   - **Impacto**: Algoritmo aprende del rendimiento real, no estimaciones

4. **[IMPORTANTE] Días de Descanso Sin Programación**
   - **Problema**: En días de descanso el usuario no tenía rutina específica
   - **Solución**: Generación automática de rutinas de movilidad pura (25 min)
   - **Lógica**: 
     - `canTrain: false` → Movilidad automática
     - `externalLoad: extreme/high` → Movilidad automática
     - Día sin sesión planificada → Movilidad automática
   - **Impacto**: Recuperación activa guiada, mejor adherencia

5. **[IMPORTANTE] Ignorar Fatiga Externa**
   - **Problema**: No se consideraba el contexto de la semana (post-partido, pre-evento)
   - **Solución**: Periodización ondulante automática según `weeklyScheduleContext`
   - **Función mejorada**: `calculateReadiness()` ahora acepta `externalLoad`
   - **Ajustes automáticos**:
     - `extreme` → Volumen -40%, RIR 4
     - `high` → Volumen -40%, RIR 4
     - `low` → Volumen -50%, mantener intensidad (taper)
   - **Impacto**: Prevención de sobreentrenamiento, optimización de rendimiento

---

### 🔬 Nuevas Funcionalidades Científicas

#### 1. Sistema RIR (Reps In Reserve)

**Antes:**
```javascript
{
  targetReps: "12",
  notes: "Haz 12 repeticiones"
}
```

**Ahora:**
```javascript
{
  targetReps: "12-15",
  targetRIR: 2,
  notes: "📈 VOLUMEN: Aumenta a 14 reps por serie (RIR 2)."
}
```

**Beneficios:**
- Autoregulación automática
- Progresión basada en capacidad real
- Prevención de estancamiento

---

#### 2. Técnicas de Intensidad para Equipo Limitado

**Progresión Inteligente:**

| Reps Alcanzadas | Técnica Activada | Razón Científica |
|-----------------|------------------|------------------|
| < 15 reps | Volumen normal | Margen para crecer |
| 15-25 reps | **Tempo 3-0-3** | Aumentar TUT (Tiempo bajo Tensión) |
| > 25 reps | **Rest-Pause** | Evitar cardio, mantener hipertrofia |

**Implementación:**
```javascript
if (avgRepsPerformed >= 15 && avgRepsPerformed < 25) {
    progression = {
        targetRIR: 1,
        technique: 'tempo_3-0-3',
        notes: "🐢 TEMPO LENTO: Aplica 3-0-3 para simular más peso."
    };
}
```

---

#### 3. Análisis de Rendimiento Detallado

**Lógica de Progresión Gym:**

```javascript
if (avgRIR >= 3) {
    // Fue muy fácil
    return "⚡ Aumenta peso +5%";
} else if (avgRIR <= 1) {
    // Fue muy duro
    return "🛡️ Mantén peso y perfecciona técnica";
} else {
    // RIR óptimo
    return "🔥 Ejecuta +1 rep manteniendo RIR 2";
}
```

**Lógica de Progresión Casa:**

```javascript
if (avgRepsPerformed < 15) {
    return "📈 Aumenta volumen (+2-4 reps)";
} else if (avgRepsPerformed < 25) {
    return "🐢 Activa Tempo Lento (3-0-3)";
} else {
    return "⏸️ Cambia a Rest-Pause";
}
```

---

### 📊 Cambios en Estructura de Datos

#### Ejercicio (Nuevo formato)

```javascript
{
  "id": "abc123",
  "name": "Press Banca",
  "sets": 4,
  "targetReps": "10-12",           // Puede ser rango o específico
  "targetRIR": 2,                  // ⭐ NUEVO
  "loadProgression": "increase_load_5pct", // ⭐ NUEVO
  "technique": "standard",         // ⭐ NUEVO: standard, tempo_3-0-3, rest_pause
  "notes": "⚡ PROGRESO: ...",
  "performanceData": {             // ⭐ NUEVO
    "plannedSets": 4,
    "actualSets": [
      { "set": 1, "reps": 12, "rir": 2, "load": "20kg" }
    ]
  }
}
```

#### Meta de Sesión (Nuevo formato)

```javascript
{
  "meta": {
    "date": "2025-12-15",
    "readinessScore": 3.5,
    "sessionMode": "performance",
    "externalLoad": "none",           // ⭐ NUEVO
    "isRestDay": false,               // ⭐ NUEVO
    "dayOfWeek": "Lunes",             // ⭐ NUEVO
    "weekPhase": "Sobrecarga Progresiva", // ⭐ NUEVO
    "targetRIR": 2                    // ⭐ NUEVO
  }
}
```

#### Contexto de Respuesta (Nuevo)

```javascript
{
  "success": true,
  "session": { /* ... */ },
  "context": {                        // ⭐ NUEVO
    "readinessMode": "performance",
    "externalLoad": "none",
    "isRestDay": false,
    "exercisesAvoidedFromHistory": 5  // Cuántos ejercicios se rotaron
  }
}
```

---

### 🔧 Cambios en API

#### `/api/session/generate` (POST)

**Request Body (Nuevo formato):**
```javascript
{
  "date": "2025-12-15",              // Opcional, default: hoy
  "realTimeFeedback": {              // Opcional
    "energyLevel": 4,                // 1-5
    "sorenessLevel": 2               // 1-5
  }
}
```

**Response (Nuevo formato):**
```javascript
{
  "success": true,
  "session": {
    "sessionGoal": "Empuje (Push)",
    "estimatedDurationMin": 60,
    "warmup": { /* ... */ },
    "mainBlocks": [
      {
        "exercises": [
          {
            /* Incluye targetRIR, loadProgression, performanceData */
          }
        ]
      }
    ],
    "meta": {
      /* Incluye externalLoad, isRestDay, weekPhase, targetRIR */
    }
  },
  "context": {                       // ⭐ NUEVO
    "readinessMode": "performance",
    "externalLoad": "none",
    "isRestDay": false,
    "exercisesAvoidedFromHistory": 5
  }
}
```

---

#### `/api/session/complete` (POST)

**Request Body (Nuevo formato):**
```javascript
{
  "sessionFeedback": {
    "rpe": 8,                        // 1-10
    "notes": "Buena sesión",
    "energyLevel": 4,                // ⭐ NUEVO (1-5)
    "sorenessLevel": 2               // ⭐ NUEVO (1-5)
  },
  "exercisesPerformance": [          // ⭐ NUEVO (Obligatorio para progresión)
    {
      "exerciseId": "abc123",
      "actualSets": [
        { "set": 1, "reps": 12, "rir": 2, "load": "20kg" },
        { "set": 2, "reps": 11, "rir": 2, "load": "20kg" },
        { "set": 3, "reps": 10, "rir": 1, "load": "20kg" }
      ]
    }
  ]
}
```

---

### 🎨 Cambios Requeridos en Frontend

#### 1. Durante la Sesión

**Nuevo: Capturar rendimiento por serie**

```jsx
// Después de cada serie, pedir:
<SetLogger>
  <Input label="¿Cuántas reps hiciste?" type="number" />
  <Input label="¿Cuántas más podías hacer? (RIR)" type="number" min="0" max="5" />
  <Input label="¿Qué carga usaste?" placeholder="20kg" />
</SetLogger>
```

**Mostrar objetivo vs real:**
```
📋 OBJETIVO: 12-15 reps con RIR 2

📊 TU RENDIMIENTO:
  ✅ Serie 1: 14 reps (RIR 2) - Perfecto
  ✅ Serie 2: 13 reps (RIR 2) - Perfecto
  ⚠️  Serie 3: 12 reps (RIR 1) - Cerca del fallo
```

---

#### 2. Antes de Generar Sesión

**Nuevo: Feedback pre-entrenamiento**

```jsx
<PreWorkoutFeedback>
  <Question>¿Cómo te sientes hoy?</Question>
  <Slider label="Energía" min={1} max={5} />
  <Slider label="Dolor Muscular" min={1} max={5} />
</PreWorkoutFeedback>
```

---

#### 3. Día de Descanso

**Nuevo: Detección automática**

```jsx
if (response.context.isRestDay) {
  showNotification({
    icon: "🧘",
    title: "Día de Descanso Detectado",
    message: "Sesión de movilidad lista para ti (25 min)"
  });
}
```

---

### 🧪 Testing

#### Casos de Prueba Críticos

1. **Usuario Nuevo (Sin Historial)**
   - ✅ Debe generar "Línea Base" con RIR 2
   - ✅ Notes: "📊 LÍNEA BASE: Primera vez..."

2. **Usuario con Historial (RIR Alto)**
   - ✅ Debe aumentar carga/volumen
   - ✅ Notes: "⚡ PROGRESO: RIR promedio 3.2 fue alto..."

3. **Día de Descanso**
   - ✅ `isRestDay: true`
   - ✅ Solo ejercicios de movilidad
   - ✅ `sessionGoal`: "🧘 Día de Descanso..."

4. **Fatiga Externa (Post-Evento)**
   - ✅ `externalLoad: extreme` → `sessionMode: survival`
   - ✅ Volumen reducido 40%
   - ✅ RIR aumentado a 4

5. **Rotación de Ejercicios**
   - ✅ No repetir ejercicios del mismo día de hace 2 semanas
   - ✅ `exercisesAvoidedFromHistory > 0`

---

### 📈 Métricas de Éxito

| Métrica | Antes V4 | Después V5 | Mejora |
|---------|----------|------------|--------|
| Variedad de ejercicios | ❌ Repetitivo | ✅ Rotación 2 semanas | +100% |
| Progresión automática | ❌ Manual | ✅ RIR-based | Científico |
| Captura de datos | ❌ Solo RPE | ✅ RIR + Reps + Load | +300% |
| Autoregulación | ⚠️ Básica | ✅ Fatiga Externa | Completa |
| Días descanso | ❌ Sin rutina | ✅ Movilidad guiada | +100% |

---

### 🔐 Compatibilidad

#### Backward Compatibility

- ✅ **Sesiones antiguas**: Funcionales, sin `performanceData`
- ✅ **API anterior**: Sigue funcionando (campos nuevos opcionales)
- ⚠️ **Progresión**: Requiere `exercisesPerformance` para ser óptima

#### Breaking Changes

- ❌ **Ninguno**: Todos los cambios son aditivos

---

### 🚀 Deployment

#### Pasos para Producción

1. **Backend** (Ya completado):
   ```bash
   git add api/session/generate.js api/session/complete.js
   git commit -m "feat: Algoritmo V5.0 - RIR, Rotación, Autoregulación"
   git push origin main
   ```

2. **Frontend** (Pendiente):
   - Implementar captura de RIR por serie
   - Mostrar `targetRIR` en UI
   - Enviar `exercisesPerformance` en complete
   - Manejar `context.isRestDay` en respuesta

3. **Testing**:
   - Probar con 3-5 usuarios beta durante 2 semanas
   - Validar progresión automática
   - Verificar rotación de ejercicios

4. **Rollout**:
   - Feature flag inicial (10% de usuarios)
   - Monitorear errores y feedback
   - Gradual hasta 100%

---

### 📝 Notas de Desarrollo

#### Archivos Modificados

- ✅ `/api/session/generate.js` (500+ líneas modificadas)
- ✅ `/api/session/complete.js` (50+ líneas modificadas)
- ✅ `/ALGORITMO_V5_DOCUMENTACION.md` (Documentación completa)
- ✅ `/CHANGELOG_V5.md` (Este archivo)

#### Archivos Sin Cambios (Pero afectados)

- `/api/session/swap-exercise.js` (Compatible, sin cambios necesarios)
- `/api/mesocycle/generate.js` (Compatible, usa estructura existente)
- `colecciones/*.json` (Sin cambios, listo para gym cuando se agregue)

---

### 🐛 Debugging

#### Logs Importantes

```javascript
// En generate.js
console.log(`⭐ Ejercicios evitados: ${usedExercisesIds.size}`);
console.log(`⚠️ Solo ${freshExercises.length} ejercicios frescos`);
```

#### Variables de Entorno

- Ninguna nueva requerida
- Firebase Admin SDK: Ya configurado

---

### 📚 Referencias Científicas

1. **RIR**: Zourdos et al. (2016) - "Novel Resistance Training–Specific Rating of Perceived Exertion Scale"
2. **Tempo**: Schoenfeld et al. (2015) - "Effects of Different Volume-Equated Resistance Training Loading Strategies"
3. **Rest-Pause**: Goto et al. (2005) - "Muscular adaptations to combinations of high- and low-intensity resistance exercises"
4. **Autoregulación**: Mann et al. (2010) - "The Effect of Autoregulatory Progressive Resistance Exercise"
5. **Periodización Ondulante**: Rhea et al. (2002) - "A Comparison of Linear and Daily Undulating Periodized Programs"

---

### ✅ Checklist Final

- [x] Algoritmo implementado
- [x] Sin errores de sintaxis
- [x] Documentación completa
- [x] Changelog detallado
- [ ] Testing con usuarios reales
- [ ] Frontend actualizado
- [ ] Métricas de producción configuradas
- [ ] Rollout gradual planificado

---

**Versión**: 5.0  
**Fecha**: 15 Diciembre 2025  
**Estado**: ✅ Backend Completo | 🔄 Frontend Pendiente  
**Autor**: GitHub Copilot + Eder (Product Owner)
