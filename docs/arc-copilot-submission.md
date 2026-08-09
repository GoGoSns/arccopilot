# ArcCopilot

USDC-first wallet assistant and agent control layer for Arc Testnet.

## 1. Problem

Crypto users need automation, paid resource access, and mobile monitoring without losing control over approvals, budgets, and payment boundaries.

## 2. Solution

ArcCopilot combines an Arc Testnet wallet view, Gogo AI guidance, x402 paid Arc insights, scheduled autonomous payments, reminders, DeFi discovery, proof-first token/meme monitoring, CCTP bridge preflight, and Telegram/WhatsApp-ready phone control.

## 3. Arc + Circle Integration

- Arc Testnet wallet UX with USDC-first positioning.
- Circle developer-controlled agent wallets for autonomous actions.
- Policy controls for weekly budgets, per-payment caps, and recipient allowlists.
- x402 paid resource discovery, exact quote review, and explicit Pay & access approval.
- Circle Gateway authorization flow for paid HTTP access.
- Scheduled payment worker with webhook/reconciliation reliability.
- DeFi Radar and Token/Meme Radar surfaces backed by real signals and ArcScan/onchain proof rules.
- Arc Bridge preflight for CCTP-style USDC movement; transfers require explicit confirmation and are not started automatically.

## 4. Agentic Economy Flow

1. User pairs ArcCopilot with MetaMask.
2. ArcCopilot provisions or loads the user's agent wallet.
3. User sets budget, per-tip cap, and allowlist.
4. Gogo AI explains actions and prepares safe payment flows.
5. x402 quote cards show exact price, network, seller, and payment status.
6. Scheduled payments and reminders keep recurring actions visible.
7. Token/Meme Radar and DeFi Radar help Gogo explain real Arc signals without fake buy calls.
8. Telegram/WhatsApp-ready mobile control can check status and manage schedules.

## 5. Safety Model

- x402 access requires explicit user approval before signature/payment.
- Phone commands cannot create new direct payments.
- Autonomous scheduled payments are checked against wallet readiness, autonomous mode, allowlist, per-payment cap, weekly budget, and live Circle transfer outcome.
- Secrets are environment variables only; no tokens or private keys are committed.
- External cron endpoint is protected by `X-Cron-Secret` for free sleeping hosts.
- Radar is read-only: no automatic token buying, no profit claims, no launch alert without proof.
- Arc is treated as Arc Testnet; mainnet is never assumed.

## 6. Demo Path

- Open ArcCopilot wallet.
- Review USDC balance on Arc Testnet.
- Ask Gogo for an Arc insight.
- Review x402 quote for `0.001 USDC`.
- Approve Pay & access.
- View protected paid response.
- Create reminders and scheduled autonomous payments.
- Pair Telegram and control schedule status from phone.
- Open Token/Meme Radar to show proof-first monitoring.
- Open Arc Bridge to show preflight-only safety.

## 7. Repositories

- Extension: https://github.com/GoGoSns/arccopilot
- Backend: https://github.com/GoGoSns/arccopilot-agent

## 8. Current Status

ArcCopilot has working extension UI, x402 paid insight flow, scheduled payment infrastructure, reminder/calendar features, DeFi Radar, proof-first Token/Meme Radar, Arc Bridge preflight, launch-readiness checks, mobile-control pairing UI, Telegram/WhatsApp webhook backend support, and external cron triggers for free sleeping hosts.

## 9. Final Submission Pack

- Final submission copy: `docs/FINAL_SUBMISSION.md`
- 3-minute video script: `docs/DEMO_VIDEO_SCRIPT.md`
- Final deck outline: `docs/FINAL_DECK_OUTLINE.md`
- Product roadmap: `docs/PRODUCT_ROADMAP.md`
- Chrome Web Store notes: `docs/CHROME_STORE_SUBMISSION.md`
