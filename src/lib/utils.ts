export function formatAddress(address: string, chars = 4): string {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export function formatBalance(wei: bigint, decimals: number): string {
  if (wei === 0n) return '0.00'
  const divisor = BigInt(10 ** decimals)
  const whole = wei / divisor
  const frac  = wei % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2)
  return `${whole.toString()}.${fracStr}`
}

// Legacy alias kept for existing callers
export function formatUSDC(raw: string | number, decimals = 18): string {
  const n = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.floor(Number(raw)))
  return formatBalance(n, decimals)
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

export function shortenTxHash(hash: string, chars = 6): string {
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  if (diff < 60_000)           return 'just now'
  if (diff < 3_600_000)        return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)       return `${Math.floor(diff / 3_600_000)}h ago`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7)                return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
