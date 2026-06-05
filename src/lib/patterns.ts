/**
 * ArcCopilot Pattern Engine v0 — pure functions, zero dependencies.
 * Analyses outgoing USDC transfer history and returns behavioural patterns.
 */

// ─── types ───────────────────────────────────────────────────────────────────

export interface BlockscoutTransfer {
  timestamp: string
  total: { value: string }
  from: { hash: string }
  to: { hash: string }
}

export type Pattern =
  | { kind: 'recurring-recipient'; address: string; label?: string; count: number; lastAmount: string; suggestion: string }
  | { kind: 'day-of-week';         weekday: number; address: string; label?: string; count: number; suggestion: string }
  | { kind: 'amount-cluster';      amount: string; count: number; suggestion: string }

export interface DismissedPattern {
  kind: string
  key:  string
  dismissedAt: number
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const USDC_DECIMALS = 6
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/** Formats wei to a precise USDC string for clustering (6 decimals) */
function formatAmtFull(weiStr: string): string {
  const wei = BigInt(weiStr || '0')
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = wei / divisor
  const frac = wei % divisor
  return `${whole}.${frac.toString().padStart(USDC_DECIMALS, '0')}`
}

/** Formats for display, e.g. "1.23" or "1.00" */
function formatAmtDisplay(weiStr: string): string {
  const wei = BigInt(weiStr || '0')
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = wei / divisor
  const frac = wei % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').slice(0, 2)
  return `${whole}.${fracStr}`
}

function shortAddr(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/** Stable key used for dismiss deduplication */
export function getPatternKey(p: Pattern): string {
  if (p.kind === 'recurring-recipient') return `recurring-recipient:${p.address}`
  if (p.kind === 'day-of-week')         return `day-of-week:${p.weekday}`
  return `amount-cluster:${p.amount}`
}

function isDismissed(p: Pattern, dismissed: DismissedPattern[]): boolean {
  const key = getPatternKey(p)
  const now = Date.now()
  return dismissed.some((d) => d.key === key && now - d.dismissedAt < SEVEN_DAYS_MS)
}

// ─── detectors ───────────────────────────────────────────────────────────────

function detectRecurringRecipient(
  outgoing: BlockscoutTransfer[],
  labels: Record<string, { label: string }>,
): Pattern[] {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recent = outgoing.filter((tx) => new Date(tx.timestamp).getTime() > since)

  const counts = new Map<string, { count: number; lastAmount: string }>()
  for (const tx of recent) {
    const addr = tx.to.hash.toLowerCase()
    const amount = formatAmtDisplay(tx.total.value)
    const prev = counts.get(addr)
    counts.set(addr, { count: (prev?.count ?? 0) + 1, lastAmount: amount })
  }

  const results: Pattern[] = []
  for (const [addr, { count, lastAmount }] of counts) {
    if (count < 3) continue
    const label = labels[addr]?.label ?? shortAddr(addr)
    results.push({
      kind: 'recurring-recipient',
      address: addr,
      label,
      count,
      lastAmount,
      suggestion: `You've sent to ${label} ${count} times. Send again?`,
    })
  }

  return results.sort((a, b) => b.count - a.count)
}

function detectDayOfWeek(
  outgoing: BlockscoutTransfer[],
): Pattern[] {
  const since = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recent = outgoing.filter((tx) => new Date(tx.timestamp).getTime() > since)

  // weekday → unique YYYY-MM-DD date strings
  const dayDates = new Map<number, Set<string>>()
  // weekday → last recipient address
  const dayAddr = new Map<number, string>()

  for (const tx of recent) {
    const date = new Date(tx.timestamp)
    const weekday = date.getDay()
    const dateStr = date.toISOString().slice(0, 10)
    if (!dayDates.has(weekday)) dayDates.set(weekday, new Set())
    dayDates.get(weekday)!.add(dateStr)
    dayAddr.set(weekday, tx.to.hash.toLowerCase())
  }

  const results: Pattern[] = []
  for (const [weekday, dates] of dayDates) {
    if (dates.size < 3) continue
    const addr = dayAddr.get(weekday) ?? ''
    results.push({
      kind: 'day-of-week',
      weekday,
      address: addr,
      count: dates.size,
      suggestion: `You usually tip on ${WEEKDAY_NAMES[weekday]}. Schedule a recurring transfer?`,
    })
  }

  return results.sort((a, b) => b.count - a.count)
}

function detectAmountCluster(outgoing: BlockscoutTransfer[]): Pattern[] {
  const counts = new Map<string, number>()
  for (const tx of outgoing) {
    const amount = formatAmtFull(tx.total.value)
    counts.set(amount, (counts.get(amount) ?? 0) + 1)
  }

  const results: Pattern[] = []
  for (const [amount, count] of counts) {
    if (count < 3) continue
    // For suggestion, use display format if it's "round" enough, or keep full if needed.
    // Actually, user wants "You often send {amount} USDC. Quick send?"
    // If it's a cluster, the amount is likely the same.
    const displayAmount = amount.endsWith('.000000') ? amount.split('.')[0] : amount.replace(/\.?0+$/, '')
    results.push({
      kind: 'amount-cluster',
      amount: amount,
      count,
      suggestion: `You often send ${displayAmount} USDC. Quick send?`,
    })
  }

  return results.sort((a, b) => b.count - a.count)
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Returns detected patterns sorted by priority:
 * recurring-recipient > day-of-week > amount-cluster
 * Dismissed patterns (within 7 days) are excluded.
 */
export function detectPatterns(
  transfers: BlockscoutTransfer[],
  ownAddress: string,
  addressLabels: Record<string, { label: string }>,
  dismissed: DismissedPattern[] = [],
): Pattern[] {
  if (transfers.length < 3) return []

  const own = ownAddress.toLowerCase()
  const outgoing = transfers.filter((tx) => tx.from.hash.toLowerCase() === own)
  if (outgoing.length < 3) return []

  const recurring = detectRecurringRecipient(outgoing, addressLabels)
    .filter((p) => !isDismissed(p, dismissed))
  if (recurring.length > 0) return [recurring[0]]

  const dayOfWeek = detectDayOfWeek(outgoing)
    .filter((p) => !isDismissed(p, dismissed))
  if (dayOfWeek.length > 0) return [dayOfWeek[0]]

  const amountCluster = detectAmountCluster(outgoing)
    .filter((p) => !isDismissed(p, dismissed))
  if (amountCluster.length > 0) return [amountCluster[0]]

  return []
}
