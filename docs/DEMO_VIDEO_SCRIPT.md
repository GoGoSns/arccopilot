# ArcCopilot 3-minute demo video script

## Recording setup

- Reload the latest extension build.
- Keep MetaMask unlocked on Arc Testnet.
- Keep the Render backend live.
- Keep cron-job.org enabled for scheduled payments and radar.
- Open an HTTPS page before testing x402 Pay & access.
- Have ArcScan proof link ready:
  https://testnet.arcscan.app/tx/0x5485dd06c2fd25de8e72157f8081fc6af0de776ec85d66fc748a3fed543f1364

## 0:00-0:20 — Problem and thesis

"ArcCopilot is a USDC-first agent control layer for Arc. The problem is simple: users want agents that can help with money, but they should not lose control. So the thesis is autonomy without bypass: the assistant can see, reason, prepare, and sometimes execute, but always inside user-defined limits and proof."

Show: Wallet screen.

## 0:20-0:45 — Real wallet state

"This is the wallet view. It reads real Arc Testnet balances and portfolio state. If a source is unavailable, ArcCopilot says so instead of inventing numbers."

Show: Wallet balance, portfolio cards.

## 0:45-1:10 — Readiness and policy

Type in Gogo:

```text
launch readiness
```

"Gogo can run a local readiness check for the demo. It checks the backend, paired wallet, policy mode, scheduled actions, x402, bridge preflight, and radar status."

Then type:

```text
portfolio
```

## 1:10-1:35 — Agentic payment decision

Type:

```text
who should I tip
```

"The agent proposes a creator tip using real signals and the user's policy: weekly budget, per-tip cap, and allowlist. This is not a free-spending bot. The policy boundary is the product."

Show: suggested recipient, amount, reasoning, approval button if visible.

## 1:35-2:05 — x402 paid resource

Type:

```text
x402 demo
```

"ArcCopilot can discover a paid HTTP resource through x402. Notice the exact price, network, and seller are shown first. Nothing is signed yet. Only after I tap Pay & access does MetaMask ask for an offchain Gateway authorization."

Show: x402 quote card, price `0.001 USDC`, Arc Testnet, seller, Pay & access button.

If already paid, show the paid response.

## 2:05-2:30 — Scheduled autonomous action proof

Open Settings -> Scheduled autonomous payments -> History.

"Scheduled payments run through a backend policy worker. The demo runs on Render Free, but cron-job.org wakes the endpoint every minute so sleeping hosts do not silently miss due actions."

Show: `complete` history item and ArcScan link.

## 2:30-2:50 — Radar and bridge safety

Open Token/Meme Radar.

"For new Arc tokens, ArcCopilot is proof-first. It does not call something a tradable opportunity without a contract address and evidence. Unknown contracts stay read-only and risky."

Open Arc Bridge.

"Bridge is also preflight-first: source, destination, amount, recipient, and confirmation must be explicit."

## 2:50-3:00 — Closing

"ArcCopilot turns Circle Agent Stack primitives into a user-facing control layer for Arc: wallet, policy, x402, scheduled USDC actions, bridge preflight, and token risk monitoring. The goal is not automation at any cost. It is autonomy without bypass."

## Fast fallback if anything fails during recording

Use these local Gogo commands:

```text
demo status
demo links
demo checklist
demo script
launch readiness
```

They are designed to work without relying on an AI provider response.

