/// <reference types="chrome" />
/**
 * ArcCopilot service worker
 * - Handles content-script and popup messages (OPEN_SEND, FETCH_ARC_DISCORD)
 * - Whale polling via chrome.alarms (every 5 min)
 * - Native notifications for whale movement, incoming USDC, and balance changes
 * - Badge management (neutral dot when unseen whale activity)
 */

import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'
import {
  ADDRESS_BOOK_STORAGE_KEY,
  PENDING_VIEW_STORAGE_KEY,
  LAST_KNOWN_BALANCE_KEY,
  LAST_SEEN_INCOMING_KEY,
  NOTIF_BALANCE_STORAGE_KEY,
  NOTIF_INCOMING_STORAGE_KEY,
  NOTIF_REMINDERS_STORAGE_KEY,
  REMINDER_NOTIFIED_STORAGE_KEY,
  REMINDERS,
  WALLET_ADDRESS_STORAGE_KEY,
} from '@/lib/storageKeys'
import { ARC_RPC_URL, BLOCKSCOUT_BASE, USDC_CONTRACT } from '@/lib/constants'
import { debugLog, debugWarn } from '@/lib/debug'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'

const ARC_DISCORD_API_URL = 'https://discord.com/api/v10/invites/buildonarc?with_counts=true'
const ARC_DISCORD_USER_AGENT = 'ArcCopilot/0.3'
const LAST_SEEN_PREFIX = 'arccopilot:whale:last-seen:'
const USDC_DECIMALS = 6
const LAST_KNOWN_BALANCE_WALLET_KEY = 'arccopilot:last-known-balance-wallet'
const LAST_SEEN_INCOMING_WALLET_KEY = 'arccopilot:last-seen-incoming-wallet'

interface PendingSend {
  recipient: string
  ts: number
}

interface ArcDiscordCountsResponse {
  memberCount: number | null
  onlineCount: number | null
  error?: string
}

interface DiscordFetchDiagnostics {
  errorName: string
  errorMessage: string
  status?: number
  bodyPreview?: string
  userAgentAttempted: boolean
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

function formatDiscordFetchError(diagnostics: DiscordFetchDiagnostics): string {
  const parts = [
    `${diagnostics.errorName}: ${diagnostics.errorMessage}`,
    diagnostics.status != null ? `status=${diagnostics.status}` : null,
    diagnostics.bodyPreview ? `body=${diagnostics.bodyPreview}` : null,
    diagnostics.userAgentAttempted ? 'userAgent=attempted' : 'userAgent=skipped',
  ].filter((part): part is string => Boolean(part))

  return `ARC_DISCORD_FETCH_FAILED ${parts.join(' | ')}`
}

function logDiscordFetchDiagnostics(diagnostics: DiscordFetchDiagnostics): void {
  console.warn('[ArcCopilot SW] Discord counts fetch failed', diagnostics)
}

async function fetchCurrentUsdcBalance(address: string): Promise<string> {
  const padded = address.slice(2).toLowerCase().padStart(64, '0')
  const data = '0x70a08231' + padded

  const res = await fetchWithTimeout(ARC_RPC_URL, {
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
  const url = `${BLOCKSCOUT_BASE}/api/v2/addresses/${address.toLowerCase()}/token-transfers?type=ERC-20&token=${USDC_CONTRACT}`
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } })
  if (!res.ok) return null

  const data = await res.json() as { items?: RawTransfer[] }
  const items = Array.isArray(data.items) ? data.items : []
  const normalized = address.toLowerCase()

  return items.find((transfer) => transfer.to?.hash?.toLowerCase() === normalized) ?? null
}

