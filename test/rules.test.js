// Tests for the guardrails in src/rules.js. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePayment, toCents } from '../src/rules.js';

// A payment that passes every rule; each test changes one thing.
const base = () => ({
  amountCents: 1_500,
  seller: { name: 'Green Bowl', approved: true },
  settings: { killSwitch: false, dailyCapCents: 10_000, approvalThresholdCents: 3_000, riskReviewScore: 40, riskBlockScore: 75 },
  taskBudgetCents: 6_000,
  taskCommittedCents: 0,
  dailyCommittedCents: 0,
  balanceCents: 10_000,
  audit: { justification: 'Two veggie bowls for the team lunch, as asked.', riskScore: 10, available: true },
});
const statusOf = (r, id) => r.checks.find((c) => c.id === id).status;

test('a normal on-task payment is allowed', () => {
  const r = evaluatePayment(base());
  assert.equal(r.decision, 'allow');
  assert.ok(r.checks.every((c) => c.status === 'pass'));
});

test('kill switch blocks everything', () => {
  const p = base(); p.settings.killSwitch = true;
  const r = evaluatePayment(p);
  assert.equal(r.decision, 'block');
  assert.equal(statusOf(r, 'kill_switch'), 'block');
});

test('unapproved seller is blocked', () => {
  const p = base(); p.seller.approved = false;
  assert.equal(evaluatePayment(p).decision, 'block');
});

test('task budget: exactly at budget passes, one cent over blocks', () => {
  const p = base(); p.taskCommittedCents = 4_500; // 4500 + 1500 = 6000
  assert.equal(evaluatePayment(p).decision, 'allow');
  p.taskCommittedCents = 4_501;
  assert.equal(statusOf(evaluatePayment(p), 'task_budget'), 'block');
});

test('daily cap blocks', () => {
  const p = base(); p.dailyCommittedCents = 9_000;
  assert.equal(statusOf(evaluatePayment(p), 'daily_cap'), 'block');
});

test('not enough allowance blocks', () => {
  const p = base(); p.balanceCents = 1_000;
  assert.equal(statusOf(evaluatePayment(p), 'balance'), 'block');
});

test('over the approval threshold goes to human review', () => {
  const p = base(); p.amountCents = 3_500;
  const r = evaluatePayment(p);
  assert.equal(r.decision, 'review');
  assert.equal(statusOf(r, 'approval_threshold'), 'review');
});

test('explain-before-pay: missing explanation blocks', () => {
  const p = base(); p.audit.justification = '  ';
  assert.equal(statusOf(evaluatePayment(p), 'explain_before_pay'), 'block');
});

test('explain-before-pay: medium risk -> review, high risk -> block', () => {
  const p = base(); p.audit.riskScore = 50;
  assert.equal(evaluatePayment(p).decision, 'review');
  p.audit.riskScore = 90;
  assert.equal(evaluatePayment(p).decision, 'block');
});

test('explain-before-pay: if the risk check is down, a human decides (fail safe)', () => {
  const p = base(); p.audit.available = false;
  assert.equal(evaluatePayment(p).decision, 'review');
});

test('block beats review', () => {
  const p = base(); p.amountCents = 3_500; p.seller.approved = false;
  assert.equal(evaluatePayment(p).decision, 'block');
});

test('invalid amounts are blocked', () => {
  for (const amountCents of [0, -100, NaN, 12.5]) {
    const p = base(); p.amountCents = amountCents;
    assert.equal(evaluatePayment(p).decision, 'block', String(amountCents));
  }
});

test('toCents parses money safely', () => {
  assert.equal(toCents('$12.50'), 1250);
  assert.equal(toCents(12.5), 1250);
  assert.equal(toCents('0.1'), 10);
  assert.ok(Number.isNaN(toCents('twelve')));
});
