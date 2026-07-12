import { countMuscleSessionsPerWeek, SPLIT_SESSIONS } from '../constants.js';

const GRADES = ['insuficiente', 'aceptable', 'muy_bien', 'excelente'];

const LEG_MUSCLES = ['Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Pantorrillas'];
const UPPER_PUSH = ['Pecho', 'Hombro', 'Tríceps'];
const UPPER_PULL = ['Espalda', 'Bíceps', 'Hombro'];

/**
 * Score weekly split assignment against DDS training principles.
 * @param {object} input
 * @returns {{ score: number, grade: string, issues: string[], metrics: object }}
 */
export function evaluateSplitQuality(input) {
  const {
    splitType,
    goal = 'Hipertrofia',
    experienceLevel = 'Intermedio',
    trainingDaysPerWeek = 3,
    effectiveTrainingDays,
    sessions = [],
  } = input;

  const issues = [];
  let score = 100;
  const days = effectiveTrainingDays ?? sessions.length;
  const templateFreq = countMuscleSessionsPerWeek(splitType);
  const templates = SPLIT_SESSIONS[splitType] ?? [];

  const actualFreq = countActualMuscleFrequency(sessions);
  const patterns = sessions.map((s) => s.patterns?.[0] ?? 'General');

  // --- Hard constraints ---
  if (days >= 7) {
    issues.push('Entrena 7 días sin descanso semanal');
    score -= 25;
  }

  if (days === 1) {
    issues.push('Solo 1 sesión/semana — límite físico del calendario');
    score -= 20;
  } else if (days === 2) {
    issues.push('Solo 2 sesiones/semana — volumen semanal limitado');
    score -= 10;
  }

  // Leg coverage in assigned sessions
  const legSessions = sessions.filter((s) =>
    (s.patterns ?? []).some((p) => p === 'Rodilla' || p === 'Cadera'),
  ).length;
  const hasRodilla = sessions.some((s) => (s.patterns ?? []).includes('Rodilla'));
  const hasCadera = sessions.some((s) => (s.patterns ?? []).includes('Cadera'));

  if (days >= 3 && !legSessions) {
    issues.push('Sin sesión de pierna en la semana');
    score -= 30;
  }
  if (days >= 4 && (!hasRodilla || !hasCadera)) {
    issues.push('Pierna incompleta: falta patrón Rodilla o Cadera');
    score -= 20;
  }
  if (days === 3 && legSessions === 1 && hasRodilla && !hasCadera) {
    issues.push('3 días: pierna solo dominante rodilla, sin cadera');
    score -= 18;
  }
  if (days === 3 && legSessions === 1 && !hasRodilla && hasCadera) {
    issues.push('3 días: pierna solo dominante cadera, sin rodilla');
    score -= 18;
  }

  // Torso balance for 3+ days
  const pushSessions = sessions.filter((s) =>
    (s.patterns ?? []).some((p) => p === 'Empuje_H' || p === 'Empuje_V'),
  ).length;
  const pullSessions = sessions.filter((s) =>
    (s.patterns ?? []).some((p) => p === 'Traccion_H' || p === 'Traccion_V'),
  ).length;

  if (days >= 3 && pushSessions === 0) {
    issues.push('Sin estímulo de empuje en la semana');
    score -= 25;
  }
  if (days >= 3 && pullSessions === 0) {
    issues.push('Sin estímulo de tracción en la semana');
    score -= 25;
  }
  if (days >= 4 && Math.abs(pushSessions - pullSessions) > 1) {
    issues.push('Desbalance empuje/tracción en la semana');
    score -= 8;
  }

  // Fuerza: main lift frequency
  if (goal === 'Fuerza' && days >= 3) {
    const pechoFreq = actualFreq.Pecho ?? 0;
    const espaldaFreq = actualFreq.Espalda ?? 0;
    if (pechoFreq < 2 && days >= 4) {
      issues.push('Fuerza: pecho < 2×/semana con 4+ días');
      score -= 15;
    }
    if (espaldaFreq < 2 && days >= 4) {
      issues.push('Fuerza: espalda < 2×/semana con 4+ días');
      score -= 15;
    }
    if (days === 3 && pechoFreq < 1) {
      issues.push('Fuerza: sin estímulo de pecho');
      score -= 20;
    }
  }

  // Consecutive same dominant pattern
  for (let i = 1; i < patterns.length; i += 1) {
    if (patterns[i] === patterns[i - 1]) {
      issues.push(`Patrón ${patterns[i]} en días consecutivos`);
      score -= 6;
      break;
    }
  }

  // Consecutive leg sessions
  for (let i = 1; i < sessions.length; i += 1) {
    const prevLeg = isLegSession(sessions[i - 1]);
    const currLeg = isLegSession(sessions[i]);
    if (prevLeg && currLeg) {
      issues.push('Dos sesiones de pierna en días consecutivos');
      score -= 5;
      break;
    }
  }

  // Template repetition when days > templates
  if (days > templates.length) {
    const names = sessions.map((s) => s.sessionFocus);
    const unique = new Set(names).size;
    if (unique < templates.length) {
      issues.push('Repite plantillas idénticas más de lo necesario');
      score -= 4;
    }
  }

  // Novato + high frequency split
  if (experienceLevel === 'Novato' && days >= 6) {
    issues.push('Novato con 6+ días — alta demanda de recuperación');
    score -= 6;
  }

  // Hombro overload
  if ((actualFreq.Hombro ?? 0) >= 3 && days <= 5) {
    issues.push('Hombro estimulado 3+ veces/semana');
    score -= 4;
  }

  score = Math.max(0, Math.min(100, score));

  const grade = scoreToGrade(score, days);

  return {
    score,
    grade,
    issues,
    metrics: {
      actualMuscleFrequency: actualFreq,
      templateMuscleFrequency: templateFreq,
      pushSessions,
      pullSessions,
      legSessions,
      hasRodilla,
      hasCadera,
    },
  };
}

function countActualMuscleFrequency(sessions) {
  const freq = {};
  for (const session of sessions) {
    for (const muscle of session.muscles ?? []) {
      freq[muscle] = (freq[muscle] ?? 0) + 1;
    }
  }
  return freq;
}

function isLegSession(session) {
  const focus = session.sessionFocus ?? '';
  if (/pierna|legs|lower\s*\(/i.test(focus)) return true;
  if (/full body|push|pull|torso|upper/i.test(focus)) return false;
  const patterns = session.patterns ?? [];
  const hasLeg = patterns.some((p) => p === 'Rodilla' || p === 'Cadera');
  const hasUpper = patterns.some(
    (p) => p === 'Empuje_H' || p === 'Empuje_V' || p === 'Traccion_H' || p === 'Traccion_V',
  );
  return hasLeg && !hasUpper;
}

function scoreToGrade(score, days) {
  // Calendars with ≤2 days cannot reach "excelente" by design
  const maxGrade =
    days <= 1 ? 'aceptable' : days === 2 ? 'muy_bien' : 'excelente';

  let grade = 'insuficiente';
  if (score >= 85) grade = 'excelente';
  else if (score >= 72) grade = 'muy_bien';
  else if (score >= 55) grade = 'aceptable';

  const maxIdx = GRADES.indexOf(maxGrade);
  const gradeIdx = GRADES.indexOf(grade);
  if (gradeIdx > maxIdx) grade = maxGrade;

  return grade;
}

export { GRADES };
