// Reads settings from environment variables (loaded from .env by `npm start`).
// Nothing here ever prints a secret; it only reports whether one is set.

// Both providers speak the same "OpenAI-compatible" chat format,
// so switching between them is just a different URL, key and model name.
const AI_PROVIDERS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVar: 'GEMINI_API_KEY',
    defaultModel: 'gemini-flash-latest',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVar: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
};

export function paypalConfig() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    apiBase: process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com',
  };
}

export function aiConfig() {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const p = AI_PROVIDERS[provider];
  if (!p) {
    throw new Error(`AI_PROVIDER must be one of: ${Object.keys(AI_PROVIDERS).join(', ')}`);
  }
  return {
    provider,
    baseUrl: p.baseUrl,
    keyVar: p.keyVar,
    apiKey: process.env[p.keyVar] || '',
    model: process.env.AI_MODEL || p.defaultModel,
  };
}

// Safe summary for the dashboard: booleans only, never key values.
export function configStatus() {
  const pp = paypalConfig();
  const ai = aiConfig();
  return {
    paypalConfigured: Boolean(pp.clientId && pp.clientSecret),
    paypalSandbox: pp.apiBase.includes('sandbox'),
    aiProvider: ai.provider,
    aiModel: ai.model,
    aiConfigured: Boolean(ai.apiKey),
  };
}
