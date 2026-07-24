# FitGen — Capa Coaches (addendum de plataforma)

**Estado:** Implementación v1 en rama `coaches`  
**Alcance:** Relación coach-cliente, freemium, supervisión. El motor de entrenamiento en [`DDS.md`](../DDS.md) **no cambia**.

## Principio

- Un solo dueño del plan: `users/{athleteId}`.
- El sistema genera mesociclos y sesiones; el atleta entrena y completa.
- El coach configura intención, supervisa, hace swaps/exclusiones y recibe insights.

## Roles

| Rol | accountType | Descripción |
|---|---|---|
| Atleta directo | `athlete` + `athleteOrigin: direct` | Flujo B2C actual |
| Cliente de coach | `athlete` + `athleteOrigin: coached` + `coachId` | Misma UX de entrenamiento |
| Coach | `coach` | Dashboard propio, sin WorkoutPlayer |

## Freemium (coach)

- Free: 3 asientos lifetime (ledger).
- Premium: 50 asientos (flag admin, sin pasarela v1).
- Invite fallido (&lt;7 días, 0 sesiones): reciclable tras 60 días.

## Colecciones Firestore

- `coaches/{coachId}`
- `coachInvites/{inviteId}`
- `coachClients/{coachId}_{athleteId}`
- `coaches/{coachId}/seatLedger/{entryId}`
- `coachActions/{actionId}`

## API

Ver rutas en `server.js` bajo `/api/coach/*` y `/api/join/*`.

## Share cards

- Direct: "Entrenamiento completado con FitGen"
- Coached + free coach: "Powered by FitGen"
- Coached + premium: "Coached by {name} · Powered by FitGen"