async function fetchArcDiscordCounts(): Promise<ArcDiscordCountsResponse> {
  const headers = new Headers({ Accept: 'application/json' })

  let userAgentAttempted = false
  try {
    headers.set('User-Agent', ARC_DISCORD_USER_AGENT)
    userAgentAttempted = headers.get('User-Agent') === ARC_DISCORD_USER_AGENT
  } catch {
    userAgentAttempted = false
  }

  let response: Response | null = null
  let bodyText = ''

  try {
    response = await fetchWithTimeout(
      ARC_DISCORD_API_URL,
      {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        headers,
      },
      10_000,
    )

    bodyText = await response.text()
    const bodyPreview = bodyText.slice(0, 200)

    if (!response.ok) {
      const diagnostics: DiscordFetchDiagnostics = {
        errorName: 'DiscordHttpError',
        errorMessage: response.statusText || `HTTP ${response.status}`,
        status: response.status,
        bodyPreview,
        userAgentAttempted,
      }
      logDiscordFetchDiagnostics(diagnostics)
      return {
        memberCount: null,
        onlineCount: null,
        error: formatDiscordFetchError(diagnostics),
      }
    }

    let payload: {
      approximate_member_count?: unknown
      approximate_presence_count?: unknown
    }

    try {
      payload = JSON.parse(bodyText) as {
        approximate_member_count?: unknown
        approximate_presence_count?: unknown
      }
    } catch (error) {
      const diagnostics: DiscordFetchDiagnostics = {
        errorName: error instanceof Error ? error.name : 'DiscordJsonParseError',
        errorMessage: error instanceof Error ? error.message : 'Failed to parse Discord invite response',
        status: response.status,
        bodyPreview,
        userAgentAttempted,
      }
      logDiscordFetchDiagnostics(diagnostics)
      return {
        memberCount: null,
        onlineCount: null,
        error: formatDiscordFetchError(diagnostics),
      }
    }

    const memberCount = typeof payload.approximate_member_count === 'number'
      ? payload.approximate_member_count
      : null
    const onlineCount = typeof payload.approximate_presence_count === 'number'
      ? payload.approximate_presence_count
      : null

    if (memberCount == null && onlineCount == null) {
      const diagnostics: DiscordFetchDiagnostics = {
        errorName: 'DiscordCountsUnavailable',
        errorMessage: 'Invite response did not include approximate_member_count or approximate_presence_count',
        status: response.status,
        bodyPreview,
        userAgentAttempted,
      }
      logDiscordFetchDiagnostics(diagnostics)
      return {
        memberCount: null,
        onlineCount: null,
        error: formatDiscordFetchError(diagnostics),
      }
    }

    return {
      memberCount,
      onlineCount,
    }
  } catch (error) {
    const bodyPreview = bodyText ? bodyText.slice(0, 200) : undefined
    const diagnostics: DiscordFetchDiagnostics = {
      errorName: error instanceof Error ? error.name : 'DiscordFetchError',
      errorMessage: error instanceof Error ? error.message : 'Unknown Discord fetch failure',
      status: response?.status,
      bodyPreview,
      userAgentAttempted,
    }
    logDiscordFetchDiagnostics(diagnostics)
    return {
      memberCount: null,
      onlineCount: null,
      error: formatDiscordFetchError(diagnostics),
    }
  }
}

async function loadNotificationPrefs(): Promise<{ incoming: boolean; balance: boolean }> {
  const result = await chromeStorageGet([NOTIF_INCOMING_STORAGE_KEY, NOTIF_BALANCE_STORAGE_KEY])

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
  debugLog('[ArcCopilot SW] whale-check alarm created (5 min interval)')
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('whale-check', { periodInMinutes: 5 })
  debugLog('[ArcCopilot SW] whale-check alarm ensured on startup')
  void runRecurringChecks()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'whale-check') {
    void runRecurringChecks()
  }
})

