import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { EXPLORER_URL } from '@/lib/arc'
import { formatAddress, formatBalance, formatRelativeTime } from '@/lib/utils'

// ─── constants ───────────────────────────────────────────────────────────────
const USDC_CONTRACT = '0x3600000000000000000000000000000000000000'
const USDC_DECIMALS = 6
const TRANSFER_TTL  = 60_000       // 1 min
const STATS_TTL     = 5 * 60_000   // 5 min

// ─── types ───────────────────────────────────────────────────────────────────
interface RawTransfer {
  timestamp: string
  total: { value: string }
  from: { hash: string }
  to:   { hash: string }
  token: { address: string }
  transaction_hash?: string
}

interface ActivityEntry {
  direction:    'in' | 'out'
  otherAddress: string
  amount:       string   // formatted USDC
  timestamp:    string
}

interface EcosystemStats {
  blockTime:       string
  totalTx:         string
  totalAddresses:  string
}

// ─── localStorage cache ───────────────────────────────────────────────────────
function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, ts, ttl } = JSON.parse(raw) as { data: T; ts: number; ttl: number }
    if (Date.now() - ts > ttl) return null
    return data as T
  } catch { return null }
}

function writeCache<T>(key: string, data: T, ttl: number): void {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now(), ttl })) } catch {}
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ─── API helpers ─────────────────────────────────────────────────────────────
async function fetchRawTransfers(address: string): Promise<RawTransfer[]> {
  const url = `${EXPLORER_URL}/api/v2/addresses/${address.toLowerCase()}/token-transfers?type=ERC-20&limit=50`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) return []
  const data = await res.json() as { items?: RawTransfer[] }
  return (data.items ?? []).filter(
    tx => tx.token?.address?.toLowerCase() === USDC_CONTRACT.toLowerCase(),
  )
}

function deriveBalanceChange(transfers: RawTransfer[], address: string): string | null {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const addr   = address.toLowerCase()
  let net = 0n
  for (const tx of transfers) {
    if (new Date(tx.timestamp).getTime() < cutoff) continue
    const amount = BigInt(tx.total?.value ?? '0')
    if (tx.to.hash.toLowerCase()   === addr) net += amount
    if (tx.from.hash.toLowerCase() === addr) net -= amount
  }
  if (net === 0n) return null
  const abs = net < 0n ? -net : net
  return `${net >= 0n ? '+' : '-'}${formatBalance(abs, USDC_DECIMALS)}`
}

function deriveActivity(transfers: RawTransfer[], address: string): ActivityEntry[] {
  const addr = address.toLowerCase()
  return transfers.slice(0, 3).map(tx => ({
    direction:    tx.to.hash.toLowerCase() === addr ? 'in' : 'out',
    otherAddress: tx.to.hash.toLowerCase() === addr ? tx.from.hash : tx.to.hash,
    amount:       formatBalance(BigInt(tx.total?.value ?? '0'), USDC_DECIMALS),
    timestamp:    tx.timestamp,
  }))
}

