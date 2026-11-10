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

// Wraps fetch: builds the URL from the fixed sandbox base and re-checks it
// right before sending, so a bug elsewhere can't point a payment at live PayPal.
export function paypalFetch(path, options = {}) {
  if (!path.startsWith('/')) throw new Error('PayPal path must start with "/"');
  const url = new URL(path, PAYPAL_SANDBOX_BASE).toString();
  assertSandboxUrl(url);
  return fetch(url, options);
}