chrome.notifications.onClicked.addListener((notifId) => {
  chrome.notifications.clear(notifId)
  void (async () => {
    await chromeStorageSet({ [PENDING_VIEW_STORAGE_KEY]: notifId.startsWith('reminder-') ? 'calendar' : 'daily-brief' })
    try {
      void (chrome.action as any).openPopup()
    } catch {}
  })()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FETCH_ARC_DISCORD') {
    void (async () => {
      const counts = await fetchArcDiscordCounts()
      if (counts.error) {
        debugWarn('[ArcCopilot SW] FETCH_ARC_DISCORD failed:', counts.error)
      } else {
        debugLog('[ArcCopilot SW] Arc Discord counts fetched')
      }
      sendResponse(counts)
    })()
    return true
  }

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
    debugLog('[ArcCopilot SW] manual whale check triggered')
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
    checkDueReminders(),
  ])
}

async function checkDueReminders(): Promise<void> {
  const storage = await chromeStorageGet([
    REMINDERS,
    NOTIF_REMINDERS_STORAGE_KEY,
    REMINDER_NOTIFIED_STORAGE_KEY,
  ])
  if (storage[NOTIF_REMINDERS_STORAGE_KEY] === false) return

  const rawReminders = Array.isArray(storage[REMINDERS]) ? storage[REMINDERS] : []
  const storedNotified = isRecord(storage[REMINDER_NOTIFIED_STORAGE_KEY])
    ? storage[REMINDER_NOTIFIED_STORAGE_KEY]
    : {}
  const notified: Record<string, string> = {}
  const validReminderIds = new Set<string>()
  const dueReminders: Array<{ id: string; text: string; dueAt: string; timestamp: number }> = []
  const now = Date.now()
  const oldestAllowed = now - 24 * 60 * 60 * 1000

  for (const raw of rawReminders) {
    if (!isRecord(raw) || raw.done === true) continue
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim() : ''
    const dueAt = typeof raw.dueAt === 'string' ? raw.dueAt : ''
    const timestamp = Date.parse(dueAt)
    if (!id || !text || !dueAt || !Number.isFinite(timestamp)) continue

    validReminderIds.add(id)
    if (typeof storedNotified[id] === 'string') {
      notified[id] = storedNotified[id] as string
    }
    if (timestamp <= now && timestamp >= oldestAllowed && notified[id] !== dueAt) {
      dueReminders.push({ id, text, dueAt, timestamp })
    }
  }

  const iconUrl = chrome.runtime.getURL('icons/icon-128.png')
  for (const reminder of dueReminders.sort((left, right) => left.timestamp - right.timestamp).slice(0, 3)) {
    chrome.notifications.create(`reminder-${reminder.id}`, {
      type: 'basic',
      iconUrl,
      title: 'ArcCopilot - Reminder',
      message: reminder.text,
      priority: 2,
    })
    notified[reminder.id] = reminder.dueAt
  }

  for (const id of Object.keys(notified)) {
    if (!validReminderIds.has(id)) delete notified[id]
  }

  await chromeStorageSet({ [REMINDER_NOTIFIED_STORAGE_KEY]: notified })
}

