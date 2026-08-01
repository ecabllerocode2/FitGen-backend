import { db, auth } from '../../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../../infrastructure/firebase/userRepository.js';
import { ensureDirectAthleteBilling } from '../../../domain/billing/athleteAccess.js';
import {
  fetchAuthorizedPayment,
  fetchPreapproval,
  verifyWebhookSignature,
} from '../../../domain/billing/mercadoPagoClient.js';
import { createFirestoreBillingEventStore } from '../../../domain/billing/eventStoreFirestore.js';
import { processBillingNotification } from '../../../domain/billing/webhookSync.js';

const users = createUserRepository(db);
const eventStore = createFirestoreBillingEventStore(db);

function extractNotification(req) {
  const body = req.body || {};
  const query = req.query || {};

  const type =
    body.type ||
    body.topic ||
    query.type ||
    query.topic ||
    null;

  const dataId =
    body?.data?.id ||
    body?.id ||
    query['data.id'] ||
    query.id ||
    null;

  return { type: type ? String(type) : null, dataId: dataId ? String(dataId) : null };
}

async function findUserByPreapprovalId(preapprovalId) {
  const snap = await db
    .collection('users')
    .where('mpPreapprovalId', '==', preapprovalId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function resolveUser(preapproval) {
  const userId = preapproval?.external_reference;
  let user = userId ? await users.getUser(userId) : null;
  let targetUserId = userId;

  if (!user && preapproval?.id) {
    user = await findUserByPreapprovalId(preapproval.id);
    targetUserId = user?.id ?? null;
  }

  return { userId: targetUserId, user };
}

/**
 * POST /api/billing/mp/webhook
 * Mercado Pago notifications for subscription_preapproval / authorized payments.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { type, dataId } = extractNotification(req);
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];

    const valid = verifyWebhookSignature({
      xSignature,
      xRequestId,
      dataId,
    });
    if (!valid) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    if (!dataId) {
      return res.status(200).json({ ok: true, ignored: true, reason: 'no_data_id' });
    }

    const result = await processBillingNotification({
      eventStore,
      type,
      dataId,
      fetchPreapproval,
      fetchAuthorizedPayment,
      resolveUser,
      users,
      auth,
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('billing/mp webhook error:', err);
    const status = err.status >= 500 || !err.status ? 500 : 200;
    return res.status(status).json({ error: err.message ?? 'Error webhook' });
  }
}

export { ensureDirectAthleteBilling };
