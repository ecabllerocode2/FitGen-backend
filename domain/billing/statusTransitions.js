import { SUBSCRIPTION_STATUS } from './constants.js';

/**
 * Monotonic-ish subscription transitions for webhook races.
 * Prevents regressions like active → pending_checkout when notifications reorder.
 */
const REGRESSIONS = new Set([
  `${SUBSCRIPTION_STATUS.ACTIVE}->${SUBSCRIPTION_STATUS.PENDING_CHECKOUT}`,
  `${SUBSCRIPTION_STATUS.ACTIVE}->${SUBSCRIPTION_STATUS.TRIALING}`,
  `${SUBSCRIPTION_STATUS.ACTIVE}->${SUBSCRIPTION_STATUS.EXPIRED}`,
  `${SUBSCRIPTION_STATUS.CANCELED}->${SUBSCRIPTION_STATUS.PENDING_CHECKOUT}`,
  `${SUBSCRIPTION_STATUS.CANCELED}->${SUBSCRIPTION_STATUS.TRIALING}`,
  `${SUBSCRIPTION_STATUS.CANCELED}->${SUBSCRIPTION_STATUS.ACTIVE}`,
  `${SUBSCRIPTION_STATUS.CANCELED}->${SUBSCRIPTION_STATUS.PAST_DUE}`,
  `${SUBSCRIPTION_STATUS.PAST_DUE}->${SUBSCRIPTION_STATUS.PENDING_CHECKOUT}`,
  `${SUBSCRIPTION_STATUS.PAST_DUE}->${SUBSCRIPTION_STATUS.TRIALING}`,
]);

/**
 * @returns {{ apply: boolean, next: string, reason: string }}
 */
export function resolveSubscriptionTransition(current, incoming) {
  if (!incoming) {
    return { apply: false, next: current ?? null, reason: 'missing_incoming' };
  }
  if (!current) {
    return { apply: true, next: incoming, reason: 'initial' };
  }
  if (current === incoming) {
    return { apply: false, next: current, reason: 'idempotent' };
  }
  const key = `${current}->${incoming}`;
  if (REGRESSIONS.has(key)) {
    return { apply: false, next: current, reason: 'reject_regression' };
  }
  return { apply: true, next: incoming, reason: 'transition' };
}

export function buildPreapprovalPatch(preapproval, now = new Date()) {
  const mpStatus = preapproval?.status ?? null;
  const subscriptionStatus = mapIncomingFromMp(mpStatus);
  const iso = now.toISOString();
  const patch = {
    mpPreapprovalId: preapproval?.id ?? null,
    mpStatus,
    subscriptionStatus,
    billingUpdatedAt: iso,
  };
  if (subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE) {
    patch.subscriptionActivatedAt = iso;
  }
  if (
    subscriptionStatus === SUBSCRIPTION_STATUS.CANCELED ||
    subscriptionStatus === SUBSCRIPTION_STATUS.EXPIRED
  ) {
    patch.subscriptionCanceledAt = iso;
  }
  return patch;
}

function mapIncomingFromMp(mpStatus) {
  switch (String(mpStatus || '').toLowerCase()) {
    case 'authorized':
      return SUBSCRIPTION_STATUS.ACTIVE;
    case 'pending':
      return SUBSCRIPTION_STATUS.PENDING_CHECKOUT;
    case 'paused':
      return SUBSCRIPTION_STATUS.PAST_DUE;
    case 'cancelled':
    case 'canceled':
      return SUBSCRIPTION_STATUS.CANCELED;
    default:
      return SUBSCRIPTION_STATUS.EXPIRED;
  }
}

export function buildAuthorizedPaymentPatch(invoice, authorizedPaymentId, now = new Date()) {
  const paymentStatus = String(invoice?.payment?.status || invoice?.status || '').toLowerCase();
  const iso = now.toISOString();
  if (paymentStatus === 'approved' || paymentStatus === 'processed') {
    return {
      lastPaymentAt: iso,
      lastAuthorizedPaymentId: String(authorizedPaymentId),
      subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      billingUpdatedAt: iso,
      subscriptionActivatedAt: iso,
    };
  }
  if (paymentStatus === 'rejected' || paymentStatus === 'cancelled' || paymentStatus === 'canceled') {
    return {
      subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
      billingUpdatedAt: iso,
      lastAuthorizedPaymentId: String(authorizedPaymentId),
    };
  }
  return null;
}

/**
 * Stable event id for Mercado Pago notifications.
 */
export function billingEventId({ type, dataId }) {
  return `${String(type || 'unknown').toLowerCase()}:${String(dataId)}`;
}
