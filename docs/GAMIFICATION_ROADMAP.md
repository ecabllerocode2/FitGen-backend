# FitGen — Plan de implementación: Gamificación (Fase 0 → Avatar V2)

**Versión:** 1.0  
**Estado:** Plan aprobado para ejecución incremental  
**Fecha:** Julio 2026  
**Alcance:** Contadores persistentes, logros, temporadas, ranking, economía cosmética y avatar (hasta V2 con capas/skins).

**Repos afectados:**

| Repo | Rol |
|---|---|
| `FitGen-backend` | Fuente de verdad: contadores, reglas de puntos, APIs, Firestore writes |
| `FitGen` (frontend) | UI de logros, ranking, tienda, avatar |

**Principio rector:** Los logros y puntos **nunca** se derivan de `recentSessions` (FIFO 36). Todo lo gamificado vive en contadores y registros persistentes actualizados **solo por el backend** en eventos de dominio (`session/complete`, `mesocycle/evaluate`, compras).

---

## 0. Estado actual (baseline)

| Aspecto | Hoy | Problema |
|---|---|---|
| Logros | Calculados en `StatsAndAchievements.tsx` desde `recentSessions` | Se pierden al podar historial (~36 sesiones) |
| Contador lifetime | No existe | Techo artificial en 50 sesiones |
| Ranking | No existe | — |
| Moneda / temporadas | No existe | — |
| Avatar | No existe | — |

**Datos que ya persisten (no tocar su lifecycle):**

- `recentSessions` — FIFO 36 (entrenamiento + UI reciente)
- `loadPerformanceLedger` — e1RM compacto, poda 18 meses
- `mesocycleExerciseIndex` — últimos 8 mesociclos

---

## 1. Modelo de datos Firestore

### 1.1 Documento de usuario — campo `gamification`

Ubicación: `users/{uid}.gamification` (merge en writes existentes del backend).

```typescript
interface UserGamification {
  // ── Contadores lifetime (nunca decrecen) ──
  lifetimeSessionsCompleted: number;
  lifetimeActiveDays: number;           // días calendario distintos con ≥1 sesión
  lifetimeWeeksPerfect: number;         // semanas con 100% sesiones planeadas
  lifetimeMesocyclesCompleted: number;
  longestStreakDays: number;            // mejor racha histórica
  currentStreakDays: number;          // racha activa (días con sesión, ventana ≤3 días)
  lastActiveDayKey: string | null;    // "yyyy-MM-dd" último día con sesión

  // ── Logros desbloqueados (memoria permanente) ──
  achievementsUnlocked: Record<string, {
    unlockedAt: string;               // ISO
    meta?: Record<string, unknown>;   // ej. { sessionId, mesocycleId }
  }>;

  // ── Temporada activa ──
  currentSeasonId: string;            // "2026-07" (año-mes UTC o timezone usuario)
  seasonPoints: number;               // resetea cada temporada
  seasonSessionsCompleted: number;
  seasonWeeksPerfect: number;
  fitCoinsBalance: number;            // moneda acumulativa (no resetea)

  // ── Avatar & cosméticos ──
  avatar: {
    baseStage: number;                // 0–7 evolución por semanas perfectas acumuladas
    equippedSkinId: string | null;    // "default" | "forge_iron" | ...
    equippedFrameId: string | null;
    equippedCelebrationId: string | null;
  };
  inventory: {
    skins: string[];
    frames: string[];
    celebrations: string[];
  };

  // ── Ranking cache (opcional, evita queries extra) ──
  lastSeasonRank: number | null;      // posición final temporada anterior
  lastSeasonLeague: string | null;  // "bronze" | "silver" | "gold"

  updatedAt: string;
}
```

**Valores iniciales** al crear perfil o en migración:

```json
{
  "lifetimeSessionsCompleted": 0,
  "lifetimeActiveDays": 0,
  "lifetimeWeeksPerfect": 0,
  "lifetimeMesocyclesCompleted": 0,
  "longestStreakDays": 0,
  "currentStreakDays": 0,
  "lastActiveDayKey": null,
  "achievementsUnlocked": {},
  "currentSeasonId": "2026-07",
  "seasonPoints": 0,
  "seasonSessionsCompleted": 0,
  "seasonWeeksPerfect": 0,
  "fitCoinsBalance": 0,
  "avatar": { "baseStage": 0, "equippedSkinId": "default", "equippedFrameId": null, "equippedCelebrationId": null },
  "inventory": { "skins": ["default"], "frames": [], "celebrations": [] },
  "lastSeasonRank": null,
  "lastSeasonLeague": null
}
```

