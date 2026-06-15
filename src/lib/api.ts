import { EXPLORER_URL } from './arc'
import { fetchWithTimeout } from '@/lib/external'

const BLOCKSCOUT_API = `${EXPLORER_URL}/api/v2`

export async function getAddressBalance(address: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${BLOCKSCOUT_API}/addresses/${address}`)
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.coin_balance === 'string' ? data.coin_balance : null
  } catch {
    return null
  }
}

export async function getAddressTransactions(address: string): Promise<{ items: unknown[] } | null> {
  try {
    const res = await fetchWithTimeout(`${BLOCKSCOUT_API}/addresses/${address}/transactions`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
