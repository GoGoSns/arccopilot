# Architecture

## Overview

ArcCopilot is organized as a Manifest V3 extension with a popup-first UI, a background service worker, and shared domain logic in `src/lib`. The popup owns the visible product experience, while the service worker handles background checks, notifications, and message-driven actions.

## Folder Structure

| Folder | Role |
| --- | --- |
| `src/pages` | Feature screens such as Wallet, Send, Daily Brief, Gogo AI, Address Book, Settings, and profile/detail views. |
| `src/lib` | Shared domain logic, constants, storage keys, validation, i18n, API clients, hooks, and state helpers. |
| `src/components` | Shared visual building blocks, empty/error/loading states, and the popup error boundary. |
| `src/background` | Service worker logic for alarms, notifications, balance checks, whale checks, reminders, and message handling. |
| `src/content` | Content script that scans supported sites, highlights addresses, and bridges page actions into the extension. |
| `src/popup` | Popup bootstrap and top-level routing. |
| `src/options` | Extension options page. |

## Runtime Data Flow

1. `src/popup/main.tsx` boots React, initializes i18n, and hydrates the store from `chrome.storage.local`.
2. `src/popup/App.tsx` routes the popup to the correct screen and reads pending actions from storage.
3. `src/lib/store.ts` persists core UI state with Zustand and mirrors the wallet address and address book back to `chrome.storage.local`.
4. `src/background/service-worker.ts` listens for alarms and runtime messages, then updates badges, sends notifications, and queues follow-up views such as Daily Brief.
5. `src/content/content.ts` scans supported web pages for standalone addresses, shows a tip card, and sends `OPEN_SEND` messages to the background worker when the user wants to act on an address.

The shared storage layer is the bridge between the popup and the background worker. The popup reads and writes local state, while the service worker uses the same keys to remember pending send/view actions, notification state, and long-lived wallet metadata.

## External APIs

| API | Calling module(s) | Purpose |
| --- | --- | --- |
| Arc RPC | `src/lib/hooks/useUSDCBalance.ts`, `src/background/service-worker.ts` | Read USDC balance via `eth_call`. |
| Blockscout | `src/lib/hooks/useTxHistory.ts`, `src/lib/hooks/useEcosystemStats.ts`, `src/lib/hooks/useAddressInsights.ts`, `src/lib/api.ts`, `src/lib/gogoAI.ts`, `src/background/service-worker.ts`, `src/pages/DailyBrief.tsx` | Activity history, ecosystem stats, address insights, spending analysis, whale tracking, and incoming transfer checks. |
| TwitterAPI.io | `src/lib/twitterApi.ts`, `src/pages/DailyBrief.tsx` | Fetch Arc community tweets and the official accounts feed. |
| Gemini, OpenAI, Anthropic | `src/lib/aiProvider.ts` | Shared BYOK text and image generation for briefings, portfolio reads, news summaries, Gogo AI, and tweet categorization. |

Every AI request routes through `src/lib/aiProvider.ts`; callers preserve their existing prompts, parsing, and honest real-data fallback behavior. `src/lib/gogoAI.ts` remains the main orchestration layer for chat, proactive greetings, address risk analysis, spending summaries, and reminder creation.

## Storage Key Inventory

