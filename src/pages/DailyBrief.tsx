import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowLeft, ArrowUpRight, BadgeCheck, Eye, Lightbulb, Send, Sparkles, TrendingDown, TrendingUp, Twitter, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { EXPLORER_URL } from '@/lib/arc'
import { formatAddress, formatBalance, formatRelativeTime } from '@/lib/utils'
import { detectPatterns, getPatternKey, type Pattern, type DismissedPattern } from '@/lib/patterns'
import { DISMISSED_PATTERNS_KEY, PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'
import { Button } from '@/components/ui/Button'
import { fetchArcTweets, type TwitterTweet } from '@/lib/twitterApi'

// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const USDC_CONTRACT  = '0x3600000000000000000000000000000000000000'
const USDC_DECIMALS  = 6
const TRANSFER_TTL   = 60_000       // 1 min
const STATS_TTL      = 5 * 60_000   // 5 min
const WHALE_TTL      = 5 * 60_000   // 5 min
const TWEETS_TTL     = 60 * 60_000  // 60 min
const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// â”€â”€â”€ types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  amount:       string
  timestamp:    string
}

interface EcosystemStats {
  blockTime:       string
  totalTx:         string
  totalAddresses:  string
}

interface WhaleEntry {
  address:   string
  label:     string
  amount:    string
  direction: 'in' | 'out'
  timestamp: string
  hasRecent: boolean
}

type RecommendationKind = 'pattern' | 'whale' | 'balance'

interface RecommendationItem {
  kind: RecommendationKind
  title: string
  body: string
  actionLabel: string
  actionStyle?: 'primary' | 'outline'
  onAction: () => void
}

// â”€â”€â”€ localStorage cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatUsdcAmount(amount: string): string {
  return amount.replace(/\.?0+$/, '')
}

function getWeekdayName(timestamp: string): string {
  return WEEKDAY_NAMES[new Date(timestamp).getDay()] ?? 'today'
}

function isUsdcTransfer(tx: RawTransfer): boolean {
  return tx.token?.address?.toLowerCase() === USDC_CONTRACT.toLowerCase()
}

function getTweetAvatarInitial(authorName: string, authorHandle: string): string {
  const source = authorName.trim() || authorHandle.trim() || '?'
  return source.charAt(0).toUpperCase()
}

function TweetAvatar({ tweet }: { tweet: TwitterTweet }) {
  const [imageFailed, setImageFailed] = useState(false)
  const fallback = getTweetAvatarInitial(tweet.authorName, tweet.authorHandle)

  if (!tweet.authorAvatar || imageFailed) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-arc-border/50 bg-arc-border/40 text-[10px] font-semibold text-arc-text-dim">
        {fallback}
      </div>
    )
  }

  return (
    <img
      src={tweet.authorAvatar}
      alt=""
      className="h-6 w-6 shrink-0 rounded-full border border-arc-border/50 object-cover"
      onError={() => setImageFailed(true)}
    />
  )
}

// â”€â”€â”€ API helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function fetchRawTransfers(address: string): Promise<RawTransfer[]> {
  const url = `${EXPLORER_URL}/api/v2/addresses/${address.toLowerCase()}/token-transfers?type=ERC-20&limit=20`

  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (res.status === 422) return []
    if (!res.ok) return []
    const data = await res.json() as { items?: RawTransfer[] }
    return (data.items ?? []).filter(isUsdcTransfer)
  } catch {
    return []
  }
}

function deriveBalanceChange(transfers: RawTransfer[], address: string): string | null {
  const cutoff = Date.now() - RECENT_ACTIVITY_WINDOW_MS
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

function hasRecentActivity(transfers: RawTransfer[]): boolean {
  const cutoff = Date.now() - RECENT_ACTIVITY_WINDOW_MS
  return transfers.some((tx) => new Date(tx.timestamp).getTime() >= cutoff)
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
      blockTime:      d.average_block_time != null ? `${Math.round(d.average_block_time)}ms` : 'â€”',
      totalTx:        d.total_transactions ? formatCompact(parseInt(d.total_transactions, 10)) : 'â€”',
      totalAddresses: d.total_addresses    ? formatCompact(parseInt(d.total_addresses, 10))    : 'â€”',
    }
  } catch { return null }
}

type CachedWhaleTx = { amount: string; direction: 'in' | 'out'; timestamp: string; hasRecent: boolean }

