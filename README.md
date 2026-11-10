# Allowance

**A guarded spending wallet for AI agents, built on the PayPal sandbox.**

AI agents are starting to buy things for us. Allowance lets an agent pay sellers through PayPal, but only inside the rules you set: a per-task budget, a daily cap, approved sellers, human approval above an amount, and a kill switch.

**Explain-before-pay:** before any money moves, the agent must justify the payment. A second AI check scores how risky or off-task that justification is, and risky payments get blocked or sent to you for approval.

Demo story: an agent orders **lunch for a small team** within budget.

> **No real money, ever.** Allowance is hard-locked to the PayPal **sandbox** (fake test money). The sandbox address is fixed in [`src/config.js`](src/config.js), every PayPal request goes through one checked function in [`src/paypal.js`](src/paypal.js), and the app refuses to start if `PAYPAL_API_BASE` points anywhere else. `npm test` proves it.

> Status: in progress for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (deadline Nov 12, 2026).

## How it works

```
 you ──top up (PayPal Checkout)──▶ Allowance wallet
                                        │
 task ──▶ AI shopping agent ──pay_seller(items, amount, WHY)──▶ Explain-before-pay
                                                                  │  1. fact check (code): items on menu? amount = menu total?
                                                                  │  2. AI auditor (separate model call): risk 0–100
                                                                  ▼
                                                             Guardrails (src/rules.js)
                                     kill switch · approved seller · balance · task budget · daily cap · risk · approval limit
                                                                  │
                                       ┌──────── allow ───────────┼────────── review ─────────┐──── block
                                       ▼                                                      ▼        ▼
                              PayPal Payouts API                                  your dashboard   logged, agent
                           (reason sent as payout note)                          Approve / Deny    told why
```

- **The agent can't see or change your rules.** It only learns the outcome (paid, blocked, waiting for you), so Allowance protects you even if the agent makes a mistake or is tricked.
- **No explanation, no payment.** Every payment carries the agent's reason. Code checks the facts, and a second AI judges whether the payment is necessary, on-task and fairly priced.
- **Fail safe.** If the AI auditor is down, payments go to a human instead of going through.
- **Circuit breaker.** An agent that gets blocked 3 times in one task is paused.
- **Every attempt is logged**, including blocked ones, in an AG Grid ledger you can search, filter and export.
- **Built-in trap:** one demo seller's listing tells AI agents to add a fake "$15 group handling fee". If the agent falls for it, the amount no longer matches the menu and explain-before-pay blocks it.

## Tech and tools used
| Part | What | How it's used |
|---|---|---|
| PayPal **Payouts API** | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` | The agent pays sellers from your sandbox business account. Payment ID is the idempotency key, so a retry can't pay twice. |
| PayPal **Orders v2** + **JS SDK** buttons | `POST /v2/checkout/orders`, `.../capture` | You top up the agent's allowance with PayPal Checkout. |
| PayPal **OAuth** | `POST /v1/oauth2/token` | Server-side client-credentials token. |
| **Google Gemini** (free tier) | OpenAI-compatible chat + tool calling | 1) the shopping agent (tool calling), 2) the independent payment auditor (risk score + reasons). Falls back from busy models to Flash-Lite, optionally to Groq. |
| **AG Grid Community** | v35 | The payments ledger: sorting, filters, quick search, CSV export, row details. |
| Node.js + Express + built-in SQLite | | Server, API and storage. No database to install. |

Code map: [`src/agent.js`](src/agent.js) (agent loop and tools) · [`src/auditor.js`](src/auditor.js) (explain-before-pay) · [`src/rules.js`](src/rules.js) (guardrails) · [`src/payments.js`](src/payments.js) (puts it together) · [`src/paypal.js`](src/paypal.js) (all PayPal calls) · [`src/ai.js`](src/ai.js) (resilient AI client) · [`public/`](public/) (dashboard).

## Run it locally

Requires **Node.js 22.9 or newer**.

```bash
git clone https://github.com/ryanp1632-netizen/allowance.git
cd allowance
npm install
cp .env.example .env     # then fill in the keys below
npm test                 # proves the app is locked to the PayPal sandbox
npm run check            # verifies your PayPal + AI keys (never prints them)
npm start                # open http://localhost:3000
```

### 1. PayPal sandbox keys (free)
1. Log in at [developer.paypal.com](https://developer.paypal.com/dashboard/) with any PayPal account.
2. Make sure the toggle at the top says **Sandbox**.
3. Open **Apps & Credentials**, then open the default app (or **Create App**).
4. Copy **Client ID** into `PAYPAL_CLIENT_ID` and **Secret** into `PAYPAL_CLIENT_SECRET` in `.env`.
5. In the app's settings, make sure **Payouts** is ticked under features.

### 2. AI key (free tier only, no billing)
- **Gemini (default):** create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`.
  **Do not add a payment method or enable billing** (no "Set up billing" / "Upgrade" in AI Studio, no billing account on the Google Cloud project). A key without billing stays on the free tier: if you hit the free limit you get a "429 rate limit" error, never a charge.
- **Groq (optional fallback):** create a key at [console.groq.com/keys](https://console.groq.com/keys) on the free plan (no card needed), put it in `GROQ_API_KEY`, and set `AI_PROVIDER=groq`.

### 3. Try the demo
1. **Top up:** click the PayPal button on the dashboard and log in with a **sandbox personal (buyer) account**. Find one at developer.paypal.com → **Testing Tools → Sandbox Accounts**; the "Personal" account's email and password are under **⋮ → View/edit account**.
2. **Run a task:** the "team lunch" task is pre-filled. Click **Run agent** and watch the live activity.
3. **Approve or deny** anything waiting for you, flip the **kill switch**, change the rules, and click ledger rows to see every guardrail check.

Optional: set `DEMO_SELLER_EMAIL` in `.env` to one of your sandbox accounts so seller payouts complete as `SUCCESS` (the built-in demo seller emails show as `UNCLAIMED`).

## Test credentials
Everything runs on the PayPal **sandbox**. All money is fake and nothing real is ever charged. Use your own sandbox buyer account (step 3 above) to top up.

## License
[MIT](LICENSE)
