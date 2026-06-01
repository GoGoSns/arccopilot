import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EXPLORER_URL, USDC_ADDRESS } from '@/lib/arc'
import { timeAgo } from '@/lib/utils'

const BLOCKSCOUT_API_URL = 'https://testnet.arcscan.app/api/v2'
const POLL_INTERVAL_MS = 30_000

interface BlockscoutAddressRef {
  hash?: string
}

interface BlockscoutTokenRef {
  address_hash?: string
  symbol?: string
  decimals?: string | number
}

interface BlockscoutTokenAmount {
  value?: string
  decimals?: string | number
}

interface BlockscoutTokenTransfer {
  transaction_hash?: string
  timestamp?: string
  from?: BlockscoutAddressRef
  to?: BlockscoutAddressRef
  token?: BlockscoutTokenRef
  total?: BlockscoutTokenAmount
}

interface BlockscoutTokenTransferResponse {
  items?: BlockscoutTokenTransfer[]
}

export interface TxHistoryItem {
  hash: string
  direction: 'send' | 'receive'
  signedAmount: string
  counterpartyPrefix: 'to' | 'from'
  counterpartyAddress: string
  timeLabel: string
  explorerUrl: string
}

interface UseTxHistoryResult {
  transactions: TxHistoryItem[]
  isLoading: boolean
  error: string
  refresh: () => Promise<void>
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString()

  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const fraction = value % divisor

  if (fraction === 0n) return whole.toString()

  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fractionStr}`
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return "Couldn't load activity"
}

export function useTxHistory(address: string | null | undefined): UseTxHistoryResult {
  const [transactions, setTransactions] = useState<TxHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const transactionsRef = useRef<TxHistoryItem[]>([])
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const normalizedAddress = address?.toLowerCase()

    if (!normalizedAddress) {
      setTransactions([])
      transactionsRef.current = []
      setError('')
      setIsLoading(false)
      return
    }

    const shouldShowLoading = transactionsRef.current.length === 0
    if (shouldShowLoading) {
      setIsLoading(true)
    }
    setError('')

    try {
      const url = new URL(`${BLOCKSCOUT_API_URL}/addresses/${address}/token-transfers`)
      url.searchParams.set('type', 'ERC-20')
      url.searchParams.set('token', USDC_ADDRESS)

      const response = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const json = (await response.json()) as BlockscoutTokenTransferResponse
      const items = Array.isArray(json.items) ? json.items : []

      const nextTransactions = items
        .map((item) => {
          const hash = item.transaction_hash
          if (!hash) return null

          const from = item.from?.hash?.toLowerCase() ?? ''
          const to = item.to?.hash?.toLowerCase() ?? ''
          const isSend = from === normalizedAddress
          const counterpartyAddress = isSend ? to : from
          const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? 6)
          const rawAmount = item.total?.value ?? '0'
          const amount = formatUnits(BigInt(rawAmount), decimals)
          const signedAmount = `${isSend ? '-' : '+'}${amount}`
          const timestamp = item.timestamp ? new Date(item.timestamp).getTime() : 0

          return {
            hash,
            direction: isSend ? 'send' : 'receive',
            signedAmount,
            counterpartyPrefix: isSend ? 'to' : 'from',
            counterpartyAddress,
            timeLabel: timestamp ? timeAgo(timestamp) : 'just now',
            explorerUrl: `${EXPLORER_URL}/tx/${hash}`,
            timestamp,
          } satisfies TxHistoryItem & { timestamp: number }
        })
        .filter((item): item is TxHistoryItem & { timestamp: number } => Boolean(item))
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(({ timestamp: _timestamp, ...item }) => item)

      if (requestIdRef.current !== requestId) return

      transactionsRef.current = nextTransactions
      setTransactions(nextTransactions)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      if (transactionsRef.current.length === 0) {
        setTransactions([])
        transactionsRef.current = []
        setError(normalizeError(err))
      } else {
        console.error('[useTxHistory] refresh failed:', err)
      }
    } finally {
      if (requestIdRef.current === requestId && shouldShowLoading) {
        setIsLoading(false)
      }
    }
  }, [address])

  useEffect(() => {
    requestIdRef.current += 1
    transactionsRef.current = []
    setTransactions([])
    setError('')

    if (!address) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
      requestIdRef.current += 1
    }
  }, [refresh])

  return useMemo(
    () => ({
      transactions,
      isLoading,
      error,
      refresh,
    }),
    [transactions, isLoading, error, refresh]
  )
}
