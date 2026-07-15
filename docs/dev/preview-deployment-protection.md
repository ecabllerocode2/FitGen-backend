# Preview develop — Deployment Protection (plan Hobby)

El backend preview (`fit-gen-backend-git-develop-...`) puede tener **Vercel Authentication** activa.
Eso bloquea `fetch()` desde el navegador → `Failed to fetch` al generar sesiones.

La URL del backend **no cambia** en cada deploy (usa la URL estable de rama `develop`).

## Plan Hobby — qué NO puedes usar

- **Deployment Protection Exceptions** (dominios públicos en la lista blanca) → requiere **Pro**.

## Plan Hobby — solución recomendada (gratis)

**Desactivar Vercel Authentication** en el proyecto backend (no es lo mismo que “exceptions”):

1. [Vercel Dashboard](https://vercel.com) → proyecto **fit-gen-backend**
2. **Settings** → **Deployment Protection**
3. Sección **Vercel Authentication** → **Disabled**
4. **Save**

Repite en **fit-gen** (frontend) si también te pide login SSO al abrir la preview.

Resultado: las URLs preview quedan públicas. Tus APIs siguen protegidas por **Firebase Bearer token** en cada endpoint — no cualquiera puede generar sesiones sin estar logueado en la app.

### Verificación

```bash
curl -sI -X POST https://fit-gen-backend-git-develop-eders-projects-85c237f9.vercel.app/api/session/generateV2
```

- **Mal (SSO activo):** `HTTP/2 302` → `vercel.com/sso-api`
- **Bien (SSO off):** `HTTP/2 401` o `405` (llega al backend Express)

---

## Alternativa temporal (sin tocar SSO)

Apuntar el frontend **Preview** al backend de **producción** (sin SSO):

1. **fit-gen** → Settings → Environment Variables → Preview
2. `VITE_BACKEND_URL` = `https://fit-gen-backend.vercel.app`
3. Redeploy frontend develop

**Limitación:** pruebas el frontend de `develop` contra el backend de `main` (puede ir retrasado respecto a `develop`).

---

## Alternativa Pro (cuando upgrades)

En **Deployment Protection Exceptions**, agregar:

```
fit-gen-backend-git-develop-eders-projects-85c237f9.vercel.app
```

Mantiene SSO en otras previews pero deja pública solo la rama develop del backend.

---

## Protection Bypass for Automation (opcional)

Si prefieres mantener SSO y usar secret:

1. fit-gen-backend → Deployment Protection → **Protection Bypass for Automation** → copiar secret
2. fit-gen → Preview env: `VITE_VERCEL_PROTECTION_BYPASS` = secret
3. Redeploy frontend (el código ya envía el header)

Comprueba en Hobby si tu dashboard muestra esta opción; si no, usa “Desactivar Vercel Authentication”.
