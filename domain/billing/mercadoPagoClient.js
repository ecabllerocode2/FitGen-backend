import crypto from 'crypto';
import {
  ATHLETE_SUBSCRIPTION_AMOUNT_MXN,
  ATHLETE_SUBSCRIPTION_CURRENCY,
  ATHLETE_SUBSCRIPTION_REASON,
} from './constants.js';

const MP_API = 'https://api.mercadopago.com';

function getAccessToken() {
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) {
    const err = new Error('MP_ACCESS_TOKEN no configurado');
    err.status = 503;
    err.code = 'mp_not_configured';
    throw err;
  }
  return token;
}

function getFrontendUrl() {
  return (
    process.env.FRONTEND_URL?.replace(/\/$/, '') ||
    process.env.MP_BACK_URL?.replace(/\/$/, '') ||
    'http://localhost:5173'
  );
}

function getBackendPublicUrl() {
  if (process.env.BACKEND_PUBLIC_URL) {
    return process.env.BACKEND_PUBLIC_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return null;
}

async function mpFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || json.error || `Mercado Pago error ${res.status}`);
    err.status = res.status >= 400 && res.status < 500 ? 502 : 502;
    err.detail = json;
    err.code = 'mp_api_error';
    throw err;
  }
  return json;
}

/**
 * Create a pending subscription; user completes payment method on init_point.
 */
export async function createAthletePreapproval({
  userId,
  payerEmail,
  amountMxn = Number(process.env.MP_SUBSCRIPTION_AMOUNT || ATHLETE_SUBSCRIPTION_AMOUNT_MXN),
}) {
  if (!payerEmail) {
    const err = new Error('Email del pagador requerido para Mercado Pago');
    err.status = 400;
    throw err;
  }

  const backUrl = `${getFrontendUrl()}/?billing=return`;
  const notificationBase = getBackendPublicUrl();
  const notificationUrl = notificationBase
    ? `${notificationBase}/api/billing/mp/webhook`
    : process.env.MP_NOTIFICATION_URL || undefined;

  const payload = {
    reason: ATHLETE_SUBSCRIPTION_REASON,
    external_reference: userId,
    payer_email: payerEmail,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: amountMxn,
      currency_id: ATHLETE_SUBSCRIPTION_CURRENCY,
    },
    back_url: backUrl,
    status: 'pending',
  };

  if (notificationUrl) {
    payload.notification_url = notificationUrl;
  }

  const preapproval = await mpFetch('/preapproval', { method: 'POST', body: payload });
  return {
    id: preapproval.id,
    status: preapproval.status,
    initPoint: preapproval.init_point || preapproval.sandbox_init_point,
    sandboxInitPoint: preapproval.sandbox_init_point || null,
    raw: preapproval,
  };
}

export async function fetchPreapproval(preapprovalId) {
  return mpFetch(`/preapproval/${preapprovalId}`);
}

export async function fetchAuthorizedPayment(authorizedPaymentId) {
  return mpFetch(`/authorized_payments/${authorizedPaymentId}`);
}

/**
 * Validate Mercado Pago webhook signature (x-signature + x-request-id + data.id).
 * If MP_WEBHOOK_SECRET is unset, skips verification (dev only) and returns true.
 */
export function verifyWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
  const webhookSecret = secret ?? process.env.MP_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('MP_WEBHOOK_SECRET missing — skipping signature check (configure ASAP)');
    }
    return true;
  }
  if (!xSignature || !xRequestId || !dataId) return false;

  const parts = Object.fromEntries(
    String(xSignature)
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((kv) => kv.length === 2),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

export function isMercadoPagoConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN?.trim());
}
