/// <reference types="chrome" />
/**
 * ArcCopilot service worker
 * - Handles content-script messages (OPEN_SEND)
 * - Whale polling via chrome.alarms (every 5 min)
 * - Native notifications when a tracked whale has new activity
 * - Badge management (gold dot when unseen whale activity)
 */

import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'

// ─── constants ─────────────────────────────────────────────────────────────
const ADDR_BOOK_KEY    = 'arccopilot:address_book'
const LAST_SEEN_PREFIX = 'arccopilot:whale:last-seen:'
const PENDING_VIEW_KEY = 'arccopilot:pending_view'
const EXPLORER_URL     = 'https://testnet.arcscan.app'
const USDC_CONTRACT    = '0x3600000000000000000000000000000000000000'
const USDC_DECIMALS    = 6

// ─── types ─────────────────────────────────────────────────────────────────
interface PendingSend {
  recipient: string
  ts: number
}

interface AddressMemory {
  address: string
  label?: string
  tag?: string
}

interface RawTransfer {
  timestamp: string
  total: { value: string }
  from: { hash: string }
  to: { hash: string }
  token: { address: string }
  transaction_hash?: string
}

// ─── inline helpers (no /lib imports — service worker context) ──────────────
function formatBalanceSW(wei: bigint, decimals: number): string {
  if (wei === 0n) return '0.00'
  const divisor = BigInt(10 ** decimals)
  const whole   = wei / divisor
  const frac    = wei % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2)
  return `${whole}.${fracStr}`
}

// ─── onInstalled: create recurring alarm ────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('whale-check', { periodInMinutes: 5 })
  console.log('[ArcCopilot SW] whale-check alarm created (5 min interval)')
})

// ─── alarm handler ─────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'whale-check') {
    void checkWhales()
  }
})

// ─── notification click → route popup to Daily Brief ───────────────────────
chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId)
  void chrome.storage.local.set({ [PENDING_VIEW_KEY]: 'daily-brief' })
  try {
    void (chrome.action as any).openPopup()
  } catch {}
})

// ─── message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Existing: open send from Universal Tip Button
  if (message?.type === 'OPEN_SEND' && typeof message.recipient === 'string') {
    handleOpenSend(message.recipient)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[ArcCopilot SW] handleOpenSend error:', err)
        sendResponse({ ok: false })
      })
    return true
  }

  // Clear badge when user opens Daily Brief
  if (message?.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' })
    sendResponse({ ok: true })
    return true
  }

  // Manual whale check (dev / debug)
  if (message?.type === 'CHECK_WHALES_NOW') {
    console.log('[ArcCopilot SW] manual whale check triggered')
    checkWhales()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
})

// ─── checkWhales ────────────────────────────────────────────────────────────
async function checkWhales(): Promise<void> {
  console.log('[ArcCopilot SW] checking whales…')

  const bookResult = await chrome.storage.local.get(ADDR_BOOK_KEY)
  const book = bookResult[ADDR_BOOK_KEY] as Record<string, AddressMemory> | undefined

  if (!book) {
    console.log('[ArcCopilot SW] no address book in storage')
    return
  }

  const whales = Object.values(book).filter((m) => m.tag === 'whale')
  if (whales.length === 0) {
    console.log('[ArcCopilot SW] no whales tracked')
    return
  }

  console.log('[ArcCopilot SW] tracking', whales.length, 'whale(s)')

  const lastSeenKeys   = whales.map((w) => LAST_SEEN_PREFIX + w.address.toLowerCase())
  const lastSeenResult = await chrome.storage.local.get(lastSeenKeys)
  const iconUrl        = chrome.runtime.getURL('icons/icon-128.png')

  let newActivity = false

  await Promise.all(
    whales.map(async (whale) => {
      const normalized   = whale.address.toLowerCase()
      const lastSeenKey  = LAST_SEEN_PREFIX + normalized
      const lastSeenHash = lastSeenResult[lastSeenKey] as string | undefined

      try {
        const url = `${EXPLORER_URL}/api/v2/addresses/${normalized}/token-transfers?type=ERC-20&limit=5`
        const res = await fetch(url, { headers: { accept: 'application/json' } })
        if (!res.ok) return

        const data    = await res.json() as { items?: RawTransfer[] }
        const usdcTxs = (data.items ?? []).filter(
          (tx) => tx.token?.address?.toLowerCase() === USDC_CONTRACT.toLowerCase(),
        )
        if (!usdcTxs.length) return

        const latest = usdcTxs[0]
        const txHash = latest.transaction_hash ?? `${latest.from.hash}:${latest.timestamp}`

        // No change
        if (lastSeenHash && lastSeenHash === txHash) return

        // Persist last-seen hash
        await chrome.storage.local.set({ [lastSeenKey]: txHash })

        // First-time init — record hash but don't notify yet
        if (!lastSeenHash) {
          console.log('[ArcCopilot SW] initialized last-seen for', normalized)
          return
        }

        // New TX — notify!
        const direction = latest.to.hash.toLowerCase() === normalized ? 'received' : 'sent'
        const amount    = formatBalanceSW(BigInt(latest.total?.value ?? '0'), USDC_DECIMALS)
        const label     = whale.label ?? `${whale.address.slice(0, 6)}…${whale.address.slice(-4)}`

        console.log('[ArcCopilot SW] new whale tx:', label, direction, amount, 'USDC')

        chrome.notifications.create(`whale-${normalized}`, {
          type: 'basic',
          iconUrl,
          title: 'ArcCopilot — Whale moved',
          message: `${label} ${direction} ${amount} USDC`,
          priority: 2,
        })

        newActivity = true
      } catch (err) {
        console.error('[ArcCopilot SW] error checking whale', normalized, err)
      }
    }),
  )

  if (newActivity) {
    chrome.action.setBadgeText({ text: '•' })
    chrome.action.setBadgeBackgroundColor({ color: '#d4af37' })
    console.log('[ArcCopilot SW] badge set — new whale activity')
  }
}

// ─── handleOpenSend ─────────────────────────────────────────────────────────
async function handleOpenSend(recipient: string): Promise<void> {
  const payload: PendingSend = { recipient: recipient.toLowerCase(), ts: Date.now() }
  await chrome.storage.local.set({ [PENDING_SEND_STORAGE_KEY]: payload })

  try {
    if (typeof (chrome.action as any)?.openPopup !== 'function') {
      console.warn('[ArcCopilot SW] openPopup unavailable')
      return
    }
    await (chrome.action as any).openPopup()
  } catch (err) {
    console.warn('[ArcCopilot SW] openPopup unavailable:', err)
  }
}

export {}
