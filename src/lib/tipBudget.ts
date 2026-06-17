import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { getLocaleSync, t } from '@/lib/i18n'
import { TIP_BUDGET } from '@/lib/storageKeys'
import { normalizeCreatorHandle, isValidCreatorHandle } from '@/lib/creatorRegistry'

export const DEFAULT_DAILY_TIP_LIMIT_USDC = 1
const MAX_TIP_LOG_ENTRIES = 50
const USDC_DECIMALS = 6

export interface TipBudgetLogEntry {
  handle: string
  amount: number
  timestamp: number
}

export interface TipBudgetState {
  dailyLimitUsdc: number
  spentTodayUsdc: number
  lastResetDate: string
  log: TipBudgetLogEntry[]
}

export interface TipBudgetDecision {
  allowed: boolean
  reason: string
  remaining: number
}

type StoredTipBudgetState = Partial<{
  dailyLimitUsdc: unknown
  spentTodayUsdc: unknown
  lastResetDate: unknown
  log: unknown
}>

function roundUsdc(value: number): number {
  return Math.round(value * 10 ** USDC_DECIMALS) / 10 ** USDC_DECIMALS
}

function parseAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null

  const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.')
  if (!text) return null
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null

  const parsed = Number(text)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  return roundUsdc(parsed)
}

function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatStoredState(raw: StoredTipBudgetState | null | undefined): TipBudgetState {
  const today = getLocalDateKey()
  const dailyLimitUsdc = parseAmount(raw?.dailyLimitUsdc) ?? DEFAULT_DAILY_TIP_LIMIT_USDC
  const spentTodayUsdc = Math.max(0, parseAmount(raw?.spentTodayUsdc) ?? 0)
  const lastResetDate = typeof raw?.lastResetDate === 'string' && raw.lastResetDate.trim()
    ? raw.lastResetDate.trim()
    : today

  const log = Array.isArray(raw?.log)
    ? raw.log
        .map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
          const value = entry as Partial<TipBudgetLogEntry>
          const handle = typeof value.handle === 'string' ? normalizeCreatorHandle(value.handle) : ''
          const amount = parseAmount(value.amount)
          const timestamp = typeof value.timestamp === 'number' ? value.timestamp : NaN

          if (!handle || !isValidCreatorHandle(handle) || amount == null || !Number.isFinite(timestamp) || timestamp <= 0) {
            return null
          }

          return {
            handle,
            amount,
            timestamp,
          }
        })
        .filter((entry): entry is TipBudgetLogEntry => Boolean(entry))
    : []

  return {
    dailyLimitUsdc: roundUsdc(dailyLimitUsdc),
    spentTodayUsdc: roundUsdc(spentTodayUsdc),
    lastResetDate,
    log: log.slice(-MAX_TIP_LOG_ENTRIES),
  }
}

function serializeState(state: TipBudgetState): TipBudgetState {
  return {
    dailyLimitUsdc: roundUsdc(state.dailyLimitUsdc),
    spentTodayUsdc: roundUsdc(state.spentTodayUsdc),
    lastResetDate: state.lastResetDate,
    log: state.log.slice(-MAX_TIP_LOG_ENTRIES).map((entry) => ({
      handle: normalizeCreatorHandle(entry.handle),
      amount: roundUsdc(entry.amount),
      timestamp: entry.timestamp,
    })),
  }
}

function getRemainingBudget(state: TipBudgetState): number {
  return Math.max(0, roundUsdc(state.dailyLimitUsdc - state.spentTodayUsdc))
}

export function formatTipBudgetAmount(amount: number): string {
  const normalized = roundUsdc(Math.max(0, amount))
  const locale = getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US'
  return normalized.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: USDC_DECIMALS,
  })
}

async function readBudgetState(): Promise<TipBudgetState> {
  const stored = await chromeStorageGet(TIP_BUDGET)
  const hasKey = Object.prototype.hasOwnProperty.call(stored, TIP_BUDGET)

  if (!hasKey) {
    const initial: TipBudgetState = {
      dailyLimitUsdc: DEFAULT_DAILY_TIP_LIMIT_USDC,
      spentTodayUsdc: 0,
      lastResetDate: getLocalDateKey(),
      log: [],
    }
    await chromeStorageSet({ [TIP_BUDGET]: initial })
    return initial
  }

  const normalized = formatStoredState(stored[TIP_BUDGET] as StoredTipBudgetState | null | undefined)
  const next = serializeState(normalized)
  if (JSON.stringify(stored[TIP_BUDGET]) !== JSON.stringify(next)) {
    await chromeStorageSet({ [TIP_BUDGET]: next })
  }

  return next
}

export async function getBudgetState(): Promise<TipBudgetState> {
  return resetIfNewDay()
}

export async function resetIfNewDay(): Promise<TipBudgetState> {
  const state = await readBudgetState()
  const today = getLocalDateKey()

  if (state.lastResetDate === today) {
    return state
  }

  const next: TipBudgetState = {
    ...state,
    spentTodayUsdc: 0,
    lastResetDate: today,
  }

  const serialized = serializeState(next)
  await chromeStorageSet({ [TIP_BUDGET]: serialized })
  return serialized
}

export async function canTip(amount: string | number): Promise<TipBudgetDecision> {
  const state = await resetIfNewDay()
  const parsedAmount = parseAmount(amount)
  const remaining = getRemainingBudget(state)

  if (parsedAmount == null) {
    return {
      allowed: false,
      reason: 'invalid_amount',
      remaining,
    }
  }

  if (parsedAmount > remaining) {
    return {
      allowed: false,
      reason: 'over_limit',
      remaining,
    }
  }

  return {
    allowed: true,
    reason: 'within_budget',
    remaining,
  }
}

export async function recordTip(handle: string, amount: string | number): Promise<TipBudgetState> {
  const normalizedHandle = normalizeCreatorHandle(handle)
  if (!isValidCreatorHandle(normalizedHandle)) {
    throw new Error(t('settings.invalidCreatorHandle'))
  }

  const parsedAmount = parseAmount(amount)
  if (parsedAmount == null) {
    throw new Error(t('gogo.invalidAmount'))
  }

  const state = await resetIfNewDay()
  const next: TipBudgetState = serializeState({
    ...state,
    spentTodayUsdc: roundUsdc(state.spentTodayUsdc + parsedAmount),
    log: [
      ...state.log,
      {
        handle: normalizedHandle,
        amount: parsedAmount,
        timestamp: Date.now(),
      },
    ],
  })

  await chromeStorageSet({ [TIP_BUDGET]: next })
  return next
}

export async function setDailyLimit(limit: string | number): Promise<TipBudgetState> {
  const parsedLimit = parseAmount(limit)
  if (parsedLimit == null) {
    throw new Error(t('settings.tipBudgetInvalidLimit'))
  }

  const state = await resetIfNewDay()
  const next: TipBudgetState = serializeState({
    ...state,
    dailyLimitUsdc: parsedLimit,
  })

  await chromeStorageSet({ [TIP_BUDGET]: next })
  return next
}
