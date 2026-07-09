/**
 * DDS 8.5 — pre-session readiness autoregulation.
 * Never increases demand; volume multiplier capped at 1.0.
 *
 * @param {object} readiness
 * @param {number} readiness.energyLevel — 1-5
 * @param {number} readiness.sorenessLevel — 1-5
 * @param {string} [readiness.sorenessZone] — muscle/zone name
 * @param {number} [readiness.sleepQuality] — 1-5
 * @param {number} [readiness.stressLevel] — 1-5 (informational, no auto-increase)
 * @param {string} [readiness.externalLoad] — ninguna|ligera|moderada|alta
 * @param {string[]} sessionMuscles — muscles trained today
 * @returns {{ volumeMultiplier: number, rirDelta: number, messages: string[] }}
 */
export function applyReadiness(readiness, sessionMuscles) {
  let volumeMultiplier = 1.0;
  let rirDelta = 0;
  const messages = [];

  const {
    energyLevel = 3,
    sorenessLevel = 1,
    sorenessZone = '',
    sleepQuality = 3,
    stressLevel = 3,
    externalLoad = 'ninguna',
  } = readiness;

  if (energyLevel <= 2) {
    volumeMultiplier *= 0.6;
    rirDelta += 2;
    messages.push(
      'Energía baja: reducimos volumen para proteger tu sistema nervioso',
    );
  }

  const sorenessInSessionZone =
    sorenessLevel >= 4 &&
    sorenessZone &&
    sessionMuscles.some(
      (m) =>
        m.toLowerCase().includes(sorenessZone.toLowerCase()) ||
        sorenessZone.toLowerCase().includes(m.toLowerCase()),
    );

  if (sorenessInSessionZone) {
    volumeMultiplier *= 0.7;
    rirDelta += 2;
    messages.push(
      'Dolor muscular alto en la zona de hoy: bajamos intensidad mecánica',
    );
  }

  if (sleepQuality <= 2) {
    rirDelta += 1;
    messages.push(
      'Sueño insuficiente: pedimos menos proximidad al fallo hoy',
    );
  }

  if (stressLevel >= 4) {
    volumeMultiplier *= 0.9;
    rirDelta += 1;
    messages.push(
      'Estrés elevado: reducimos ligeramente la exigencia de hoy',
    );
  }

  if (externalLoad === 'alta') {
    volumeMultiplier *= 0.85;
    messages.push(
      'Carga externa alta hoy (trabajo/deporte): sesión ligeramente reducida',
    );
  }

  volumeMultiplier = Math.min(volumeMultiplier, 1.0);
  rirDelta = Math.max(rirDelta, 0);

  return {
    volumeMultiplier,
    rirDelta,
    messages,
    userMessage: messages.length
      ? messages.join('. ')
      : 'Sin ajustes: usamos la prescripción base del mesociclo',
  };
}
