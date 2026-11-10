// Resilient AI client.
// Free-tier models are sometimes "overloaded" (HTTP 503) or rate-limited (429).
// Instead of failing, we try a chain of models in order, then wait and retry:
//   1. your main Gemini model      (AI_MODEL, default gemini-flash-latest)
//   2. backup Gemini models        (AI_FALLBACK_MODELS, default Flash-Lite ones)
//   3. Groq, only if GROQ_API_KEY is set
// The model that last worked goes first next time ("sticky"), so a busy model
// doesn't slow down every call.
import { aiConfig, AI_PROVIDERS } from './config.js';

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 25_000;
const BACKOFF_MS = [2_000, 6_000]; // waits between full passes over the chain

let lastGood = null; // "provider:model" that answered most recently
let lastUsed = null;

// Builds the ordered list of {provider, model, baseUrl, apiKey} to try.
export function modelChain(env = process.env) {
  const chain = [];
  const primary = aiConfig(env);
  const add = (provider, model) => {
    const p = AI_PROVIDERS[provider];
    const apiKey = env[p.keyVar];
    if (!apiKey || !model) return;
    if (chain.some((c) => c.provider === provider && c.model === model)) return;
    chain.push({ provider, model, baseUrl: p.baseUrl, apiKey });
  };

  add(primary.provider, primary.model);
  const fallbacks = (env.AI_FALLBACK_MODELS ?? AI_PROVIDERS[primary.provider].fallbackModels.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
  fallbacks.forEach((m) => add(primary.provider, m));
  // Cross-provider fallback (only when that provider's key exists).
  for (const [name, p] of Object.entries(AI_PROVIDERS)) {
    if (name !== primary.provider) add(name, p.defaultModel);
  }

  if (lastGood) {
    const i = chain.findIndex((c) => `${c.provider}:${c.model}` === lastGood);
    if (i > 0) chain.unshift(...chain.splice(i, 1));
  }
  return chain;
}

class AIError extends Error {
  constructor(message, { status, retryable }) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

async function callOnce(target, body) {
  let res;
  try {
    res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model: target.model }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AIError(`network/timeout: ${e.message}`, { status: 0, retryable: true });
  }
  if (!res.ok) {
    const text = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
    // 401/403 = bad key: no point retrying the same provider.
    // 400/404 = this model can't take the request (e.g. retired): try the next model.
    throw new AIError(`HTTP ${res.status}: ${text}`, { status: res.status, retryable: RETRYABLE.has(res.status) });
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new AIError('empty response', { status: res.status, retryable: true });
  return message;
}

/**
 * Sends a chat request (OpenAI-compatible format) with retries and fallbacks.
 * @param {{messages: object[], tools?: object[], temperature?: number}} body
 * @param {{log?: (line: string) => void, pin?: {provider: string, model: string}}} [opts]
 *   pin: keep using one model (an agent conversation should not switch models
 *   mid-way, because Gemini attaches model-specific "thought signatures").
 * @returns {Promise<{message: object, provider: string, model: string}>}
 */
export async function chat(body, { log = () => {}, pin } = {}) {
  let chain = modelChain();
  if (pin) {
    const pinned = chain.filter((c) => c.provider === pin.provider && c.model === pin.model);
    if (pinned.length) chain = [...pinned, ...chain.filter((c) => !pinned.includes(c))];
  }
  if (!chain.length) throw new Error('No AI key set. Put GEMINI_API_KEY (or GROQ_API_KEY) in .env');

  const deadProviders = new Set();
  const errors = [];
  for (let pass = 0; pass <= BACKOFF_MS.length; pass++) {
    for (const target of chain) {
      if (deadProviders.has(target.provider)) continue;
      try {
        const message = await callOnce(target, body);
        lastGood = `${target.provider}:${target.model}`;
        lastUsed = { provider: target.provider, model: target.model, at: new Date().toISOString() };
        return { message, provider: target.provider, model: target.model };
      } catch (e) {
        errors.push(`${target.model}: ${e.message}`);
        log(`AI ${target.model} unavailable (${e.status || 'timeout'}), trying next…`);
        if (e.status === 401 || e.status === 403) deadProviders.add(target.provider);
        // If we were pinned to a model and it failed with a non-retryable error,
        // the conversation can still continue on another model below.
      }
    }
    if (pass < BACKOFF_MS.length) {
      log(`All AI models busy, waiting ${BACKOFF_MS[pass] / 1000}s before retrying…`);
      await new Promise((r) => setTimeout(r, BACKOFF_MS[pass]));
    }
  }
  throw new Error(`All AI models failed:\n  ${errors.slice(-6).join('\n  ')}`);
}

export function lastModelUsed() {
  return lastUsed;
}

// Pulls the first JSON object out of a model reply (models sometimes wrap it in ```json fences).
export function parseJsonReply(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
