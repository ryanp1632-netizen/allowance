// Storage: one SQLite file (data/allowance.db) using Node's built-in SQLite.
// Holds the sellers, your rule settings, every task, every payment attempt
// (paid, blocked or waiting), top-ups, and the agent's activity log.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from './rules.js';
import { SEED_SELLERS } from './seed.js';

const DB_PATH = process.env.DB_PATH || 'data/allowance.db';
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sellers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT,
    paypal_email TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, menu TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, prompt TEXT NOT NULL, budget_cents INTEGER NOT NULL,
    status TEXT NOT NULL, summary TEXT, model TEXT, created_at TEXT NOT NULL, finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, task_id TEXT, seller_id TEXT, seller_name TEXT,
    amount_cents INTEGER NOT NULL, items TEXT, justification TEXT,
    risk_score INTEGER, risk_summary TEXT, risk_reasons TEXT, menu_total_cents INTEGER,
    status TEXT NOT NULL, reason TEXT, checks TEXT,
    payout_batch_id TEXT, payout_status TEXT, error TEXT,
    created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT
  );
  CREATE TABLE IF NOT EXISTS topups (
    id TEXT PRIMARY KEY, order_id TEXT UNIQUE, amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT NOT NULL,
    message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();
export const newId = () => randomUUID();
const json = (v) => (v == null ? null : JSON.stringify(v));
const parse = (v, fallback = null) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

// ---- seed demo sellers once ----
if (!db.prepare('SELECT COUNT(*) AS n FROM sellers').get().n) {
  const ins = db.prepare('INSERT INTO sellers (id, name, category, description, paypal_email, approved, menu) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const s of SEED_SELLERS) ins.run(s.id, s.name, s.category, s.description, s.paypal_email, s.approved ? 1 : 0, JSON.stringify(s.menu));
}

// ---- settings ----
export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) out[key] = parse(value);
  return out;
}
export function saveSettings(patch) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) up.run(k, JSON.stringify(v));
  return getSettings();
}

// ---- sellers ----
const sellerRow = (r) => r && ({ ...r, approved: Boolean(r.approved), menu: parse(r.menu, []), paypal_email: sellerEmail(r) });
// Optional: route every seller payout to one real sandbox account (DEMO_SELLER_EMAIL),
// so payouts complete as SUCCESS instead of UNCLAIMED.
const sellerEmail = (r) => process.env.DEMO_SELLER_EMAIL || r.paypal_email;
export const listSellers = () => db.prepare('SELECT * FROM sellers ORDER BY name').all().map(sellerRow);
export const getSeller = (id) => sellerRow(db.prepare('SELECT * FROM sellers WHERE id = ?').get(id));
export const setSellerApproved = (id, approved) => db.prepare('UPDATE sellers SET approved = ? WHERE id = ?').run(approved ? 1 : 0, id);

// ---- tasks ----
export function createTask(prompt, budgetCents) {
  const id = newId();
  db.prepare('INSERT INTO tasks (id, prompt, budget_cents, status, created_at) VALUES (?, ?, ?, ?, ?)').run(id, prompt, budgetCents, 'running', now());
  return getTask(id);
}
export const getTask = (id) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
export const listTasks = () => db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50').all();
export function finishTask(id, status, summary, model) {
  db.prepare('UPDATE tasks SET status = ?, summary = ?, model = COALESCE(?, model), finished_at = ? WHERE id = ?').run(status, summary, model ?? null, now(), id);
}

// ---- payments ----
// "Committed" money = already paid, being sent, or waiting for your approval.
const COMMITTED = `status IN ('paid', 'processing', 'pending_approval')`;
export const taskCommittedCents = (taskId) =>
  db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM payments WHERE task_id = ? AND ${COMMITTED}`).get(taskId).c;
export const dailyCommittedCents = () =>
  db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM payments WHERE ${COMMITTED} AND date(created_at, 'localtime') = date('now', 'localtime')`).get().c;
export function balanceCents() {
  const topped = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM topups WHERE status = 'COMPLETED'`).get().c;
  const spent = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM payments WHERE ${COMMITTED}`).get().c;
  return topped - spent;
}

const paymentRow = (r) => r && ({ ...r, items: parse(r.items, []), checks: parse(r.checks, []), risk_reasons: parse(r.risk_reasons, []) });
export function insertPayment(p) {
  const id = newId();
  db.prepare(`INSERT INTO payments (id, task_id, seller_id, seller_name, amount_cents, items, justification,
      risk_score, risk_summary, risk_reasons, menu_total_cents, status, reason, checks, created_at, decided_at, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, p.task_id ?? null, p.seller_id ?? null, p.seller_name ?? null, p.amount_cents, json(p.items), p.justification ?? null,
    p.risk_score ?? null, p.risk_summary ?? null, json(p.risk_reasons), p.menu_total_cents ?? null,
    p.status, p.reason ?? null, json(p.checks), now(), p.status === 'pending_approval' ? null : now(), p.decided_by ?? 'rules');
  return getPayment(id);
}
export const getPayment = (id) => paymentRow(db.prepare('SELECT * FROM payments WHERE id = ?').get(id));
export const listPayments = () => db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all().map(paymentRow);
export function updatePayment(id, patch) {
  const cols = Object.keys(patch);
  if (!cols.length) return getPayment(id);
  db.prepare(`UPDATE payments SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => (typeof patch[c] === 'object' && patch[c] !== null ? JSON.stringify(patch[c]) : patch[c])), id);
  return getPayment(id);
}

// ---- top-ups (PayPal Checkout) ----
export function recordTopup(orderId, amountCents, status) {
  db.prepare(`INSERT INTO topups (id, order_id, amount_cents, status, created_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(order_id) DO UPDATE SET status = excluded.status, amount_cents = excluded.amount_cents`)
    .run(newId(), orderId, amountCents, status, now());
}
export const listTopups = () => db.prepare('SELECT * FROM topups ORDER BY created_at DESC').all();

// ---- activity log ----
export function logEvent(taskId, kind, message, data) {
  db.prepare('INSERT INTO events (task_id, kind, message, data, created_at) VALUES (?, ?, ?, ?, ?)').run(taskId ?? null, kind, message, json(data), now());
}
export const eventsSince = (afterId = 0) =>
  db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT 200').all(afterId).map((e) => ({ ...e, data: parse(e.data) }));
