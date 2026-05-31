import { useState, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { formatBalance } from '@/lib/utils'

const RPC_URL      = 'https://rpc.testnet.arc.network'
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const BALANCE_OF   = '0x70a08231' // keccak256("balanceOf(address)").slice(0,4)

export async function fetchUsdcBalance(address: string): Promise<string> {
  const padded = address.replace(/^0x/i, '').padStart(64, '0')
  const data   = BALANCE_OF + padded

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: USDC_ADDRESS, data }, 'latest'],
    }),
  })

  const json = await res.json()
  if (json.error) throw new Error(json.error.message)

  const raw = json.result as string
  if (!raw || raw === '0x' || raw === '0x0') return '0.00'

  return formatBalance(BigInt(raw), 18)
}

/**
 * Fetches USDC balance for the connected address.
 * Seed value comes from the persisted Zustand store so there is no "0.00 flash"
 * when the popup reopens with a previously loaded balance.
 */
export function useUSDCBalance() {
  const address       = useStore((s) => s.walletAddress)
  const storedBalance = useStore((s) => s.usdcBalance)
  const persist       = useStore((s) => s.setBalance)

  // Start with whatever was last stored — avoids the blank-screen / 0.00 flash
  const [balance,   setBalance]   = useState<string>(storedBalance ?? '0.00')
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const load = useCallback(async () => {
    if (!address) {
      setIsLoading(false)
      return
    }
    try {
      const b = await fetchUsdcBalance(address)
      setBalance(b)
      persist(b)
    } catch (err) {
      console.error('[useUSDCBalance] fetch error:', err)
      // Keep last known value; don't overwrite with 0
    } finally {
      setIsLoading(false)
    }
  }, [address, persist])

  useEffect(() => {
    load()
    const id = window.setInterval(load, 15_000)
    return () => window.clearInterval(id)
  }, [load])

  return { balance, isLoading }
}
