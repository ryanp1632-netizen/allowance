# Allowance

**A guarded spending wallet for AI agents, built on the PayPal sandbox.**

AI agents are starting to buy things for us. Allowance lets an agent pay sellers through PayPal, but only inside the rules you set: a per-task budget, a daily cap, approved sellers, human approval above an amount, and a kill switch.

**Explain-before-pay:** before any money moves, the agent must justify the payment. A second AI check scores how risky or off-task that justification is, and risky payments get blocked or sent to you for approval.

Demo story: an agent orders **lunch for a small team** within budget.

> **No real money, ever.** Allowance is hard-locked to the PayPal **sandbox** (fake test money). The sandbox address is fixed in [`src/config.js`](src/config.js), every PayPal request goes through one checked function in [`src/paypal.js`](src/paypal.js), and the app refuses to start if `PAYPAL_API_BASE` points anywhere else. `npm test` proves it.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Nov 2026).

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

## Run it locally (judges start here)

Takes about 10 minutes. Everything is free, and everything runs on the PayPal **sandbox**, so no real money can move.

### 0. What you need
- **Node.js 22.9 or newer** ([nodejs.org](https://nodejs.org/), LTS is fine). Check with `node --version`.
- A free **PayPal developer** login (any PayPal account works; you can create one at sign-in).
- A free **Google AI Studio** key (Gemini). No billing needed.

### 1. Get the code
```bash
git clone https://github.com/ryanp1632-netizen/allowance.git
cd allowance
npm install
cp .env.example .env
```
On Windows Command Prompt use `copy .env.example .env` instead of `cp`.

### 2. PayPal sandbox app keys
1. Go to [developer.paypal.com/dashboard](https://developer.paypal.com/dashboard/) and log in.
2. Make sure the toggle at the top says **Sandbox** (not Live).
3. Open **Apps & Credentials**. Open the **Default Application** (or click **Create App**, type "Business").
4. Copy **Client ID** → `PAYPAL_CLIENT_ID` and **Secret** → `PAYPAL_CLIENT_SECRET` in `.env`.
5. Still in the app, scroll to the features list and make sure **Payouts** is ticked (save if you change it).

### 3. Sandbox test accounts (for the top-up)
PayPal creates two fake sandbox accounts for every developer automatically:
1. Go to **Testing Tools → Sandbox Accounts** in the developer dashboard.
2. **Personal** account (`…@personal.example.com`): this is the **buyer** you log in with when you top up the allowance. Click **⋮ → View/edit account** to see its email and password.
3. **Business** account (`…@business.example.com`): this owns the app. Top-ups land here, and the agent's seller payouts are sent from here.

If the list is empty, click **Create account** and make one Personal (US) and one Business (US) account.

### 4. Free AI key (free tier only, no billing)
- **Gemini (default):** create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`.
  **Do not add a payment method or enable billing.** A key without billing stays on the free tier: if you hit the free limit you get a "429 rate limit" error, never a charge. Allowance retries busy models and falls back to Flash-Lite automatically.
- **Groq (optional fallback):** create a key at [console.groq.com/keys](https://console.groq.com/keys) on the free plan (no card needed) and put it in `GROQ_API_KEY`. It's used automatically if Gemini is unavailable; set `AI_PROVIDER=groq` to make it the main provider.

### 5. Check and start
```bash
npm test         # 20 tests: guardrails + proof the app is locked to the PayPal sandbox
npm run check    # tests your PayPal + AI keys (never prints them)
npm start        # then open http://localhost:3000
```

### 6. Try the demo (about 3 minutes)
1. **Top up:** enter `100` in "Top up the allowance", click the **PayPal** button, and log in with the sandbox **Personal** account from step 3. The balance shows $100.00.
2. **Run the agent:** the "team lunch for 4" task and $60 budget are pre-filled. Click **Run agent** and watch the live activity.
3. **Explain-before-pay:** every payment shows the agent's reason and a risk score. Under **Approved sellers → Sunny Side Tacos → Seller's listing** you can see a hidden instruction that tries to trick AI agents into adding a fake $15 fee; if the agent falls for it, the payment is blocked.
4. **Approve:** orders over the $50 "ask me above" limit wait under **Waiting for your approval**. Click **Approve & pay with PayPal** to send a sandbox payout.
5. **Ledger:** scroll down to the AG Grid ledger. Search, filter, export CSV, and click any row to see every guardrail check.
6. **Kill switch:** click it (top right), then run the agent again. It stops before spending anything.

To start over with an empty wallet and ledger: stop the server, delete the `data/` folder, and run `npm start` again.

**Optional:** set `DEMO_SELLER_EMAIL` in `.env` to your sandbox **Personal** account's email so seller payouts show `SUCCESS`. Without it, the made-up demo seller emails show `UNCLAIMED`, which is normal in the sandbox.

### Troubleshooting
| Problem | Fix |
|---|---|
| `npm run check` says PayPal rejected the credentials | Re-copy the **Sandbox** (not Live) Client ID and Secret. |
| "No Payouts permission" warning | Tick **Payouts** in the sandbox app's features (step 2.5). |
| AI errors 503 / 429 | Free-tier models are busy or rate-limited. Wait a minute; Allowance already retries and falls back. Adding a free Groq key helps. |
| PayPal payout fails with insufficient funds | Top up first. Top-ups fund the sandbox business account that sends the payouts. |
| PayPal pop-up doesn't open | Allow pop-ups for `localhost`. |

## Test credentials
There's no shared login: Allowance runs on your machine with **your own** free sandbox accounts (step 3). All money is PayPal sandbox money; nothing real is ever charged.

## License
[MIT](LICENSE)
