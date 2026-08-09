# Regent final deck outline

Use 8-10 slides. Keep the deck visual, proof-heavy, and honest.

## Slide 1 — Title

Regent

Subtitle: A USDC-first agent control layer for Arc

Track: Agentic Economy

Tagline: Autonomy without bypass.

## Slide 2 — Problem

Crypto agents can help users move money, pay services, and monitor markets — but most designs create a trust gap:

- hidden keys
- unclear approvals
- invented signals
- no spending policy
- no proof trail

## Slide 3 — Solution

Regent is a browser assistant for Arc that:

- reads real wallet and ecosystem state
- explains what it sees
- prepares USDC actions
- executes only inside user policy
- shows proof links and payment history

## Slide 4 — Why Arc + Circle

- Arc: USDC-native gas, EVM-compatible, fast settlement.
- USDC: common unit for payments, settlement, treasury, and agent transactions.
- Gateway + x402: paid HTTP resources with quote-first approval.
- Agent Stack / W3S pattern: agent wallet actions with server-side policy.
- App Kits: bridge/swap/send/unified-balance roadmap.

## Slide 5 — Product walkthrough

Screens to show:

- Wallet
- Gogo AI
- x402 quote card
- Scheduled payment history
- Token/Meme Radar
- Arc Bridge preflight

## Slide 6 — Agentic Economy flow

1. User pairs wallet.
2. User defines budget, cap, and allowlist.
3. Gogo reads real signals.
4. Agent prepares action.
5. Policy checks run.
6. User approves sensitive flows.
7. Result is recorded with proof.

## Slide 7 — Proof and safety

- x402: no signature before Pay & access.
- Scheduled payments: cron-triggered and policy checked.
- Token radar: no buy calls, no unproven launches.
- Bridge: preflight-only.
- Secrets: env-only, no private key in extension.

## Slide 8 — Live proof

Include:

- Frontend repo
- Backend repo
- Render backend health
- x402 payment id
- ArcScan scheduled payment transaction
- Screenshot of cron-job.org successful 200 OK runs

## Slide 9 — What is new / differentiated

Regent is not only a wallet and not only a chatbot. It is a control surface where an AI assistant, policy engine, x402 payments, scheduled USDC actions, bridge preflight, and risk radar meet.

## Slide 10 — Roadmap

Near-term:

- Agent Marketplace / x402 service browser
- x402 payment history with nonce and txHash tracking
- Bridge step timeline
- Swap preflight for USDC, EURC, cirBTC
- Policy & Proof Center
- Stronger token detail/risk explanations in Gogo

## Final slide sentence

Regent helps agents act with money on Arc, but never outside the user's policy.