async function checkWhales(): Promise<void> {
  debugLog('[ArcCopilot SW] checking whales...')

  const bookResult = await chromeStorageGet(ADDRESS_BOOK_STORAGE_KEY)
  const rawBook = bookResult[ADDRESS_BOOK_STORAGE_KEY]
  const book = normalizeAddressBook(bookResult[ADDRESS_BOOK_STORAGE_KEY])

  if (Object.keys(book).length === 0) {
    if (rawBook != null) {
      await chromeStorageRemove(ADDRESS_BOOK_STORAGE_KEY)
    }
    debugLog('[ArcCopilot SW] no address book in storage')
    return
  }

  const whales = Object.values(book).filter((m) => m.tag === 'whale')
  if (whales.length === 0) {
    debugLog('[ArcCopilot SW] no whales tracked')
    return
  }

  debugLog('[ArcCopilot SW] tracking', whales.length, 'whale(s)')

  const lastSeenKeys = whales.map((w) => LAST_SEEN_PREFIX + w.address.toLowerCase())
  const lastSeenResult = await chromeStorageGet(lastSeenKeys)
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
        const url = `${BLOCKSCOUT_BASE}/api/v2/addresses/${normalized}/token-transfers?type=ERC-20`
        const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } })
        if (!res.ok) return

        const data = await res.json() as { items?: RawTransfer[] }
        const usdcTxs = (data.items ?? []).filter(
          (tx) => tx.token?.address?.toLowerCase() === USDC_CONTRACT.toLowerCase(),
        )
        if (!usdcTxs.length) return

        const latest = usdcTxs[0]
        const txHash = latest.transaction_hash ?? `${latest.from.hash}:${latest.timestamp}`

        if (lastSeenHash && lastSeenHash === txHash) return

        await chromeStorageSet({ [lastSeenKey]: txHash })

        if (!lastSeenHash) {
          debugLog('[ArcCopilot SW] initialized last-seen for', normalized)
          return
        }

        const direction = latest.to.hash.toLowerCase() === normalized ? 'received' : 'sent'
        const amount = formatBalanceSW(BigInt(latest.total?.value ?? '0'), USDC_DECIMALS)
        const label = whale.label ?? `${whale.address.slice(0, 6)}...${whale.address.slice(-4)}`

        debugLog('[ArcCopilot SW] new whale tx:', label, direction, amount, 'USDC')

        chrome.notifications.create(`whale-${normalized}`, {
          type: 'basic',
          iconUrl,
          title: 'ArcCopilot - Whale moved',
          message: `${label} ${direction} ${amount} USDC`,
          priority: 2,
        })

        newActivity = true
      } catch (err) {
        console.error('[ArcCopilot SW] error checking whale', shortAddress(normalized), err)
      }
    }),
  )

  if (newActivity) {
    chrome.action.setBadgeText({ text: '•' })
    chrome.action.setBadgeBackgroundColor({ color: '#ffffff' })
    debugLog('[ArcCopilot SW] badge set - new whale activity')
  }
}

async function checkBalanceAndIncoming(): Promise<void> {
  debugLog('[ArcCopilot SW] checking balance and incoming transfers...')

  try {
    const storage = await chromeStorageGet([
      ADDRESS_BOOK_STORAGE_KEY,
      LAST_KNOWN_BALANCE_KEY,
      LAST_KNOWN_BALANCE_WALLET_KEY,
      LAST_SEEN_INCOMING_KEY,
      LAST_SEEN_INCOMING_WALLET_KEY,
      WALLET_ADDRESS_STORAGE_KEY,
    ])

    const addressBook = storage[ADDRESS_BOOK_STORAGE_KEY] as Record<string, AddressMemory> | undefined
    const walletAddress = resolveWalletAddress(storage[WALLET_ADDRESS_STORAGE_KEY], addressBook)

    if (!walletAddress) {
      debugLog('[ArcCopilot SW] no wallet address available for balance checks')
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

      await chromeStorageSet({
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

      await chromeStorageSet({
        [LAST_SEEN_INCOMING_KEY]: incomingKey,
        [LAST_SEEN_INCOMING_WALLET_KEY]: walletAddress,
      })
    }
  } catch (err) {
    console.error('[ArcCopilot SW] balance/incoming check failed:', err)
  }
}

async function handleOpenSend(recipient: string): Promise<void> {
  const payload: PendingSend = { recipient: recipient.toLowerCase(), ts: Date.now() }
  await chromeStorageSet({ [PENDING_SEND_STORAGE_KEY]: payload })

  try {
    if (typeof (chrome.action as any)?.openPopup !== 'function') {
      debugWarn('[ArcCopilot SW] openPopup unavailable')
      return
    }
    await (chrome.action as any).openPopup()
  } catch (err) {
    debugWarn('[ArcCopilot SW] openPopup unavailable:', err)
  }
}

export {}
