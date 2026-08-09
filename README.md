# Regent

**An onchain chief of staff for Arc.**

Regent is a multi-user Chrome extension AI agent that does more than execute commands. Any user can pair with MetaMask, receive their own Circle W3S agent wallet, fund it, and set their own weekly budget, per-tip cap, and allowlist. Regent watches the Arc ecosystem on each user's behalf, decides who to support and how much, can execute signatureless USDC nanopayments autonomously from that user's agent wallet, and can unlock paid HTTP resources through x402 after explicit user approval.

Built by GoGo for the Encode Programmable Money Hackathon, Build on Arc.

---

## What it does

Regent is a personal onchain assistant built as a multi-user product. Each user pairs independently, gets an independently funded agent wallet, and controls the limits that govern what their agent can do.

### Autonomous, signatureless payments (Circle W3S)
The agent can send USDC on Arc **without a per-transaction wallet signature**. Pairing starts with a SIWE-style MetaMask signature, then the backend provisions that user their own Circle W3S (developer-controlled) agent wallet. The user funds that wallet and defines its weekly budget, per-tip cap, and recipient allowlist. Every autonomous transfer is enforced against that user's policy server-side and recorded in their ledger. No private key ever lives in the extension.

Users can also create recurring autonomous payments from Settings. Daily, weekly, and 30-day schedules execute from the paired agent wallet, use a stable idempotency key for each occurrence, and recheck the live policy and wallet state before every payment. Schedules can be paused, resumed, or removed from the extension.

This is opt-in. When "Autonomous mode for my agent" is off, Regent uses the standard MetaMask / Circle Gateway flow and you sign each transaction yourself. The legacy single-operator autonomous mode remains available as a fallback.

### Proactive tip advisor
The agent decides who to tip and how much, using real signals: recent X activity for a creator, your tip history, and your remaining budget. It explains its reasoning ("active on X", "balancing your support", "you haven't supported them recently") and never fabricates activity. If a signal is unavailable, it degrades honestly and says so.

### Automatic creator discovery
The agent reads your own recent X activity, extracts the creators you actually mention and interact with, and proposes them as people to support, so you don't have to add everyone by hand. It only knows handles from X; you supply the Arc address (it never invents addresses).

### Ecosystem news pulse
The agent tracks Arc / Circle / stablecoin / agent news for you from public feeds, dedupes and ranks by recency, and summarizes what's happening. Only real, fetched headlines, never invented news.

### Portfolio intelligence
The agent reads your wallet: USDC balance, Circle Gateway balance, spendable position, and your recent tipping behavior (who you support most, how much lately), then gives an honest read of where you stand.

### Smart daily briefing
One cohesive, chief-of-staff style briefing that synthesizes the above into a short personal summary: your position, what's notable in the ecosystem, and one actionable suggestion. Real data only.

### Planner
Reminders you set, plus smart task suggestions the agent proposes from real state ("top up your Gateway balance", "you have budget left this week", "add an address for a discovered creator"). Only surfaced when the real precondition is met.

### Phone control
Users can pair Telegram or WhatsApp from Settings with a one-time code. If the backend exposes a public Telegram bot username, Settings can open the bot directly and can include the pairing code in the Telegram `/start` payload. Phone commands are intentionally narrow and safe: `help`, `balance`, `status`, `schedules`, `pause 1`, and `resume 1`. Direct message-based transfers are disabled; new payments and x402 access still stay inside the normal approved app flow.

### x402 paid access
Gogo can inspect an x402 URL without paying, verify that it is an Arc Testnet USDC + Circle Gateway offer, and show the exact price, network, and seller. The user must then tap **Pay & access** before MetaMask is asked for an EIP-712 authorization. Regent re-fetches and compares the quote immediately before signing, rejects changed terms, and caps this initial flow at 1 USDC. Type `x402 demo` in Gogo to use the companion backend's protected test resource.

