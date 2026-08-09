# Regent product roadmap

This roadmap keeps the product aligned with the core philosophy: a powerful assistant that can learn, explain, prepare, and act — but only with real data, proof, policy, and explicit approval where money movement is involved.

## Now: submission-ready MVP

- Wallet + portfolio.
- Gogo AI assistant.
- x402 quote -> Pay & access.
- Scheduled USDC payments + cron-job.org.
- Render backend + Neon database.
- DeFi Radar.
- Proof-first Token/Meme Radar.
- Arc Bridge preflight.
- Discord count proxy.
- Launch readiness command.
- Chrome extension package and store notes.

## Next 1: Agent Marketplace / x402 service browser

Goal: turn `x402 demo` into a real market surface.

User can:

- search services
- see exact price
- see network and seller
- ask Gogo which service fits the task
- pay only after quote review

Guardrails:

- no hidden payment
- no auto-subscribe
- no signature before Pay & access
- show receipt and payment id

## Next 2: x402 payment history and receipt center

Track:

- service
- seller
- amount
- network
- nonce if available
- txHash if available
- paid response timestamp
- repeated payment warnings

Why: gives the user and judges a proof trail.

## Next 3: Bridge step timeline

Upgrade current preflight screen into a step timeline:

- source chain
- destination chain
- token
- amount
- recipient
- approve
- burn
- attestation
- mint
- recovery status

Guardrail: Regent never starts a bridge automatically.

## Next 4: Swap preflight for Arc

Start with safe Arc Testnet pairs:

- USDC -> EURC
- EURC -> USDC
- USDC -> cirBTC

Show:

- quote
- slippage
- route
- estimated output
- risk explanation
- "nothing signed yet"

No auto-buy and no investment advice.

## Next 5: Policy & Proof Center

One screen that explains what the agent can and cannot do:

- paired wallet
- agent wallet
- weekly budget
- per-tip cap
- allowlist
- x402 approvals
- scheduled payment history
- failed/succeeded logs
- ArcScan links
- cron health

This turns safety from a hidden implementation detail into a product feature.

## Next 6: Stronger Radar + Gogo analysis

For every watched token/contract:

- contract address required
- ArcScan link required
- verified-contract proof if available
- holder count if available
- decimals
- core Circle token detection
- launch evidence status
- watchlist status
- risk reason in plain language

Rules:

- no fake data
- no buy/sell calls
- no "moon" framing
- no mainnet assumption while Arc is testnet

## Product north star

Regent should feel like a chief of staff for programmable money:

- it sees more than the user wants to manually check
- it explains what matters
- it prepares safe actions
- it records proof
- it never bypasses the user's limits

