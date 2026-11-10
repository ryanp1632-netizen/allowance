// Allowance web server: serves the dashboard and a small JSON API.
import express from 'express';
import { configStatus, assertSandboxEnv, paypalConfig } from './src/config.js';

// Safety lock: refuse to start unless PayPal is the sandbox (fake money).
try {
  assertSandboxEnv();
} catch (e) {
  console.error(`\nAllowance will not start: ${e.message}\n`);
  process.exit(1);
}

const store = await import('./src/db.js');
const { runTask } = await import('./src/agent.js');
const { approvePayment, denyPayment } = await import('./src/payments.js');
const { createOrder, captureOrder } = await import('./src/paypal.js');
const { lastModelUsed } = await import('./src/ai.js');
const { toCents } = await import('./src/rules.js');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Wraps async routes so errors become a JSON {error} instead of crashing.
const route = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: e.message }));

// Which keys are set (true/false only, never the values).
app.get('/api/status', (req, res) => res.json({ ...configStatus(), lastModel: lastModelUsed() }));

// Everything the dashboard needs in one call.
app.get('/api/state', (req, res) => {
  const payments = store.listPayments();
  res.json({
    settings: store.getSettings(),
    balanceCents: store.balanceCents(),
    todayCents: store.dailyCommittedCents(),
    sellers: store.listSellers().map(({ paypal_email, ...s }) => s),
    pending: payments.filter((p) => p.status === 'pending_approval'),
    tasks: store.listTasks(),
    topups: store.listTopups(),
    counts: {
      paid: payments.filter((p) => p.status === 'paid').length,
      blocked: payments.filter((p) => p.status === 'blocked' || p.status === 'denied').length,
    },
  });
});

app.get('/api/payments', (req, res) => res.json(store.listPayments()));
app.get('/api/events', (req, res) => res.json(store.eventsSince(Number(req.query.after) || 0)));

// ---- your controls ----
app.post('/api/settings', route((req, res) => {
  const b = req.body ?? {};
  const patch = {};
  const money = (k, v) => { const c = toCents(v); if (!(c >= 0)) throw new Error(`${k} must be a dollar amount`); patch[k] = c; };
  if (b.dailyCap !== undefined) money('dailyCapCents', b.dailyCap);
  if (b.approvalThreshold !== undefined) money('approvalThresholdCents', b.approvalThreshold);
  for (const k of ['riskReviewScore', 'riskBlockScore']) {
    if (b[k] !== undefined) {
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error(`${k} must be 0-100`);
      patch[k] = n;
    }
  }
  res.json(store.saveSettings(patch));
}));

app.post('/api/kill-switch', route((req, res) => {
  const on = Boolean(req.body?.on);
  store.logEvent(null, on ? 'block' : 'human', on ? 'Kill switch turned ON: all agent spending stopped' : 'Kill switch turned off');
  res.json(store.saveSettings({ killSwitch: on }));
}));

app.post('/api/sellers/:id', route((req, res) => {
  if (!store.getSeller(req.params.id)) throw new Error('Unknown seller');
  store.setSellerApproved(req.params.id, Boolean(req.body?.approved));
  res.json({ ok: true });
}));

app.post('/api/payments/:id/approve', route(async (req, res) => res.json(await approvePayment(req.params.id))));
app.post('/api/payments/:id/deny', route((req, res) => res.json(denyPayment(req.params.id))));

// ---- run the agent ----
app.post('/api/tasks', route((req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim().slice(0, 1000);
  const budgetCents = toCents(req.body?.budget);
  if (!prompt) throw new Error('Describe the task');
  if (!(budgetCents > 0 && budgetCents <= 50_000)) throw new Error('Budget must be between $0.01 and $500');
  const task = store.createTask(prompt, budgetCents);
  runTask(task.id); // runs in the background; the dashboard follows /api/events
  res.json(task);
}));

// ---- top up the allowance with PayPal Checkout (Orders v2) ----
app.get('/api/paypal/client-id', (req, res) => res.json({ clientId: paypalConfig().clientId }));

app.post('/api/topup/create', route(async (req, res) => {
  const cents = toCents(req.body?.amount);
  if (!(cents >= 100 && cents <= 50_000)) throw new Error('Top-up must be between $1 and $500');
  const id = await createOrder(cents);
  store.recordTopup(id, cents, 'CREATED');
  res.json({ id });
}));

app.post('/api/topup/:orderId/capture', route(async (req, res) => {
  const r = await captureOrder(req.params.orderId);
  if (r.status !== 'COMPLETED' || r.currency !== 'USD') throw new Error(`Payment not completed (${r.status})`);
  store.recordTopup(req.params.orderId, r.amountCents, 'COMPLETED');
  store.logEvent(null, 'topup', `Allowance topped up with $${(r.amountCents / 100).toFixed(2)} via PayPal Checkout`);
  res.json({ ok: true, amountCents: r.amountCents, balanceCents: store.balanceCents() });
}));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Allowance running at http://localhost:${port}  (PayPal SANDBOX only)`));
