# ArcCopilot

**An onchain chief of staff for Arc.**

ArcCopilot is a Chrome extension AI agent that does more than execute commands. It watches the Arc ecosystem on your behalf, decides who to support and how much, and can execute signatureless USDC nanopayments autonomously through Circle W3S Programmable Wallets, all within human-defined budget and allowlist limits.

Built by GoGo for the Lepton hackathon (Circle x Canteen), on Arc Testnet.

---

## What it does

ArcCopilot is a personal onchain assistant. Instead of a wallet you drive manually, it is an agent that thinks and acts for you across a few core areas.

### Autonomous, signatureless payments (Circle W3S)
The agent can send USDC on Arc **without a per-transaction wallet signature**. A minimal backend holds a Circle W3S (developer-controlled) wallet and signs transfers server-side, so the agent can act on your behalf while a MetaMask flow remains available as the default. Every autonomous transfer is enforced against server-side policy: a weekly budget, a per-tip cap, and a recipient allowlist. No private key ever lives in the extension.

This is opt-in. When "Autonomous mode" is off, ArcCopilot uses the standard MetaMask / Circle Gateway flow and you sign each transaction yourself.

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

---

## Circle stack

ArcCopilot is built end-to-end on Circle's tooling for Arc:

- **USDC on Arc Testnet** — the unit for every payment.
- **Circle W3S Programmable Wallets** — the agent's signatureless wallet, signed server-side with no local key.
- **Circle Gateway** — deposits, single tips, and batch tips, with real on-chain settlement.

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

Explorer: https://testnet.arcscan.app

---

## Architecture

- **Extension (Chrome MV3):** React + TypeScript + wagmi/viem. Runs the agent logic, advisor, discovery, news, briefing, portfolio, planner, and the Gogo AI chat surface. No private key stored.
- **Agent backend (separate service):** a minimal Node service holding the Circle W3S credentials. Exposes an authenticated tip endpoint that enforces weekly budget, per-tip cap, and allowlist, then executes the W3S USDC transfer and returns the on-chain result. Secrets live only in the backend environment.
- **Default path preserved:** with autonomous mode off, the extension uses the existing MetaMask / Circle Gateway flow unchanged.

**Arc Testnet constants:**
- Chain ID: `5042002`
- USDC: `0x3600000000000000000000000000000000000000`
- Explorer: https://testnet.arcscan.app

---

## Design principles

- **Human-defined limits.** Autonomy always runs inside a weekly budget, a per-tip cap, and an allowlist enforced server-side.
- **No key in the client.** The extension never holds a raw private key. Autonomous signing happens in the backend via Circle W3S.
- **Honest by default.** The agent never fabricates activity, headlines, balances, or transactions. When a data source is unavailable, it says so and degrades gracefully.

---

## Roadmap

- **Per-user wallet provisioning** — each user pairs their own Circle W3S agent wallet (one-time signature challenge), with per-user budget, allowlist, and ledger, for a true multi-user product.
- **Mainnet** — move from Arc Testnet to Arc mainnet (config-driven).
- **Pay-per-access (x402)** — let creators gate content and get paid per request in sub-cent USDC.
- **Deeper ecosystem integration** — richer creator onboarding, more news and portfolio signals, and calendar/task automation to complete the chief-of-staff vision.

---

## Built by

GoGo — X: [@0xGoGochain](https://x.com/0xGoGochain)

Built solo, starting from zero coding background, across a series of Arc projects that grew into this onchain chief of staff.
