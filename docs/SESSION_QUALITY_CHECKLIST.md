# FitGen — Checklist de Calidad de Sesión

Criterios verificables antes de cada release beta.

## Volumen y periodización

- [ ] Sets semanales por músculo dentro de [MEV, MRV] tras dividir por frecuencia del split
- [ ] RIR descendente en semanas de acumulación
- [ ] Deload ≈ 50% del volumen de la última semana de acumulación
- [ ] Feedback RP al cierre de semana modifica volumen de la semana siguiente

## Prescripción de carga

- [ ] Primera sesión sin historial: modo exploratorio (carga null, sugerencia opcional)
- [ ] Progresión de carga solo con historial real del usuario
- [ ] Caps de incremento semanal y por sesión aplicados

## Selección de ejercicios

- [ ] Continuidad semana 2+ anclada a selección de semana 1
- [ ] Meseta: cambio de rep range antes de swap de variante
- [ ] Ejercicios excluidos por lesión no aparecen en sesión
- [ ] Protocolo conservador bloquea carga axial libre en semanas 1-2

## Calentamiento RAMP

- [ ] ≤ 8 ítems por sesión (4 fases × 2)
- [ ] Incluye movilidad del patrón del día
- [ ] Prehab integrado si hay lesión reportada
- [ ] Rotación entre semanas (no siempre los mismos 2 primeros)

## Feedback y UX

- [ ] Post-sesión: pump, soreness timing, dificultad, dolor articular (estilo RP)
- [ ] RIR registrado en cada serie de trabajo del bloque principal
- [ ] Swap de ejercicio funcional end-to-end
- [ ] Fin de mesociclo dispara evaluación automática

## Comandos de verificación

```bash
npm test
npm run verify-catalog:remote
node scripts/auditCatalogQuality.cjs
npm run qa-mesocycle -- --user <UID>
```
