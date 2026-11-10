// The shopping agent.
// It's an AI model given a task ("order lunch for the team") and a few tools.
// It decides which tools to call; our code runs them and sends back results,
// round after round, until it calls finish_task.
//
// Important: the agent can't see or change your rules. It only gets told the
// outcome (paid / blocked / waiting for you). Allowance assumes the agent can
// make mistakes or be fooled, and protects your money anyway.
import { chat } from './ai.js';
import * as store from './db.js';
import { requestPayment } from './payments.js';
import { fmt, toCents } from './rules.js';

const MAX_ROUNDS = 14;
const MAX_BLOCKED = 3; // circuit breaker: pause the agent after this many blocked payments

const SYSTEM_PROMPT = `You are a purchasing agent working for a small team.
You buy things by paying sellers through "Allowance", a PayPal wallet the user controls.
How to work:
1. Look at the sellers and their menus with the tools. Never invent sellers, items or prices.
2. Plan an order that fits the task and the budget. Use quote_order to get the exact total, and pay exactly that.
3. Pay each seller with pay_seller. Every payment MUST include a clear justification:
   who it is for, how it fits the task, and why the amount is right.
4. If a payment is blocked, read the reason and adjust (or skip it). Never retry the same blocked payment unchanged.
   If it is waiting for human approval, do not pay for the same thing again.
5. When done, call finish_task with a short summary for the user.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_sellers',
      description: 'List sellers in the marketplace with their category and listing text.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_menu',
      description: "Get a seller's menu with item names and prices in USD.",
      parameters: { type: 'object', properties: { seller_id: { type: 'string' } }, required: ['seller_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quote_order',
      description: 'Get the exact total for an order from one seller before paying. Use this total as the payment amount.',
      parameters: {
        type: 'object',
        properties: {
          seller_id: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, quantity: { type: 'integer' } },
              required: ['name', 'quantity'],
            },
          },
        },
        required: ['seller_id', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_budget',
      description: 'How much of this task budget is left to spend.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pay_seller',
      description: 'Pay one seller for an order through Allowance (PayPal). One call per seller.',
      parameters: {
        type: 'object',
        properties: {
          seller_id: { type: 'string' },
          items: {
            type: 'array',
            description: 'Items exactly as named on the menu',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, quantity: { type: 'integer' } },
              required: ['name', 'quantity'],
            },
          },
          amount: { type: 'number', description: 'Total to pay in USD, e.g. 25.50' },
          justification: { type: 'string', description: 'Why this payment is needed: who it is for and how it fits the task and budget' },
        },
        required: ['seller_id', 'items', 'amount', 'justification'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_task',
      description: 'Finish the task with a short summary for the user.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  },
];

// Runs one task in the background. Progress goes to the activity log (events table).
export async function runTask(taskId) {
  const task = store.getTask(taskId);
  const log = (kind, message, data) => store.logEvent(taskId, kind, message, data);
  log('task', `Task started: "${task.prompt}" (budget ${fmt(task.budget_cents)})`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Task: ${task.prompt}\nBudget for this task: ${fmt(task.budget_cents)}` },
  ];
  let pin; // stay on one model for the whole conversation when possible
  let modelUsed;
  let blockedCount = 0;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (store.getSettings().killSwitch) {
        log('block', 'Kill switch is ON: agent stopped.');
        store.finishTask(taskId, 'stopped', 'Stopped by kill switch', modelUsed);
        return;
      }
      const { message, provider, model } = await chat({ messages, tools: TOOLS, temperature: 0.2 }, { pin, log: (m) => log('info', m) });
      if (!pin) { pin = { provider, model }; modelUsed = model; log('info', `Agent model: ${model}`); }
      messages.push(message); // keep the reply exactly as returned (Gemini needs its thought signatures back)

      if (message.content?.trim()) log('think', message.content.trim().slice(0, 600));
      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        messages.push({ role: 'user', content: 'Continue using the tools. Call finish_task when you are done.' });
        continue;
      }

      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leave empty */ }
        const name = call.function.name;
        if (name === 'finish_task') {
          log('done', `Agent finished: ${args.summary ?? ''}`);
          store.finishTask(taskId, 'done', args.summary ?? '', modelUsed);
          return;
        }
        const result = await runTool(name, args, task, log);
        messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(result) });

        // Circuit breaker: an agent that keeps getting blocked is paused.
        if (name === 'pay_seller' && result.status === 'blocked' && ++blockedCount >= MAX_BLOCKED) {
          log('block', `Agent paused: ${MAX_BLOCKED} blocked payments in one task. A human should take a look.`);
          store.finishTask(taskId, 'paused', `Paused after ${MAX_BLOCKED} blocked payments`, modelUsed);
          return;
        }
      }
    }
    log('error', `Agent stopped after ${MAX_ROUNDS} rounds without finishing.`);
    store.finishTask(taskId, 'stopped', 'Too many steps', modelUsed);
  } catch (e) {
    log('error', `Agent error: ${e.message.split('\n')[0]}`);
    store.finishTask(taskId, 'error', e.message.slice(0, 500), modelUsed);
  }
}

