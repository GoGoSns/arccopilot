# ArcCopilot

ArcCopilot is a Chrome Extension scaffold for the Arc economy: wallet, dashboard, social feed, and AI entry points in one surface.

## Stack

- Chrome Manifest V3
- React 18 + TypeScript 5
- Vite 5 with @crxjs/vite-plugin
- Tailwind CSS 3
- wagmi 2 + viem 2
- Zustand
- TanStack Query
- Lucide React
- pnpm

## Included

- Manifest V3 extension scaffold
- Arc Testnet defaults for chainId 5042002
- Popup-first UI with welcome, wallet, send, receive, and discover views
- Shared UI primitives and mocked live data wiring points
- Placeholder icons in public/icons/

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the extension dev server:

   ```bash
   pnpm dev
   ```

3. Build the extension:

   ```bash
   pnpm build
   ```

## Environment

Use .env.example as the starting point for runtime overrides.

- VITE_ARC_RPC_URL
- VITE_ARC_EXPLORER_URL
- VITE_ARC_USDC_ADDRESS
- VITE_BLOCKSCOUT_API_BASE

## Notes

- The icon files are placeholders and can be replaced with final brand assets later.
- public/fonts/ is intentionally empty for local font drops.
- Arc Testnet defaults are centralized in src/lib/arc.ts.
