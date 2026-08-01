# Mercado Pago — suscripción atletas (FitGen)

Integración B2C para atletas independientes: **14 días de prueba gratis** gestionados por FitGen, y a partir del día 15 cobro recurrente de **$249 MXN/mes** vía Mercado Pago (preapproval pendiente → checkout).

Atletas invitados por coach (`athleteOrigin: coached`) y cuentas coach **no** pasan por este paywall.

## Qué debes configurar tú

### 1. Credenciales en Mercado Pago

1. Entra a [Mercado Pago Developers](https://www.mercadopago.com.mx/developers/panel/app) con tu cuenta.
2. Crea una aplicación (o usa una existente) con producto **Suscripciones**.
3. Copia:
   - **Access Token** de prueba (`TEST-…`) para sandbox
   - **Access Token** de producción (`APP_USR-…`) cuando vayas en vivo
4. En **Webhooks → Configurar notificaciones**:
   - URL producción: `https://<TU_BACKEND>/api/billing/mp/webhook`
   - URL prueba: la misma (o un tunnel) apuntando a develop/preview
   - Eventos: **Planes y Suscripciones** → `subscription_preapproval` y `subscription_authorized_payment`
   - Copia el **secreto de firma** (Webhook secret)

> Nota: también enviamos `notification_url` al crear cada suscripción, por si el panel no aplica a Suscripciones en tu cuenta.

### 2. Variables de entorno (backend / Vercel)

En el proyecto **FitGen-backend** (Preview/Production):

| Variable | Ejemplo | Obligatoria |
|---|---|---|
| `MP_ACCESS_TOKEN` | `APP_USR-…` o `TEST-…` | Sí |
| `MP_WEBHOOK_SECRET` | secreto del panel | Sí en prod |
| `FRONTEND_URL` | `https://tu-app.vercel.app` | Sí (back_url post-pago) |
| `BACKEND_PUBLIC_URL` | `https://tu-api.vercel.app` | Sí (notification_url) |
| `MP_SUBSCRIPTION_AMOUNT` | `249` | No (default 249) |

Reinicia / redeploy tras guardar.

Local (`.env.local` del backend):

```bash
MP_ACCESS_TOKEN=TEST-...
MP_WEBHOOK_SECRET=...
FRONTEND_URL=http://localhost:5173
BACKEND_PUBLIC_URL=https://xxxx.ngrok-free.app   # tunnel para webhooks locales
```

### 3. Probar en sandbox

1. Usa Access Token de **prueba**.
2. Crea un usuario de prueba (comprador) en el panel de MP.
3. Registra un atleta directo en FitGen → debe quedar `subscriptionStatus: trialing`.
4. Para forzar el paywall sin esperar 14 días, en Firestore (`users/{uid}`) pon:
   - `trialEndsAt` a una fecha pasada
   - `subscriptionStatus: "expired"`
5. En la app debe aparecer el paywall → **Pagar con Mercado Pago**.
6. Completa el checkout con la tarjeta de prueba de MP.
7. El webhook debe dejar `subscriptionStatus: "active"`.

### 4. Producción

1. Cambia a Access Token de **producción**.
2. Confirma webhook URL pública HTTPS del backend.
3. Haz un pago real de $1/ciclo de prueba si quieres, o el monto 249.
4. Verifica en Firestore que tras autorizar la suscripción el usuario pasa a `active`.

## Endpoints añadidos

- `GET /api/billing/status` — estado trial/suscripción (también inicializa trial en usuarios viejos)
- `POST /api/billing/mp/create-subscription` — crea preapproval pendiente y devuelve `initPoint`
- `POST /api/billing/mp/webhook` — notificaciones MP

APIs de entrenamiento (`mesocycle/generate`, `session/generateV2`, `session/complete`) responden **402** si el trial expiró y no hay suscripción activa.

## Campos Firestore (`users/{uid}`)

- `subscriptionStatus`: `trialing` | `pending_checkout` | `active` | `past_due` | `canceled` | `expired`
- `trialStartedAt` / `trialEndsAt`
- `subscriptionAmountMxn` (249)
- `mpPreapprovalId`, `mpStatus`, `mpPayerEmail`
- `lastPaymentAt` (cuando llega un authorized payment aprobado)

## Quality / seguridad (billing)

```bash
npm run test:billing           # unitarios (access, firma, races, idempotencia)
npm run test:billing:coverage  # coverage ≥ 75% en domain/billing
npm run test:billing:mutation  # Stryker (break ≥ 60)
npm run qa:billing             # coverage + mutación
```

CI: `.github/workflows/billing-quality.yml` (PRs que tocan `domain/billing` o `api/billing`).

El gate incremental también mapea cambios de billing a `tests/unit/billing/**`.