### Free always-on scheduling via external cron
The backend can run on a free sleeping host while preserving scheduled-payment reliability. A secured external cron endpoint wakes the worker every minute, reuses the same due-payment processor as the in-process scheduler, and requires `X-Cron-Secret` before doing any work. The current demo deployment uses Render Free + Neon + cron-job.org, so the web service may sleep but scheduled payments are still externally triggered.

---

## Circle stack

Regent is built end-to-end on Circle's tooling for Arc:

- **USDC on Arc Testnet** — the unit for every payment.
- **Circle W3S Programmable Wallets** — one signatureless agent wallet provisioned per paired user, signed server-side with no local key.
- **Circle Gateway** — deposits, single tips, and batch tips, with real on-chain settlement.
- **x402 + Gateway Nanopayments** — HTTP-native paid access using offchain MetaMask authorization and batched USDC settlement.

---

## Proven on-chain (Arc Testnet)

Every capability below was executed on Arc Testnet and is verifiable on ArcScan.

**Autonomous signatureless transfer (Circle W3S):**
`0xb54e5c25b5e856f3f93125ab509e9ba856d9a68c254ee5cb6ee4bf7a5979ae84`

**Signatureless tip via the agent backend:**
`0xcd6505d97d1dba3e966f4610144d9f33fa5cbe5b25f5e4f3f09c089086ad53d8`

**Circle Gateway batch tip (advisor paid three creators in one flow):**
- `0x7ac55c8e6296ab0ebc35bbe2dea10b871ffc405a9c213514164fae503a8d8029`
- `0xda76f0f55120f58495b5bb9fa1bffa11b710edd9832248f0e35a57fa57d27f97`
- `0xafdc1f7fb76dcd55fe90404ea4d03c93e0c5417dca6a5c2456b0a9392c292176`

**x402 paid resource unlock (0.001 USDC, Arc Testnet):**
`13c83515-65d9-4906-bf80-b7ead6762c9d`

**Scheduled autonomous payment via external cron (0.001 USDC):**
`0x5485dd06c2fd25de8e72157f8081fc6af0de776ec85d66fc748a3fed543f1364`

Explorer: https://testnet.arcscan.app

---

## Architecture

- **Extension (Chrome MV3):** React + TypeScript + wagmi/viem. Runs the agent logic, advisor, discovery, news, briefing, portfolio, planner, pairing UI, and the Gogo AI chat surface. Pairing uses a SIWE-style MetaMask signature. No private key is stored in the client.
- **Agent backend (separate service):** a Node service that authenticates paired users, provisions one Circle W3S agent wallet per user, and routes autonomous tips from the correct wallet. Per-user weekly budget, per-tip cap, and allowlist policy are enforced server-side before every transfer.
- **Neon Postgres:** stores users, sessions, agent wallet records, policies, allowlists, recurring payment rules, occurrence records, and the per-user tip ledger. Session tokens are stored only as hashes.
- **Render + external cron:** the live demo backend runs on Render Free and is woken by cron-job.org every minute through a secret-protected schedule endpoint. The same schedule processor also runs in-process whenever the host is awake.
- **Key custody:** Circle W3S holds the wallet keys. Private keys are never returned to or stored by the extension.
- **Fallback paths preserved:** with per-user autonomous mode off, the extension uses the existing signed MetaMask / Circle Gateway flow. The legacy single-operator autonomous mode remains available as a fallback.
- **x402 isolation:** paid-resource discovery and signing live in their own client module and backend routes. Existing wallet, transfer, tipping, and scheduled-payment endpoints are unchanged.

**Arc Testnet constants:**
- Chain ID: `5042002`
- USDC: `0x3600000000000000000000000000000000000000`
- Explorer: https://testnet.arcscan.app

---

## How to install and try it

Regent is currently installed as an unpacked Chrome extension. Chrome Web Store publishing is on the roadmap.

```bash
git clone https://github.com/GoGoSns/arccopilot.git
cd Regent
pnpm install
pnpm build
```

