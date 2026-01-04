import fs from 'fs/promises';
import { addDays, format } from 'date-fns';
import { db, auth } from '../lib/firebaseAdmin.js';
import generateHandler from '../api/session/generate.js';

// --------------------------- CONFIG ---------------------------
const TEST_USER_ID = 'u9whVKtPEeT8VNvpRIJlX6ZebfI3';
const OUTPUT_FILE = `./simulated_sessions_${TEST_USER_ID}.json`;
const DAYS_TO_SIMULATE = 20;

// --------------------------- HELPERS --------------------------
// Toggle: si false -> solo generar JSON local sin escribir en Firestore
const WRITE_TO_FIRESTORE = false;
// Bypass de verificación de token para ejecutar handler directamente
auth.verifyIdToken = async () => ({ uid: TEST_USER_ID });

function createMockReq(dateStr, preFeedback = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer FAKE_TOKEN' },
    body: {
      date: dateStr,
      realTimeFeedback: preFeedback
    }
  };
}

function createMockRes() {
  let statusCode = 200;
  let payload = null;
  const headers = {};
  return {
    res: {
      setHeader(name, value) { headers[name] = value; },
      status(code) { statusCode = code; return this; },
      json(data) { payload = data; return this; },
      end() { return this; }
    },
    getData() { return { statusCode, payload, headers }; }
  };
}

