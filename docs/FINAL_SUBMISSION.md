# ArcCopilot final submission

## Project

ArcCopilot

## Track

Primary: Agentic Economy

Secondary fit: DeFi, through read-only DeFi discovery, Arc token monitoring, CCTP bridge preflight, and USDC/EURC/cirBTC swap-preflight roadmap.

## One-liner

ArcCopilot is a USDC-first agent control layer for Arc: a browser assistant that reads real wallet, community, and onchain signals, then prepares or executes policy-bound USDC actions without bypassing user limits or explicit approvals.

## Short description

ArcCopilot gives Arc users a Gogo AI assistant, wallet view, x402 paid-resource access, scheduled USDC payments, CCTP bridge preflight, DeFi discovery, and proof-first token/meme radar in one Chrome extension. The agent can reason over real signals and prepare money movement, but every sensitive action is constrained by server-side policy, user-defined budgets, allowlists, and explicit confirmation.

## Longer description

Most crypto automation asks users to choose between convenience and control. ArcCopilot is built around a different thesis: autonomy without bypass.

The user sees a wallet and assistant, but the system underneath is a control layer for USDC actions on Arc Testnet. Gogo AI can summarize portfolio state, suggest creators to tip, inspect x402 paid resources, create recurring USDC schedules, explain Arc/DeFi/token signals, and prepare bridge flows. Real payments are bounded by policy: weekly budget, per-tip cap, recipient allowlist, live wallet checks, and explicit user approval for x402 and MetaMask/Gateway flows.

The project uses Arc as the stablecoin-native L1, USDC as the money layer, Circle W3S / agent-wallet patterns for policy-bound autonomous actions, Circle Gateway and x402 for paid HTTP access, external cron for reliable scheduled actions on a free sleeping host, and ArcScan-backed evidence for token monitoring.

## Why it fits Agentic Economy

- Agent has wallet context and can use USDC actions.
- Decision logic is tied to real signals: wallet balance, Gateway balance, tip history, ArcScan token evidence, Discord counts, and public ecosystem/news signals.
- x402 flow shows how an agent discovers paid HTTP resources, verifies terms, and only requests payment after explicit approval.
- Scheduled USDC actions run autonomously from backend policy, not from a hidden browser key.
- Every sensitive flow is bounded by user policy and proof links.

## Why it also touches DeFi

- DeFi Radar surfaces real Arc/Circle DeFi signals, not invented cards.
- Arc Bridge screen explains CCTP preflight and does not start transfers automatically.
- Token/Meme Radar watches Arc Testnet ERC-20 contracts with proof-first launch rules.
- Roadmap includes App Kit swap preflight for USDC, EURC, and cirBTC with quote/risk disclosure before any signature.

## Built capabilities

- Arc Testnet wallet view with USDC balance and portfolio intelligence.
- Gogo AI assistant with local deterministic commands for demo reliability.
- Policy-bound agent wallet flow and paired-agent status.
- x402 quote inspection and Pay & access flow.
- Scheduled autonomous USDC payments with history and ArcScan proof.
- Render Free + Neon + cron-job.org free architecture.
- CCTP Arc Bridge preflight screen.
- DeFi Radar with Gogo analysis prompts.
- Proof-first Token/Meme Radar with watchlist commands.
- Discord count proxy and Arc community surface.
- Launch readiness command for demo/release checks.
- Chrome Web Store package and reviewer notes.

## Live proof links

- Frontend repo: https://github.com/GoGoSns/arccopilot
- Backend repo: https://github.com/GoGoSns/arccopilot-agent
- Render backend: https://arccopilot-agent.onrender.com
- ArcScan scheduled payment proof: https://testnet.arcscan.app/tx/0x5485dd06c2fd25de8e72157f8081fc6af0de776ec85d66fc748a3fed543f1364
- x402 paid resource id: `13c83515-65d9-4906-bf80-b7ead6762c9d`

Note: the Render root path may return `not_found`; this is expected. Use app endpoints such as `/health`, `/market/token-radar`, `/cron/schedules/run`, and `/cron/radar/run`.

## Demo path

1. Open ArcCopilot Wallet and show Arc Testnet balance.
2. Open Gogo AI and run `launch readiness`.
3. Run `portfolio`.
4. Run `who should I tip`.
5. Run `x402 demo`, show quote-first review, then Pay & access.
6. Open scheduled payment history and show the completed ArcScan proof.
7. Open Token/Meme Radar and explain proof-first monitoring.
8. Open Arc Bridge and show preflight-only CCTP safety.

## Safety and trust model

- No private key, mnemonic, Circle entity secret, or cron secret is stored in the extension source/package.
- Arc Testnet only; no mainnet assumption.
- ERC-20 USDC and EURC amounts use 6 decimals.
- x402 quote is shown before signature/payment.
- Bridge is preflight-only until source chain, destination chain, recipient, amount, and wallet approval are explicit.
- Token radar is read-only and never issues buy/sell recommendations.
- Unknown contracts cannot be promoted as proven launches without ArcScan/onchain evidence.
- Scheduled actions are externally triggered but protected by `X-Cron-Secret`.

## What is complete

- Functional MVP.
- Public repositories.
- Working backend deployment.
- Free cron reliability path.
- Demo command path.
- Chrome extension release zip.
- Chrome Web Store submission notes.
- Final script/deck outline in this docs folder.

## Final positioning

ArcCopilot is not trying to be a trading bot. It is a safe control layer for stablecoin-native agents on Arc: it lets an assistant see, reason, prepare, and in constrained cases act — without bypassing the human-defined policy envelope.