Then open `chrome://extensions/` in Chrome, enable Developer mode, click **Load unpacked**, and select the `dist` folder.

Connect MetaMask on Arc Testnet. The signed MetaMask / Circle Gateway flow works right away.

To try x402 safely, open Gogo and type `x402 demo`. Review the displayed 0.001 USDC quote. No payment or signature happens until you tap **Pay & access**. The buyer must already have enough available Circle Gateway balance.

To use your own autonomous agent:

1. Open **Settings** and go to **Your agent (paired)**.
2. Click **Pair with MetaMask** and sign the message.
3. The backend provisions your own Circle W3S agent wallet and shows its address.
4. Fund that address with Arc Testnet USDC from the [Circle faucet](https://faucet.circle.com) or your own wallet.
5. Turn on **Autonomous mode for my agent**, then set your weekly budget and per-tip cap. You can also configure your recipient allowlist.

Your agent now pays from your own agent wallet without a signature for each transaction, while the backend enforces your policy.

Optionally, choose Gemini, OpenAI, or Anthropic in Settings and add your own provider key for AI wording. Without a key, briefing, portfolio, and news features degrade honestly to summaries built from real available data.

---

## Demo script

Use this short path for judging or a screen recording:

1. Open the wallet and show Arc Testnet USDC plus Circle Gateway balance.
2. Open Gogo and type `demo mode` to show the local demo command menu.
3. Type `demo status` to show the local proof card: Render + Neon + cron, x402 payment id, and scheduled-payment transaction hash.
4. Type `demo links` to show the repository, Render, x402 proof, and ArcScan proof links in one place.
5. Type `demo checklist` to show the pre-recording reliability checklist.
6. Type `demo script` if you want Gogo to show a compact judging/screen-recording narration.
7. Type `portfolio` to show real wallet intelligence.
8. Type `who should I tip` to show the paired-agent policy, weekly budget, per-tip cap, and advisor reasoning.
9. Type `x402 demo`, review the 0.001 USDC quote, then tap **Pay & access** to unlock the protected resource.
10. Type `create a reminder to pay 0.001 USDC to 0xB87B6D1a56bB7942bd07b6B0e9540a63b3dA4365 every 1 hour` to create a recurring autonomous payment without relying on an AI provider.
11. Open Settings -> Your agent (paired) -> Scheduled autonomous payments -> History and show the completed ArcScan transaction.

For the final Encode submission package, see:

- [Final submission copy](docs/FINAL_SUBMISSION.md)
- [3-minute demo video script](docs/DEMO_VIDEO_SCRIPT.md)
- [Final deck outline](docs/FINAL_DECK_OUTLINE.md)
- [Product roadmap](docs/PRODUCT_ROADMAP.md)
- [Chrome Web Store submission notes](docs/CHROME_STORE_SUBMISSION.md)

---

## Design principles

- **Human-defined limits.** Autonomy always runs inside a weekly budget, a per-tip cap, and an allowlist enforced server-side.
- **No key in the client.** The extension never holds a raw private key. Autonomous signing happens in the backend via Circle W3S.
- **Honest by default.** The agent never fabricates activity, headlines, balances, or transactions. When a data source is unavailable, it says so and degrades gracefully.

---

## Roadmap

- **Chrome Web Store publishing** — move from unpacked installation to a published extension release.
- **Mainnet** — move from Arc Testnet to Arc mainnet (config-driven).
- **x402 marketplace expansion** — add creator-defined resources, richer discovery, receipts, and user-configurable payment policies on top of the working paid-access flow.
- **Deeper ecosystem integration** — richer creator onboarding, more news and portfolio signals, and calendar/task automation to complete the chief-of-staff vision.

---

## Built by

GoGo — X: [@0xGoGochain](https://x.com/0xGoGochain)

Built solo, starting from zero coding background, across a series of Arc projects that grew into this onchain chief of staff.