### 1.2 Leaderboard (lectura pública acotada)

```
leaderboards/{seasonId}/entries/{uid}
  displayName: string          // nombre público (opt-in)
  avatarStage: number
  equippedSkinId: string
  seasonPoints: number
  seasonSessionsCompleted: number
  updatedAt: string
  showInLeaderboard: boolean   // opt-in privacidad
```

```
leaderboards/{seasonId}/meta
  seasonId: string
  startsAt: string
  endsAt: string
  participantCount: number
  lastUpdatedAt: string
```

**Lecturas del ranking:** `orderBy seasonPoints desc limit 50` → **50 documentos**, no scan de todos los usuarios.

### 1.3 Catálogo cosmético (config estática, backend-owned)

```
catalogs/gamification
  achievements: AchievementDefinition[]
  seasons: SeasonDefinition[]
  shop: ShopItem[]
  avatarStages: AvatarStageDefinition[]
```

El frontend **lee** este doc (igual que catálogo de ejercicios). Cambios de balance sin redeploy de app.

### 1.4 Reglas Firestore (actualización futura)

| Colección | Cliente | Backend |
|---|---|---|
| `users/{uid}.gamification` | **read** (dueño) | **write** (Admin SDK) |
| `leaderboards/{seasonId}/entries/{uid}` | **read** (autenticado) | **write** (Admin SDK) |
| `catalogs/gamification` | **read** (autenticado) | **write** (Admin SDK / script) |

Mantener `allow write: if false` en `users/{uid}` — el backend hace merge de `gamification` vía Admin SDK (ya bypass rules).

---

## 2. Reglas de negocio (dominio)

### 2.1 Eventos que incrementan contadores

| Evento | Hook | Contadores |
|---|---|---|
| Sesión completada | `POST /api/session/complete` | `lifetimeSessionsCompleted++`, `seasonSessionsCompleted++`, racha, día activo |
| Semana perfecta cerrada | `session/complete` cuando `weekClosed` y sesiones ≥ planeadas | `lifetimeWeeksPerfect++`, `seasonWeeksPerfect++`, bonus puntos |
| Mesociclo evaluado | `POST /api/mesocycle/evaluate` | `lifetimeMesocyclesCompleted++`, bonus puntos/monedas |
| Nueva temporada | Lazy al primer evento del mes | Reset `seasonPoints`, `seasonSessionsCompleted`, `seasonWeeksPerfect`; snapshot rank anterior |

### 2.2 Puntos de temporada (no compiten por peso)

| Acción | Puntos | FitCoins |
|---|---|---|
| Completar sesión | +10 | +2 |
| Semana perfecta (bonus) | +25 | +5 |
| Mesociclo completado (≥75% sesiones) | +50 | +15 |
| Racha 7 días activos (bonus único por hito) | +15 | +3 |
| Feedback post-sesión registrado | +2 | +0 |

**Cap semanal:** máx. 120 puntos de temporada por semana calendario (anti-grind).

### 2.3 Rachas

- Día activo = completó ≥1 sesión ese día calendario (timezone del usuario).
- Si gap entre días consecutivos con sesión ≤ 3 días → racha continúa (coherente con UI actual).
- `currentStreakDays` se actualiza en cada complete; `longestStreakDays = max(...)`.

### 2.4 Logros — definición centralizada

Archivo: `domain/gamification/achievements.js`

Categorías:

1. **Sesiones lifetime:** 1, 10, 25, 50, 75, 100, 150, 200, 365, 500, 1000
2. **Semanas perfectas:** 1, 4, 12, 26, 52
3. **Mesociclos:** 1, 3, 6, 12
4. **Rachas:** 7, 14, 30, 60 días
5. **Nivel:** subir a Intermedio, subir a Avanzado
6. **Temporada:** top 10, top 100 (evaluados al cierre)

Función pura:

```javascript
evaluateAchievements(gamification, context) → { newlyUnlocked: AchievementUnlock[] }
```

Idempotente: si `achievementsUnlocked[id]` existe, no re-desbloquea.

### 2.5 Avatar — evolución por etapas

