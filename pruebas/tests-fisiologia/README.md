# 🔬 Tests de Fisiología del Entrenamiento - FitGen Backend

## 📋 Descripción

Suite completa de tests diseñada por principios científicos del entrenamiento para validar que el sistema de generación de sesiones de FitGen cumple con los más altos estándares de ciencias del deporte.

---

## 🎯 Objetivos de los Tests

### **1. Seguridad Biomecánica** ✅
- Validar que RPE/RIR sean apropiados según nivel de experiencia
- Verificar que incrementos de carga sean seguros (≤2.5% compuestos, ≤5% aislamiento)
- Confirmar que adultos mayores reciben safety profiles
- Asegurar que pesos limitados no se excedan
- Validar filtrado de ejercicios según lesiones reportadas

### **2. Sobrecarga Progresiva** 📈
- Verificar que Semana 1 use pesos exploratorios
- Confirmar que Semana 2+ use historial para calcular cargas
- Validar incremento lineal consistente entre semanas
- Verificar ajustes por RIR bajo/alto
- Confirmar progresión por reps cuando peso máximo alcanzado

### **3. Especificidad del Objetivo** 🎯
- **Hipertrofia**: Reps 6-12, descansos 60-120s
- **Fuerza Máxima**: Reps 1-6, descansos 180-300s
- **Pérdida de Grasa**: Reps 12-20, descansos 30-60s
- Volumen semanal apropiado según nivel
- Orden correcto: compuestos → accesorios → aislamiento

---

## 📁 Estructura del Proyecto

```
pruebas/tests-fisiologia/
├── profiles/                          # Perfiles de usuario variados
│   ├── beginner-home.json            # Principiante en casa
│   ├── intermediate-gym.json         # Intermedio en gym
│   ├── advanced-home-equipped.json   # Avanzado en casa equipada
│   ├── senior-limited.json           # Adulto mayor con equipo limitado
│   └── female-intermediate-gym.json  # Mujer intermedia en gym
│
├── mesocycles/                        # Mesociclos de ejemplo (por crear)
│   ├── hypertrophy-4week.json
│   ├── strength-6week.json
│   └── fatloss-home.json
│
├── results/                           # Resultados de ejecución (JSON)
│
├── utils-test.mjs                     # Utilidades comunes
├── test-1-seguridad-biomecanica.mjs  # Test de seguridad
├── test-2-sobrecarga-progresiva.mjs  # Test de progresión
├── test-3-especificidad-objetivo.mjs # Test de especificidad
└── run-all-tests.mjs                 # Script maestro
```

---

## 🚀 Cómo Ejecutar los Tests

### **Opción 1: Ejecutar TODOS los tests**
```bash
cd pruebas/tests-fisiologia
node run-all-tests.mjs
```

### **Opción 2: Ejecutar test individual**
```bash
# Test de seguridad biomecánica
node test-1-seguridad-biomecanica.mjs

# Test de sobrecarga progresiva
node test-2-sobrecarga-progresiva.mjs

# Test de especificidad del objetivo
node test-3-especificidad-objetivo.mjs
```

---

## 📊 Interpretación de Resultados

### **Salida en Consola**
```
✅ PASÓ   - El test cumplió con todos los criterios
❌ FALLÓ  - El test no cumplió con al menos un criterio
⚠️  Advertencia - El test pasó pero tiene observaciones
```

### **Archivos JSON Generados**
Los resultados se guardan en `results/` con el siguiente formato:
```json
{
  "test": "Test 1: Seguridad Biomecánica",
  "timestamp": "2026-01-18T10:30:00Z",
  "resumen": {
    "total": 6,
    "pasados": 5,
    "fallados": 1,
    "porcentajeExito": "83.3%"
  },
  "advertencias": 2,
  "resultados": [...]
}
```

---

## 🔬 Fundamentos Científicos

### **Principios Implementados**