async function runTool(name, args, task, log) {
  switch (name) {
    case 'list_sellers': {
      log('tool', 'Agent is browsing sellers');
      // Note: approval status is NOT shown. The agent doesn't know your rules.
      return store.listSellers().map((s) => ({ seller_id: s.id, name: s.name, category: s.category, listing: s.description }));
    }
    case 'get_menu': {
      const s = store.getSeller(args.seller_id);
      if (!s) return { error: `No seller with id "${args.seller_id}"` };
      log('tool', `Agent is reading ${s.name}'s menu`);
      return { seller_id: s.id, name: s.name, listing: s.description, menu: s.menu.map((m) => ({ name: m.name, price_usd: m.price, tags: m.tags })) };
    }
    case 'quote_order': {
      const s = store.getSeller(args.seller_id);
      if (!s) return { error: `No seller with id "${args.seller_id}"` };
      const menu = new Map(s.menu.map((m) => [m.name.toLowerCase(), m]));
      const lines = [];
      const problems = [];
      let total = 0;
      for (const it of args.items ?? []) {
        const m = menu.get(String(it.name ?? '').toLowerCase().trim());
        const qty = Number(it.quantity ?? 1);
        if (!m) { problems.push(`"${it.name}" is not on the menu`); continue; }
        const line = Math.round(m.price * 100) * qty;
        total += line;
        lines.push(`${qty} x ${m.name} = ${fmt(line)}`);
      }
      log('tool', `Agent got a quote from ${s.name}: ${fmt(total)}`);
      return { seller_id: s.id, lines, total: (total / 100).toFixed(2), problems };
    }
    case 'check_budget': {
      const spent = store.taskCommittedCents(task.id);
      return { task_budget: fmt(task.budget_cents), committed_so_far: fmt(spent), left: fmt(task.budget_cents - spent) };
    }
    case 'pay_seller': {
      const amountCents = toCents(args.amount);
      log('tool', `Agent wants to pay ${Number.isNaN(amountCents) ? args.amount : fmt(amountCents)} to ${args.seller_id}`);
      const p = await requestPayment(
        { taskId: task.id, sellerId: args.seller_id, items: args.items ?? [], amountCents, justification: args.justification ?? '' },
        log,
      );
      const outcome = {
        paid: 'PAID via PayPal.',
        processing: 'Being sent via PayPal.',
        pending_approval: 'WAITING for the human to approve on the dashboard. Do not pay for this again.',
        blocked: 'BLOCKED. No money moved.',
        failed: 'FAILED at PayPal. No money moved.',
      }[p.status];
      return { status: p.status, message: outcome, reason: p.reason, risk_score: p.risk_score, auditor_notes: p.risk_reasons };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}
