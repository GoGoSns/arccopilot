import { useCallback, useEffect, useRef, useState } from 'react'
import { BLOCKSCOUT_API_BASE } from '@/lib/constants'
import { fetchWithTimeout } from '@/lib/external'
import { getExternalErrorMessage } from '@/lib/externalErrors'
const REFRESH_INTERVAL_MS = 60_000

interface BlockscoutStatsResponse {
  total_transactions?: string
  total_addresses?: string
  average_block_time?: number
  gas_used_today?: string
  transactions_today?: string
}

export interface EcosystemStatsState {
  volume24h: string
  activeWallets: string
  totalTxs: string
  averageBlockTimeLabel: string
  dataComplete: boolean
  isLoading: boolean
  error: string
  refresh: () => Promise<void>
}

function formatCompactNumber(raw: string | number): string {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value <= 0) return '0'

  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return `${Math.round(value)}`
}

function formatCompactCurrency(raw: string): string {
  const amount = Number(raw) / 1_000_000
  if (!Number.isFinite(amount) || amount <= 0) return '$0'

  const abs = Math.abs(amount)
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`
  return `$${amount.toFixed(2).replace(/\.00$/, '')}`
}

function formatBlockTimeLabel(raw: number): string {
  if (!Number.isFinite(raw) || raw <= 0) return '0ms'
  if (raw < 1_000) return `${Math.round(raw)}ms`

  const seconds = raw / 1_000
  if (seconds < 60) {
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

export function useEcosystemStats(): EcosystemStatsState {
  const [volume24h, setVolume24h] = useState('')
  const [activeWallets, setActiveWallets] = useState('')
  const [totalTxs, setTotalTxs] = useState('')
  const [averageBlockTimeLabel, setAverageBlockTimeLabel] = useState('')
  const [dataComplete, setDataComplete] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const hasLoadedRef = useRef(false)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const shouldShowLoading = !hasLoadedRef.current

    if (shouldShowLoading) {
      setIsLoading(true)
    }

    setError('')

    try {
      const response = await fetchWithTimeout(`${BLOCKSCOUT_API_BASE}/stats`, {
        headers: { accept: 'application/json' },
      })

      if (!response.ok) {
        if (requestId !== requestIdRef.current) return
        hasLoadedRef.current = true
        setDataComplete(false)
        setVolume24h('')
        setActiveWallets('')
        setTotalTxs('')
        setAverageBlockTimeLabel('')
        setError(getExternalErrorMessage(new Error(`HTTP ${response.status}`), 'discover.couldNotLoadStats'))
        return
      }

      const json = (await response.json()) as BlockscoutStatsResponse

      const nextVolume24h = formatCompactCurrency(json.gas_used_today ?? '0')
      const nextActiveWallets = formatCompactNumber(json.total_addresses ?? '0')
      const nextTotalTxs = formatCompactNumber(json.transactions_today ?? json.total_transactions ?? '0')
      const nextAverageBlockTimeLabel = formatBlockTimeLabel(Number(json.average_block_time ?? 0))

      if (requestId !== requestIdRef.current) return

      hasLoadedRef.current = true
      setDataComplete(true)
      setVolume24h(nextVolume24h)
      setActiveWallets(nextActiveWallets)
      setTotalTxs(nextTotalTxs)
      setAverageBlockTimeLabel(nextAverageBlockTimeLabel)
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      hasLoadedRef.current = true
      setDataComplete(false)
      setVolume24h('')
      setActiveWallets('')
      setTotalTxs('')
      setAverageBlockTimeLabel('')
      setError(getExternalErrorMessage(error, 'discover.couldNotLoadStats'))
    } finally {
      if (requestId === requestIdRef.current && shouldShowLoading) {
        setIsLoading(false)
      }
    }
  }, [])

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
    volume24h,
    activeWallets,
    totalTxs,
    averageBlockTimeLabel,
    dataComplete,
    isLoading,
    error,
    refresh,
  }
}
