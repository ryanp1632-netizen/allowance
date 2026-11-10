// The ONLY way this app talks to PayPal.
// Safety lock: every request must go to the PayPal *sandbox* (fake money).
// The live PayPal address is never used, and there is no setting to change that.
import { paypalConfig, assertSandboxUrl, PAYPAL_SANDBOX_BASE } from './config.js';

// Gets a short-lived sandbox access token using the app's client ID + secret.
export async function getAccessToken() {
  const { clientId, clientSecret } = paypalConfig();
  const res = await paypalFetch('/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal sandbox rejected the credentials (HTTP ${res.status})`);
  return res.json();
}

// Cache the token until shortly before it expires.
let cached = null;
async function bearer() {
  if (!cached || Date.now() > cached.expiresAt) {
    const t = await getAccessToken();
    cached = { token: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
  }
  return `Bearer ${cached.token}`;
}

async function api(method, path, body, extraHeaders = {}) {
  const res = await paypalFetch(path, {
    method,
    headers: { Authorization: await bearer(), 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details?.[0]?.issue || data.name || '';
    throw new Error(`PayPal ${method} ${path.split('?')[0]} failed (HTTP ${res.status}) ${detail} ${data.message || ''}`.trim());
  }
  return data;
}

const dollars = (cents) => (cents / 100).toFixed(2);

// ---------- Payouts: how the agent pays a seller ----------
// Sends money from your sandbox business account to the seller's PayPal email.
// The agent's explanation travels with the payment as the payout note.
// paymentId doubles as the idempotency key, so a retry can never pay twice.
export async function sendPayout({ paymentId, receiverEmail, amountCents, note, sellerName }) {
  const data = await api('POST', '/v1/payments/payouts', {
    sender_batch_header: {
      sender_batch_id: `allowance-${paymentId}`,
      email_subject: 'You received a payment from an Allowance agent',
      email_message: `Payment for ${sellerName}`,
    },
    items: [{
      recipient_type: 'EMAIL',
      receiver: receiverEmail,
      amount: { value: dollars(amountCents), currency: 'USD' },
      note: note.slice(0, 4000),
      sender_item_id: paymentId,
    }],
  }, { 'PayPal-Request-Id': paymentId });
  return { batchId: data.batch_header.payout_batch_id, status: data.batch_header.batch_status };
}

// Looks up a payout to see if it finished (SUCCESS, UNCLAIMED, PENDING, ...).
export async function getPayout(batchId) {
  const data = await api('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  const item = data.items?.[0];
  return { batchStatus: data.batch_header?.batch_status, itemStatus: item?.transaction_status, transactionId: item?.transaction_id };
}

// ---------- Orders v2: how YOU top up the agent's allowance ----------
export async function createOrder(amountCents) {
  const data = await api('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      description: 'Allowance top-up for your AI agent',
      amount: { currency_code: 'USD', value: dollars(amountCents) },
    }],
  });
  return data.id;
}

export async function captureOrder(orderId) {
  const data = await api('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: data.status, // COMPLETED when the money arrived
    amountCents: capture ? Math.round(Number(capture.amount.value) * 100) : 0,
    currency: capture?.amount?.currency_code,
  };
}

// Wraps fetch: builds the URL from the fixed sandbox base and re-checks it
// right before sending, so a bug elsewhere can't point a payment at live PayPal.
export function paypalFetch(path, options = {}) {
  if (!path.startsWith('/')) throw new Error('PayPal path must start with "/"');
  const url = new URL(path, PAYPAL_SANDBOX_BASE).toString();
  assertSandboxUrl(url);
  return fetch(url, options);
}
