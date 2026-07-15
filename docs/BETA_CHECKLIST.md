# FitGen — Checklist de Lanzamiento Beta

## Seguridad

- [x] Firestore rules restringidas por `request.auth.uid` (no `if true`)
- [x] Cliente solo **lee** `users/{uid}` y subcolecciones; **escritura solo vía backend** (Admin SDK)
- [x] `recentSessions` y `evaluations`: read owner / write false
- [x] Limpieza de `currentSession` obsoleta vía `POST /api/session/discard-stale` (no `updateDoc` en cliente)
- [x] Todos los endpoints de sesión/mesociclo requieren Bearer token
- [x] `generateV2` ya no acepta `userId` sin autenticación
- [ ] Desplegar `firestore.rules` a producción: `firebase deploy --only firestore:rules --project fitgen-d94f6`
- [ ] Verificar que `FIREBASE_SERVICE_ACCOUNT` está configurado en Vercel
- [ ] Activar Firebase App Check antes de beta pública

## Registro y acceso

- [x] Auto-aprobación en `POST /api/profile/save` (custom claim + `status: approved`)
- [x] Sin pasarela de pago en UI ni código
- [x] Landing sin sección de pricing
- [ ] Probar flujo completo: registro → onboarding → mesociclo → sesión

## Catálogo de ejercicios

- [x] Catálogo curado en `colecciones/curated/` (729 ejercicios gym-viable tras deduplicación)
- [x] Script `npm run curate-catalog` (deduplica nombres, resuelve colisiones de `id`, valida enums)
- [x] Script `npm run verify-catalog` (validación local)
- [x] Subir a Firestore: `npm run upload-catalog -- --yes`
- [x] Verificar en producción: `npm run verify-catalog:remote`

## Motor de entrenamiento

- [x] Domain layer según DDS v1.0 (`domain/`)
- [x] Integración motor: deload 50%, feedback semanal RP, meseta, evaluate, sets por músculo
- [x] 29 tests pasando (unit + simulación de 6 personas × 2 mesociclos)
- [x] Correr simulación extendida antes de cada release: `npm test`

## QA manual (máquina del tiempo)

```bash
# Crear usuario de prueba, completar onboarding, generar mesociclo
DEV_TOOLS=true npm run advance-time -- --user <UID> --days 7
# Repetir para avanzar semanas sin esperar tiempo real
```

## Beta testers

- [ ] Compartir URL de la PWA
- [ ] Canal de feedback (WhatsApp / Discord / formulario)
- [ ] Documentar cómo reportar bugs: incluir UID, pantalla, pasos

## Monitoreo

- [ ] Revisar logs de Vercel tras primeras sesiones
- [ ] Alertas si `501 not_implemented` aparece (indica endpoint sin implementar)

## Post-beta (fuera de alcance v1)

- MercadoPago
- Objetivos adicionales (resistencia, pérdida de grasa)
- Contexto "gimnasio lleno"
