// Proves Allowance can only ever talk to the PayPal sandbox (fake money).
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PAYPAL_SANDBOX_BASE, assertSandboxUrl, assertSandboxEnv, paypalConfig } from '../src/config.js';
import { paypalFetch } from '../src/paypal.js';

test('the PayPal base URL is the sandbox, exactly', () => {
  assert.equal(PAYPAL_SANDBOX_BASE, 'https://api-m.sandbox.paypal.com');
});

test('sandbox URLs are allowed', () => {
  assert.doesNotThrow(() => assertSandboxUrl('https://api-m.sandbox.paypal.com/v1/oauth2/token'));
  assert.doesNotThrow(() => assertSandboxUrl('https://api-m.sandbox.paypal.com/v1/payments/payouts'));
});

test('live PayPal and look-alike hosts are refused', () => {
  for (const url of [
    'https://api-m.paypal.com/v1/payments/payouts', // live PayPal
    'https://api.paypal.com/v1/oauth2/token', // live PayPal (old host)
    'http://api-m.sandbox.paypal.com/v1/oauth2/token', // not HTTPS
    'https://api-m.sandbox.paypal.com.evil.com/v1', // look-alike domain
    'https://api-m.sandbox.paypal.com:8443/v1', // different port
    'not a url',
  ]) {
    assert.throws(() => assertSandboxUrl(url), /Refusing PayPal call/, url);
  }
});

test('PAYPAL_API_BASE in .env: unset or sandbox is fine, anything else refuses to start', () => {
  assert.doesNotThrow(() => assertSandboxEnv({}));
  assert.doesNotThrow(() => assertSandboxEnv({ PAYPAL_API_BASE: '' }));
  assert.doesNotThrow(() => assertSandboxEnv({ PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com' }));
  assert.doesNotThrow(() => assertSandboxEnv({ PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com/' }));
  assert.throws(() => assertSandboxEnv({ PAYPAL_API_BASE: 'https://api-m.paypal.com' }), /only runs against the PayPal sandbox/);
  assert.throws(() => assertSandboxEnv({ PAYPAL_API_BASE: 'https://example.com' }), /only runs against the PayPal sandbox/);
});

test('paypalConfig() refuses when .env points at live PayPal', () => {
  const saved = process.env.PAYPAL_API_BASE;
  process.env.PAYPAL_API_BASE = 'https://api-m.paypal.com';
  try {
    assert.throws(() => paypalConfig(), /only runs against the PayPal sandbox/);
  } finally {
    if (saved === undefined) delete process.env.PAYPAL_API_BASE;
    else process.env.PAYPAL_API_BASE = saved;
  }
  assert.equal(paypalConfig().apiBase, PAYPAL_SANDBOX_BASE);
});

test('paypalFetch only sends requests to the sandbox', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url) => { sent.push(url); return new Response('{}'); };
  try {
    await paypalFetch('/v1/oauth2/token');
    assert.deepEqual(sent, ['https://api-m.sandbox.paypal.com/v1/oauth2/token']);
    // A protocol-relative path would switch hosts; it must be refused before sending.
    assert.throws(() => paypalFetch('//api-m.paypal.com/v1/payments/payouts'), /Refusing PayPal call/);
    assert.throws(() => paypalFetch('https://api-m.paypal.com/v1/payments/payouts'), /must start with/);
    assert.equal(sent.length, 1, 'no extra request may be sent');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('no source file mentions the live PayPal API host', () => {
  const live = /api(-m)?\.paypal\.com/;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(name)) files.push(p);
    }
  };
  ['src', 'public', 'scripts'].forEach(walk);
  files.push('server.js');
  for (const f of files) {
    assert.ok(!live.test(readFileSync(f, 'utf8')), `${f} mentions the live PayPal host`);
  }
});
