import { useCallback, useEffect, useRef, useState } from 'react'
import { BLOCKSCOUT_API_BASE } from '@/lib/constants'
const REFRESH_INTERVAL_MS = 5 * 60_000
const USDC_DECIMALS = 18

interface BlockscoutAddressItem {
  hash?: string
  transactions_count?: string
  coin_balance?: string
  exchange_rate?: string | null
}

interface BlockscoutAddressesResponse {
  items?: BlockscoutAddressItem[]
}

export interface TopBuilder {
  address: string
  txCount: number
  volume: string
  isYou: boolean
}

interface UseTopBuildersResult {
  builders: TopBuilder[]
  isLoading: boolean
  error: string
  refresh: () => Promise<void>
}

function normalizeError(error: unknown): string {
  return 'Couldn\'t load builders'
}

function formatCompactCurrencyFromUnits(raw: string, decimals = USDC_DECIMALS): string {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return '$0'

  const amount = value / 10 ** decimals
  const abs = Math.abs(amount)
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`
  return `$${amount.toFixed(2).replace(/\.00$/, '')}`
}

export function useTopBuilders(address?: string | null): UseTopBuildersResult {
  const [builders, setBuilders] = useState<TopBuilder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const hasLoadedRef = useRef(false)
  const requestIdRef = useRef(0)

  const normalizedAddress = address?.toLowerCase() ?? ''

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const shouldShowLoading = !hasLoadedRef.current

    if (shouldShowLoading) {
      setIsLoading(true)
    }

    setError('')

    try {
      const response = await fetch(`${BLOCKSCOUT_API_BASE}/addresses?sort=transactions_count`, {
        headers: { accept: 'application/json' },
      })

      if (!response.ok) {
        if (requestId !== requestIdRef.current) return
        hasLoadedRef.current = true
        setBuilders([])
        return
      }

      const json = (await response.json()) as BlockscoutAddressesResponse
      const items = Array.isArray(json.items) ? json.items : []

      const nextBuilders = items
        .filter((item): item is BlockscoutAddressItem & { hash: string } => Boolean(item.hash))
        .sort((a, b) => {
          const left = BigInt(a.transactions_count ?? '0')
          const right = BigInt(b.transactions_count ?? '0')
          if (left === right) return 0
          return left > right ? -1 : 1
        })
        .slice(0, 5)
        .map((item) => {
          const addressHash = item.hash
          const isYou = Boolean(normalizedAddress) && addressHash.toLowerCase() === normalizedAddress

          return {
            address: addressHash,
            txCount: Number(item.transactions_count ?? '0'),
            volume: formatCompactCurrencyFromUnits(item.coin_balance ?? '0'),
            isYou,
          } satisfies TopBuilder
        })

      if (requestId !== requestIdRef.current) return

      hasLoadedRef.current = true
      setBuilders(nextBuilders)
    } catch {
      if (requestId !== requestIdRef.current) return
      hasLoadedRef.current = true
      setBuilders([])
    } finally {
      if (requestId === requestIdRef.current && shouldShowLoading) {
        setIsLoading(false)
      }
    }
  }, [normalizedAddress])

  useEffect(() => {
    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
      requestIdRef.current += 1
    }
  }, [refresh])

  return {
    builders,
    isLoading,
    error,
    refresh,
  }
}
