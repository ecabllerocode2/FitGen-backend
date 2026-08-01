import { db, auth } from '../../../lib/firebaseAdmin.js';
import { createUserRepository } from '../../../infrastructure/firebase/userRepository.js';
import {
  ensureDirectAthleteBilling,
  evaluateAthleteBillingAccess,
  mapMpPreapprovalStatus,
} from '../../../domain/billing/athleteAccess.js';
import {
  fetchAuthorizedPayment,
  fetchPreapproval,
  verifyWebhookSignature,
} from '../../../domain/billing/mercadoPagoClient.js';
import { SUBSCRIPTION_STATUS } from '../../../domain/billing/constants.js';

const users = createUserRepository(db);

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

  const action = body.action || null;
  return { type: type ? String(type) : null, dataId: dataId ? String(dataId) : null, action };
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

async function applyPreapprovalToUser(preapproval) {
  const userId = preapproval.external_reference;
  const mpStatus = preapproval.status;
  const subscriptionStatus = mapMpPreapprovalStatus(mpStatus);

  let targetUserId = userId;
  let user = userId ? await users.getUser(userId) : null;

  if (!user && preapproval.id) {
    user = await findUserByPreapprovalId(preapproval.id);
    targetUserId = user?.id ?? null;
  }

  if (!targetUserId || !user) {
    console.warn('MP webhook: user not found for preapproval', preapproval.id, userId);
    return { ok: false, reason: 'user_not_found' };
  }

  const patch = {
    mpPreapprovalId: preapproval.id,
    mpStatus,
    subscriptionStatus,
    billingUpdatedAt: new Date().toISOString(),
  };

  if (subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE) {
    patch.subscriptionActivatedAt = new Date().toISOString();
  }

  if (
    subscriptionStatus === SUBSCRIPTION_STATUS.CANCELED ||
    subscriptionStatus === SUBSCRIPTION_STATUS.EXPIRED
  ) {
    patch.subscriptionCanceledAt = new Date().toISOString();
  }

  await users.saveUser(targetUserId, patch);

  // Keep Firebase claim access aligned for hard clients that read claims.
  try {
    const refreshed = { ...user, ...patch };
    const access = evaluateAthleteBillingAccess(refreshed);
    const existing = await auth.getUser(targetUserId);
    const claims = { ...(existing.customClaims || {}) };
    claims.access = access.allowed;
    claims.subscriptionStatus = subscriptionStatus;
    await auth.setCustomUserClaims(targetUserId, claims);
  } catch (claimsErr) {
    console.error('MP webhook claims sync warning:', claimsErr);
  }

  return { ok: true, userId: targetUserId, subscriptionStatus };
}

async function handleAuthorizedPayment(authorizedPaymentId) {
  const invoice = await fetchAuthorizedPayment(authorizedPaymentId);
  const preapprovalId = invoice.preapproval_id || invoice.preapprovalId;
  if (!preapprovalId) {
    return { ok: false, reason: 'no_preapproval' };
  }

  const preapproval = await fetchPreapproval(preapprovalId);
  const result = await applyPreapprovalToUser(preapproval);

  const paymentStatus = String(invoice.payment?.status || invoice.status || '').toLowerCase();
  if (result.ok && (paymentStatus === 'approved' || paymentStatus === 'processed')) {
    await users.saveUser(result.userId, {
      lastPaymentAt: new Date().toISOString(),
      lastAuthorizedPaymentId: String(authorizedPaymentId),
      subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      billingUpdatedAt: new Date().toISOString(),
    });
  } else if (result.ok && (paymentStatus === 'rejected' || paymentStatus === 'cancelled')) {
    await users.saveUser(result.userId, {
      subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
      billingUpdatedAt: new Date().toISOString(),
    });
  }

  return result;
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

    // Ack fast path: still process synchronously but keep work bounded.
    if (!dataId) {
      return res.status(200).json({ ok: true, ignored: true, reason: 'no_data_id' });
    }

    const normalizedType = (type || '').toLowerCase();

    if (
      normalizedType.includes('subscription_preapproval') ||
      normalizedType === 'preapproval' ||
      normalizedType.includes('preapproval')
    ) {
      const preapproval = await fetchPreapproval(dataId);
      const result = await applyPreapprovalToUser(preapproval);
      return res.status(200).json({ ok: true, ...result });
    }

    if (
      normalizedType.includes('subscription_authorized_payment') ||
      normalizedType.includes('authorized_payment')
    ) {
      const result = await handleAuthorizedPayment(dataId);
      return res.status(200).json({ ok: true, ...result });
    }

    // Generic payment topic — ignore unless linked later.
    return res.status(200).json({ ok: true, ignored: true, type: normalizedType });
  } catch (err) {
    console.error('billing/mp webhook error:', err);
    // Return 200 when possible to avoid infinite MP retries on permanent errors;
    // still 500 for transient failures so MP retries.
    const status = err.status >= 500 || !err.status ? 500 : 200;
    return res.status(status).json({ error: err.message ?? 'Error webhook' });
  }
}

/** Used by create-subscription flow / status endpoint bootstrap */
export { ensureDirectAthleteBilling };