| `baseStage` | Requisito | Nombre (placeholder) |
|---|---|---|
| 0 | Registro | Recruit |
| 1 | 1 semana perfecta | Trainee |
| 2 | 4 semanas perfectas acumuladas | Regular |
| 3 | 12 semanas perfectas | Dedicated |
| 4 | 26 semanas perfectas | Veteran |
| 5 | 52 semanas perfectas | Elite |
| 6 | 2 mesociclos con ≥90% adherencia | Forged |
| 7 | 5 mesociclos completados | Legend |

V1 = una imagen/SVG por stage. V2 = capas (cuerpo + outfit + skin).

---

## 3. APIs nuevas

| Método | Ruta | Fase | Descripción |
|---|---|---|---|
| GET | `/api/gamification/summary` | 1 | Contadores + logros + avatar para UI |
| GET | `/api/gamification/achievements` | 1 | Catálogo + estado unlocked/locked |
| GET | `/api/leaderboard/current` | 3 | Top 50 temporada + posición del usuario |
| GET | `/api/shop/catalog` | 4 | Items disponibles + precios |
| POST | `/api/shop/purchase` | 4 | Comprar skin/frame con FitCoins |
| POST | `/api/gamification/opt-in-leaderboard` | 3 | Toggle `showInLeaderboard` + displayName |
| POST | `/api/gamification/equip` | 4 | Equipar skin/frame/celebration |

**Respuesta en `session/complete` (extensión):**

```json
{
  "success": true,
  "gamificationDelta": {
    "seasonPointsEarned": 12,
    "fitCoinsEarned": 2,
    "newAchievements": [{ "id": "sessions-10", "title": "...", "unlockedAt": "..." }],
    "avatarStageUp": false,
    "currentStreakDays": 5
  }
}
```

El frontend muestra toast/modal post-sesión cuando hay `newAchievements` o `avatarStageUp`.

---

## 4. Fases de implementación

### Resumen

| Fase | Nombre | Duración est. | Repos | Bloqueante para |
|---|---|---|---|---|
| **1** | Fundación: contadores + logros persistentes | 1–2 sprints | BE + FE | Todo lo demás |
| **2** | Logros extendidos + stats lifetime | 0.5–1 sprint | BE + FE | Fase 3 |
| **3** | Temporadas + ranking | 1–2 sprints | BE + FE | Fase 4–5 |
| **4** | Economía + tienda cosmética | 1–2 sprints | BE + FE | Avatar V2 skins |
| **5** | Avatar V1 (sprite por stage) | 1 sprint | FE (+ assets) | Avatar V2 |
| **6** | Avatar V2 (capas + skins equipables) | 1–2 sprints | FE (+ assets) | — |

---

### Fase 1 — Fundación: contadores y logros persistentes

**Objetivo:** Que ningún logro se pierda con el lifecycle de sesiones. Reemplazar cálculo client-side por datos del backend.

#### Backend

| Tarea | Archivo / ubicación |
|---|---|
| Schema + defaults | `domain/gamification/types.js`, `domain/gamification/defaults.js` |
| Motor de contadores | `domain/gamification/updateGamification.js` |
| Evaluador de logros (tier básico: 1–50 sesiones, racha 7, consistencia) | `domain/gamification/achievements.js` |
| Integrar en complete | `api/session/complete.js` — transacción: archive + update gamification |
| Repo helpers | `infrastructure/firebase/userRepository.js` — `getGamification`, `saveGamification` |
| Endpoint summary | `api/gamification/summary.js` |
| Migración usuarios existentes | `scripts/backfill-gamification.mjs` — cuenta desde `recentSessions` + campos user |
| Tests unitarios | `tests/gamification.test.js` |
| Seed catálogo logros | `scripts/seed-gamification-catalog.mjs` → `catalogs/gamification` |

#### Frontend

| Tarea | Archivo / ubicación |
|---|---|
| Tipos + fetch summary | `src/types/gamification.ts`, `src/api/gamification.ts` |
| Refactor StatsAndAchievements | Leer `gamification` del API, no recalcular `totalSessions` desde history |
| Mantener historial reciente | Tab "Sesiones" sigue usando `recentSessions` (solo UI) |
| Toast post-sesión | Mostrar `gamificationDelta.newAchievements` tras complete |
| Dashboard badge | Contador lifetime visible ("127 sesiones totales") |

#### Criterios de aceptación

