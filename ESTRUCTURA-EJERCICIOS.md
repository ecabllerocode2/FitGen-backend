# Estructura del Catálogo de Ejercicios — FitGen v2

**Versión:** 2.0 (gym-only, 3 documentos Firestore)

---

## Documentos Firestore

| Documento | Ruta | Contenido |
|---|---|---|
| Calentamiento | `catalogs/calentamiento` | Ejercicios `categoriaBloque: calentamiento` (RAMP) |
| Enfriamiento | `catalogs/enfriamiento` | Ejercicios `categoriaBloque: enfriamiento` |
| Entrenamiento | `catalogs/entrenamiento` | `main_block` + `core` unificados |

Cada documento tiene la forma:

```json
{
  "id": "calentamiento | enfriamiento | entrenamiento",
  "updatedAt": "ISO8601",
  "count": 74,
  "items": [ /* array de ejercicios */ ]
}
```

**Lecturas por generación de sesión:** 3 (una por documento).

---

## Schema de un ejercicio (`items[]`)

```json
{
  "id": "Barbell_Bench_Press",
  "nombre": "Press de Banca con Barra",
  "descripcion": "Descripción de ejecución",
  "correcciones": ["Corrección común 1"],
  "categoriaBloque": "main_block",
  "faseRAMP": null,
  "prioridad": 1,
  "patronMovimiento": "Empuje_H",
  "parteCuerpo": "Pecho",
  "dificultadTecnica": "Media",
  "equipo": ["Barra Olímpica", "Banco Ajustable"],
  "isUnilateral": false,
  "isDynamic": true,
  "url_img_0": "https://...",
  "url_img_1": "https://..."
}
```

### Campos obligatorios

`id`, `nombre`, `categoriaBloque`, `patronMovimiento`, `parteCuerpo`, `prioridad`

### `categoriaBloque`

`calentamiento` | `main_block` | `core` | `enfriamiento`

### `faseRAMP` (solo calentamiento)

`Raise` | `Activate` | `Mobilize` | `Potentiate` | `null`

### `prioridad`

`1` = multiarticular (compuesto) | `2` = accesorio | `3` = aislamiento

### `patronMovimiento`

`Empuje_H` | `Empuje_V` | `Traccion_H` | `Traccion_V` | `Rodilla` | `Cadera` | `Core` | `General`

### `equipo`

Siempre **array** de strings. Equipo de gimnasio comercial estándar.

---

## Scripts

```bash
# Curar catálogo localmente
node scripts/curateCatalog.cjs

# Subir a Firestore de producción (pide confirmación)
node scripts/uploadCatalog.cjs
node scripts/uploadCatalog.cjs --yes   # sin confirmación interactiva
```

## Archivos locales

- `colecciones/ejercicios-actualizados.json` — fuente original (736 ejercicios)
- `colecciones/ejercicios-gym.json` — catálogo curado unificado
- `colecciones/curated/{calentamiento,enfriamiento,entrenamiento}.json` — listos para Firestore
