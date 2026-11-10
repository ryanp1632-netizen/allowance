// Reads settings from environment variables (loaded from .env by `npm start`).
// Nothing here ever prints a secret; it only reports whether one is set.

// Both providers speak the same "OpenAI-compatible" chat format,
// so switching between them is just a different URL, key and model name.
// fallbackModels are tried when the main model is busy (see src/ai.js).
export const AI_PROVIDERS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVar: 'GEMINI_API_KEY',
    defaultModel: 'gemini-flash-latest',
    fallbackModels: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'],
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVar: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    fallbackModels: ['openai/gpt-oss-20b'],
  },
};

// SAFETY LOCK: the PayPal sandbox address is fixed in code. Sandbox money is
// fake, so Allowance can never move real money. There is deliberately no
// setting that switches to the live PayPal API.
export const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

// Throws unless `url` points exactly at the PayPal sandbox host over HTTPS.
export function assertSandboxUrl(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new Error(`Refusing PayPal call: "${url}" is not a valid URL`);
  }
  if (origin !== PAYPAL_SANDBOX_BASE) {
    throw new Error(`Refusing PayPal call to ${origin}: only ${PAYPAL_SANDBOX_BASE} (sandbox) is allowed`);
  }
}

// Called at startup. If someone sets PAYPAL_API_BASE in .env to anything other
// than the sandbox, the app refuses to start instead of silently ignoring it.
export function assertSandboxEnv(env = process.env) {
  const configured = env.PAYPAL_API_BASE;
  if (configured === undefined || configured === '') return;
  if (configured.replace(/\/+$/, '') !== PAYPAL_SANDBOX_BASE) {
    throw new Error(
      `PAYPAL_API_BASE is "${configured}". Allowance only runs against the PayPal sandbox ` +
        `(${PAYPAL_SANDBOX_BASE}). Remove that line from .env.`,
    );
  }
}

export function paypalConfig() {
  assertSandboxEnv();
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    apiBase: PAYPAL_SANDBOX_BASE,
  };
}

export function aiConfig(env = process.env) {
  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();
  const p = AI_PROVIDERS[provider];
  if (!p) {
    throw new Error(`AI_PROVIDER must be one of: ${Object.keys(AI_PROVIDERS).join(', ')}`);
  }
  return {
    provider,
    baseUrl: p.baseUrl,
    keyVar: p.keyVar,
    apiKey: env[p.keyVar] || '',
    model: env.AI_MODEL || p.defaultModel,
  };
}

// Safe summary for the dashboard: booleans only, never key values.
export function configStatus() {
  const pp = paypalConfig();
  const ai = aiConfig();
  return {
    paypalConfigured: Boolean(pp.clientId && pp.clientSecret),
    paypalSandbox: pp.apiBase === PAYPAL_SANDBOX_BASE,
    aiProvider: ai.provider,
    aiModel: ai.model,
    aiConfigured: Boolean(ai.apiKey),
  };
}