async function fetchWhaleLastTx(whaleAddr: string, label: string): Promise<WhaleEntry | null> {
  const cacheKey = `arccopilot:whale:last:${whaleAddr.toLowerCase()}`
  const cached   = readCache<CachedWhaleTx>(cacheKey)
  if (cached) return { address: whaleAddr, label, ...cached }

  try {
    const url = `${EXPLORER_URL}/api/v2/addresses/${whaleAddr.toLowerCase()}/token-transfers?type=ERC-20&limit=5`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const data  = await res.json() as { items?: RawTransfer[] }
    const items = (data.items ?? []).filter(isUsdcTransfer)
    if (!items.length) return null

    const latest  = items[0]
    const wNorm   = whaleAddr.toLowerCase()
    const direction: 'in' | 'out' = latest.to.hash.toLowerCase() === wNorm ? 'in' : 'out'
    const amount   = formatBalance(BigInt(latest.total?.value ?? '0'), USDC_DECIMALS)
    const hasRecent = Date.now() - new Date(latest.timestamp).getTime() < 24 * 60 * 60 * 1000

    const txData: CachedWhaleTx = { amount, direction, timestamp: latest.timestamp, hasRecent }
    writeCache(cacheKey, txData, WHALE_TTL)
    return { address: whaleAddr, label, ...txData }
  } catch { return null }
}

// â”€â”€â”€ component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface DailyBriefProps {
  onBack: () => void
}

