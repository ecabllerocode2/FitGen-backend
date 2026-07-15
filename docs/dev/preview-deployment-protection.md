# Preview develop — Deployment Protection

El backend preview (`fit-gen-backend-git-develop-...`) tiene **Vercel Authentication** activa.
Eso bloquea `fetch()` desde el navegador → `Failed to fetch` al generar sesiones.

La URL del backend **no cambia** en cada deploy (usa la URL estable de rama `develop`).

## Solución recomendada (2 minutos)

1. [Vercel Dashboard](https://vercel.com) → proyecto **fit-gen-backend**
2. **Settings** → **Deployment Protection**
3. En **Deployment Protection Exceptions**, agrega:

   ```
   fit-gen-backend-git-develop-eders-projects-85c237f9.vercel.app
   ```

4. Guarda. No hace falta redeploy.

Con eso el API queda público (sigue protegido por Firebase Bearer token en cada endpoint).

## Alternativa: Protection Bypass for Automation

1. En el mismo panel, activa **Protection Bypass for Automation** y copia el secret.
2. En el proyecto **fit-gen** → **Settings** → **Environment Variables** → Preview:

   ```
   VITE_VERCEL_PROTECTION_BYPASS = <tu-secret>
   ```

3. Redeploy frontend develop.

El frontend ya envía los headers `x-vercel-protection-bypass` cuando esa variable existe.

## Verificación

```bash
curl -sI -X POST https://fit-gen-backend-git-develop-eders-projects-85c237f9.vercel.app/api/session/generateV2
```

- **Antes:** `HTTP/2 302` → `vercel.com/sso-api`
- **Después:** `HTTP/2 405` o `401` (llega al backend, no al SSO)
