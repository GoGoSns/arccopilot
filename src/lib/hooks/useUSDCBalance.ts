import { useState, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { formatBalance } from '@/lib/utils'

const RPC_URL      = 'https://rpc.testnet.arc.network'
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const BALANCE_OF   = '0x70a08231' // balanceOf(address) selector

export async function fetchUsdcBalance(address: string): Promise<string> {
  const padded = address.replace(/^0x/i, '').padStart(64, '0')
  const data   = BALANCE_OF + padded

  console.log('[useUSDCBalance] fetching RPC for', address.slice(0, 10) + '...')

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
  console.log('[useUSDCBalance] raw RPC response:', json)

  if (json.error) throw new Error(json.error.message)

  const raw = json.result as string
  if (!raw || raw === '0x' || raw === '0x0') return '0.00'

  const result = formatBalance(BigInt(raw), 18)
  console.log('[useUSDCBalance] parsed balance:', result)
  return result
}

export function useUSDCBalance() {
  const address       = useStore((s) => s.walletAddress)
  const storedBalance = useStore((s) => s.usdcBalance)
  const persist       = useStore((s) => s.setBalance)

  console.log('[useUSDCBalance] called — address:', address, '| storedBalance:', storedBalance)

  // Seed from persisted store so there's no "0.00 flash" on popup reopen
  const [balance,   setBalance]   = useState<string>(storedBalance ?? '0.00')
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const load = useCallback(async () => {
    if (!address) {
      console.log('[useUSDCBalance] no address yet — skipping fetch')
      setIsLoading(false)
      return
    }
    try {
      const b = await fetchUsdcBalance(address)
      setBalance(b)
      persist(b)
    } catch (err) {
      console.error('[useUSDCBalance] fetch error:', err)
      // Keep last known value rather than falling back to 0
    } finally {
      setIsLoading(false)
    }
  }, [address, persist])

  // Re-run whenever address changes (covers Zustand rehydration lag)
  useEffect(() => {
    load()
    const id = window.setInterval(load, 15_000)
    return () => window.clearInterval(id)
  }, [load])

  // Extra guard: if address arrives late (rehydration after mount), trigger immediately
  useEffect(() => {
    if (address) load()
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  return { balance, isLoading }
}