- [ ] Usuario con 40+ sesiones en historial podado sigue viendo logros de 10/25/50 desbloqueados
- [ ] `achievementsUnlocked` persiste en Firestore tras complete
- [ ] Stats modal muestra `lifetimeSessionsCompleted`, no `recentSessions.length`
- [ ] Backfill corre sin duplicar contadores en re-ejecución (idempotente)
- [ ] 15+ tests nuevos pasando

#### Diseño / assets

Ninguno — reutilizar iconos Lucide actuales.

---

### Fase 2 — Logros extendidos y stats lifetime

**Objetivo:** Progresión infinita post-50 sesiones; métricas de mesociclo y semanas perfectas.

#### Backend

| Tarea | Detalle |
|---|---|
| Ampliar `achievements.js` | Tiers 75→1000 sesiones, semanas perfectas, mesociclos, rachas 14/30/60 |
| Hook mesociclo evaluate | `api/mesocycle/evaluate.js` — incrementar `lifetimeMesocyclesCompleted`, evaluar logros de nivel |
| Semana perfecta | En `complete` cuando `weekClosed`: contar sesiones de la semana vs plan → incrementar si 100% |
| Logros de nivel | Desbloquear al detectar cambio en `resolveHybridExperienceLevel` |

#### Frontend

| Tarea | Detalle |
|---|---|
| Secciones en logros | "Sesiones", "Consistencia", "Mesociclos", "Rachas" |
| Próxima meta | Siempre mostrar siguiente logro locked con barra de progreso desde contadores lifetime |
| Milestone celebration | Modal especial en tiers 100, 365, 500 |

#### Criterios de aceptación

- [ ] Usuario con 60 sesiones lifetime ve progreso hacia logro de 75 (no techo en 50)
- [ ] Completar mesociclo incrementa contador aunque `recentSessions` no tenga todas las sesiones del ciclo
- [ ] Logro "Primera semana perfecta" usa contador persistente, no historial reciente

---

### Fase 3 — Temporadas y ranking global

**Objetivo:** Competencia mensual justa (puntos de esfuerzo, no pesos). Lecturas acotadas.

#### Backend

| Tarea | Detalle |
|---|---|
| `domain/gamification/season.js` | `getCurrentSeasonId(timezone)`, rollover lazy, snapshot rank |
| Puntos + cap semanal | Integrar en `updateGamification.js` |
| Leaderboard writes | Upsert `leaderboards/{seasonId}/entries/{uid}` en cada complete (merge) |
| Endpoints | `GET /api/leaderboard/current`, `POST /api/gamification/opt-in-leaderboard` |
| Cierre de temporada | Lazy: al primer evento del nuevo mes, calcular `lastSeasonRank` + bonus FitCoins top 100 |
| Ligas | Asignar bronze/silver/gold según percentil temporada anterior |
| Firestore rules | Permitir read autenticado en `leaderboards/**` |
| Privacidad | Default `showInLeaderboard: false`; opt-in explícito |

#### Frontend

| Tarea | Detalle |
|---|---|
| Pantalla Ranking | Top 50, tu posición, puntos de temporada, días restantes |
| Opt-in flow | Modal primera vez: "¿Aparecer en el ranking?" + nombre público |
| Dashboard widget | "Temporada Julio · 340 pts · #23" |
| Indicador de liga | Badge bronze/silver/gold |

#### Criterios de aceptación

- [ ] Ranking carga con ≤51 lecturas Firestore (50 entries + meta)
- [ ] Principiante y avanzado compiten en igualdad (mismas reglas de puntos)
- [ ] Al cambiar mes, `seasonPoints` del user resetea a 0; FitCoins no
- [ ] Usuario opt-out no aparece en leaderboard

#### Métricas a monitorear post-deploy

- Lecturas Firestore / complete (objetivo: +1 write leaderboard, +0 reads extra en complete)
- % usuarios opt-in ranking

---

### Fase 4 — Economía FitCoins y tienda cosmética

**Objetivo:** Moneda acumulativa + shop de cosméticos (sin pay-to-win).

#### Backend

