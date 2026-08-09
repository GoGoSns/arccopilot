# Regent Chrome Web Store submission notes

## Product summary

Regent is a USDC-first agent control layer for Arc Testnet. It combines a wallet view, Gogo AI assistant, policy-bound agent wallet actions, x402 paid-resource access, scheduled USDC actions, CCTP bridge preflight, DeFi discovery, and proof-backed Arc token monitoring.

## Short description

USDC-first Arc assistant for wallet insight, safe agent actions, x402, schedules, bridge preflight, and token risk signals.

## Longer description

Regent helps Arc builders and power users turn real wallet, community, and onchain signals into safe, policy-bound actions. Gogo AI can explain portfolio state, prepare x402 paid-resource access, suggest creator tips inside configured budget and allowlist rules, create recurring USDC schedules, analyze DeFi signals, and watch Arc Testnet ERC-20 contracts through a proof-first radar.

Money movement is intentionally guarded. Regent does not silently move funds from the browser. Agent-wallet actions are constrained by backend policy, x402 access requires explicit Pay & access approval, and bridge flows are preflight-only until the user confirms route, amount, recipient, token, and wallet signature.

## Permission justification

- `storage`: stores local wallet address, settings, API-provider keys entered by the user, reminders, address book labels, watchlists, and cached non-sensitive summaries.
- `activeTab` and `scripting`: reads the active page only when the user asks Regent to connect, scan an address/QR, interact with MetaMask, or prepare an x402/Gateway signature flow.
- `tabs`: opens trusted external proof links such as ArcScan, Circle/Arc docs, Discord, and source articles.
- `notifications` and `alarms`: supports reminder and scheduled-action follow-up surfaces.
- Broad content script matches: used to detect wallet addresses and supported context on arbitrary user-opened pages. The extension does not collect browsing history for sale or profiling.
- Host permissions:
  - AI providers: only called when the user adds their own provider key or selects that provider.
  - Arc RPC / ArcScan: reads Arc Testnet balances, token evidence, transactions, and proof links.
  - Render backend: policy-bound agent wallet, x402, scheduler, Discord count proxy, and Radar endpoints.
  - Circle Gateway testnet: Gateway/x402 and balance-related flows.
  - News/community/TwitterAPI sources: user-visible Arc ecosystem briefing and discovery signals.

## Data and custody notes

- No private key, mnemonic, Circle entity secret, cron secret, or backend signing secret is stored in the extension source or package.
- The browser extension stores only user-entered client settings and local UX state.
- Agent-wallet custody and autonomous transfer enforcement live on the backend through Circle W3S and server-side policy.
- x402 paid access is quote-first; no MetaMask signature is requested before the user taps Pay & access.
- Token and DeFi radar surfaces are read-only and do not issue buy recommendations.

## Reviewer smoke test

1. Load `dist/` as an unpacked extension or upload `Regent-extension-0.3.0.zip`.
2. Open the popup and connect MetaMask on Arc Testnet.
3. Open Wallet and confirm the portfolio loads.
4. Open Tools → Ready check, or ask Gogo AI: `launch readiness`.
5. Ask Gogo AI: `portfolio`.
6. Ask Gogo AI: `x402 demo`; verify it shows the exact 0.001 USDC terms before requesting approval.
7. Open Tools → Token/Meme Radar and verify unknown candidates do not become launch alerts without proof.
8. Open Tools → Arc Bridge and verify it is preflight-only.

## Release checklist

- `node .\node_modules\typescript\bin\tsc --noEmit`
- `pnpm build`
- `pnpm audit --prod`
- Search package/source for secrets before upload.
- Reload extension after installing a new build.
- Confirm Render backend and cron-job.org jobs are live.