| Constant | Actual key | Owner | Purpose |
| --- | --- | --- | --- |
| `PENDING_SEND_STORAGE_KEY` | `arccopilot:pending-send` | Popup and background worker | Temporary recipient payload used to open the Send flow from the content script or background worker. |
| `PENDING_VIEW_STORAGE_KEY` | `arccopilot:pending_view` | Background worker and popup | Routes the popup to a specific screen after a notification click. |
| `ADDRESS_BOOK_STORAGE_KEY` | `arccopilot:address_book` | Store, popup, content script, background worker | Persisted address memories, labels, tags, and notes. |
| `DISMISSED_PATTERNS_KEY` | `arccopilot:patterns:dismissed` | Gogo AI and Daily Brief | Stores dismissed pattern IDs so repeated insights can be suppressed. |
| `AI_PROVIDER_STORAGE_KEY` | `arccopilot:ai-provider` | AI provider and Settings | Selected AI provider; absent or invalid values resolve to Gemini. |
| `GEMINI_API_KEY_STORAGE_KEY` | `arccopilot:gemini-api-key` | AI provider and Settings | Existing Gemini key, preserved for backward compatibility. |
| `OPENAI_API_KEY_STORAGE_KEY` | `arccopilot:openai-api-key` | AI provider and Settings | Stored OpenAI key. |
| `ANTHROPIC_API_KEY_STORAGE_KEY` | `arccopilot:anthropic-api-key` | AI provider and Settings | Stored Anthropic key. |
| `TWITTERAPI_KEY` | `arccopilot:twitterapi-key` | Twitter API wrapper and Settings | Stored TwitterAPI.io key for Arc tweet feeds. |
| `TWITTER_SEARCH_QUERY` | `arccopilot:twitter-search-query` | Twitter API wrapper and Settings | Custom Arc tweet search query. |
| `TWITTER_OFFICIAL_ACCOUNTS` | `arccopilot:twitter-official-accounts` | Twitter API wrapper and Settings | Handles used for the official Arc/Circle section. |
| `TWITTER_TWEETS_CACHE_KEY` | `arccopilot:tweets:arc` | Daily Brief and Gogo AI | Cached Arc community tweets. |
| `TWITTER_OFFICIAL_TWEETS_CACHE_KEY` | `arccopilot:tweets:official` | Daily Brief and Gogo AI | Cached official tweets. |
| `REMINDERS` | `arccopilot:reminders` | Reminders helper, Settings, Daily Brief, Gogo AI | Scheduled reminder definitions. |
| `GOGO_HISTORY` | `arccopilot:gogo-history` | Gogo AI | Local conversation history for multi-turn context. |
| `WALLET_ADDRESS_STORAGE_KEY` | `arccopilot:wallet-address` | Store, popup, service worker | Primary wallet address for balance checks and notifications. |
| `LAST_KNOWN_BALANCE_KEY` | `arccopilot:last-known-balance` | Background worker | Last known USDC balance used for change detection. |
| `LAST_SEEN_INCOMING_KEY` | `arccopilot:last-seen-incoming` | Background worker | Last seen incoming transfer key used to prevent duplicate alerts. |
| `NOTIF_INCOMING_STORAGE_KEY` | `arccopilot:notif-incoming` | Settings and background worker | Toggle for incoming USDC notifications. |
| `NOTIF_BALANCE_STORAGE_KEY` | `arccopilot:notif-balance` | Settings and background worker | Toggle for balance change notifications. |
| `VOICE_INPUT_STORAGE_KEY` | `arccopilot:voice-input` | Settings and Gogo AI | Enables microphone input for Gogo. |
| `VOICE_RESPONSES_STORAGE_KEY` | `arccopilot:voice-responses` | Settings and Gogo AI | Enables spoken responses from Gogo. |

Note: `GOGO_HISTORY_STORAGE_KEY` is a compatibility alias for `GOGO_HISTORY`; it does not map to a separate storage entry.

## Important Patterns

- Error Boundary: `src/components/ErrorBoundary.tsx` prevents a blank popup by showing a reload screen when a render crash occurs.
- Debug flag: `src/lib/debug.ts` hard-disables debug logging in production builds.
- Constants: `src/lib/constants.ts` centralizes chain ID, RPC endpoints, API bases, contract addresses, and cache TTLs.
- Validation: `src/lib/validation.ts` rejects invalid addresses and non-positive or malformed USDC amounts before any send or analysis action runs.
- i18n: `src/lib/i18n.ts` stores the English and Turkish dictionaries, persists the locale preference, and exposes synchronous and hook-based accessors.
- Defensive rendering: UI components and data hooks normalize remote responses, prune malformed storage blobs, and keep the last known value when a refresh fails.
