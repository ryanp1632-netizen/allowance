// `npm run check` — confirms your .env keys work, without ever printing them.
//  1. Asks PayPal sandbox for an access token using your client ID + secret.
//  2. Sends the AI provider a one-line test prompt.
import { paypalConfig, aiConfig } from '../src/config.js';
import { getAccessToken } from '../src/paypal.js';
import { chat, modelChain } from '../src/ai.js';

const ok = (msg) => console.log(`  [ok]   ${msg}`);
const bad = (msg) => console.log(`  [fail] ${msg}`);
let failures = 0;

async function checkPayPal() {
  console.log('\nPayPal sandbox');
  const { clientId, clientSecret, apiBase } = paypalConfig(); // throws if not sandbox
  ok(`Locked to sandbox: ${apiBase}`);
  if (!clientId || !clientSecret) {
    bad('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is empty in .env');
    return failures++;
  }
  let data;
  try {
    data = await getAccessToken();
  } catch (e) {
    bad(`${e.message}. Re-copy the Sandbox client ID and secret.`);
    return failures++;
  }
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
  console.log(`  Try order: ${modelChain().map((c) => c.model).join(' -> ')}`);
  try {
    const { message, model } = await chat(
      { messages: [{ role: 'user', content: 'Reply with exactly: Allowance ready' }] },
      { log: (line) => console.log(`  [info] ${line}`) },
    );
    ok(`${model} replied: "${message.content?.trim()}"`);
  } catch (e) {
    bad(e.message);
    await listModels(ai);
    return failures++;
  }
}

// If the default model name is outdated, show which ones this key can use.
async function listModels(ai) {
  const res = await fetch(`${ai.baseUrl}/models`, { headers: { Authorization: `Bearer ${ai.apiKey}` } });
  if (!res.ok) return;
  const { data = [] } = await res.json();
  const names = data.map((m) => m.id.replace(/^models\//, '')).filter((n) => /flash|llama|gpt-oss/i.test(n));
  console.log('  Models available to this key (set AI_MODEL / AI_FALLBACK_MODELS in .env):');
  names.slice(0, 15).forEach((n) => console.log(`    - ${n}`));
}

await checkPayPal().catch((e) => { bad(`PayPal check crashed: ${e.message}`); failures++; });
await checkAI().catch((e) => { bad(`AI check crashed: ${e.message}`); failures++; });
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll set!');
process.exit(failures ? 1 : 0);
