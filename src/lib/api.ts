import { EXPLORER_URL } from './arc'

const BLOCKSCOUT_API = `${EXPLORER_URL}/api/v2`

export async function getAddressBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`${BLOCKSCOUT_API}/addresses/${address}`)
    const data = await res.json()
    return data.coin_balance ?? '0'
  } catch {
    return '0'
  }
}

export async function getAddressTransactions(address: string) {
  try {
    const res = await fetch(`${BLOCKSCOUT_API}/addresses/${address}/transactions?limit=20`)
    return await res.json()
  } catch {
    return { items: [] }
  }
}
