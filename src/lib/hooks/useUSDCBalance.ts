import { useState, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { formatBalance } from '@/lib/utils'
import { ARC_RPC_URL, USDC_CONTRACT } from '@/lib/constants'
import { debugLog } from '@/lib/debug'
import { fetchWithTimeout } from '@/lib/external'

const BALANCE_OF = '0x70a08231' // balanceOf(address) selector
// USDC on Arc Testnet uses 6 decimals (ERC-20 standard), NOT 18.
// Arc's native currency has 18 decimals but the USDC token contract does not.
const USDC_DECIMALS = 6

export async function fetchUsdcBalance(address: string): Promise<string | null> {
  const padded = address.slice(2).toLowerCase().padStart(64, '0')
  const data = BALANCE_OF + padded

  debugLog('[useUSDCBalance] fetching RPC for', `${address.slice(0, 10)}...`)

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

  if (!res.ok) return null

  const json = await res.json()
  debugLog('[useUSDCBalance] raw RPC response:', json)

  if (json.error) return null

  const raw = json.result as string
  if (!raw || raw === '0x' || raw === '0x0') return '0.00'

  const wei = BigInt(raw)
  debugLog('[useUSDCBalance] as 6 dec:', Number(wei) / 1e6, '| as 18 dec:', Number(wei) / 1e18)

  const result = formatBalance(wei, USDC_DECIMALS)
  debugLog('[useUSDCBalance] formatted:', result)
  return result
}

export function useUSDCBalance() {
  const address = useStore((s) => s.walletAddress)
  const storedBalance = useStore((s) => s.usdcBalance)
  const persist = useStore((s) => s.setBalance)

  debugLog('[useUSDCBalance] called - address:', address, '| storedBalance:', storedBalance)

  // Seed from persisted store so there's no "0.00 flash" on popup reopen
  const [balance, setBalance] = useState<string | null>(storedBalance ?? null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const refresh = useCallback(async () => {
    if (!address) {
      debugLog('[useUSDCBalance] no address yet - skipping fetch')
      setIsLoading(false)
      return
    }

    try {
      const nextBalance = await fetchUsdcBalance(address)
      if (nextBalance != null) {
        setBalance(nextBalance)
        persist(nextBalance)
      } else if (storedBalance == null) {
        setBalance(null)
      }
    } catch (err) {
      console.error('[useUSDCBalance] fetch error:', err)
      if (storedBalance == null) {
        setBalance(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [address, persist, storedBalance])

  // Re-run whenever address changes (covers Zustand rehydration lag)
  useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 15_000)
    return () => window.clearInterval(id)
  }, [refresh])

  // Extra guard: if address arrives late (rehydration after mount), trigger immediately
  useEffect(() => {
    if (address) refresh()
  }, [address, refresh])

  return { balance, isLoading, refresh }
}

