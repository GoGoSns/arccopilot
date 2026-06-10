import { EXPLORER_URL } from './arc'

const BLOCKSCOUT_API = `${EXPLORER_URL}/api/v2`

export async function getAddressBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`${BLOCKSCOUT_API}/addresses/${address}`)
    if (!res.ok) return '0'
    const data = await res.json()
    return data.coin_balance ?? '0'
  } catch {
    return '0'
  }
}

export async function getAddressTransactions(address: string) {
  try {
    const res = await fetch(`${BLOCKSCOUT_API}/addresses/${address}/transactions`)
    if (!res.ok) return { items: [] }
    return await res.json()
  } catch {
    return { items: [] }
  }
}
