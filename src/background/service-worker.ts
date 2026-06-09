/// <reference types="chrome" />
/**
 * ArcCopilot service worker
 * - Handles content-script messages (OPEN_SEND)
 * - Whale polling via chrome.alarms (every 5 min)
 * - Native notifications for whale movement, incoming USDC, and balance changes
 * - Badge management (gold dot when unseen whale activity)
 */

import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'
import {
  LAST_KNOWN_BALANCE_KEY,
  LAST_SEEN_INCOMING_KEY,
  NOTIF_BALANCE_STORAGE_KEY,
  NOTIF_INCOMING_STORAGE_KEY,
  WALLET_ADDRESS_STORAGE_KEY,
} from '@/lib/storageKeys'
import {
  getDueReminders,
  getLocalDateKey,
  getReminderNotificationMessage,
} from '@/lib/reminders'

const ADDR_BOOK_KEY = 'arccopilot:address_book'
const LAST_SEEN_PREFIX = 'arccopilot:whale:last-seen:'
const REMINDER_NOTIFIED_PREFIX = 'arccopilot:reminders:last-notified:'
const PENDING_VIEW_KEY = 'arccopilot:pending_view'
const EXPLORER_URL = 'https://testnet.arcscan.app'
const RPC_URL = 'https://rpc.testnet.arc.network'
const USDC_CONTRACT = '0x3600000000000000000000000000000000000000'
const USDC_DECIMALS = 6
const LAST_KNOWN_BALANCE_WALLET_KEY = 'arccopilot:last-known-balance-wallet'
const LAST_SEEN_INCOMING_WALLET_KEY = 'arccopilot:last-seen-incoming-wallet'

interface PendingSend {
  recipient: string
  ts: number
}

interface AddressMemory {
  address: string
  label?: string
  tag?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAddressBook(raw: unknown): Record<string, AddressMemory> {
  if (!isRecord(raw)) return {}

  const next: Record<string, AddressMemory> = {}
  for (const memory of Object.values(raw as Record<string, Partial<AddressMemory>>)) {
    if (!memory?.address) continue
    const address = memory.address.toLowerCase()
    next[address] = {
      address,
      label: typeof memory.label === 'string' ? memory.label : undefined,
      tag: typeof memory.tag === 'string' ? memory.tag : undefined,
    }
  }

  return next
}

interface RawTransfer {
  timestamp: string
  total: { value: string }
  from: { hash: string }
  to: { hash: string }
  token: { address: string }
  transaction_hash?: string
}

function formatBalanceSW(wei: bigint, decimals: number): string {
  if (wei === 0n) return '0.00'
  const divisor = BigInt(10 ** decimals)
  const whole = wei / divisor
  const frac = wei % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2)
  return `${whole}.${fracStr}`
}

function shortAddress(address: string): string {
  const normalized = address.toLowerCase()
  if (normalized.length <= 10) return normalized
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}

function chromeGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as Record<string, unknown>))
  })
}

function chromeSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve())
  })
}

function chromeRemove(keys: string | string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve())
  })
}

function formatAddressLabel(address: string, addressBook?: Record<string, AddressMemory>): string {
  const normalized = address.toLowerCase()
  const label = addressBook?.[normalized]?.label?.trim()
  return label || shortAddress(normalized)
}

function makeTransferKey(transfer: RawTransfer): string {
  if (transfer.transaction_hash) return transfer.transaction_hash.toLowerCase()
  return `${transfer.from.hash.toLowerCase()}:${transfer.to.hash.toLowerCase()}:${transfer.total?.value ?? '0'}:${transfer.timestamp}`
}