| Tarea | Detalle |
|---|---|
| Catálogo shop | `catalogs/gamification.shop[]` — id, type, price, rarity, previewUrl |
| Items iniciales (placeholders) | 3 skins, 2 frames, 1 celebration — precios 50–200 FitCoins |
| `POST /api/shop/purchase` | Validar balance, idempotencia, agregar a inventory |
| `POST /api/gamification/equip` | Validar ownership, actualizar `avatar.equipped*` |
| Cofre semanal (opcional MVP) | Si ≥3 sesiones en semana → bonus 10 FitCoins (una vez/semana) |

#### Frontend

| Tarea | Detalle |
|---|---|
| Pantalla Tienda | Grid de items, balance FitCoins, preview |
| Inventario | Skins desbloqueadas vs locked |
| Equipar | Cambio en perfil / avatar preview |
| Earn feedback | "+2 FitCoins" en toast post-sesión |

#### Criterios de aceptación

- [ ] Compra deduce balance y es atómica (transacción Firestore)
- [ ] No se puede comprar dos veces el mismo item
- [ ] Equipar skin invalida si no está en inventory
- [ ] Ningún item afecta prescripción de entrenamiento

#### Diseño / assets (inicio)

| Entregable | Formato | Cantidad MVP |
|---|---|---|
| Placeholder skins | PNG/SVG 256×256 | 3 |
| Placeholder frames | PNG overlay | 2 |
| Icono FitCoin | SVG | 1 |

**Nota:** Placeholders genéricos bastan; diseño final puede llegar en Fase 6.

---

### Fase 5 — Avatar V1 (evolución por stage)

**Objetivo:** Feedback visual semanal en dashboard; un sprite por etapa de evolución.

#### Backend

| Tarea | Detalle |
|---|---|
| `domain/gamification/avatar.js` | `resolveAvatarStage(gamification)` — pura |
| Actualizar stage en complete/evaluate | Cuando `lifetimeWeeksPerfect` cruza umbral |
| Summary API | Incluir `avatar: { stage, stageName, equippedSkinId }` |

#### Frontend

| Tarea | Detalle |
|---|---|
| Componente `AvatarDisplay` | `src/components/gamification/AvatarDisplay.tsx` |
| Asset map | `src/assets/avatar/stages/stage-0.svg` … `stage-7.svg` |
| Dashboard | Avatar + "Siguiente evolución: 3 semanas perfectas más" |
| Stats modal header | Avatar pequeño junto al nombre |
| Leaderboard row | Mini avatar + stage |

#### Criterios de aceptación

- [ ] Avatar visible en dashboard sin afectar performance PWA (assets < 200 KB total SVG)
- [ ] Stage sube automáticamente al cruzar umbral (persistido en Firestore)
- [ ] Funciona offline si assets en cache del service worker

#### Diseño / assets (requerido antes de polish)

| Entregable | Spec |
|---|---|
| Silueta base neutra | SVG, vista frontal, 8 variantes de "forma" (no realismo extremo) |
| Paleta | Coherente con zinc/lime de la app |
| Guía de proporciones | Misma caja 512×512, mismo anchor point |

**MVP sin diseñador:** Usar siluetas geométricas generadas (bloques CSS/SVG simples) → reemplazar cuando haya arte.

---

### Fase 6 — Avatar V2 (capas + skins equipables)

**Objetivo:** Sistema de capas como Clash Royale — base + outfit + skin + frame.

#### Modelo de capas

```
Avatar render stack (bottom → top):
1. baseBody      — stage 0–7 (forma/evolución)
2. baseOutfit    — default gym wear (cambia levemente por stage)
3. skinLayer     — skin equipada (Forge Iron, Shadow, etc.)
4. frameOverlay  — marco de perfil (ranking reward)
```

#### Backend

| Tarea | Detalle |
|---|---|
| Extender shop types | `skin`, `frame`, `celebration`, `outfit` |
| Validar equip combinations | Skin compatible con stage (opcional: algunas skins requieren stage ≥3) |
| Celebration override | Post-sesión usa animación de celebration equipada |

#### Frontend

| Tarea | Detalle |
|---|---|
| `AvatarRenderer` | Compone capas SVG/PNG con z-index |
| Preview en tienda | Render en vivo antes de comprar |
| Profile card share | Avatar + stats + liga (reutilizar share card existente) |
| Animación idle (opcional) | Lottie 2–3 s loop, lazy load |

#### Criterios de aceptación

- [ ] Cambiar skin en tienda se refleja en dashboard, ranking y share card
- [ ] Capas componen sin artefactos en mobile (375px width)
- [ ] Peso total assets avatar V2 < 500 KB (lazy por skin)

