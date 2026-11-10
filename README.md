# Allowance

**A guarded spending wallet for AI agents, built on the PayPal sandbox.**

AI agents are starting to buy things for us. Allowance lets an agent spend real (sandbox) money through PayPal, but only inside the rules you set: a per-task budget, a daily cap, approved sellers, human approval above an amount, and a kill switch.

**Explain-before-pay:** before any money moves, the agent must justify the payment. A second AI check scores how risky or off-task that justification is, and risky payments get blocked or sent to you for approval.

Demo story: an agent orders **lunch for a small team** within budget.

> Status: in progress for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (deadline Nov 12, 2026).

## Tech
- **PayPal (sandbox only):** REST APIs, OAuth client-credentials
- **AI:** Google Gemini (free tier) through its OpenAI-compatible API; Groq can be swapped in with one `.env` setting
- **App:** Node.js + Express, plain HTML/JS dashboard, AG Grid for the payments ledger

## Run it locally

Requires **Node.js 22.9 or newer**.

```bash
git clone https://github.com/ryanp1632-netizen/allowance.git
cd allowance
npm install
cp .env.example .env     # then fill in the keys below
npm run check            # verifies your PayPal + AI keys (never prints them)
npm start                # open http://localhost:3000
```

### 1. PayPal sandbox keys (free)
1. Log in at [developer.paypal.com](https://developer.paypal.com/dashboard/) with any PayPal account.
2. Make sure the toggle at the top says **Sandbox**.
3. Open **Apps & Credentials**, then open the default app (or **Create App**).
4. Copy **Client ID** into `PAYPAL_CLIENT_ID` and **Secret** into `PAYPAL_CLIENT_SECRET` in `.env`.
5. In the app's settings, make sure **Payouts** is ticked under features.

### 2. AI key (free)
- **Gemini (default):** create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`.
- **Groq (optional fallback):** create a key at [console.groq.com/keys](https://console.groq.com/keys), put it in `GROQ_API_KEY`, and set `AI_PROVIDER=groq`.

## Test credentials
Sandbox test accounts for judges will be listed here once the demo is finished. All money is PayPal sandbox money; nothing real is charged.

## License
[MIT](LICENSE)