async function fetchStats(): Promise<EcosystemStats | null> {
  try {
    const res = await fetch(`${EXPLORER_URL}/api/v2/stats`, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const d = await res.json() as {
      average_block_time?: number
      total_transactions?: string
      total_addresses?:    string
    }
    return {
      blockTime:      d.average_block_time != null ? `${Math.round(d.average_block_time)}ms` : '—',
      totalTx:        d.total_transactions   ? formatCompact(parseInt(d.total_transactions, 10)) : '—',
      totalAddresses: d.total_addresses      ? formatCompact(parseInt(d.total_addresses, 10))    : '—',
    }
  } catch { return null }
}

// ─── component ───────────────────────────────────────────────────────────────
interface DailyBriefProps {
  onBack: () => void
}

export function DailyBrief({ onBack }: DailyBriefProps) {
  const address         = useStore((s) => s.walletAddress)
  const profile         = useStore((s) => s.profile)
  const getMemory       = useStore((s) => s.getAddressMemory)
  const { balance }     = useUSDCBalance()

  // ── balance change ─
  const [balanceChange,  setBalanceChange]  = useState<string | null>(null)
  const [changeLoading,  setChangeLoading]  = useState(true)

  // ── recent activity ─
  const [activity,       setActivity]       = useState<ActivityEntry[] | null>(null)
  const [activityLoading,setActivityLoading]= useState(true)

  // ── stats ─
  const [stats,          setStats]          = useState<EcosystemStats | null>(null)
  const [statsLoading,   setStatsLoading]   = useState(true)

  // ── header ─
  const displayName = profile?.displayName?.trim() || 'GoGo'
  const now         = new Date()
  const hour        = now.getHours()
  const greeting    = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr     = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // ── effect: transfers (balance change + activity) ─────────────────────────
  useEffect(() => {
    if (!address) {
      setChangeLoading(false)
      setActivityLoading(false)
      return
    }

    const cacheKey = `arccopilot:brief:transfers:${address.toLowerCase()}`
    const cached   = readCache<RawTransfer[]>(cacheKey)

    if (cached) {
      setBalanceChange(deriveBalanceChange(cached, address))
      setActivity(deriveActivity(cached, address))
      setChangeLoading(false)
      setActivityLoading(false)
      return
    }

    // Cache miss — fetch
    fetchRawTransfers(address)
      .then((items) => {
        writeCache(cacheKey, items, TRANSFER_TTL)
        setBalanceChange(deriveBalanceChange(items, address))
        setActivity(deriveActivity(items, address))
      })
      .catch(() => {})
      .finally(() => {
        setChangeLoading(false)
        setActivityLoading(false)
      })
  }, [address])

  // ── effect: ecosystem stats ───────────────────────────────────────────────
  useEffect(() => {
    const cacheKey = 'arccopilot:brief:stats'
    const cached   = readCache<EcosystemStats>(cacheKey)

    if (cached) {
      setStats(cached)
      setStatsLoading(false)
      return
    }

    fetchStats()
      .then((s) => {
        if (s) { writeCache(cacheKey, s, STATS_TTL); setStats(s) }
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  const isPositive = balanceChange?.startsWith('+')
  const isNegative = balanceChange?.startsWith('-')

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-arc-border px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-arc-text">{greeting}, {displayName}</h2>
          <p className="text-xs text-arc-text-dim">{dateStr}</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">

        {/* ── Balance Change ────────────────────────────────── */}
        <div className="space-y-2 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Your balance</p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-arc-gold">{balance}</span>
            <span className="mb-0.5 text-base text-arc-text-dim">USDC</span>
          </div>
          <div className="flex items-center gap-1.5">
            {changeLoading ? (
              <div className="h-4 w-28 animate-pulse rounded bg-arc-border" />
            ) : balanceChange ? (
              <>
                {isPositive && <TrendingUp   size={12} className="text-arc-success" />}
                {isNegative && <TrendingDown size={12} className="text-arc-danger"  />}
                <span className={`text-xs font-medium ${isPositive ? 'text-arc-success' : isNegative ? 'text-arc-danger' : 'text-arc-text-dim'}`}>
                  {balanceChange} USDC (last 24h)
                </span>
              </>
            ) : (
              <span className="text-xs text-arc-text-dim">No activity in last 24h</span>
            )}
          </div>
        </div>

        {/* ── Recent Activity ───────────────────────────────── */}
        <div className="space-y-1 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Recent activity</p>

          {activityLoading ? (
            <div className="space-y-2">
              {[0, 100, 200].map((delay) => (
                <div key={delay} className="h-10 animate-pulse rounded-xl bg-arc-border/70" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          ) : !activity || activity.length === 0 ? (
            <p className="py-2 text-center text-xs text-arc-text-dim">No recent USDC activity</p>
          ) : (
            <div className="space-y-px">
              {activity.map((tx, i) => {
                const memory = getMemory(tx.otherAddress)
                const label  = memory?.label ?? formatAddress(tx.otherAddress, 4)
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-arc-border/30 transition-colors">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      tx.direction === 'in'
                        ? 'bg-arc-success/15 text-arc-success'
                        : 'bg-arc-danger/15 text-arc-danger'
                    }`}>
                      {tx.direction === 'in'
                        ? <ArrowDownLeft size={14} />
                        : <ArrowUpRight  size={14} />
                      }
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-arc-text">
                        {tx.direction === 'in' ? 'Received from' : 'Sent to'} {label}
                      </p>
                      <p className="text-[10px] text-arc-text-dim">{formatRelativeTime(tx.timestamp)}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${tx.direction === 'in' ? 'text-arc-success' : 'text-arc-danger'}`}>
                      {tx.direction === 'in' ? '+' : '-'}{tx.amount} USDC
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Ecosystem Pulse ───────────────────────────────── */}
        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Arc ecosystem</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Block time',   value: stats?.blockTime },
              { label: 'Total tx',     value: stats?.totalTx },
              { label: 'Wallets',      value: stats?.totalAddresses },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1.5 rounded-xl border border-arc-border bg-arc-bg p-2">
                <p className="text-[9px] text-arc-text-dim">{label}</p>
                {statsLoading || !value ? (
                  <div className="h-4 animate-pulse rounded bg-arc-border/70" />
                ) : (
                  <p className="text-sm font-bold text-arc-text">{value}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── AI Insight placeholder ────────────────────────── */}
        <div className="space-y-2 rounded-2xl border border-arc-gold/20 bg-arc-card p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-arc-gold" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-gold/80">Insight</p>
          </div>
          <p className="text-sm leading-relaxed text-arc-text-dim">Building patterns from your activity…</p>
        </div>

      </div>
    </div>
  )
}