function parseBalance(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isOverTenPercentChange(previous: number, current: number): boolean {
  if (previous === current) return false
  if (previous <= 0) return current > 0
  return Math.abs(current - previous) / previous > 0.1
}

async function fetchCurrentUsdcBalance(address: string): Promise<string> {
  const padded = address.slice(2).toLowerCase().padStart(64, '0')
  const data = '0x70a08231' + padded

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC_CONTRACT, data }, 'latest'],
    }),
  })

  if (!res.ok) {
    throw new Error(`RPC ${res.status}`)
  }

  const json = await res.json() as { result?: string; error?: { message?: string } }
  if (json.error) {
    throw new Error(json.error.message ?? 'RPC error')
  }

  const raw = json.result ?? '0x'
  if (!raw || raw === '0x' || raw === '0x0') return '0.00'

  return formatBalanceSW(BigInt(raw), USDC_DECIMALS)
}

async function fetchLatestIncomingTransfer(address: string): Promise<RawTransfer | null> {
  const url = `${EXPLORER_URL}/api/v2/addresses/${address.toLowerCase()}/token-transfers?type=ERC-20&token=${USDC_CONTRACT}&limit=20`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) return null

  const data = await res.json() as { items?: RawTransfer[] }
  const items = Array.isArray(data.items) ? data.items : []
  const normalized = address.toLowerCase()

  return items.find((transfer) => transfer.to?.hash?.toLowerCase() === normalized) ?? null
}

async function loadNotificationPrefs(): Promise<{ incoming: boolean; balance: boolean }> {
  const result = await chromeGet([NOTIF_INCOMING_STORAGE_KEY, NOTIF_BALANCE_STORAGE_KEY])

  return {
    incoming: result[NOTIF_INCOMING_STORAGE_KEY] !== false,
    balance: result[NOTIF_BALANCE_STORAGE_KEY] !== false,
  }
}

function resolveWalletAddress(
  storageAddress: unknown,
  addressBook: Record<string, AddressMemory> | undefined,
): string | null {
  if (typeof storageAddress === 'string' && storageAddress.trim()) {
    return storageAddress.trim().toLowerCase()
  }

  const selfEntry = addressBook ? Object.values(addressBook).find((entry) => entry.tag === 'self') : null
  return selfEntry?.address?.trim().toLowerCase() ?? null
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('whale-check', { periodInMinutes: 5 })
  console.log('[ArcCopilot SW] whale-check alarm created (5 min interval)')
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('whale-check', { periodInMinutes: 5 })
  console.log('[ArcCopilot SW] whale-check alarm ensured on startup')
  void runRecurringChecks()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'whale-check') {
    void runRecurringChecks()
  }
})

chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId)
  void chrome.storage.local.set({ [PENDING_VIEW_KEY]: 'daily-brief' })
  try {
    void (chrome.action as any).openPopup()
  } catch {}
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OPEN_SEND' && typeof message.recipient === 'string') {
    handleOpenSend(message.recipient)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[ArcCopilot SW] handleOpenSend error:', err)
        sendResponse({ ok: false })
      })
    return true
  }

  if (message?.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' })
    sendResponse({ ok: true })
    return true
  }

  if (message?.type === 'CHECK_WHALES_NOW') {
    console.log('[ArcCopilot SW] manual whale check triggered')
    checkWhales()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
})

async function runRecurringChecks(): Promise<void> {
  await Promise.allSettled([
    checkWhales(),
    checkBalanceAndIncoming(),
    checkReminders(),
  ])
}

