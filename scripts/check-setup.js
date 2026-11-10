// `npm run check` — confirms your .env keys work, without ever printing them.
//  1. Asks PayPal sandbox for an access token using your client ID + secret.
//  2. Sends the AI provider a one-line test prompt.
import { paypalConfig, aiConfig } from '../src/config.js';

const ok = (msg) => console.log(`  [ok]   ${msg}`);
const bad = (msg) => console.log(`  [fail] ${msg}`);
let failures = 0;

async function checkPayPal() {
  console.log('\nPayPal sandbox');
  const { clientId, clientSecret, apiBase } = paypalConfig();
  if (!clientId || !clientSecret) {
    bad('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is empty in .env');
    return failures++;
  }
  if (!apiBase.includes('sandbox')) {
    bad(`PAYPAL_API_BASE is not the sandbox (${apiBase}). This project only uses the sandbox.`);
    return failures++;
  }
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    bad(`PayPal rejected the credentials (HTTP ${res.status}). Re-copy the Sandbox client ID and secret.`);
    return failures++;
  }
  const data = await res.json();
  ok('Got a sandbox access token');
  // The token's scopes tell us which APIs this app may call.
  // Missing Payouts is only a warning: we'd fall back to Orders v2.
  const scopes = data.scope || '';
  if (scopes.includes('payouts')) ok('Payouts permission is on for this app');
  else console.log('  [warn] No Payouts permission in the token. Turn on "Payouts" in the app settings, or we fall back to Orders v2.');
}

async function checkAI() {
  const ai = aiConfig();
  console.log(`\nAI provider: ${ai.provider} (model: ${ai.model})`);
  if (!ai.apiKey) {
    bad(`${ai.keyVar} is empty in .env`);
    return failures++;
  }
  const res = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ai.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: 'user', content: 'Reply with exactly: Allowance ready' }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    bad(`AI call failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    if (res.status === 404 || res.status === 400) await listModels(ai);
    return failures++;
  }
  const data = await res.json();
  ok(`Model replied: "${data.choices?.[0]?.message?.content?.trim()}"`);
}

// If the default model name is outdated, show which ones this key can use.
async function listModels(ai) {
  const res = await fetch(`${ai.baseUrl}/models`, { headers: { Authorization: `Bearer ${ai.apiKey}` } });
  if (!res.ok) return;
  const { data = [] } = await res.json();
  const names = data.map((m) => m.id.replace(/^models\//, '')).filter((n) => /flash|llama|gpt-oss/i.test(n));
  console.log('  Models available to this key (set one as AI_MODEL in .env):');
  names.slice(0, 15).forEach((n) => console.log(`    - ${n}`));
}

await checkPayPal().catch((e) => { bad(`PayPal check crashed: ${e.message}`); failures++; });
await checkAI().catch((e) => { bad(`AI check crashed: ${e.message}`); failures++; });
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll set!');
process.exit(failures ? 1 : 0);
