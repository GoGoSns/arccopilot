import { useCallback, useEffect, useRef, useState } from 'react'
import { BLOCKSCOUT_API_BASE, USDC_CONTRACT } from '@/lib/constants'
import { debugWarn } from '@/lib/debug'
import { isValidAddress } from '@/lib/validation'
import { useStore, type PortfolioTokenBalance } from '@/lib/store'

export const PORTFOLIO_CACHE_KEY = 'arccopilot:portfolio'
export const PORTFOLIO_CACHE_TTL_MS = 5 * 60_000

interface BlockscoutTokenBalanceToken {
  address?: string
  address_hash?: string
  symbol?: string
  name?: string
  decimals?: number | string
}

interface BlockscoutTokenBalanceItem {
  token?: BlockscoutTokenBalanceToken
  address?: string
  address_hash?: string
  symbol?: string
  name?: string
  decimals?: number | string
  value?: number | string
  balance?: number | string
  quantity?: number | string
}

interface BlockscoutTokenBalanceResponse {
  items?: BlockscoutTokenBalanceItem[]
}

interface PortfolioCacheEnvelope {
  address: string
  tokens: PortfolioTokenBalance[]
  ts: number
  ttl: number
}

interface PortfolioLoadResult {
  tokens: PortfolioTokenBalance[]
  updatedAt: number
  ok: boolean
  status: number | null
  fromCache: boolean
}

function normalizeAddress(address: string | null | undefined): string {
  return (address ?? '').trim().toLowerCase()
}

function canUseLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed))
  }

  return null
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) return null
    return BigInt(Math.trunc(value))
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim()
    if (!/^\d+$/.test(normalized)) return null
    try {
      return BigInt(normalized)
    } catch {
      return null
    }
  }

  return null
}

function formatTokenAmount(rawValue: bigint, decimals: number): string {
  if (rawValue === 0n) {
    return decimals > 0 ? '0.00' : '0'
  }

  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, Math.floor(decimals)) : 0
  if (safeDecimals === 0) return rawValue.toString()

  const divisor = 10n ** BigInt(safeDecimals)
  const whole = rawValue / divisor
  const fraction = rawValue % divisor
  const visibleDecimals = Math.min(2, safeDecimals)
  const fractionStr = fraction.toString().padStart(safeDecimals, '0').slice(0, visibleDecimals)

  return visibleDecimals > 0 ? `${whole.toString()}.${fractionStr}` : whole.toString()
}

function isUsdcToken(address: string, symbol: string): boolean {
  return normalizeAddress(address) === normalizeAddress(USDC_CONTRACT) || symbol.toUpperCase() === 'USDC'
}

function readCachedPortfolio(address: string): PortfolioLoadResult | null {
  try {
    if (!canUseLocalStorage()) return null

    const raw = localStorage.getItem(PORTFOLIO_CACHE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as PortfolioCacheEnvelope | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      localStorage.removeItem(PORTFOLIO_CACHE_KEY)
      return null
    }

    if (normalizeAddress(parsed.address) !== address) return null
    if (typeof parsed.ts !== 'number' || typeof parsed.ttl !== 'number' || !Array.isArray(parsed.tokens)) {
      localStorage.removeItem(PORTFOLIO_CACHE_KEY)
      return null
    }

    if (Date.now() - parsed.ts > parsed.ttl) {
      localStorage.removeItem(PORTFOLIO_CACHE_KEY)
      return null
    }

    const tokens = parsed.tokens.filter((token): token is PortfolioTokenBalance => {
      return Boolean(
        token
        && typeof token.address === 'string'
        && typeof token.symbol === 'string'
        && typeof token.name === 'string'
        && typeof token.decimals === 'number'
        && typeof token.balance === 'string'
        && typeof token.isUsdc === 'boolean'
      )
    })

    return {
      tokens,
      updatedAt: parsed.ts,
      ok: true,
      status: 200,
      fromCache: true,
    }
  } catch (error) {
    debugWarn('[portfolio] cache read failed:', error)
    try {
      if (canUseLocalStorage()) localStorage.removeItem(PORTFOLIO_CACHE_KEY)
    } catch {}
    return null
  }
}

function writeCachedPortfolio(address: string, tokens: PortfolioTokenBalance[], updatedAt: number): void {
  try {
    if (!canUseLocalStorage()) return

    const payload: PortfolioCacheEnvelope = {
      address,
      tokens,
      ts: updatedAt,
      ttl: PORTFOLIO_CACHE_TTL_MS,
    }
    localStorage.setItem(PORTFOLIO_CACHE_KEY, JSON.stringify(payload))
  } catch (error) {
    debugWarn('[portfolio] cache write failed:', error)
  }
}

