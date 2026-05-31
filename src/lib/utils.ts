export function formatAddress(address: string, chars = 4): string {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export function formatUSDC(raw: string | number, decimals = 18): string {
  const n = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.floor(Number(raw)))
  const divisor = BigInt(10 ** decimals)
  const whole = n / divisor
  const frac  = n % divisor
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2)
  return `${whole.toString()}.${fracStr}`
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
