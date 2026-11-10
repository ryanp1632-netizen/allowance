// Puts it all together for one payment request:
//   agent asks to pay -> explain-before-pay audit -> guardrails -> PayPal Payout
// Every attempt is saved to the ledger, including blocked ones.
import * as store from './db.js';
import { auditPayment } from './auditor.js';
import { evaluatePayment, fmt } from './rules.js';
import { sendPayout, getPayout } from './paypal.js';

export async function requestPayment({ taskId, sellerId, items, amountCents, justification }, log = () => {}) {
  const task = store.getTask(taskId);
  const seller = store.getSeller(sellerId);
  const taskSpentCents = store.taskCommittedCents(taskId);

  log('audit', `Explain-before-pay: checking "${String(justification ?? '').slice(0, 140)}"`);
  const audit = await auditPayment({ task, seller, items, amountCents, justification, taskSpentCents }, (m) => log('info', m));

  const result = evaluatePayment({
    amountCents,
    seller: seller ?? { name: sellerId, approved: false },
    settings: store.getSettings(),
    taskBudgetCents: task.budget_cents,
    taskCommittedCents: taskSpentCents,
    dailyCommittedCents: store.dailyCommittedCents(),
    balanceCents: store.balanceCents(),
    audit,
  });

  const status = { allow: 'processing', review: 'pending_approval', block: 'blocked' }[result.decision];
  let payment = store.insertPayment({
    task_id: taskId,
    seller_id: sellerId,
    seller_name: seller?.name ?? sellerId,
    amount_cents: Number.isInteger(amountCents) ? amountCents : 0,
    items,
    justification,
    risk_score: audit.riskScore,
    risk_summary: audit.summary,
    risk_reasons: audit.reasons,
    menu_total_cents: audit.menuTotalCents,
    status,
    reason: result.reason,
    checks: result.checks,
  });
  log(result.decision === 'allow' ? 'allow' : result.decision, `${result.decision.toUpperCase()}: ${fmt(amountCents)} to ${payment.seller_name}. ${result.reason}`, { paymentId: payment.id, risk: audit.riskScore });

  if (status === 'processing') payment = await pay(payment, seller, log);
  return payment;
}

// Sends the PayPal payout for a payment that passed (or that you approved).
async function pay(payment, seller, log) {
  try {
    const { batchId, status } = await sendPayout({
      paymentId: payment.id,
      receiverEmail: seller.paypal_email,
      amountCents: payment.amount_cents,
      sellerName: seller.name,
      note: `Allowance agent payment. Reason: ${payment.justification}`,
    });
    log('paid', `PayPal payout sent: ${fmt(payment.amount_cents)} to ${seller.name} (batch ${batchId}, ${status})`, { paymentId: payment.id });
    const updated = store.updatePayment(payment.id, { status: 'paid', payout_batch_id: batchId, payout_status: status });
    trackPayout(payment.id, batchId);
    return updated;
  } catch (e) {
    log('error', `PayPal payout failed: ${e.message}`, { paymentId: payment.id });
    return store.updatePayment(payment.id, { status: 'failed', error: e.message.slice(0, 500) });
  }
}

// Payouts finish a few seconds later; check back a few times and record the result.
function trackPayout(paymentId, batchId, tries = 6) {
  setTimeout(async () => {
    try {
      const r = await getPayout(batchId);
      store.updatePayment(paymentId, { payout_status: r.itemStatus || r.batchStatus });
      if (['PENDING', 'PROCESSING', undefined].includes(r.itemStatus) && tries > 1) trackPayout(paymentId, batchId, tries - 1);
    } catch {
      if (tries > 1) trackPayout(paymentId, batchId, tries - 1);
    }
  }, 4000);
}

// You approved a payment that was waiting. Hard limits are re-checked first:
// the kill switch still wins, even over your own approval.
export async function approvePayment(id) {
  const p = store.getPayment(id);
  if (!p || p.status !== 'pending_approval') throw new Error('Payment is not waiting for approval');
  if (store.getSettings().killSwitch) throw new Error('Kill switch is ON. Turn it off before approving payments.');
  const seller = store.getSeller(p.seller_id);
  store.updatePayment(id, { status: 'processing', decided_at: new Date().toISOString(), decided_by: 'human' });
  const log = (kind, message, data) => store.logEvent(p.task_id, kind, message, data);
  log('human', `You approved ${fmt(p.amount_cents)} to ${p.seller_name}`);
  return pay(store.getPayment(id), seller, log);
}

export function denyPayment(id) {
  const p = store.getPayment(id);
  if (!p || p.status !== 'pending_approval') throw new Error('Payment is not waiting for approval');
  store.logEvent(p.task_id, 'human', `You denied ${fmt(p.amount_cents)} to ${p.seller_name}`);
  return store.updatePayment(id, { status: 'denied', decided_at: new Date().toISOString(), decided_by: 'human' });
}
