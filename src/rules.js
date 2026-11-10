// The guardrails ("the bouncer").
// Every payment the agent asks for is checked against your rules BEFORE any
// money moves. Each rule gives one of three answers:
//   pass   -> fine
//   review -> a human must approve it on the dashboard first
//   block  -> refused, no money moves
// The overall answer is the strictest one: any block => blocked,
// otherwise any review => waits for approval, otherwise => paid.
//
// All money is in whole cents (1250 = $12.50) so there are no rounding errors.
// This file is pure logic (no database, no network), which makes it easy to test.

export const DEFAULT_SETTINGS = {
  killSwitch: false,
  dailyCapCents: 10_000, // $100 per day across all tasks
  approvalThresholdCents: 5_000, // payments above $50 need a human OK
  riskReviewScore: 40, // AI risk score 40+ -> human review
  riskBlockScore: 75, // AI risk score 75+ -> blocked
};

export const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

/**
 * @param {object} p
 * @param {number} p.amountCents            what the agent wants to pay
 * @param {object} p.seller                 { name, approved }
 * @param {object} p.settings               see DEFAULT_SETTINGS
 * @param {number} p.taskBudgetCents        budget you gave this task
 * @param {number} p.taskCommittedCents     already paid + awaiting approval for this task
 * @param {number} p.dailyCommittedCents    already paid + awaiting approval today (all tasks)
 * @param {number} p.balanceCents           allowance left to spend
 * @param {object} p.audit                  explain-before-pay result: { justification, riskScore, available, summary }
 */
export function evaluatePayment(p) {
  const s = { ...DEFAULT_SETTINGS, ...p.settings };
  const amt = p.amountCents;
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  // 1. Kill switch: one click stops all agent spending.
  add('kill_switch', 'Kill switch', s.killSwitch ? 'block' : 'pass',
    s.killSwitch ? 'Kill switch is ON: all agent spending is stopped' : 'Off');

  // 2. Only sellers you approved.
  add('approved_seller', 'Approved seller', p.seller?.approved ? 'pass' : 'block',
    p.seller?.approved ? `${p.seller.name} is on your approved list` : `${p.seller?.name ?? 'Unknown seller'} is NOT on your approved list`);

  // 3. A sane amount.
  const validAmount = Number.isInteger(amt) && amt > 0;
  add('valid_amount', 'Valid amount', validAmount ? 'pass' : 'block',
    validAmount ? fmt(amt) : 'Amount must be a positive number of cents');

  // 4. Enough allowance left in the wallet.
  const enough = validAmount && amt <= p.balanceCents;
  add('balance', 'Allowance balance', enough ? 'pass' : 'block',
    `${fmt(amt)} requested, ${fmt(p.balanceCents)} left in the allowance`);

  // 5. Per-task budget.
  const taskAfter = p.taskCommittedCents + amt;
  add('task_budget', 'Task budget', taskAfter <= p.taskBudgetCents ? 'pass' : 'block',
    `${fmt(taskAfter)} of ${fmt(p.taskBudgetCents)} task budget after this payment`);

  // 6. Daily cap across all tasks.
  const dayAfter = p.dailyCommittedCents + amt;
  add('daily_cap', 'Daily cap', dayAfter <= s.dailyCapCents ? 'pass' : 'block',
    `${fmt(dayAfter)} of ${fmt(s.dailyCapCents)} daily cap after this payment`);

  // 7. Explain-before-pay: no explanation, no payment; risky explanations get stopped.
  const a = p.audit ?? {};
  const why = (a.justification ?? '').trim();
  if (why.length < 10) {
    add('explain_before_pay', 'Explain-before-pay', 'block', 'The agent did not explain why it is paying');
  } else if (!a.available) {
    add('explain_before_pay', 'Explain-before-pay', 'review', 'Risk check unavailable, so a human must look at it');
  } else if (a.riskScore >= s.riskBlockScore) {
    add('explain_before_pay', 'Explain-before-pay', 'block', `Risk ${a.riskScore}/100: ${a.summary ?? ''}`.trim());
  } else if (a.riskScore >= s.riskReviewScore) {
    add('explain_before_pay', 'Explain-before-pay', 'review', `Risk ${a.riskScore}/100: ${a.summary ?? ''}`.trim());
  } else {
    add('explain_before_pay', 'Explain-before-pay', 'pass', `Risk ${a.riskScore}/100: ${a.summary ?? 'looks on-task'}`.trim());
  }

  // 8. Big payments need a human OK.
  const big = validAmount && amt > s.approvalThresholdCents;
  add('approval_threshold', 'Approval threshold', big ? 'review' : 'pass',
    big ? `${fmt(amt)} is over your ${fmt(s.approvalThresholdCents)} auto-approve limit` : `Under ${fmt(s.approvalThresholdCents)} auto-approve limit`);

  const blocked = checks.filter((c) => c.status === 'block');
  const reviews = checks.filter((c) => c.status === 'review');
  const decision = blocked.length ? 'block' : reviews.length ? 'review' : 'allow';
  const reason = (blocked[0] ?? reviews[0])?.detail ?? 'All checks passed';
  return { decision, reason, checks };
}

// Parses "$12.50", "12.5" or 12.5 into cents. Returns NaN if it isn't money.
export function toCents(value) {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}