export function DailyBrief({ onBack }: DailyBriefProps) {
  const address         = useStore((s) => s.walletAddress)
  const profile         = useStore((s) => s.profile)
  const addressMemories = useStore((s) => s.addressMemories)
  const getMemory       = useStore((s) => s.getAddressMemory)
  const setCurrentView  = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)
  const { balance }     = useUSDCBalance()
  const recentActivityRef = useRef<HTMLDivElement | null>(null)

  // Whale addresses (tag === 'whale')
  const trackedWhales = useMemo(
    () => Object.values(addressMemories).filter(m => m.tag === 'whale'),
    [addressMemories],
  )
  const whales = useMemo(
    () => trackedWhales.slice(0, 3),
    [trackedWhales],
  )

  // â”€â”€ state â”€
  const [balanceChange,  setBalanceChange]  = useState<string | null>(null)
  const [changeLoading,  setChangeLoading]  = useState(true)
  const [activity,       setActivity]       = useState<ActivityEntry[] | null>(null)
  const [activityLoading,setActivityLoading]= useState(true)
  const [stats,          setStats]          = useState<EcosystemStats | null>(null)
  const [statsLoading,   setStatsLoading]   = useState(true)
  const [whaleEntries,   setWhaleEntries]   = useState<WhaleEntry[]>([])
  const [whaleLoading,   setWhaleLoading]   = useState(false)
  const [whaleReady,     setWhaleReady]     = useState(false)

  // -- Twitter State --
  const [tweets,         setTweets]         = useState<TwitterTweet[]>([])
  const [tweetsLoading,  setTweetsLoading]  = useState(true)
  const [tweetsError,    setTweetsError]    = useState<string | null>(null)

  // -- Pattern State --
  const [rawTransfers,    setRawTransfers]    = useState<RawTransfer[]>([])
  const [dismissed,       setDismissed]       = useState<DismissedPattern[]>([])
  const [patternLoading,  setPatternLoading]  = useState(true)

  const activePattern = useMemo(() => {
    if (!address) return null
    return detectPatterns(rawTransfers, address, addressMemories, dismissed)[0] ?? null
  }, [rawTransfers, address, addressMemories, dismissed])

  // Clear badge when this page mounts (user has seen whale activity)
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' }, () => {
      if (chrome.runtime.lastError) { /* ignore â€” popup may have opened before SW ready */ }
    })
  }, [])

  // â”€â”€ header â”€
  const displayName = profile?.displayName?.trim() || 'GoGo'
  const now         = new Date()
  const hour        = now.getHours()
  const greeting    = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateStr     = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // â”€â”€ effect: transfers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!address) {
      setChangeLoading(false)
      setActivityLoading(false)
      setPatternLoading(false)
      return
    }
    const cacheKey = `arccopilot:brief:transfers:${address.toLowerCase()}`
    const cached   = readCache<RawTransfer[]>(cacheKey)

    const process = (items: RawTransfer[]) => {
      setRawTransfers(items)
      setBalanceChange(deriveBalanceChange(items, address))
      setActivity(deriveActivity(items, address))
      setChangeLoading(false)
      setActivityLoading(false)
      setPatternLoading(false)
    }

    if (cached) {
      process(cached)
      return
    }
    fetchRawTransfers(address)
      .then((items) => {
        writeCache(cacheKey, items, TRANSFER_TTL)
        process(items)
      })
      .catch(() => {
        setChangeLoading(false)
        setActivityLoading(false)
        setPatternLoading(false)
      })
  }, [address])

  // â”€â”€ effect: dismissed patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    chrome.storage.local.get(DISMISSED_PATTERNS_KEY, (res) => {
      if (res[DISMISSED_PATTERNS_KEY]) {
        setDismissed(res[DISMISSED_PATTERNS_KEY])
      }
    })
  }, [])

  const dismissPattern = (p: Pattern) => {
    const key = getPatternKey(p)
    const newEntry: DismissedPattern = { kind: p.kind, key, dismissedAt: Date.now() }
    const next = [...dismissed, newEntry]
    setDismissed(next)
    chrome.storage.local.set({ [DISMISSED_PATTERNS_KEY]: next })
  }

  const handlePatternAction = (p: Pattern) => {
    if (p.kind === 'day-of-week') {
      // day-of-week action is "Got it"
      dismissPattern(p)
      return
    }

    const pending = {
      recipient: p.kind === 'recurring-recipient' ? p.address : undefined,
      amount: p.kind === 'recurring-recipient' ? p.lastAmount : p.kind === 'amount-cluster' ? formatUsdcAmount(p.amount) : undefined,
      ts: Date.now(),
    }

    chrome.storage.local.set({ [PENDING_SEND_STORAGE_KEY]: pending }, () => {
      setCurrentView('send')
    })
  }

  // â”€â”€ effect: stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const cacheKey = 'arccopilot:brief:stats'
    const cached   = readCache<EcosystemStats>(cacheKey)
    if (cached) { setStats(cached); setStatsLoading(false); return }
    fetchStats()
      .then((s) => { if (s) { writeCache(cacheKey, s, STATS_TTL); setStats(s) } })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  // â”€â”€ effect: whale movements â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    setWhaleReady(false)
    if (whales.length === 0) { setWhaleEntries([]); setWhaleReady(true); return }
    setWhaleLoading(true)
    Promise.all(
      whales.map(w => fetchWhaleLastTx(w.address, w.label ?? formatAddress(w.address, 4)))
    )
      .then((results) => setWhaleEntries(results.filter(Boolean) as WhaleEntry[]))
      .catch(() => {})
      .finally(() => { setWhaleLoading(false); setWhaleReady(true) })
  }, [whales])

  // â”€â”€ effect: twitter feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const cacheKey = 'arccopilot:tweets:arc'
    const cached   = readCache<TwitterTweet[]>(cacheKey)
    setTweetsError(null)

    if (cached) {
      setTweets(cached)
      setTweetsLoading(false)
      return
    }

    fetchArcTweets()
      .then(items => {
        writeCache(cacheKey, items, TWEETS_TTL)
        setTweets(items)
      })
      .catch(err => {
        setTweetsError(err instanceof Error ? err.message : 'Tweets unavailable right now. Try refreshing in a few minutes.')
      })
      .finally(() => setTweetsLoading(false))
  }, [])

  const isPositive     = balanceChange?.startsWith('+')
  const isNegative     = balanceChange?.startsWith('-')
  const anyWhaleRecent = whaleEntries.some((e) => e.hasRecent)
  const recentWhale    = whaleEntries
    .filter((entry) => entry.hasRecent)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ?? null
  const has24hActivity = hasRecentActivity(rawTransfers)
  const balanceDelta   = balanceChange ? Math.abs(Number(balanceChange)) : 0
  const recommendationsLoading = patternLoading || whaleLoading || activityLoading

  const summaryLine = (() => {
    if (tweetsLoading || activityLoading || !whaleReady) {
      return 'İşte bugünkü özetin.'
    }

    const tweetCount = tweets.length
    const whaleCount = trackedWhales.length
    if (tweetCount === 0 && whaleCount === 0 && !has24hActivity) {
      return 'İşte bugünkü özetin.'
    }

    const activityClause = has24hActivity
      ? 'son 24 saatte aktiviteni kontrol ettim'
      : 'son 24 saatte aktivite olmadığını kontrol ettim'

    return `Bu sabah ${tweetCount} Arc tweet'i, ${whaleCount} takip edilen whale ve ${activityClause}.`
  })()

  const recommendations: RecommendationItem[] = []

  const openSendWithPending = (pending: { recipient?: string; amount?: string }) => {
    chrome.storage.local.set({
      [PENDING_SEND_STORAGE_KEY]: {
        ...pending,
        ts: Date.now(),
      },
    }, () => {
      setCurrentView('send')
    })
  }

  const goToWhale = (whale: WhaleEntry) => {
    setSelectedAddress(whale.address)
    setCurrentView('address-detail')
  }

  const scrollToRecentActivity = () => {
    recentActivityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (activePattern && address) {
    const normalizedAddress = address.toLowerCase()
    const patternRecipient = activePattern.kind === 'amount-cluster'
      ? ''
      : getMemory(activePattern.address)?.label?.trim()
        || ('label' in activePattern ? activePattern.label?.trim() : '')
        || formatAddress(activePattern.address, 4)

    const matchingTransfer = activePattern.kind === 'amount-cluster'
      ? null
      : rawTransfers.find((tx) =>
          tx.from.hash.toLowerCase() === normalizedAddress &&
          tx.to.hash.toLowerCase() === activePattern.address.toLowerCase()
        ) ?? null

    const latestAmount = matchingTransfer
      ? formatBalance(BigInt(matchingTransfer.total?.value ?? '0'), USDC_DECIMALS)
      : activePattern.kind === 'recurring-recipient'
        ? formatUsdcAmount(activePattern.lastAmount)
        : undefined

    if (activePattern.kind === 'amount-cluster') {
      const amount = formatUsdcAmount(activePattern.amount)
      recommendations.push({
        kind: 'pattern',
        title: 'Smart send',
        body: `You often send ${amount} USDC. Quick send?`,
        actionLabel: 'Open Send',
        actionStyle: 'primary',
        onAction: () => openSendWithPending({ amount }),
      })
    } else {
      const dayLabel = activePattern.kind === 'day-of-week'
        ? WEEKDAY_NAMES[activePattern.weekday] ?? 'today'
        : matchingTransfer
          ? getWeekdayName(matchingTransfer.timestamp)
          : 'recently'

      recommendations.push({
        kind: 'pattern',
        title: 'Smart send',
        body: `You usually send to ${patternRecipient} on ${dayLabel}. Send again?`,
        actionLabel: 'Open Send',
        actionStyle: 'primary',
        onAction: () => openSendWithPending({
          recipient: activePattern.address,
          amount: latestAmount,
        }),
      })
    }
  }

  if (recentWhale) {
    recommendations.push({
      kind: 'whale',
      title: 'Whale alert',
      body: `${recentWhale.label} moved ${recentWhale.amount} USDC recently. View?`,
      actionLabel: 'View',
      actionStyle: 'outline',
      onAction: () => goToWhale(recentWhale),
    })
  }

  if (balanceChange && balanceDelta > 5) {
    recommendations.push({
      kind: 'balance',
      title: 'Balance swing',
      body: `Your balance changed ${balanceChange} USDC in 24h. Check activity?`,
      actionLabel: 'Check Activity',
      actionStyle: 'outline',
      onAction: scrollToRecentActivity,
    })
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 border-b border-arc-border px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-arc-text">{greeting}, {displayName}</h2>
          <p className="text-xs text-arc-text-dim">{dateStr}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-arc-text-dim">
            {summaryLine}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="space-y-4 overflow-hidden rounded-2xl border border-arc-gold/25 bg-gradient-to-br from-arc-gold/10 via-arc-card to-arc-card p-4 shadow-lg shadow-arc-gold/5">
          <div className="flex items-center gap-2">
            <Lightbulb size={14} className="text-arc-gold" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-gold/85">Önerilerim</p>
              <p className="text-[10px] text-arc-text-dim">For You</p>
            </div>
          </div>

          {recommendations.length === 0 && recommendationsLoading ? (
            <div className="space-y-3">
              {[0, 90].map((delay) => (
                <div key={delay} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-arc-border/70" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-3/4 rounded bg-arc-border/70" />
                      <div className="h-2 w-1/3 rounded bg-arc-border/70" />
                      <div className="h-8 w-28 rounded-xl bg-arc-border/70" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="rounded-xl border border-arc-border bg-arc-bg/70 px-3 py-4 text-center">
              <p className="text-sm font-medium text-arc-text">Nothing urgent right now.</p>
              <p className="mt-1 text-xs text-arc-text-dim">You&apos;re all caught up.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.slice(0, 3).map((item) => {
                const Icon = item.kind === 'pattern' ? Send : item.kind === 'whale' ? Eye : Activity

                return (
                  <div key={`${item.kind}-${item.title}-${item.actionLabel}`} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-gold/20 bg-arc-gold/10 text-arc-gold">
                        <Icon size={14} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="space-y-1">
                          <p className="text-sm leading-relaxed text-arc-text">{item.body}</p>
                          <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">{item.title}</p>
                        </div>
                        <Button
                          variant={item.actionStyle ?? 'primary'}
                          size="sm"
                          className="h-8 px-3 text-[10px]"
                          onClick={item.onAction}
                        >
                          {item.actionLabel}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

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
                {isPositive && <TrendingUp size={12} className="text-arc-success" />}
                {isNegative && <TrendingDown size={12} className="text-arc-danger" />}
                <span className={`text-xs font-medium ${isPositive ? 'text-arc-success' : isNegative ? 'text-arc-danger' : 'text-arc-text-dim'}`}>
                  {balanceChange} USDC (last 24h)
                </span>
              </>
            ) : (
              <span className="text-xs text-arc-text-dim">No activity in last 24h</span>
            )}
          </div>
        </div>

        <div ref={recentActivityRef} className="space-y-1 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Recent activity</p>
          {activityLoading ? (
            <div className="space-y-2">
              {[0, 100, 200].map((d) => (
                <div key={d} className="h-10 animate-pulse rounded-xl bg-arc-border/70" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          ) : !activity || activity.length === 0 ? (
            <p className="py-2 text-center text-xs text-arc-text-dim">No recent activity</p>
          ) : (
            <div className="space-y-px">
              {activity.map((tx, i) => {
                const mem = getMemory(tx.otherAddress)
                const label = mem?.label ?? formatAddress(tx.otherAddress, 4)
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-arc-border/30">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tx.direction === 'in' ? 'bg-arc-success/15 text-arc-success' : 'bg-arc-danger/15 text-arc-danger'}`}>
                      {tx.direction === 'in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
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

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Arc ecosystem</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Block time', value: stats?.blockTime },
              { label: 'Total tx', value: stats?.totalTx },
              { label: 'Wallets', value: stats?.totalAddresses },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1.5 rounded-xl border border-arc-border bg-arc-bg p-2">
                <p className="text-[9px] text-arc-text-dim">{label}</p>
                {statsLoading || !value
                  ? <div className="h-4 animate-pulse rounded bg-arc-border/70" />
                  : <p className="text-sm font-bold text-arc-text">{value}</p>
                }
              </div>
            ))}
          </div>
        </div>

        <div className={`space-y-3 rounded-2xl border bg-arc-card p-4 ${anyWhaleRecent ? 'border-l-2 border-arc-gold/60' : 'border-arc-border'}`}>
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-arc-gold" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Whale Movements</p>
          </div>

          {whaleLoading && (
            <div className="h-10 animate-pulse rounded-xl bg-arc-border/70" />
          )}

          {!whaleLoading && whaleReady && whales.length === 0 && (
            <div className="space-y-2 py-1 text-center">
              <p className="text-xs text-arc-text-dim">No whales tracked yet</p>
              <p className="text-[10px] text-arc-text-dim">Mark addresses as whale from Address Book</p>
              <button
                onClick={() => setCurrentView('address-book')}
                className="text-[10px] font-semibold text-arc-gold underline-offset-2 hover:underline"
              >
                Browse Address Book
              </button>
            </div>
          )}

          {!whaleLoading && whaleReady && whaleEntries.length > 0 && (
            <div className="space-y-px">
              {whaleEntries.map((entry, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-arc-border/30 ${entry.hasRecent ? 'bg-arc-gold/5' : ''}`}>
                  <Eye size={14} className="shrink-0 text-arc-gold" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-arc-text">{entry.label}</p>
                    <p className="text-[10px] text-arc-text-dim">
                      {entry.direction === 'out' ? 'Sent' : 'Received'} {entry.amount} USDC · {formatRelativeTime(entry.timestamp)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${entry.direction === 'out' ? 'text-arc-danger' : 'text-arc-success'}`}>
                    {entry.amount}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!whaleLoading && whaleReady && whales.length > 0 && whaleEntries.length === 0 && (
            <p className="py-1 text-center text-xs text-arc-text-dim">No recent whale activity</p>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <div className="flex items-center gap-2">
            <Twitter size={14} className="text-[#d4af37]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">Arc on X</p>
          </div>

          {tweetsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-6 w-6 rounded-full bg-arc-border/70 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-2 w-24 rounded bg-arc-border/70" />
                    <div className="h-3 w-full rounded bg-arc-border/70" />
                  </div>
                </div>
              ))}
            </div>
          ) : tweetsError ? (
            <div className="space-y-2 py-1 text-center">
              <p className="text-xs text-arc-danger">{tweetsError}</p>
              <button
                onClick={() => setCurrentView('settings')}
                className="text-[10px] font-semibold text-arc-gold underline-offset-2 hover:underline"
              >
                Update key in Settings
              </button>
            </div>
          ) : tweets.length === 0 ? (
            <p className="py-2 text-center text-xs text-arc-text-dim">No Arc tweets found yet</p>
          ) : (
            <div className="space-y-4">
              {tweets.slice(0, 3).map((tweet) => (
                <button
                  key={tweet.id}
                  type="button"
                  className="flex w-full cursor-pointer gap-3 text-left group"
                  onClick={() => chrome.tabs.create({ url: tweet.tweetUrl })}
                >
                  <TweetAvatar tweet={tweet} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="truncate text-[11px] font-semibold text-arc-text">{tweet.authorName}</span>
                      {tweet.verified && <BadgeCheck size={11} className="shrink-0 text-[#1d9bf0]" />}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-arc-text-dim">
                      <span className="truncate">@{tweet.authorHandle}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{tweet.createdAt ? formatRelativeTime(tweet.createdAt) : 'Unknown time'}</span>
                    </div>
                    <p className="line-clamp-2 text-xs leading-snug text-arc-text transition-colors group-hover:text-arc-gold">
                      {tweet.text}
                    </p>
                    <p className="text-[10px] font-medium text-arc-text-dim">
                      ❤ {tweet.likes} · ↻ {tweet.retweets}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-arc-gold/20 bg-arc-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-arc-gold" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-gold/80">Insight</p>
            </div>
            {activePattern && (
              <button
                onClick={() => dismissPattern(activePattern)}
                className="rounded-lg p-1 text-arc-text-dim transition-colors hover:bg-arc-border/30 hover:text-arc-text"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {patternLoading ? (
            <div className="h-10 animate-pulse rounded-xl bg-arc-border/70" />
          ) : activePattern ? (
            <div className="space-y-3">
              <p className="text-sm font-medium leading-relaxed text-arc-text">
                {activePattern.suggestion}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="h-7 px-3 text-[10px]"
                  onClick={() => handlePatternAction(activePattern)}
                >
                  {activePattern.kind === 'recurring-recipient' && 'Send again'}
                  {activePattern.kind === 'day-of-week' && 'Got it'}
                  {activePattern.kind === 'amount-cluster' && `Send ${formatUsdcAmount(activePattern.amount)} USDC`}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm leading-relaxed text-arc-text-dim">
                {rawTransfers.length < 3 ? 'Building patterns from your activity…' : 'No new patterns detected today.'}
              </p>
              {rawTransfers.length < 3 && (
                <p className="text-[10px] text-arc-text-dim/60">Need at least 3 transactions</p>
              )}
            </div>
          )}
        </div>

        {import.meta.env.DEV && (
          <button
            onClick={() => {
              chrome.runtime.sendMessage({ type: 'CHECK_WHALES_NOW' }, (res) => {
                console.log('[DailyBrief] CHECK_WHALES_NOW response:', res)
              })
            }}
            className="w-full py-1 text-center text-[10px] text-arc-text-dim/40 transition-colors hover:text-arc-text-dim"
          >
            Check whales now (dev)
          </button>
        )}
      </div>
    </div>
  )
}
