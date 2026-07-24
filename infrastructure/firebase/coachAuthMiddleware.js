import { auth } from '../../lib/firebaseAdmin.js';
import { createCoachRepository } from './coachRepository.js';
import { createUserRepository } from './userRepository.js';
import { db } from '../../lib/firebaseAdmin.js';
import { ACCOUNT_TYPES } from '../../domain/coach/constants.js';

const coaches = createCoachRepository(db);
const users = createUserRepository(db);

export async function authenticateRequest(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Token requerido'), { status: 401 });
  const decoded = await auth.verifyIdToken(match[1]);
  return { uid: decoded.uid, email: decoded.email ?? null, claims: decoded };
}

export async function requireCoach(req) {
  const authUser = await authenticateRequest(req);
  const user = await users.getUser(authUser.uid);
  const accountType = user?.accountType ?? authUser.claims?.accountType;
  if (accountType !== ACCOUNT_TYPES.COACH) {
    throw Object.assign(new Error('Solo coaches'), { status: 403 });
  }
  const coach = await coaches.getCoach(authUser.uid);
  if (!coach) {
    throw Object.assign(new Error('Perfil de coach no encontrado'), { status: 404 });
  }
  return { authUser, coach, users, coaches };
}

export async function assertClientOwnership(coachId, athleteId) {
  const relation = await coaches.getClientRelation(coachId, athleteId);
  if (!relation) {
    throw Object.assign(new Error('Cliente no vinculado a este coach'), { status: 403 });
  }
  const athlete = await users.getUser(athleteId);
  if (!athlete || athlete.coachId !== coachId) {
    throw Object.assign(new Error('Cliente no vinculado a este coach'), { status: 403 });
  }
  return { relation, athlete };
}

export { coaches, users };
