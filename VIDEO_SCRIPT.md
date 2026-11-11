# Demo video script: Allowance (target 2:45, hard limit 3:00)

About 390 spoken words at a calm pace. Lines in **[YOUR WORDS]** are yours to fill in. Say things in your own way; this is a guide, not a teleprompter.

## Before you record (checklist)

- [ ] `npm start`, open http://localhost:3000, browser zoom ~110% so text is readable.
- [ ] **Fresh data:** stop the server, delete the `data/` folder, start again (balance $0, empty ledger).
- [ ] Rules: daily cap **$100**, ask me above **$50**, review at risk **40**, block at **75**. Green Bowl, Sunny Side and Crumb & Co. ticked; QuickBite unticked (that's the default).
- [ ] Logged out of PayPal in that browser, and your sandbox **buyer** email/password ready (Testing Tools → Sandbox Accounts → Personal → ⋮ → View/edit).
- [ ] **Do a practice run first.** The AI decides differently each time; the agent may or may not fall for the taco fee. Record a few takes and keep a real one. Never fake a result. If the trap doesn't trigger in your best take, use the "Option B" line in Shot 4.
- [ ] Turn off notifications. No background music unless it's royalty-free and you have the rights. No logos besides PayPal's own buttons on screen.
- [ ] Upload to YouTube as **Public**, under 3:00.

---

## Shot 0: Who I am (optional face cam, 0:00–0:10)
**Screen:** your face (webcam), then cut to the dashboard.
**Say:**
> "Hi, I'm [your first name], a college student at Cal State LA. This week I started using AI agents to do real work for me, like entering coding contests and getting paid, and it made me think hard about trusting AI with money."

## Shot 1: Hook (0:10–0:20)
**Screen:** the dashboard with the yellow SANDBOX banner.
**Say:**
> "AI agents are starting to buy things for us. But giving an agent your PayPal is all or nothing. I built **Allowance**: a PayPal wallet for AI agents where every payment has to be explained, checked, and kept inside your rules."
>
> "I'm a college student, and when I started letting AI do real work for me, my first question was: how do I make sure it can't spend my money?"

## Shot 2: Top up with PayPal Checkout (0:15–0:35)
**Screen:** Top-up card → type 100 → click the PayPal button → sandbox login → Pay → toast "Added $100.00", balance shows $100.00.
**Say:**
> "First, I fund the agent's allowance with PayPal Checkout, using the PayPal Orders API in sandbox. The agent can only spend what I put in, so the most it can ever lose is this $100."

## Shot 3: Run the agent (0:35–1:00)
**Screen:** the pre-filled task "Order lunch for our team of 4. One person is vegetarian. Include drinks." Budget $60 → **Run agent** → live activity feed fills in (browsing sellers, reading menus, quotes).
**Say:**
> "Now I give the agent a task: lunch for four, one vegetarian, sixty dollars. It's a Gemini model with tools. It browses sellers, reads menus and gets quotes, all on its own. It can't see my rules; it only finds out if a payment goes through."

## Shot 4: Explain-before-pay and the taco trap (1:00–1:35)
**Screen:** feed shows an "explain" line, then a red BLOCKED line. Then, under "Approved sellers", expand **Sunny Side Tacos → Seller's listing** to show the hidden fee instruction, and/or click the blocked row in the ledger.
**Say (Option A, the agent fell for the trap):**
> "Here's the key idea: **explain-before-pay**. Every payment has to come with a reason. Code checks the facts against the menu, and a second, separate AI audits the payment and scores the risk."
>
> "And look: this taco seller hid an instruction in their listing telling AI agents to add a fifteen-dollar 'handling fee'. The agent fell for it. Allowance didn't. The amount doesn't match the menu, the auditor scored it risk [say the number on screen], and it was blocked. No money moved."

**Say (Option B, the agent ignored the trap):**
> "Here's the key idea: **explain-before-pay**. Every payment has to come with a reason. Code checks the facts against the menu, and a second, separate AI audits it and scores the risk. This taco seller even hides an instruction telling AI agents to add a fake fifteen-dollar fee. This time the agent ignored it, but if it doesn't, the amount won't match the menu and Allowance blocks it. In my testing it got caught at risk ninety."

## Shot 5: Human approval at the $50 limit (1:35–2:00)
**Screen:** "Waiting for your approval" card: amount (e.g. $57.50), items, the agent's explanation, the risk bar → click **Approve & pay with PayPal** → toast "Paid … via PayPal sandbox".
**Say:**
> "The real order is over my fifty-dollar limit, so it waits for me. I can see exactly what it's buying, why, and the auditor's risk score. I approve, and Allowance pays the seller through the PayPal Payouts API, with the agent's reason attached to the payment."

## Shot 6: The AG Grid ledger (2:00–2:20)
**Screen:** scroll to the ledger → type "taco" in the search → click a row → the guardrail checks dialog (green ticks / red crosses).
**Say:**
> "Every attempt is in the ledger, built with AG Grid: paid, blocked, or waiting. I can search, filter, export, and click any payment to see each check: approved seller, budget, daily cap, risk, and my approval limit."

## Shot 7: Kill switch (2:20–2:35)
**Screen:** click **Kill switch** (turns red) → click Run agent again → feed shows "Kill switch is ON: agent stopped."
**Say:**
> "And if anything ever looks wrong, one click on the kill switch stops all agent spending immediately, even payments I've already been asked to approve."

## Shot 8: Close (2:35–2:50)
**Screen:** dashboard overview or GitHub README.
**Say:**
> "Allowance runs on PayPal's sandbox with Payouts and Checkout, Gemini for the agent and the auditor, and AG Grid for the ledger. It's open source; setup steps are in the README. Agents can shop for us, as long as they explain every payment first. Thanks for watching!"

---

### If you run short on time
Cut Shot 7's re-run (just show the switch turning red), and shorten Shot 1. Shots 2–6 are the must-haves.