function normalizePortfolioItems(items: BlockscoutTokenBalanceItem[]): PortfolioTokenBalance[] {
  const parsed = items
    .map((item, index) => {
      const tokenSource = typeof item.token === 'object' && item.token ? item.token : item
      const address = getString(tokenSource.address ?? tokenSource.address_hash ?? item.address ?? item.address_hash)
      const symbol = getString(tokenSource.symbol ?? item.symbol) ?? (address ? address.slice(0, 6) : `TKN${index + 1}`)
      const name = getString(tokenSource.name ?? item.name) ?? symbol
      const decimals = toFiniteNumber(tokenSource.decimals ?? item.decimals) ?? 18
      const rawValue = toBigInt(item.value ?? item.balance ?? item.quantity)

      if (!address || !rawValue || rawValue === 0n) return null

      const normalizedSymbol = symbol.toUpperCase()
      const isUsdc = isUsdcToken(address, normalizedSymbol)

      return {
        address: address.toLowerCase(),
        symbol: normalizedSymbol,
        name,
        decimals,
        balance: formatTokenAmount(rawValue, decimals),
        isUsdc,
        rawValue,
      }
    })
    .filter((token): token is PortfolioTokenBalance & { rawValue: bigint } => Boolean(token))
    .sort((left, right) => {
      if (left.isUsdc !== right.isUsdc) return left.isUsdc ? -1 : 1
      if (left.rawValue === right.rawValue) return left.symbol.localeCompare(right.symbol)
      return left.rawValue > right.rawValue ? -1 : 1
    })

  return parsed.map(({ rawValue: _rawValue, ...token }) => token)
}

async function loadTokenBalances(address: string): Promise<PortfolioLoadResult> {
  const normalized = normalizeAddress(address)
  const now = Date.now()

  if (!isValidAddress(normalized)) {
    return {
      tokens: [],
      updatedAt: now,
      ok: true,
      status: null,
      fromCache: false,
    }
  }

  const cached = readCachedPortfolio(normalized)
  if (cached) return cached

  try {
    const response = await fetch(`${BLOCKSCOUT_API_BASE}/addresses/${normalized}/token-balances`, {
      headers: { accept: 'application/json' },
    })

    if (response.status === 404) {
      const emptyResult: PortfolioLoadResult = {
        tokens: [],
        updatedAt: now,
        ok: true,
        status: 404,
        fromCache: false,
      }
      writeCachedPortfolio(normalized, emptyResult.tokens, emptyResult.updatedAt)
      return emptyResult
    }

    if (!response.ok) {
      debugWarn('[portfolio] token balances request failed:', response.status)
      writeCachedPortfolio(normalized, [], now)
      return {
        tokens: [],
        updatedAt: now,
        ok: false,
        status: response.status,
        fromCache: false,
      }
    }

    const json = (await response.json()) as BlockscoutTokenBalanceResponse | BlockscoutTokenBalanceItem[]
    const items = Array.isArray(json)
      ? json
      : Array.isArray(json.items)
        ? json.items
        : []

    const tokens = normalizePortfolioItems(items)
    writeCachedPortfolio(normalized, tokens, now)

    return {
      tokens,
      updatedAt: now,
      ok: true,
      status: response.status,
      fromCache: false,
    }
  } catch (error) {
    debugWarn('[portfolio] token balances fetch failed:', error)
    writeCachedPortfolio(normalized, [], now)
    return {
      tokens: [],
      updatedAt: now,
      ok: false,
      status: null,
      fromCache: false,
    }
  }
}

export async function fetchTokenBalances(address: string): Promise<PortfolioTokenBalance[]> {
  return (await loadTokenBalances(address)).tokens
}

function getSeededPortfolio(address: string): PortfolioTokenBalance[] {
  const normalized = normalizeAddress(address)
  if (!isValidAddress(normalized)) return []

  const state = useStore.getState()
  const isFreshStore =
    state.portfolioAddress === normalized
    && typeof state.portfolioUpdatedAt === 'number'
    && Date.now() - state.portfolioUpdatedAt <= PORTFOLIO_CACHE_TTL_MS

  if (isFreshStore) {
    return state.portfolioTokens
  }

  const cached = readCachedPortfolio(normalized)
  return cached?.tokens ?? []
}

export function usePortfolioBalances(address: string | null | undefined) {
  const normalizedAddress = normalizeAddress(address)
  const setPortfolioTokens = useStore((state) => state.setPortfolioTokens)
  const [tokens, setTokens] = useState<PortfolioTokenBalance[]>(() => getSeededPortfolio(normalizedAddress))
  const [isLoading, setIsLoading] = useState(Boolean(normalizedAddress))
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!isValidAddress(normalizedAddress)) {
      if (requestId === requestIdRef.current) {
        setTokens([])
        setIsLoading(false)
        setPortfolioTokens(null, [], Date.now())
      }
      return
    }

    const seededTokens = getSeededPortfolio(normalizedAddress)
    setTokens(seededTokens)
    setIsLoading(true)

    const result = await loadTokenBalances(normalizedAddress)
    if (requestId !== requestIdRef.current) return

    setTokens(result.tokens)
    setPortfolioTokens(normalizedAddress, result.tokens, result.updatedAt)
    setIsLoading(false)
  }, [normalizedAddress, setPortfolioTokens])

  useEffect(() => {
    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, PORTFOLIO_CACHE_TTL_MS)

    return () => {
      window.clearInterval(intervalId)
      requestIdRef.current += 1
    }
  }, [refresh])

  return { tokens, isLoading, refresh }
}