1. **Sobrecarga Progresiva** (Kraemer & Ratamess, 2004)
   - Incremento gradual de carga para adaptación continua
   - Límites: 2.5% compuestos, 5% aislamiento por sesión

2. **Especificidad** (SAID Principle - Wallis et al., 2019)
   - Adaptaciones específicas a las demandas impuestas
   - Reps/descansos alineados con objetivo

3. **Variación** (Rhea et al., 2002)
   - Prevención de mesetas con variación programada
   - Cambio de ejercicios entre mesociclos

4. **Recuperación** (Schoenfeld, 2010)
   - Volumen semanal dentro de rangos seguros (10-30 sets/músculo)
   - Safety profiles para poblaciones especiales

5. **Autoregulación** (Helms et al., 2018)
   - Ajustes basados en RPE/RIR reportado
   - Modificación de volumen según readiness

### **Referencias Científicas**

- Haff, G. G., & Triplett, N. T. (2016). *Essentials of Strength Training and Conditioning* (4th ed.). Human Kinetics.
- Schoenfeld, B. J. (2010). The mechanisms of muscle hypertrophy. *Journal of Strength and Conditioning Research*, 24(10), 2857-2872.
- Helms, E. R., et al. (2018). Rating of perceived exertion as a method of volume autoregulation. *Journal of Strength and Conditioning Research*, 32(6), 1627-1636.
- ACSM (2009). American College of Sports Medicine position stand: Progression models in resistance training. *Medicine & Science in Sports & Exercise*, 41(3), 687-708.

---

## 🛠️ Personalización de Tests

### **Agregar Nuevos Perfiles**
Crea un archivo JSON en `profiles/`:
```json
{
  "userId": "test-mi-perfil",
  "profileData": {
    "age": 30,
    "weight": 70,
    "height": 175,
    "gender": "male",
    "experienceLevel": "Intermedio",
    "fitnessGoal": "Hipertrofia",
    "preferredTrainingLocation": "gym"
  }
}
```

### **Agregar Nuevos Tests**
1. Crea `test-N-nombre-test.mjs`
2. Importa utilidades desde `utils-test.mjs`
3. Implementa casos de prueba
4. Genera reporte y guarda resultados
5. Agrégalo a `run-all-tests.mjs`

---

## 📈 Casos de Uso

### **Validación Pre-Despliegue**
```bash
# Ejecutar antes de deploy a producción
npm run test:fisiologia
```

### **Desarrollo de Nuevas Funciones**
```bash
# Ejecutar tests específicos durante desarrollo
node test-1-seguridad-biomecanica.mjs
```

### **Auditoría de Calidad**
```bash
# Ejecutar con múltiples perfiles
# Analizar resultados en results/
```

---

## ⚠️ Limitaciones Actuales

1. **Tests simulados**: Los tests actuales usan datos simulados. Para tests completos, integrar con endpoint real.
2. **Cobertura parcial**: Se cubren los aspectos más críticos, pero se puede expandir.
3. **Sin tests de carga**: No hay tests de performance/carga del sistema.

---

## 🔮 Mejoras Futuras

- [ ] Integración con endpoint real `/api/session/generateV2`
- [ ] Tests de autoregulación con múltiples ciclos
- [ ] Tests de gestión de fatiga (low-load pivots)
- [ ] Tests de consistencia estructural (Semana 2+ replica Semana 1)
- [ ] Tests de variación inter-mesociclo
- [ ] Tests de performance (tiempo de generación)
- [ ] Tests de edge cases (usuarios extremos)

---

## 📞 Soporte

Si encuentras problemas o tienes sugerencias:
1. Revisa los archivos de resultados en `results/`
2. Verifica que los perfiles tengan la estructura correcta
3. Asegúrate de estar en Node.js v18+

---

## 📜 Licencia

Parte del proyecto FitGen Backend v2.0
© 2026 - Todos los derechos reservados

---

**Última actualización**: 18 de Enero, 2026
**Versión**: 1.0.0
**Autor**: Sistema de Generación FitGen (con Claude Sonnet 4.5)