async function checkWhales(): Promise<void> {
  console.log('[ArcCopilot SW] checking whales…')

  const bookResult = await chrome.storage.local.get(ADDR_BOOK_KEY)
  const rawBook = bookResult[ADDR_BOOK_KEY]
  const book = normalizeAddressBook(bookResult[ADDR_BOOK_KEY])

  if (Object.keys(book).length === 0) {
    if (rawBook != null) {
      await chrome.storage.local.remove(ADDR_BOOK_KEY)
    }
    console.log('[ArcCopilot SW] no address book in storage')
    return
  }

  const whales = Object.values(book).filter((m) => m.tag === 'whale')
  if (whales.length === 0) {
    console.log('[ArcCopilot SW] no whales tracked')
    return
  }

  console.log('[ArcCopilot SW] tracking', whales.length, 'whale(s)')

  const lastSeenKeys = whales.map((w) => LAST_SEEN_PREFIX + w.address.toLowerCase())
  const lastSeenResult = await chrome.storage.local.get(lastSeenKeys)
  const iconUrl = chrome.runtime.getURL('icons/icon-128.png')

  let newActivity = false

  await Promise.all(
    whales.map(async (whale) => {
      const normalized = whale.address.toLowerCase()
      const lastSeenKey = LAST_SEEN_PREFIX + normalized
      const lastSeenHash = typeof lastSeenResult[lastSeenKey] === 'string'
        ? (lastSeenResult[lastSeenKey] as string)
        : undefined

      try {
        const url = `${EXPLORER_URL}/api/v2/addresses/${normalized}/token-transfers?type=ERC-20&limit=5`
        const res = await fetch(url, { headers: { accept: 'application/json' } })
        if (!res.ok) return

        const data = await res.json() as { items?: RawTransfer[] }
        const usdcTxs = (data.items ?? []).filter(
          (tx) => tx.token?.address?.toLowerCase() === USDC_CONTRACT.toLowerCase(),
        )
        if (!usdcTxs.length) return

        const latest = usdcTxs[0]
        const txHash = latest.transaction_hash ?? `${latest.from.hash}:${latest.timestamp}`

        if (lastSeenHash && lastSeenHash === txHash) return

        await chrome.storage.local.set({ [lastSeenKey]: txHash })

        if (!lastSeenHash) {
          console.log('[ArcCopilot SW] initialized last-seen for', normalized)
          return
        }

        const direction = latest.to.hash.toLowerCase() === normalized ? 'received' : 'sent'
        const amount = formatBalanceSW(BigInt(latest.total?.value ?? '0'), USDC_DECIMALS)
        const label = whale.label ?? `${whale.address.slice(0, 6)}...${whale.address.slice(-4)}`

        console.log('[ArcCopilot SW] new whale tx:', label, direction, amount, 'USDC')

        chrome.notifications.create(`whale-${normalized}`, {
          type: 'basic',
          iconUrl,
          title: 'ArcCopilot - Whale moved',
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
    console.log('[ArcCopilot SW] badge set - new whale activity')
  }
}

async function checkBalanceAndIncoming(): Promise<void> {
  console.log('[ArcCopilot SW] checking balance and incoming transfers…')

  try {
    const storage = await chromeGet([
      ADDR_BOOK_KEY,
      LAST_KNOWN_BALANCE_KEY,
      LAST_KNOWN_BALANCE_WALLET_KEY,
      LAST_SEEN_INCOMING_KEY,
      LAST_SEEN_INCOMING_WALLET_KEY,
      WALLET_ADDRESS_STORAGE_KEY,
    ])

    const addressBook = storage[ADDR_BOOK_KEY] as Record<string, AddressMemory> | undefined
    const walletAddress = resolveWalletAddress(storage[WALLET_ADDRESS_STORAGE_KEY], addressBook)

    if (!walletAddress) {
      console.log('[ArcCopilot SW] no wallet address available for balance checks')
      return
    }

    const prefs = await loadNotificationPrefs()
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png')
    const [balanceResult, incomingResult] = await Promise.allSettled([
      fetchCurrentUsdcBalance(walletAddress),
      fetchLatestIncomingTransfer(walletAddress),
    ])

    const currentBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : null
    const latestIncoming = incomingResult.status === 'fulfilled' ? incomingResult.value : null

    const knownBalance = parseBalance(
      typeof storage[LAST_KNOWN_BALANCE_KEY] === 'string' ? storage[LAST_KNOWN_BALANCE_KEY] : '',
    )
    const knownBalanceWallet = typeof storage[LAST_KNOWN_BALANCE_WALLET_KEY] === 'string'
      ? storage[LAST_KNOWN_BALANCE_WALLET_KEY]
      : null

    if (currentBalance !== null) {
      const currentBalanceValue = parseBalance(currentBalance)
      const isSameWallet = knownBalanceWallet === walletAddress
      const shouldNotifyBalance = isSameWallet && isOverTenPercentChange(knownBalance, currentBalanceValue)

      if (prefs.balance && shouldNotifyBalance) {
        chrome.notifications.create(`balance-${walletAddress}-${Date.now()}`, {
          type: 'basic',
          iconUrl,
          title: 'ArcCopilot - Balance changed',
          message: `Bakiyen ${knownBalance.toFixed(2)} -> ${currentBalanceValue.toFixed(2)} USDC`,
          priority: 2,
        })
      }

      await chromeSet({
        [LAST_KNOWN_BALANCE_KEY]: currentBalance,
        [LAST_KNOWN_BALANCE_WALLET_KEY]: walletAddress,
      })
    }

    if (latestIncoming) {
      const incomingKey = makeTransferKey(latestIncoming)
      const knownIncoming = typeof storage[LAST_SEEN_INCOMING_KEY] === 'string'
        ? storage[LAST_SEEN_INCOMING_KEY]
        : null
      const knownIncomingWallet = typeof storage[LAST_SEEN_INCOMING_WALLET_KEY] === 'string'
        ? storage[LAST_SEEN_INCOMING_WALLET_KEY]
        : null
      const isSameWallet = knownIncomingWallet === walletAddress

      if (prefs.incoming && isSameWallet && knownIncoming !== incomingKey) {
        const amount = formatBalanceSW(BigInt(latestIncoming.total?.value ?? '0'), USDC_DECIMALS)
        const fromAddress = latestIncoming.from?.hash?.toLowerCase?.() ?? ''
        const fromLabel = formatAddressLabel(fromAddress, addressBook)

        chrome.notifications.create(`incoming-${walletAddress}-${incomingKey}`, {
          type: 'basic',
          iconUrl,
          title: `Received ${amount} USDC`,
          message: `from ${fromLabel}`,
          priority: 2,
        })
      }

      await chromeSet({
        [LAST_SEEN_INCOMING_KEY]: incomingKey,
        [LAST_SEEN_INCOMING_WALLET_KEY]: walletAddress,
      })
    }
  } catch (err) {
    console.error('[ArcCopilot SW] balance/incoming check failed:', err)
  }
}

async function checkReminders(): Promise<void> {
  console.log('[ArcCopilot SW] checking reminders…')

  try {
    const dueReminders = await getDueReminders()
    if (dueReminders.length === 0) {
      return
    }

    const todayKey = getLocalDateKey()
    const notifiedKeys = dueReminders.map((reminder) => `${REMINDER_NOTIFIED_PREFIX}${reminder.id}`)
    const stored = await chromeGet(notifiedKeys)
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png')
    const updates: Record<string, unknown> = {}
    let notifiedCount = 0

    for (const reminder of dueReminders) {
      const storageKey = `${REMINDER_NOTIFIED_PREFIX}${reminder.id}`
      if (stored[storageKey] === todayKey) {
        continue
      }

      updates[storageKey] = todayKey
      notifiedCount += 1

      chrome.notifications.create(`reminder-${reminder.id}`, {
        type: 'basic',
        iconUrl,
        title: `Reminder: ${reminder.title}`,
        message: getReminderNotificationMessage(reminder),
        priority: 2,
      })
    }

    if (Object.keys(updates).length > 0) {
      await chromeSet(updates)
    }

    if (notifiedCount > 0) {
      console.log('[ArcCopilot SW] reminder notification(s) created:', notifiedCount)
    }
  } catch (err) {
    console.error('[ArcCopilot SW] reminder check failed:', err)
  }
}

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
