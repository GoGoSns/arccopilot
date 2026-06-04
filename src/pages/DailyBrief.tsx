import { useEffect, useState } from 'react'
import { ArrowLeft, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { EXPLORER_URL } from '@/lib/arc'
import { formatBalance } from '@/lib/utils'

const USDC_CONTRACT = '0x3600000000000000000000000000000000000000'
const USDC_DECIMALS = 6

interface TokenTransfer {
  timestamp: string
  total: { value: string }
  from: { hash: string }
  to:   { hash: string }
  token: { address: string }
}

async function fetch24hBalanceChange(address: string): Promise<string | null> {
  try {
    const url = `${EXPLORER_URL}/api/v2/addresses/${address.toLowerCase()}/token-transfers?type=ERC-20&limit=50`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null

    const data = await res.json() as { items?: TokenTransfer[] }
    const items = data.items ?? []
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const normalizedAddr  = address.toLowerCase()
    const normalizedUsdc  = USDC_CONTRACT.toLowerCase()

    let netChange = 0n
    for (const tx of items) {
      if (tx.token?.address?.toLowerCase() !== normalizedUsdc) continue
      if (new Date(tx.timestamp).getTime() < cutoff) continue
      const amount = BigInt(tx.total?.value ?? '0')
      if (tx.to.hash.toLowerCase() === normalizedAddr)   netChange += amount
      if (tx.from.hash.toLowerCase() === normalizedAddr) netChange -= amount
    }

    if (netChange === 0n) return null
    const abs = netChange < 0n ? -netChange : netChange
    const formatted = formatBalance(abs, USDC_DECIMALS)
    return `${netChange >= 0n ? '+' : '-'}${formatted}`
  } catch {
    return null
  }
}

interface DailyBriefProps {
  onBack: () => void
}

export function DailyBrief({ onBack }: DailyBriefProps) {
  const address     = useStore((s) => s.walletAddress)
  const profile     = useStore((s) => s.profile)
  const { balance } = useUSDCBalance()

  const [balanceChange, setBalanceChange] = useState<string | null>(null)
  const [changeLoading, setChangeLoading] = useState(true)

  const displayName = profile?.displayName?.trim() || 'GoGo'

  const now      = new Date()
  const hour     = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr  = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => {
    if (!address) { setChangeLoading(false); return }
    fetch24hBalanceChange(address)
      .then((v) => setBalanceChange(v))
      .catch(() => {})
      .finally(() => setChangeLoading(false))
  }, [address])

  const isPositive = balanceChange?.startsWith('+')
  const isNegative = balanceChange?.startsWith('-')

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-arc-border px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-arc-text">
            {greeting}, {displayName}
          </h2>
          <p className="text-xs text-arc-text-dim">{dateStr}</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/* ── Balance Change ──────────────────────────────── */}
        <div className="space-y-2 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
            Your balance
          </p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-arc-gold">{balance}</span>
            <span className="mb-0.5 text-base text-arc-text-dim">USDC</span>
          </div>
          <div className="flex items-center gap-1.5">
            {changeLoading ? (
              <div className="h-4 w-28 animate-pulse rounded bg-arc-border" />
            ) : balanceChange ? (
              <>
                {isPositive && <TrendingUp  size={12} className="text-arc-success" />}
                {isNegative && <TrendingDown size={12} className="text-arc-danger"  />}
                <span className={`text-xs font-medium ${
                  isPositive ? 'text-arc-success' : isNegative ? 'text-arc-danger' : 'text-arc-text-dim'
                }`}>
                  {balanceChange} USDC (last 24h)
                </span>
              </>
            ) : (
              <span className="text-xs text-arc-text-dim">No activity in last 24h</span>
            )}
          </div>
        </div>

        {/* ── Recent Activity (skeleton) ───────────────────── */}
        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
            Recent activity
          </p>
          <div className="space-y-2">
            {[0, 100, 200].map((delay) => (
              <div
                key={delay}
                className="h-8 animate-pulse rounded-xl bg-arc-border/70"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
          <p className="text-center text-xs text-arc-text-dim">Loading recent transfers…</p>
        </div>

        {/* ── Ecosystem Pulse (skeleton) ───────────────────── */}
        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
            Arc ecosystem
          </p>
          <div className="grid grid-cols-3 gap-2">
            {['Block time', '24h volume', 'Active wallets'].map((label) => (
              <div key={label} className="space-y-1.5 rounded-xl border border-arc-border bg-arc-bg p-2">
                <p className="text-[9px] text-arc-text-dim">{label}</p>
                <div className="h-4 animate-pulse rounded bg-arc-border/70" />
              </div>
            ))}
          </div>
        </div>

        {/* ── AI Insight (placeholder) ─────────────────────── */}
        <div className="space-y-2 rounded-2xl border border-arc-gold/20 bg-arc-card p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-arc-gold" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-gold/80">Insight</p>
          </div>
          <p className="text-sm leading-relaxed text-arc-text-dim">
            Building patterns from your activity…
          </p>
        </div>
      </div>
    </div>
  )
}