#### Diseño / assets (requerido)

| Entregable | Cantidad inicial |
|---|---|
| Skins completas (capa sobre base) | 5 |
| Frames | 3 |
| Outfits por stage (opcional V2.1) | 8 × 1 default |
| Animación celebration Lottie | 2 |

---

## 5. Migración y backfill

### Script `backfill-gamification.mjs`

1. Para cada `users/{uid}`:
   - Leer `recentSessions` (max 36) — **solo para estimación inicial**
   - Contar sesiones completadas, días activos distintos
   - Estimar racha actual desde fechas
   - Evaluar logros alcanzables con esos datos
   - **No** asumir lifetime real si hay >36 sesiones históricas → marcar `gamification._backfillNote: "partial-from-recent-only"`
2. Usuarios con mucha actividad previa: considerar flag manual o incremento conservador

### Idempotencia

- Backfill usa `FieldValue.increment(0)` pattern o check `if (!user.gamification)` antes de init
- Re-ejecutar no duplica logros ni contadores

---

## 6. Testing

| Nivel | Qué |
|---|---|
| Unit | `updateGamification`, `evaluateAchievements`, `resolveAvatarStage`, season rollover |
| Integration | complete → gamification delta → summary API |
| E2E manual | Completar sesión → ver toast logro → abrir stats → persiste tras recargar |
| Regression | Lifecycle sigue podando `recentSessions`; gamification intacto |

Objetivo: **+40 tests** acumulados en gamificación al cerrar Fase 3.

---

## 7. Orden de ejecución recomendado

```
Fase 1 ──► Fase 2 ──► Fase 3 ──► Fase 4 ──► Fase 5 ──► Fase 6
  │           │           │           │           │
  │           │           │           │           └── requiere assets base (puede usar placeholders)
  │           │           │           └── requiere FitCoins (Fase 3)
  │           │           └── requiere contadores (Fase 1)
  │           └── requiere achievements engine (Fase 1)
  └── EMPEZAR AQUÍ
```

**Paralelizable:**

- Diseño de avatar (sketches) puede empezar durante Fase 2–3
- Catálogo shop JSON puede prepararse durante Fase 3
- Firestore rules update puede hacerse en Fase 1 (solo read gamification) y ampliarse en Fase 3 (leaderboards)

---

## 8. Checklist por fase (para PRs)

### Fase 1 PR checklist

- [ ] `domain/gamification/*` creado con tests
- [ ] `session/complete` actualiza gamification en misma transacción lógica
- [ ] `GET /api/gamification/summary` documentado en `FRONTEND_API_INTEGRATION.md`
- [ ] Backfill script probado en dev
- [ ] Frontend deja de calcular logros desde `recentSessions.length`
- [ ] Sin cambios en lifecycle de `recentSessions` / ledger

### Fase 3 PR checklist

- [ ] Leaderboard opt-in + privacidad
- [ ] Cap semanal de puntos testeado
- [ ] Reglas Firestore para `leaderboards/**`
- [ ] No lectura full-collection de usuarios

---

## 9. Fuera de alcance (post V2)

| Feature | Por qué después |
|---|---|
| Clanes / amigos | Requiere grafo social + moderación |
| PvP directo | Complejidad UX |
| Compras IAP de FitCoins | Monetización post-beta |
| Avatar 3D | Overkill para PWA |
| NFTs / blockchain | — |

---

## 10. Referencias en codebase

| Concepto actual | Archivo |
|---|---|
| Logros client-side | `FitGen/src/components/StatsAndAchievements.tsx` |
| FIFO sesiones | `FitGen-backend/infrastructure/firebase/userRepository.js` |
| Complete session | `FitGen-backend/api/session/complete.js` |
| Evaluate mesociclo | `FitGen-backend/api/mesocycle/evaluate.js` |
| Reglas Firestore | `FitGen-backend/firestore.rules` |
| Progresión nivel | `FitGen-backend/domain/athlete/levelProgression.js` |

---

## 11. Próximo paso

**Implementar Fase 1** en rama `develop`:

1. Backend: `domain/gamification/` + hook en `complete` + `summary` API + tests
2. Script backfill
3. Frontend: consumir summary + refactor StatsAndAchievements
4. PR → develop → validar en preview → merge main cuando estable

Cuando confirmes, avanzamos con Fase 1 en código.
