import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { USDC_CONTRACT, BLOCKSCOUT_API_BASE } from '@/lib/constants'
import { useStore } from '@/lib/store'

interface BlockscoutAddressRef {
  hash?: string
}

interface BlockscoutTokenAmount {
  value?: string
}

interface BlockscoutTokenTransfer {
  timestamp?: string
  from?: BlockscoutAddressRef
  to?: BlockscoutAddressRef
  total?: BlockscoutTokenAmount
}

interface BlockscoutTokenTransferResponse {
  items?: BlockscoutTokenTransfer[]
}

export interface AddressInsights {
  totalTx: number
  totalVolume: bigint
  firstTx: number
  lastTx: number
  direction: 'mostly-sent' | 'mostly-received' | 'balanced'
  isLoading: boolean
  error: string | null
}

export function useAddressInsights(targetAddress: string | null | undefined): AddressInsights {
  const userAddress = useStore((s) => s.walletAddress)
  const [insights, setInsights] = useState<Omit<AddressInsights, 'isLoading' | 'error'>>({
    totalTx: 0,
    totalVolume: 0n,
    firstTx: 0,
    lastTx: 0,
    direction: 'balanced'
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const fetchInsights = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!userAddress || !targetAddress) {
      setInsights({
        totalTx: 0,
        totalVolume: 0n,
        firstTx: 0,
        lastTx: 0,
        direction: 'balanced'
      })
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const url = new URL(`${BLOCKSCOUT_API_BASE}/addresses/${userAddress}/token-transfers`)
      url.searchParams.set('type', 'ERC-20')
      url.searchParams.set('token', USDC_CONTRACT)

      const response = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const json = (await response.json()) as BlockscoutTokenTransferResponse
      const items = Array.isArray(json.items) ? json.items : []

      const targetLower = targetAddress.toLowerCase()
      const userLower = userAddress.toLowerCase()

      const relevantTransfers = items.filter(item => {
        const from = item.from?.hash?.toLowerCase()
        const to = item.to?.hash?.toLowerCase()
        return (from === userLower && to === targetLower) || (from === targetLower && to === userLower)
      })

      if (relevantTransfers.length === 0) {
        if (requestId === requestIdRef.current) {
          setInsights({
            totalTx: 0,
            totalVolume: 0n,
            firstTx: 0,
            lastTx: 0,
            direction: 'balanced'
          })
        }
        return
      }

      let totalVolume = 0n
      let sentCount = 0
      let receivedCount = 0
      let firstTx = Infinity
      let lastTx = -Infinity

      relevantTransfers.forEach(item => {
        const timestamp = item.timestamp ? new Date(item.timestamp).getTime() : 0
        const from = item.from?.hash?.toLowerCase()
        const value = BigInt(item.total?.value ?? '0')

        totalVolume += value
        if (from === userLower) sentCount++
        else receivedCount++

        if (timestamp > 0) {
          if (timestamp < firstTx) firstTx = timestamp
          if (timestamp > lastTx) lastTx = timestamp
        }
      })

      let direction: 'mostly-sent' | 'mostly-received' | 'balanced' = 'balanced'
      if (sentCount > receivedCount * 2) direction = 'mostly-sent'
      else if (receivedCount > sentCount * 2) direction = 'mostly-received'

      if (requestId === requestIdRef.current) {
        setInsights({
          totalTx: relevantTransfers.length,
          totalVolume,
          firstTx: firstTx === Infinity ? 0 : firstTx,
          lastTx: lastTx === -Infinity ? 0 : lastTx,
          direction
        })
      }
    } catch (err: any) {
      if (requestId === requestIdRef.current) {
        setError(err.message || 'Failed to fetch insights')
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [userAddress, targetAddress])

  useEffect(() => {
    void fetchInsights()
  }, [fetchInsights])

  return useMemo(() => ({
    ...insights,
    isLoading,
    error
  }), [insights, isLoading, error])
}