function extractNumericLoad(loadStr) {
  if (!loadStr) return null;
  const m = String(loadStr).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// Crea actualSets simuladas a partir de la sesión planificada
function simulateCompletion(plannedSession, dayIndex) {
  const session = JSON.parse(JSON.stringify(plannedSession));

  const totalPlannedSets = session.mainBlocks?.flatMap(b => b.exercises || []).reduce((s, e) => s + (e.sets || 0), 0) || 0;
  const baseRPE = Math.min(9, 6 + Math.floor(totalPlannedSets / 8) + (dayIndex % 3));
  const energy = Math.max(1, 5 - (dayIndex % 4));
  const soreness = Math.min(5, 1 + (dayIndex % 3));

  // Feedback global post sesión
  session.feedback = {
    rpe: baseRPE,
    energyLevel: energy,
    sorenessLevel: soreness,
    notes: `Simulación día ${dayIndex + 1}. Volumen: ${totalPlannedSets} series.`
  };
  // Feedback post sesión extendido
  session.postSessionFeedback = {
    mood: ["excelente", "bien", "normal", "cansado", "agotado"][Math.floor(Math.random()*5)],
    perceivedDifficulty: baseRPE >= 8 ? "alta" : baseRPE <= 6 ? "baja" : "media",
    recovery: Math.max(1, 5 - (dayIndex % 5)),
    notes: `Feedback post sesión simulado para el día ${dayIndex + 1}.`
  };

  session.meta = session.meta || {};
  session.meta.completedAt = new Date().toISOString();

  // Helper para feedback por set
  function genSetFeedback(setIdx, plannedReps, isHard) {
    return {
      perceivedRIR: isHard ? Math.max(0, 1 - (setIdx % 2)) : 2 + (setIdx % 2),
      perceivedEffort: isHard ? "alta" : "media",
      focus: ["bueno", "distraído", "óptimo"][setIdx % 3],
      notes: isHard ? "Set exigente" : "Set controlado",
      reps: plannedReps
    };
  }

  // Main blocks
  if (session.mainBlocks) {
    session.mainBlocks = session.mainBlocks.map((block, blockIdx) => {
      const newBlock = { ...block };
      newBlock.exercises = (block.exercises || []).map((ex, exIndex) => {
        const plannedSets = ex.sets || ex.performanceData?.plannedSets || 3;
        let targetReps = 10;
        if (typeof ex.targetReps === 'number') targetReps = ex.targetReps;
        else if (typeof ex.targetReps === 'string') {
          const m = ex.targetReps.match(/(\d+)/);
          if (m) targetReps = parseInt(m[1], 10);
        }

        const isHardDay = (dayIndex + exIndex + blockIdx) % 3 === 0;
        const actualSets = Array.from({ length: plannedSets }).map((_, sIdx) => {
          const rir = isHardDay ? Math.max(0, 1 - (sIdx % 2)) : Math.max(0, 3 - (sIdx % 2));
          const repsNoise = isHardDay ? -1 : +1;
          const reps = Math.max(1, targetReps + repsNoise - Math.floor(Math.random() * 2));
          const loadVal = extractNumericLoad(ex.suggestedLoad) || extractNumericLoad(ex.performanceData?.lastLoad) || null;
          const loadLabel = ex.suggestedLoad || (loadVal ? `${loadVal} kg` : 'Tu peso');
          return {
            setNumber: sIdx + 1,
            reps,
            rir,
            load: loadLabel,
            setFeedback: genSetFeedback(sIdx, reps, isHardDay)
          };
        });

        return {
          ...ex,
          performanceData: {
            plannedSets,
            actualSets
          }
        };
      });
      return newBlock;
    });
  }

  // Core blocks (si existen)
  if (session.coreBlocks && Array.isArray(session.coreBlocks)) {
    session.coreBlocks = session.coreBlocks.map((block, blockIdx) => {
      if (!block.exercises) return block;
      const newBlock = { ...block };
      newBlock.exercises = block.exercises.map((ex, exIndex) => {
        const plannedSets = ex.sets || ex.performanceData?.plannedSets || 3;
        let targetReps = 15;
        if (typeof ex.targetReps === 'number') targetReps = ex.targetReps;
        else if (typeof ex.targetReps === 'string') {
          const m = ex.targetReps.match(/(\d+)/);
          if (m) targetReps = parseInt(m[1], 10);
        }
        const isHardDay = (dayIndex + exIndex + blockIdx) % 3 === 0;
        const actualSets = Array.from({ length: plannedSets }).map((_, sIdx) => {
          const rir = isHardDay ? Math.max(0, 1 - (sIdx % 2)) : Math.max(0, 3 - (sIdx % 2));
          const repsNoise = isHardDay ? -1 : +1;
          const reps = Math.max(1, targetReps + repsNoise - Math.floor(Math.random() * 2));
          const loadLabel = ex.suggestedLoad || 'Tu peso';
          return {
            setNumber: sIdx + 1,
            reps,
            rir,
            load: loadLabel,
            setFeedback: genSetFeedback(sIdx, reps, isHardDay)
          };
        });
        return {
          ...ex,
          performanceData: {
            plannedSets,
            actualSets
          }
        };
      });
      return newBlock;
    });
  }

  return session;
}

async function runSimulation() {
  const userRef = db.collection('users').doc(TEST_USER_ID);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    console.error(`Usuario ${TEST_USER_ID} no encontrado en Firestore.`);
    process.exit(1);
  }

  const userData = userSnap.data() || {};
  const currentMesocycle = userData.currentMesocycle;
  if (!currentMesocycle || !currentMesocycle.startDate) {
    console.error('El usuario no tiene un currentMesocycle con startDate configurado.');
    process.exit(1);
  }

  const startDate = new Date(currentMesocycle.startDate);

  if (!WRITE_TO_FIRESTORE) {
    console.log('WRITE_TO_FIRESTORE=false → no se escribirá nada en Firestore; solo se generará el JSON local.');
  }

  const allSessions = [];

  for (let i = 0; i < DAYS_TO_SIMULATE; i++) {
    const dateObj = addDays(startDate, i);
    const dateStr = format(dateObj, 'yyyy-MM-dd');

    const preFeedback = {
      energyLevel: Math.max(1, 5 - (i % 4)),
      sorenessLevel: Math.min(5, 1 + (i % 3))
    };

    console.log(`Generando día ${i + 1} - ${dateStr} (preFeedback: energy=${preFeedback.energyLevel}, soreness=${preFeedback.sorenessLevel})`);

    const req = createMockReq(dateStr, preFeedback);
    const { res, getData } = createMockRes();
    try {
      await generateHandler(req, res);
    } catch (err) {
      console.error('Error al ejecutar generateHandler:', err);
      throw err;
    }
    const { statusCode, payload } = getData();
    if (statusCode !== 200 || !payload?.session) {
      console.error('Fallo generación sesión:', statusCode, payload);
      throw new Error('Fallo al generar sesión planificada.');
    }
    const planned = payload.session;

    const completed = simulateCompletion(planned, i);

    if (WRITE_TO_FIRESTORE) {
      await userRef.collection('history').add(completed);
      console.log(`Sesión ${i + 1} guardada en history.`);
    } else {
      console.log(`Sesión ${i + 1} generada (no escrita). Ejercicios principales: ${completed.mainBlocks?.flatMap(b => b.exercises || []).length || 0}`);
    }
    allSessions.push(completed);
  }

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(allSessions, null, 2), 'utf8');
  console.log(`Simulación completa. Archivo generado: ${OUTPUT_FILE}`);
}

runSimulation().catch(err => {
  console.error('Error en simulación:', err);
  process.exit(1);
});
