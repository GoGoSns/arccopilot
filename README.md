# ArcCopilot

ArcCopilot is a Chrome extension for the Arc economy. It brings together wallet actions, onchain context, and market intelligence in one popup so the user can move USDC, inspect addresses, read the ecosystem, and act on timely signals without leaving the browser.

The product is designed as a local-first companion for Arc Testnet. Core state lives in the extension, while live data is pulled from Arc RPC, Blockscout, TwitterAPI.io, and Gemini only when needed. The result is a focused workflow for wallet management, community monitoring, and AI-assisted actions.

## Features

- Wallet
- Send
- Address Book
- Whale Radar
- Daily Brief plus proactive Morning Brief
- Arc on X with community and official sections
- AI tweet categorization
- Gogo AI with context awareness, memory, multi-step actions, tweet drafts, address risk analysis, spending analysis, recurring reminders, and voice input/output
- Smart notifications
- i18n in English and Turkish

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build the extension:

   ```bash
   pnpm build
   ```

3. Load the extension in Chrome:

   - Open `chrome://extensions`
   - Enable Developer mode
   - Choose Load unpacked
   - Select the `dist/` folder

## Required Keys

Enter these in Settings before using the live social and AI features:

- Gemini API key
- TwitterAPI.io key

## Tech Stack

- React 18
- TypeScript
- Vite
- Manifest V3

Built by GoGo
