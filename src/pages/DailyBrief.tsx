import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowLeft, ArrowUpRight, BadgeCheck, Bell, Eye, Hash, MessageCircle, RefreshCw, Rss, Send, Sparkles, TrendingDown, TrendingUp, Twitter, Users, Wallet, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { ErrorState } from '@/components/ErrorState'
import {
  BLOCKSCOUT_API_BASE,
  BRIEF_STATS_CACHE_TTL_MS,
  BRIEF_TRANSFER_CACHE_TTL_MS,
  BRIEF_WHALE_CACHE_TTL_MS,
  USDC_CONTRACT,
  TWITTER_FEED_CACHE_TTL_MS,
  TWITTER_FEED_PACE_DELAY_MS,
} from '@/lib/constants'
import { debugLog, debugWarn } from '@/lib/debug'
import { formatAddress, formatBalance, formatRelativeTime, openSafeUrl } from '@/lib/utils'
import { detectPatterns, getPatternKey, type Pattern, type DismissedPattern } from '@/lib/patterns'
import {
  DISMISSED_PATTERNS_KEY,
  PENDING_SEND_STORAGE_KEY,
  NEWS_FEEDS_STORAGE_KEY,
  TWITTERAPI_KEY,
  TWITTER_OFFICIAL_ACCOUNTS,
  TWITTER_OFFICIAL_TWEETS_CACHE_KEY,
  TWITTER_SEARCH_QUERY,
  TWITTER_TWEETS_CACHE_KEY,
} from '@/lib/storageKeys'
import { Button } from '@/components/ui/Button'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { ARC_DISCORD_INVITE_URL, fetchArcDiscord, type ArcDiscordResult } from '@/lib/arcDiscord'
import { fetchArcCommunity, type ArcCommunityItem } from '@/lib/arcCommunity'
import { gatewayBatchTip, gatewayWithdraw } from '@/lib/gatewayMetamask'
import { logAutoTipError, logAutoTipStart } from '@/lib/agentBackend'
import {
  isAutonomousTipRoute,
  resolveTipRoute,
  sendRoutedAutonomousTip,
  type AutonomousTipSource,
  type TipRoute,
} from '@/lib/tipRouting'
import { generateTipSuggestions, type TipAdvisorResult, type TipSuggestion } from '@/lib/tipAdvisor'
import { buildDailyBriefing, type DailyBriefingResult } from '@/lib/dailyBriefing'
import { buildPortfolioIntel, type PortfolioIntelResult, type PortfolioIntelRecipient } from '@/lib/portfolioIntel'
import { formatTipBudgetAmount, recordTip } from '@/lib/tipBudget'
import {
  categorizeTweets,
  fetchArcTweetFeed,
  fetchOfficialTweetFeed,
  type TwitterTweet,
} from '@/lib/twitterApi'
import {
  fetchNews,
  getNewsPulseState,
  summarizeNews,
  type NewsFetchStatus,
  type NewsItem,
  type NewsSummaryMode,
} from '@/lib/newsPulse'
import {
  completeReminder,
  deleteReminder,
  generateTaskSuggestions,
  getReminderDueLabel,
  getReminderStatusLabel,
  getPlannerStorageKey,
  listReminders,
  type PlannerReminder,
  type TaskSuggestion,
} from '@/lib/planner'
import { getExternalErrorMessage } from '@/lib/externalErrors'
import { formatText, getLocaleSync, t } from '@/lib/i18n'
import { shortenTxHash } from '@/lib/utils'
import { PairingApiError } from '@/lib/pairing'
import { UserAgentErrorActions } from '@/components/UserAgentErrorActions'

// --- constants ---------------------------------------------------------------
const USDC_DECIMALS = 6
const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// --- types -------------------------------------------------------------------
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

type TipAdvisorExecutionState = {
  status: 'sending' | 'sent' | 'failed'
  txHash?: string
  explorerUrl?: string
  error?: string
  autonomous?: boolean
  autonomousSource?: AutonomousTipSource
  userAgentError?: PairingApiError
}

// --- localStorage cache -------------------------------------------------------
function readCache<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data?: T; ts?: number; ttl?: number } | null
    if (!parsed || typeof parsed !== 'object') {
      localStorage.removeItem(key)
      return null
    }
    if (typeof parsed.ts !== 'number' || typeof parsed.ttl !== 'number') {
      localStorage.removeItem(key)
      return null
    }
    if (Date.now() - parsed.ts > parsed.ttl) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.data ?? null
  } catch {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
    } catch {}
    return null
  }
}

function writeCache<T>(key: string, data: T, ttl: number, ts = Date.now()): void {
  try { localStorage.setItem(key, JSON.stringify({ data, ts, ttl })) } catch {}
}

// --- helpers -----------------------------------------------------------------
function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatUsdcAmount(amount: string): string {
  return amount.replace(/\.?0+$/, '')
}

function formatPortfolioAmount(amount: string | null, locale: 'en' | 'tr'): string {
  if (!amount) return '—'

  const parsed = Number(amount)
  if (!Number.isFinite(parsed)) return amount

  try {
    return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
      maximumFractionDigits: 6,
    }).format(parsed)
  } catch {
    return amount
  }
}

function formatPortfolioRecipient(recipient: PortfolioIntelRecipient): string {
  if (recipient.handle) return `@${recipient.handle}`
  if (recipient.address) return formatAddress(recipient.address, 4)
  return t('common.unknown')
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

// --- API helpers -------------------------------------------------------------
type TweetBadge = {
  label: string
  className: string
}

const TWEET_CATEGORY_BADGES: Record<NonNullable<TwitterTweet['category']>, TweetBadge> = {
  news: {
    label: 'News',
    className: 'border-arc-border bg-arc-card text-arc-text-dim',
  },
  opportunity: {
    label: 'Opportunity',
    className: 'border-white/25 bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]',
  },
  discussion: {
    label: 'Discussion',
    className: 'border-arc-border/70 bg-arc-border/20 text-arc-text-dim',
  },
}

const OFFICIAL_TWEET_BADGE_CLASS = 'border-white/25 bg-white/10 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)]'

function TweetBadgePill({ badge }: { badge: TweetBadge }) {
  return (
    <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${badge.className}`}>
      {badge.label}
    </span>
  )
}

function getArcCommunityBadge(type: ArcCommunityItem['type']): TweetBadge {
  switch (type) {
    case 'Blog':
      return {
        label: t('dailyBrief.arcCommunityBlog'),
        className: 'border-arc-border bg-arc-card text-arc-text-dim',
      }
    case 'External':
      return {
        label: t('dailyBrief.arcCommunityExternal'),
        className: 'border-arc-border/70 bg-arc-border/20 text-arc-text-dim',
      }
    case 'Video':
      return {
        label: t('dailyBrief.arcCommunityVideo'),
        className: OFFICIAL_TWEET_BADGE_CLASS,
      }
    case 'Announcement':
    default:
      return {
        label: t('dailyBrief.arcCommunityAnnouncement'),
        className: 'border-white/25 bg-white/10 text-white',
      }
  }
}

function TweetListItem({
  tweet,
  badge,
  onClick,
}: {
  tweet: TwitterTweet
  badge?: TweetBadge | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="group flex w-full cursor-pointer gap-3 text-left"
      onClick={onClick}
    >
      <TweetAvatar tweet={tweet} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] font-semibold text-arc-text">{tweet.authorName}</span>
          {tweet.verified && <BadgeCheck size={11} className="shrink-0 text-arc-success" />}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-arc-text-dim">
          <span className="truncate">@{tweet.authorHandle}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{tweet.createdAt ? formatRelativeTime(tweet.createdAt) : t('dailyBrief.unknownTime')}</span>
        </div>
        {badge && (
          <div className="mt-0.5 flex items-center">
            <TweetBadgePill badge={badge} />
          </div>
        )}
        <p className="line-clamp-2 text-xs leading-snug text-arc-text transition-colors group-hover:text-white">
          {tweet.text}
        </p>
        <p className="text-[10px] font-medium text-arc-text-dim">
          ♥ {tweet.likes} · ↻ {tweet.retweets}
        </p>
      </div>
    </button>
  )
}

function getSummaryTimeLabel(): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('dailyBrief.summaryPrefixMorning')
  if (hour < 18) return t('dailyBrief.summaryPrefixAfternoon')
  return t('dailyBrief.summaryPrefixEvening')
}

function formatFeedRefreshLabel(fetchedAt: number): string {
  return formatText('dailyBrief.lastUpdated', {
    age: formatRelativeTime(new Date(fetchedAt).toISOString()),
  })
}

function formatLocalizedCount(value: number): string {
  return new Intl.NumberFormat(getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US').format(value)
}

async function fetchRawTransfers(address: string): Promise<RawTransfer[]> {
  const url = `${BLOCKSCOUT_API_BASE}/addresses/${address.toLowerCase()}/token-transfers?type=ERC-20`
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as { items?: RawTransfer[] }
  return (data.items ?? []).filter(isUsdcTransfer)
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
  const res = await fetchWithTimeout(`${BLOCKSCOUT_API_BASE}/stats`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const d = await res.json() as {
    average_block_time?: number
    total_transactions?: string
    total_addresses?:    string
  }
  return {
    blockTime:      d.average_block_time != null ? `${Math.round(d.average_block_time)}ms` : '-',
    totalTx:        d.total_transactions ? formatCompact(parseInt(d.total_transactions, 10)) : '-',
    totalAddresses: d.total_addresses    ? formatCompact(parseInt(d.total_addresses, 10))    : '-',
  }
}

type CachedWhaleTx = { amount: string; direction: 'in' | 'out'; timestamp: string; hasRecent: boolean }

async function fetchWhaleLastTx(whaleAddr: string, label: string): Promise<WhaleEntry | null> {
  const cacheKey = `arccopilot:whale:last:${whaleAddr.toLowerCase()}`
  const cached   = readCache<CachedWhaleTx>(cacheKey)
  if (cached) return { address: whaleAddr, label, ...cached }

  const url = `${BLOCKSCOUT_API_BASE}/addresses/${whaleAddr.toLowerCase()}/token-transfers?type=ERC-20`
  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data  = await res.json() as { items?: RawTransfer[] }
  const items = (data.items ?? []).filter(isUsdcTransfer)
  if (!items.length) return null

  const latest  = items[0]
  const wNorm   = whaleAddr.toLowerCase()
  const direction: 'in' | 'out' = latest.to.hash.toLowerCase() === wNorm ? 'in' : 'out'
  const amount   = formatBalance(BigInt(latest.total?.value ?? '0'), USDC_DECIMALS)
  const hasRecent = Date.now() - new Date(latest.timestamp).getTime() < 24 * 60 * 60 * 1000

  const txData: CachedWhaleTx = { amount, direction, timestamp: latest.timestamp, hasRecent }
  writeCache(cacheKey, txData, BRIEF_WHALE_CACHE_TTL_MS)
  return { address: whaleAddr, label, ...txData }
}

// --- component ---------------------------------------------------------------
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
  const { balance, isLoading: balanceLoading } = useUSDCBalance()
  const recentActivityRef = useRef<HTMLDivElement | null>(null)
  const briefingRefreshNonceRef = useRef(0)

  // Whale addresses (tag === 'whale')
  const trackedWhales = useMemo(
    () => Object.values(addressMemories).filter(m => m.tag === 'whale'),
    [addressMemories],
  )
  const whales = useMemo(
    () => trackedWhales.slice(0, 3),
    [trackedWhales],
  )

  // -- state -
  const [balanceChange,  setBalanceChange]  = useState<string | null>(null)
  const [changeLoading,  setChangeLoading]  = useState(true)
  const [activity,       setActivity]       = useState<ActivityEntry[] | null>(null)
  const [activityLoading,setActivityLoading]= useState(true)
  const [stats,          setStats]          = useState<EcosystemStats | null>(null)
  const [statsLoading,   setStatsLoading]   = useState(true)
  const [statsError,     setStatsError]     = useState<string | null>(null)
  const [whaleEntries,   setWhaleEntries]   = useState<WhaleEntry[]>([])
  const [whaleLoading,   setWhaleLoading]   = useState(false)
  const [whaleReady,     setWhaleReady]     = useState(false)
  const [whaleError,     setWhaleError]     = useState<string | null>(null)
  const [plannerReminders, setPlannerReminders] = useState<PlannerReminder[]>([])
  const [plannerRemindersLoading, setPlannerRemindersLoading] = useState(true)
  const [plannerSuggestions, setPlannerSuggestions] = useState<TaskSuggestion[]>([])
  const [plannerSuggestionsLoading, setPlannerSuggestionsLoading] = useState(true)
  const [transferError,  setTransferError]  = useState<string | null>(null)
  const [officialTweetsError, setOfficialTweetsError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [tipAdvisor, setTipAdvisor] = useState<TipAdvisorResult | null>(null)
  const [tipAdvisorLoading, setTipAdvisorLoading] = useState(true)
  const [tipAdvisorError, setTipAdvisorError] = useState<string | null>(null)
  const [tipAdvisorExecution, setTipAdvisorExecution] = useState<Record<string, TipAdvisorExecutionState>>({})
  const [tipAdvisorBatchLoading, setTipAdvisorBatchLoading] = useState(false)
  const [tipAdvisorBatchMessage, setTipAdvisorBatchMessage] = useState<string | null>(null)

  // -- Twitter State --
  const [tweets,         setTweets]         = useState<TwitterTweet[]>([])
  const [tweetsLoading,  setTweetsLoading]  = useState(true)
  const [tweetsError,    setTweetsError]    = useState<string | null>(null)
  const [tweetsStaleAt,  setTweetsStaleAt]  = useState<number | null>(null)
  const [officialTweets, setOfficialTweets] = useState<TwitterTweet[]>([])
  const [officialTweetsStaleAt, setOfficialTweetsStaleAt] = useState<number | null>(null)
  const [arcCommunityItems, setArcCommunityItems] = useState<ArcCommunityItem[]>([])
  const [arcCommunityLoading, setArcCommunityLoading] = useState(true)
  const [arcCommunityError, setArcCommunityError] = useState<string | null>(null)
  const [arcCommunityStaleAt, setArcCommunityStaleAt] = useState<number | null>(null)
  const [arcDiscord, setArcDiscord] = useState<ArcDiscordResult | null>(null)
  const [arcDiscordLoading, setArcDiscordLoading] = useState(true)
  const [arcDiscordError, setArcDiscordError] = useState<string | null>(null)
  const [smartBriefing, setSmartBriefing] = useState<DailyBriefingResult | null>(null)
  const [smartBriefingLoading, setSmartBriefingLoading] = useState(true)
  const [smartBriefingError, setSmartBriefingError] = useState<string | null>(null)
  const [smartBriefingRefreshNonce, setSmartBriefingRefreshNonce] = useState(0)
  const [portfolioIntel, setPortfolioIntel] = useState<PortfolioIntelResult | null>(null)
  const [portfolioIntelLoading, setPortfolioIntelLoading] = useState(true)
  const [portfolioIntelError, setPortfolioIntelError] = useState<string | null>(null)
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [newsBrief, setNewsBrief] = useState('')
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState<string | null>(null)
  const [newsFetchedAt, setNewsFetchedAt] = useState<number | null>(null)
  const [newsFetchStatus, setNewsFetchStatus] = useState<NewsFetchStatus>('idle')
  const [newsSummaryMode, setNewsSummaryMode] = useState<NewsSummaryMode>('idle')

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
      if (chrome.runtime.lastError) { /* ignore - popup may have opened before SW ready */ }
    })
  }, [])

  // -- header -
  const displayName = profile?.displayName?.trim() || 'GoGo'
  const now         = new Date()
  const hour        = now.getHours()
  const locale      = getLocaleSync()
  const greeting    = hour < 12
    ? (locale === 'tr' ? 'Günaydın' : 'Good morning')
    : hour < 18
      ? (locale === 'tr' ? 'Tünaydın' : 'Good afternoon')
      : (locale === 'tr' ? 'İyi akşamlar' : 'Good evening')
  const dateStr     = now.toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // -- effect: transfers -----------------------------------------------------
  useEffect(() => {
    if (!address) {
      setChangeLoading(false)
      setActivityLoading(false)
      setPatternLoading(false)
      setTransferError(null)
      return
    }
    const cacheKey = `arccopilot:brief:transfers:${address.toLowerCase()}`
    const cached   = readCache<RawTransfer[]>(cacheKey)

    const process = (items: RawTransfer[]) => {
      setRawTransfers(items)
      setBalanceChange(deriveBalanceChange(items, address))
      setActivity(deriveActivity(items, address))
      setTransferError(null)
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
        writeCache(cacheKey, items, BRIEF_TRANSFER_CACHE_TTL_MS)
        process(items)
      })
      .catch((error) => {
        debugWarn('[DailyBrief] transfers load failed:', error)
        setRawTransfers([])
        setBalanceChange(null)
        setActivity([])
        setTransferError(getExternalErrorMessage(error, 'activity.couldNotLoad'))
        setChangeLoading(false)
        setActivityLoading(false)
        setPatternLoading(false)
      })
  }, [address, refreshNonce])

  // -- effect: dismissed patterns ------------------------------------------
  useEffect(() => {
    let active = true

    void chromeStorageGet(DISMISSED_PATTERNS_KEY).then((res) => {
      const hasStoredDismissals = Object.prototype.hasOwnProperty.call(res, DISMISSED_PATTERNS_KEY)
      if (!active) return
      const raw = res[DISMISSED_PATTERNS_KEY]
      if (!Array.isArray(raw)) {
        setDismissed([])
        if (hasStoredDismissals) {
          void chromeStorageRemove(DISMISSED_PATTERNS_KEY)
        }
        return
      }

      const next = raw.filter((item): item is DismissedPattern => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as DismissedPattern).kind === 'string'
        && typeof (item as DismissedPattern).key === 'string'
        && typeof (item as DismissedPattern).dismissedAt === 'number'
      ))

      if (next.length !== raw.length) {
        void chromeStorageSet({ [DISMISSED_PATTERNS_KEY]: next })
      }

      setDismissed(next)
    })

    return () => {
      active = false
    }
  }, [])

  const dismissPattern = (p: Pattern) => {
    const key = getPatternKey(p)
    const newEntry: DismissedPattern = { kind: p.kind, key, dismissedAt: Date.now() }
    const next = [...dismissed, newEntry]
    setDismissed(next)
    void chromeStorageSet({ [DISMISSED_PATTERNS_KEY]: next })
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

    void chromeStorageSet({ [PENDING_SEND_STORAGE_KEY]: pending }).finally(() => {
      setCurrentView('send')
    })
  }

  // -- effect: stats ---------------------------------------------------------
  useEffect(() => {
    const cacheKey = 'arccopilot:brief:stats'
    const cached   = readCache<EcosystemStats>(cacheKey)
    if (cached) {
      setStats(cached)
      setStatsError(null)
      setStatsLoading(false)
      return
    }
    fetchStats()
      .then((s) => {
        if (s) {
          writeCache(cacheKey, s, BRIEF_STATS_CACHE_TTL_MS)
          setStats(s)
          setStatsError(null)
        }
      })
      .catch((error) => {
        debugWarn('[DailyBrief] stats load failed:', error)
        setStats(null)
        setStatsError(getExternalErrorMessage(error, 'discover.couldNotLoadStats'))
      })
      .finally(() => setStatsLoading(false))
  }, [refreshNonce])

  // -- effect: whale movements -----------------------------------------------
  useEffect(() => {
    setWhaleReady(false)
    setWhaleError(null)
    if (whales.length === 0) {
      setWhaleEntries([])
      setWhaleReady(true)
      return
    }
    setWhaleLoading(true)
    Promise.allSettled(
      whales.map((w) => fetchWhaleLastTx(w.address, w.label ?? formatAddress(w.address, 4))),
    )
      .then((results) => {
        const entries = results
          .filter((result): result is PromiseFulfilledResult<WhaleEntry | null> => result.status === 'fulfilled')
          .map((result) => result.value)
          .filter((item): item is WhaleEntry => Boolean(item))

        setWhaleEntries(entries)

        if (results.some((result) => result.status === 'rejected') && entries.length === 0) {
          setWhaleError(t('activity.couldNotLoad'))
        } else {
          setWhaleError(null)
        }
      })
      .catch((error) => {
        debugWarn('[DailyBrief] whale load failed:', error)
        setWhaleEntries([])
        setWhaleError(getExternalErrorMessage(error, 'activity.couldNotLoad'))
      })
      .finally(() => {
        setWhaleLoading(false)
        setWhaleReady(true)
      })
  }, [whales, refreshNonce])

  useEffect(() => {
    let cancelled = false

    const loadPlannerReminders = async () => {
      setPlannerRemindersLoading(true)

      try {
        const items = await listReminders()
        if (!cancelled) {
          setPlannerReminders(items)
        }
      } catch (error) {
        debugWarn('[DailyBrief] planner reminder load failed:', error)
        if (!cancelled) {
          setPlannerReminders([])
        }
      } finally {
        if (!cancelled) {
          setPlannerRemindersLoading(false)
        }
      }
    }

    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[getPlannerStorageKey()]) {
        void loadPlannerReminders()
      }
    }

    void loadPlannerReminders()
    chrome.storage.onChanged.addListener(onStorageChanged)

    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadPlannerSuggestions = async () => {
      setPlannerSuggestionsLoading(true)

      if (tipAdvisorLoading || portfolioIntelLoading || newsLoading) {
        return
      }

      try {
        const items = await generateTaskSuggestions({
          tipAdvisor,
          portfolioIntel,
          newsItems,
          newsFetchedAt,
        })

        if (!cancelled) {
          setPlannerSuggestions(items)
        }
      } catch (error) {
        debugWarn('[DailyBrief] planner suggestions load failed:', error)
        if (!cancelled) {
          setPlannerSuggestions([])
        }
      } finally {
        if (!cancelled) {
          setPlannerSuggestionsLoading(false)
        }
      }
    }

    void loadPlannerSuggestions()

    return () => {
      cancelled = true
    }
  }, [tipAdvisor, tipAdvisorLoading, portfolioIntel, portfolioIntelLoading, newsItems, newsFetchedAt, newsLoading])

  // -- effect: twitter feed --------------------------------------------------
  useEffect(() => {
    let cancelled = false
    let requestVersion = 0

    const loadOfficialTweets = async (currentVersion: number): Promise<void> => {
      const cached = readCache<TwitterTweet[]>(TWITTER_OFFICIAL_TWEETS_CACHE_KEY)
      if (cached) {
        if (cancelled || currentVersion !== requestVersion) return
        setOfficialTweets(cached.slice(0, 3))
        setOfficialTweetsStaleAt(null)
        setOfficialTweetsError(null)
        return
      }

      try {
        const fetched = await fetchOfficialTweetFeed()
        if (cancelled || currentVersion !== requestVersion) return
        if (!fetched) {
          setOfficialTweets([])
          setOfficialTweetsStaleAt(null)
          setOfficialTweetsError(t('activity.couldNotLoad'))
          return
        }

        writeCache(TWITTER_OFFICIAL_TWEETS_CACHE_KEY, fetched.tweets, TWITTER_FEED_CACHE_TTL_MS, fetched.fetchedAt)
        setOfficialTweets(fetched.tweets.slice(0, 3))
        setOfficialTweetsStaleAt(fetched.cacheStatus === 'stale-cache' ? fetched.fetchedAt : null)
        setOfficialTweetsError(null)
      } catch (error) {
        if (cancelled || currentVersion !== requestVersion) return
        debugWarn('[DailyBrief] official tweets load failed:', error)
        setOfficialTweets([])
        setOfficialTweetsStaleAt(null)
        setOfficialTweetsError(getExternalErrorMessage(error, 'activity.couldNotLoad'))
      }
    }

    const loadCommunityTweets = async (currentVersion: number): Promise<void> => {
      const cached = readCache<TwitterTweet[]>(TWITTER_TWEETS_CACHE_KEY)
      if (cached) {
        const hasCategorizedTweets = cached.every((tweet) => Boolean(tweet.category))
        const items = hasCategorizedTweets ? cached : await categorizeTweets(cached)
        if (cancelled || currentVersion !== requestVersion) return
        if (!hasCategorizedTweets && items.some((tweet) => Boolean(tweet.category))) {
          writeCache(TWITTER_TWEETS_CACHE_KEY, items, TWITTER_FEED_CACHE_TTL_MS, Date.now())
        }
        setTweets(items)
        setTweetsStaleAt(null)
        return
      }

      try {
        const fetched = await fetchArcTweetFeed()
        const items = await categorizeTweets(fetched.tweets)
        if (cancelled || currentVersion !== requestVersion) return
        writeCache(TWITTER_TWEETS_CACHE_KEY, items, TWITTER_FEED_CACHE_TTL_MS, fetched.fetchedAt)
        setTweets(items)
        setTweetsStaleAt(fetched.cacheStatus === 'stale-cache' ? fetched.fetchedAt : null)
      } catch (err) {
        if (cancelled || currentVersion !== requestVersion) return
        setTweetsError(err instanceof Error ? err.message : 'Tweets unavailable right now. Try refreshing in a few minutes.')
        setTweets([])
        setTweetsStaleAt(null)
      }
    }

    const loadTweets = async () => {
      const currentVersion = ++requestVersion
      setTweetsLoading(true)
      setTweetsError(null)
      setOfficialTweetsError(null)
      setTweets([])
      setTweetsStaleAt(null)
      setOfficialTweets([])
      setOfficialTweetsStaleAt(null)

      try {
        await loadOfficialTweets(currentVersion)
        if (cancelled || currentVersion !== requestVersion) return
        await new Promise<void>((resolve) => setTimeout(resolve, TWITTER_FEED_PACE_DELAY_MS))
        if (cancelled || currentVersion !== requestVersion) return
        await loadCommunityTweets(currentVersion)
      } finally {
        if (!cancelled && currentVersion === requestVersion) {
          setTweetsLoading(false)
        }
      }
    }

    const onStorageChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== 'local') return
      if (changes[TWITTER_SEARCH_QUERY] || changes[TWITTER_OFFICIAL_ACCOUNTS] || changes[TWITTERAPI_KEY]) {
        void loadTweets()
      }
    }

    void loadTweets()
    chrome.storage.onChanged.addListener(onStorageChanged)

    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [refreshNonce])

  // -- effect: Arc community feed -------------------------------------------
  useEffect(() => {
    let cancelled = false

    const loadArcCommunity = async () => {
      setArcCommunityLoading(true)
      setArcCommunityError(null)
      setArcCommunityItems([])
      setArcCommunityStaleAt(null)

      try {
        const fetched = await fetchArcCommunity()
        if (cancelled) return

        setArcCommunityItems(fetched.items.slice(0, 6))
        setArcCommunityStaleAt(fetched.cacheStatus === 'stale-cache' ? fetched.fetchedAt : null)
        setArcCommunityError(fetched.error ?? null)
      } catch (error) {
        if (cancelled) return
        debugWarn('[DailyBrief] arc community load failed:', error)
        setArcCommunityItems([])
        setArcCommunityStaleAt(null)
        setArcCommunityError(getExternalErrorMessage(error, 'dailyBrief.arcCommunityCouldNotLoad'))
      } finally {
        if (!cancelled) {
          setArcCommunityLoading(false)
        }
      }
    }

    void loadArcCommunity()

    return () => {
      cancelled = true
    }
  }, [refreshNonce])

  // -- effect: Arc Discord counts -------------------------------------------
  useEffect(() => {
    let cancelled = false

    const loadArcDiscord = async () => {
      setArcDiscordLoading(true)
      setArcDiscordError(null)

      try {
        const result = await fetchArcDiscord()
        if (cancelled) return

        setArcDiscord(result)
        const hasDiscordCounts = result.memberCount != null || result.onlineCount != null
        setArcDiscordError(!hasDiscordCounts && result.error ? t('dailyBrief.arcDiscordCouldNotLoad') : null)
      } catch (error) {
        if (cancelled) return
        debugWarn('[DailyBrief] arc discord load failed:', error)
        setArcDiscord({
          memberCount: null,
          onlineCount: null,
          inviteUrl: ARC_DISCORD_INVITE_URL,
          fetchedAt: Date.now(),
          cacheStatus: 'error',
          error: error instanceof Error ? error.message : 'ARC_DISCORD_FETCH_FAILED',
        })
        setArcDiscordError(t('dailyBrief.arcDiscordCouldNotLoad'))
      } finally {
        if (!cancelled) {
          setArcDiscordLoading(false)
        }
      }
    }

    void loadArcDiscord()

    return () => {
      cancelled = true
    }
  }, [refreshNonce])

  // -- effect: ecosystem news pulse ----------------------------------------
  useEffect(() => {
    let cancelled = false

    const loadNewsPulse = async () => {
      setNewsLoading(true)
      setNewsError(null)
      setNewsBrief('')
      setNewsItems([])
      setNewsFetchedAt(null)
      setNewsFetchStatus('idle')
      setNewsSummaryMode('idle')

      try {
        const items = await fetchNews()
        if (cancelled) return

        const fetchState = getNewsPulseState()
        setNewsFetchStatus(fetchState.fetchStatus)
        setNewsFetchedAt(fetchState.fetchedAt)

        if (fetchState.fetchStatus === 'no-feeds' || fetchState.fetchStatus === 'error') {
          setNewsError(fetchState.error ?? t('dailyBrief.newsCouldNotLoad'))
          return
        }

        if (items.length === 0) {
          setNewsError(fetchState.error ?? t('dailyBrief.newsCouldNotLoad'))
          return
        }

        const brief = await summarizeNews(items)
        if (cancelled) return

        const summaryState = getNewsPulseState()
        setNewsItems(items)
        setNewsSummaryMode(summaryState.summaryMode)
        setNewsBrief(summaryState.summaryMode === 'ai' ? brief : '')
      } catch (error) {
        if (cancelled) return
        debugWarn('[DailyBrief] news pulse load failed:', error)
        setNewsFetchStatus('error')
        setNewsError(t('dailyBrief.newsCouldNotLoad'))
      } finally {
        if (!cancelled) {
          setNewsLoading(false)
        }
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[NEWS_FEEDS_STORAGE_KEY]) {
        void loadNewsPulse()
      }
    }

    void loadNewsPulse()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [refreshNonce])

  // -- effect: smart daily briefing -----------------------------------------
  useEffect(() => {
    let cancelled = false

    const loadSmartBriefing = async () => {
      if (balanceLoading || changeLoading || activityLoading || patternLoading || tipAdvisorLoading || newsLoading || statsLoading) {
        setSmartBriefingLoading(true)
        return
      }

      const force = briefingRefreshNonceRef.current !== smartBriefingRefreshNonce

      setSmartBriefingLoading(true)
      setSmartBriefingError(null)

      try {
        const result = await buildDailyBriefing({
          walletAddress: address,
          displayName: profile.displayName?.trim() || null,
          balance,
          balanceChange,
          recentActivityCount: activity?.length ?? 0,
          tipAdvisor,
          newsItems,
          ecosystemStats: stats,
          force,
        })

        if (cancelled) return

        setSmartBriefing(result)
      } catch (error) {
        if (cancelled) return
        debugWarn('[DailyBrief] smart briefing load failed:', error)
        setSmartBriefing(null)
        setSmartBriefingError(t('state.error'))
      } finally {
        if (!cancelled) {
          setSmartBriefingLoading(false)
          briefingRefreshNonceRef.current = smartBriefingRefreshNonce
        }
      }
    }

    void loadSmartBriefing()

    return () => {
      cancelled = true
    }
  }, [
    address,
    activity,
    balance,
    balanceChange,
    balanceLoading,
    changeLoading,
    activityLoading,
    patternLoading,
    newsItems,
    newsLoading,
    profile.displayName,
    refreshNonce,
    smartBriefingRefreshNonce,
    stats,
    statsLoading,
    tipAdvisor,
    tipAdvisorLoading,
  ])

  // -- effect: portfolio intelligence -------------------------------------
  useEffect(() => {
    let cancelled = false

    const loadPortfolioIntel = async () => {
      setPortfolioIntelLoading(true)
      setPortfolioIntelError(null)

      try {
        const result = await buildPortfolioIntel()
        if (cancelled) return

        setPortfolioIntel(result)
      } catch (error) {
        if (cancelled) return
        debugWarn('[DailyBrief] portfolio intel load failed:', error)
        setPortfolioIntel(null)
        setPortfolioIntelError(getExternalErrorMessage(error, 'state.error'))
      } finally {
        if (!cancelled) {
          setPortfolioIntelLoading(false)
        }
      }
    }

    void loadPortfolioIntel()

    return () => {
      cancelled = true
    }
  }, [address, refreshNonce])

  useEffect(() => {
    let cancelled = false

    const loadTipAdvisor = async () => {
      if (!address) {
        setTipAdvisor(null)
        setTipAdvisorError(null)
        setTipAdvisorExecution({})
        setTipAdvisorBatchLoading(false)
        setTipAdvisorBatchMessage(null)
        setTipAdvisorLoading(false)
        return
      }

      setTipAdvisorLoading(true)
      setTipAdvisorError(null)
      setTipAdvisorExecution({})
      setTipAdvisorBatchLoading(false)
      setTipAdvisorBatchMessage(null)

      try {
        const result = await generateTipSuggestions()
        if (cancelled) return
        setTipAdvisor(result)
      } catch (error) {
        if (cancelled) return
        debugWarn('[DailyBrief] tip advisor load failed:', error)
        setTipAdvisor(null)
        setTipAdvisorError(getExternalErrorMessage(error, 'state.error'))
      } finally {
        if (!cancelled) {
          setTipAdvisorLoading(false)
        }
      }
    }

    void loadTipAdvisor()

    return () => {
      cancelled = true
    }
  }, [address, refreshNonce])

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
      return t('dailyBrief.emptyBrief')
    }

    if (transferError || statsError || whaleError || officialTweetsError || tweetsError) {
      return t('activity.couldNotLoad')
    }

    const tweetCount = tweets.length
    const whaleCount = trackedWhales.length
    if (tweetCount === 0 && whaleCount === 0 && !has24hActivity) {
      return t('activity.noActivityYet')
    }

    const activityClause = has24hActivity
      ? (locale === 'tr' ? t('dailyBrief.activityCheckedTr') : t('dailyBrief.activityCheckedEn'))
      : (locale === 'tr' ? t('dailyBrief.noActivityCheckedTr') : t('dailyBrief.noActivityCheckedEn'))

    return formatText(locale === 'tr' ? 'dailyBrief.summaryTr' : 'dailyBrief.summaryEn', {
      timeLabel: getSummaryTimeLabel(),
      tweetCount,
      whaleCount,
      activityClause,
    })
  })()

  const plannerNow = Date.now()
  const plannerDueReminders = plannerReminders.filter((reminder) => {
    if (reminder.done || !reminder.dueAt) return false
    const dueAt = new Date(reminder.dueAt).getTime()
    return Number.isFinite(dueAt) && dueAt <= plannerNow
  })
  const plannerUpcomingReminders = plannerReminders.filter((reminder) => {
    if (reminder.done) return false
    if (!reminder.dueAt) return true
    const dueAt = new Date(reminder.dueAt).getTime()
    return !Number.isFinite(dueAt) || dueAt > plannerNow
  })
  const plannerVisibleReminders = [...plannerDueReminders, ...plannerUpcomingReminders]
  const recommendations: RecommendationItem[] = []
  const safeWhaleEntries = Array.isArray(whaleEntries) ? whaleEntries : []
  const safeOfficialTweets = Array.isArray(officialTweets) ? officialTweets : []
  const safeTweets = Array.isArray(tweets) ? tweets : []
  const safeActivity = Array.isArray(activity) ? activity : []
  const hasOfficialTweets = safeOfficialTweets.length > 0
  const portfolioTopRecipients = portfolioIntel?.topRecipients.slice(0, 3) ?? []
  const portfolioLocale = locale === 'tr' ? 'tr' : 'en'

  const openSendWithPending = (pending: { recipient?: string; amount?: string }) => {
    void chromeStorageSet({
      [PENDING_SEND_STORAGE_KEY]: {
        ...pending,
        ts: Date.now(),
      },
    }).finally(() => {
      setCurrentView('send')
    })
  }

  const handlePlannerComplete = async (id: string) => {
    try {
      const completed = await completeReminder(id)
      if (completed) {
        setPlannerReminders((current) => current.map((reminder) => (
          reminder.id === id ? { ...reminder, done: true } : reminder
        )))
      }
    } catch (error) {
      debugWarn('[DailyBrief] planner reminder complete failed:', error)
    }
  }

  const handlePlannerDelete = async (id: string) => {
    try {
      const deleted = await deleteReminder(id)
      if (deleted) {
        setPlannerReminders((current) => current.filter((reminder) => reminder.id !== id))
      }
    } catch (error) {
      debugWarn('[DailyBrief] planner reminder delete failed:', error)
    }
  }

  const goToWhale = (whale: WhaleEntry) => {
    setSelectedAddress(whale.address)
    setCurrentView('address-detail')
  }

  const scrollToRecentActivity = () => {
    recentActivityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const retryBrief = () => {
    setRefreshNonce((value) => value + 1)
  }

  const refreshSmartBriefing = () => {
    setSmartBriefingRefreshNonce((value) => value + 1)
  }

  const updateTipAdvisorExecution = (handle: string, nextState: TipAdvisorExecutionState) => {
    setTipAdvisorExecution((current) => ({
      ...current,
      [handle]: nextState,
    }))
  }

  const sendAdvisorTip = async (recipient: string, amount: string, route: TipRoute): Promise<{ txHash: string; explorerUrl: string; autonomous: boolean; autonomousSource?: AutonomousTipSource }> => {
    const autonomousMode = isAutonomousTipRoute(route)
    logAutoTipStart('DailyBrief.sendAdvisorTip', autonomousMode, recipient, amount)

    if (isAutonomousTipRoute(route)) {
      const result = await sendRoutedAutonomousTip(route, recipient, amount)
      return {
        txHash: result.txHash,
        explorerUrl: result.arcscanUrl,
        autonomous: true,
        autonomousSource: result.source,
      }
    }

    const gatewayResult = await gatewayWithdraw(recipient, amount, 26)
    return {
      txHash: gatewayResult.mintTxHash,
      explorerUrl: gatewayResult.destinationExplorerUrl,
      autonomous: false,
    }
  }

  const tipAdvisorAnySending = Object.values(tipAdvisorExecution).some((state) => state.status === 'sending')
  const pendingTipSuggestions = tipAdvisor?.suggestions.filter(
    (suggestion) => tipAdvisorExecution[suggestion.handle]?.status !== 'sent',
  ) ?? []

  const handleTipSuggestionSend = async (suggestion: TipSuggestion) => {
    if (!address || tipAdvisorBatchLoading || tipAdvisorAnySending) return

    const normalizedAddress = suggestion.address.trim().toLowerCase()
    if (!normalizedAddress) return

    setTipAdvisorBatchMessage(null)
    updateTipAdvisorExecution(suggestion.handle, { status: 'sending' })

    let tipRoute: TipRoute = 'signed'
    let autonomousEnabled = false

    try {
      tipRoute = await resolveTipRoute({
        intent: 'tip_advisor',
        recipient: normalizedAddress,
        amount: suggestion.amount,
      })
      autonomousEnabled = isAutonomousTipRoute(tipRoute)
      logAutoTipStart('DailyBrief.handleTipSuggestionSend', autonomousEnabled, normalizedAddress, suggestion.amount)
      const transportResult = await sendAdvisorTip(normalizedAddress, suggestion.amount, tipRoute)
      await recordTip(suggestion.handle, suggestion.amount).catch((error) => {
        debugWarn('[DailyBrief] tip budget record failed:', error)
      })

      updateTipAdvisorExecution(suggestion.handle, {
        status: 'sent',
        txHash: transportResult.txHash,
        explorerUrl: transportResult.explorerUrl,
        autonomous: transportResult.autonomous,
        autonomousSource: transportResult.autonomousSource,
      })
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : autonomousEnabled
          ? t('settings.agentBackendUnreachable')
          : t('gogo.couldNotSendViaGateway')
      if (autonomousEnabled) {
        logAutoTipError(message)
      }
      updateTipAdvisorExecution(suggestion.handle, {
        status: 'failed',
        error: message,
        userAgentError: error instanceof PairingApiError ? error : undefined,
      })
    }
  }

  const handleTipAdvisorSendAll = async () => {
    if (!tipAdvisor || tipAdvisorBatchLoading || tipAdvisorAnySending || pendingTipSuggestions.length === 0) return

    setTipAdvisorBatchLoading(true)
    setTipAdvisorBatchMessage(null)

    for (const suggestion of pendingTipSuggestions) {
      updateTipAdvisorExecution(suggestion.handle, { status: 'sending' })
    }

    let tipRoute: TipRoute = 'signed'
    let autonomousEnabled = false

    try {
      tipRoute = await resolveTipRoute({
        intent: 'tip_advisor_batch',
        recipient: pendingTipSuggestions[0]?.address,
        amount: pendingTipSuggestions[0]?.amount,
      })
      autonomousEnabled = isAutonomousTipRoute(tipRoute)
      logAutoTipStart('DailyBrief.handleTipAdvisorSendAll', autonomousEnabled, '', pendingTipSuggestions[0]?.amount ?? '')
      if (autonomousEnabled) {
        let paidCount = 0
        let failedCount = 0
        let totalSentAmount = 0

        for (const suggestion of pendingTipSuggestions) {
          try {
            logAutoTipStart('DailyBrief.handleTipAdvisorSendAll', autonomousEnabled, suggestion.address, suggestion.amount)
            const transportResult = await sendAdvisorTip(suggestion.address, suggestion.amount, tipRoute)
            paidCount += 1
            totalSentAmount += Number(suggestion.amount)

            await recordTip(suggestion.handle, suggestion.amount).catch((error) => {
              debugWarn('[DailyBrief] tip budget record failed:', error)
            })

            updateTipAdvisorExecution(suggestion.handle, {
              status: 'sent',
              txHash: transportResult.txHash,
              explorerUrl: transportResult.explorerUrl,
              autonomous: true,
              autonomousSource: transportResult.autonomousSource,
            })
          } catch (error) {
            failedCount += 1
            const message = error instanceof Error
              ? error.message
              : t('settings.agentBackendUnreachable')
            logAutoTipError(message)
            updateTipAdvisorExecution(suggestion.handle, {
              status: 'failed',
              error: message,
              autonomous: true,
              autonomousSource: isAutonomousTipRoute(tipRoute) ? tipRoute : undefined,
              userAgentError: error instanceof PairingApiError ? error : undefined,
            })
          }
        }

        setTipAdvisorBatchMessage(
          `${formatText(tipRoute === 'paired' ? 'gogo.userAgentBatchTipSuccess' : 'gogo.autonomousBatchTipSuccess', {
            count: paidCount,
            total: formatTipBudgetAmount(totalSentAmount),
          })}${failedCount > 0 ? ` ${t('gogo.gatewayBatchPartialFailureNote')}` : ''}`,
        )
      } else {
        const gatewayResult = await gatewayBatchTip(
          pendingTipSuggestions.map((suggestion) => ({
            handle: suggestion.handle,
            address: suggestion.address,
            amount: suggestion.amount,
          })),
        )

        for (const recipient of gatewayResult.recipients) {
          if (recipient.txHash) {
            await recordTip(recipient.handle, recipient.amount).catch((error) => {
              debugWarn('[DailyBrief] tip budget record failed:', error)
            })
            updateTipAdvisorExecution(recipient.handle, {
              status: 'sent',
              txHash: recipient.txHash,
              explorerUrl: recipient.explorerUrl,
            })
          } else {
            updateTipAdvisorExecution(recipient.handle, {
              status: 'failed',
              error: recipient.error ?? t('gogo.couldNotSendViaGateway'),
            })
          }
        }

        setTipAdvisorBatchMessage(
          `${formatText('gogo.gatewayBatchTipSuccess', {
            count: gatewayResult.paidCount,
            total: gatewayResult.totalSentAmount,
          })}${gatewayResult.failedCount > 0 ? ` ${t('gogo.gatewayBatchPartialFailureNote')}` : ''}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : autonomousEnabled
          ? t('settings.agentBackendUnreachable')
          : t('gogo.couldNotSendViaGateway')
      if (autonomousEnabled) {
        logAutoTipError(message)
      }
      for (const suggestion of pendingTipSuggestions) {
        updateTipAdvisorExecution(suggestion.handle, {
          status: 'failed',
          error: message,
          userAgentError: error instanceof PairingApiError ? error : undefined,
        })
      }
      setTipAdvisorBatchMessage(message)
    } finally {
      setTipAdvisorBatchLoading(false)
    }
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
        title: t('dailyBrief.smartSendTitle'),
        body: formatText(locale === 'tr' ? 'dailyBrief.recommendationPatternTr' : 'dailyBrief.recommendationPatternEn', { amount }),
        actionLabel: t('dailyBrief.openSend'),
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
        title: t('dailyBrief.smartSendTitle'),
        body: formatText(locale === 'tr' ? 'dailyBrief.recommendationRecipientTr' : 'dailyBrief.recommendationRecipientEn', {
          recipient: patternRecipient,
          day: dayLabel,
        }),
        actionLabel: t('dailyBrief.openSend'),
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
      title: t('dailyBrief.whaleAlertTitle'),
      body: formatText(locale === 'tr' ? 'dailyBrief.recommendationWhaleTr' : 'dailyBrief.recommendationWhaleEn', {
        label: recentWhale.label,
        amount: recentWhale.amount,
      }),
      actionLabel: t('dailyBrief.view'),
      actionStyle: 'outline',
      onAction: () => goToWhale(recentWhale),
    })
  }

  if (balanceChange && balanceDelta > 5) {
    recommendations.push({
      kind: 'balance',
      title: t('dailyBrief.balanceSwingTitle'),
      body: formatText(locale === 'tr' ? 'dailyBrief.recommendationBalanceTr' : 'dailyBrief.recommendationBalanceEn', {
        change: balanceChange,
      }),
      actionLabel: t('dailyBrief.checkActivity'),
      actionStyle: 'outline',
      onAction: scrollToRecentActivity,
    })
  }

  const arcDiscordMemberLabel = arcDiscord?.memberCount != null
    ? formatText('dailyBrief.arcDiscordMembers', { count: formatLocalizedCount(arcDiscord.memberCount) })
    : null
  const arcDiscordOnlineLabel = arcDiscord?.onlineCount != null
    ? formatText('dailyBrief.arcDiscordOnline', { count: formatLocalizedCount(arcDiscord.onlineCount) })
    : null
  const arcDiscordCountsLabel = [arcDiscordMemberLabel, arcDiscordOnlineLabel].filter(Boolean).join(' · ')
  const arcDiscordDisplayError = arcDiscordError ?? (!arcDiscordLoading && !arcDiscordCountsLabel ? t('dailyBrief.arcDiscordCouldNotLoad') : null)

  const handleArcDiscordJoin = () => {
    if (!openSafeUrl(arcDiscord?.inviteUrl ?? 'https://discord.gg/buildonarc')) {
      debugWarn('[DailyBrief] blocked unsafe discord invite url:', arcDiscord?.inviteUrl ?? 'https://discord.gg/buildonarc')
    }
  }

  const handleArcDiscordChannelOpen = (url: string) => {
    if (!openSafeUrl(url)) {
      debugWarn('[DailyBrief] blocked unsafe discord channel url:', url)
    }
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
        <div className="overflow-hidden rounded-2xl border border-arc-accent/25 bg-gradient-to-br from-arc-accent/10 via-arc-card to-arc-card p-4 shadow-lg shadow-arc-accent/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-arc-accent" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-arc-accent/85">
                  {t('dailyBrief.briefingTitle')}
                </p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
                {t('dailyBrief.briefingSubtitle')}
              </p>
              {smartBriefing?.mode === 'fallback' && (
                <p className="mt-2 text-[10px] uppercase tracking-widest text-arc-text-dim">
                  {t('dailyBrief.briefingFallbackLabel')}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {smartBriefing?.fetchedAt ? (
                <span className="text-[10px] text-arc-text-dim">
                  {formatFeedRefreshLabel(smartBriefing.fetchedAt)}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[10px]"
                onClick={refreshSmartBriefing}
                disabled={smartBriefingLoading}
              >
                <RefreshCw size={12} className={smartBriefingLoading ? 'animate-spin' : ''} />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          <div className="mt-4">
            {smartBriefingLoading ? (
              <div className="space-y-2 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                <div className="h-3 w-1/2 animate-pulse rounded bg-arc-border/70" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-arc-border/70" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-arc-border/70" />
              </div>
            ) : smartBriefingError ? (
              <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                <p className="text-sm font-medium text-arc-text">{t('state.error')}</p>
                <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
                  {smartBriefingError}
                </p>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-[10px]"
                    onClick={refreshSmartBriefing}
                  >
                    {t('common.refresh')}
                  </Button>
                </div>
              </div>
            ) : smartBriefing?.text ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-arc-text">
                {smartBriefing.text}
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-arc-text-dim">
                {t('dailyBrief.briefingNoData')}
              </p>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-arc-accent/25 bg-gradient-to-br from-amber-500/10 via-arc-card to-arc-card p-4 shadow-lg shadow-arc-accent/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Wallet size={14} className="text-arc-accent" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-arc-accent/85">
                  {t('portfolio.intelTitle')}
                </p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
                {t('portfolio.intelSubtitle')}
              </p>
              {portfolioIntel?.mode === 'fallback' && (
                <p className="mt-2 text-[10px] uppercase tracking-widest text-arc-text-dim">
                  {t('portfolio.intelFallbackLabel')}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              {portfolioIntel?.fetchedAt ? (
                <span className="text-[10px] text-arc-text-dim">
                  {formatRelativeTime(new Date(portfolioIntel.fetchedAt).toISOString())}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-[10px]"
                onClick={retryBrief}
                disabled={portfolioIntelLoading}
              >
                <RefreshCw size={12} className={portfolioIntelLoading ? 'animate-spin' : ''} />
                {t('common.refresh')}
              </Button>
            </div>
          </div>

          <div className="mt-4">
            {portfolioIntelLoading ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="space-y-1.5 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                      <div className="h-2.5 w-16 animate-pulse rounded bg-arc-border/70" />
                      <div className="h-4 w-24 animate-pulse rounded bg-arc-border/70" />
                      <div className="h-2.5 w-20 animate-pulse rounded bg-arc-border/70" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <div className="h-2.5 w-1/3 animate-pulse rounded bg-arc-border/70" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-arc-border/70" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-arc-border/70" />
                </div>
              </div>
            ) : portfolioIntelError ? (
              <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                <p className="text-sm font-medium text-arc-text">{t('state.error')}</p>
                <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{portfolioIntelError}</p>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-[10px]"
                    onClick={retryBrief}
                  >
                    {t('common.refresh')}
                  </Button>
                </div>
              </div>
            ) : portfolioIntel ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                    <p className="text-[9px] uppercase tracking-widest text-arc-text-dim">
                      {t('portfolio.intelWalletLabel')}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatPortfolioAmount(portfolioIntel.walletUsdc, portfolioLocale)} USDC
                    </p>
                  </div>
                  <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                    <p className="text-[9px] uppercase tracking-widest text-arc-text-dim">
                      {t('portfolio.intelGatewayLabel')}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatPortfolioAmount(portfolioIntel.gatewayAvailable, portfolioLocale)} USDC
                    </p>
                    <p className="mt-1 text-[10px] text-arc-text-dim">
                      {portfolioIntel.gatewayTotal
                        ? formatText('portfolio.intelGatewayTotal', {
                            total: formatPortfolioAmount(portfolioIntel.gatewayTotal, portfolioLocale),
                          })
                        : t('portfolio.intelGatewayUnavailable')}
                    </p>
                  </div>
                  <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                    <p className="text-[9px] uppercase tracking-widest text-arc-text-dim">
                      {t('portfolio.intelSpendableLabel')}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatPortfolioAmount(portfolioIntel.spendableUsdc, portfolioLocale)} USDC
                    </p>
                  </div>
                  <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                    <p className="text-[9px] uppercase tracking-widest text-arc-text-dim">
                      {t('portfolio.intelRecentTipsLabel')}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {formatPortfolioAmount(portfolioIntel.recentTipTotal, portfolioLocale)} USDC
                    </p>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                    {t('portfolio.intelReadLabel')}
                  </p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-arc-text">
                    {portfolioIntel.read}
                  </p>
                </div>

                <div className="space-y-2 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                      {t('portfolio.intelTopRecipientsLabel')}
                    </p>
                    <p className="text-[10px] text-arc-text-dim">
                      {portfolioIntel.available.tipHistory
                        ? portfolioIntel.recentTipTotal
                          ? formatText('portfolio.intelRecentTipTotal', {
                              total: formatPortfolioAmount(portfolioIntel.recentTipTotal, portfolioLocale),
                            })
                          : t('portfolio.intelNoTipHistory')
                        : t('portfolio.intelTipHistoryUnavailable')}
                    </p>
                  </div>

                  {portfolioTopRecipients.length > 0 ? (
                    <div className="space-y-2">
                      {portfolioTopRecipients.map((recipient) => (
                        <div key={`${recipient.handle ?? recipient.address ?? 'unknown'}-${recipient.total ?? '0'}`} className="flex items-center justify-between gap-3 rounded-lg border border-arc-border bg-arc-card px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-arc-text">
                              {formatPortfolioRecipient(recipient)}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">
                              {recipient.address ? formatAddress(recipient.address, 4) : t('common.unknown')}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold text-arc-accent">
                            {formatPortfolioAmount(recipient.total, portfolioLocale)} USDC
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-arc-text-dim">
                      {portfolioIntel.available.tipHistory
                        ? t('portfolio.intelNoTopRecipients')
                        : t('portfolio.intelTipHistoryUnavailable')}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 text-[10px] text-arc-text-dim">
                  <span>
                    {portfolioIntel.available.txHistory
                      ? formatText('portfolio.intelTransfersLabel', {
                          count: portfolioIntel.txCount ?? 0,
                        })
                      : t('portfolio.intelTransfersUnavailable')}
                  </span>
                  <span>
                    {portfolioIntel.mode === 'fallback'
                      ? t('portfolio.intelFallbackShortLabel')
                      : portfolioIntel.mode === 'unavailable'
                        ? t('portfolio.intelNoDataLabel')
                        : ''}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-arc-text-dim">
                {t('portfolio.intelNoData')}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 overflow-hidden rounded-2xl border border-arc-accent/25 bg-gradient-to-br from-arc-accent/10 via-arc-card to-arc-card p-4 shadow-lg shadow-arc-accent/5">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-arc-accent" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-accent/85">{t('planner.title')}</p>
            </div>
          </div>

          <div className="space-y-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                    {t('planner.remindersTitle')}
                  </p>
                  <p className="mt-1 text-[11px] text-arc-text-dim">
                    {formatText('planner.remindersCount', { count: plannerVisibleReminders.length })}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-arc-border/70 bg-arc-bg/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-arc-text-dim">
                  {plannerDueReminders.length}
                </span>
              </div>

              {plannerRemindersLoading && plannerVisibleReminders.length === 0 ? (
                <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-arc-border/70" />
                  <div className="mt-2 h-2 w-3/4 animate-pulse rounded bg-arc-border/70" />
                  <div className="mt-3 h-8 w-32 animate-pulse rounded-xl bg-arc-border/70" />
                </div>
              ) : plannerVisibleReminders.length > 0 ? (
                <div className="space-y-3">
                  {plannerDueReminders.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-widest text-arc-accent/85">
                        {t('planner.dueNow')}
                      </p>
                      {plannerDueReminders.map((reminder) => (
                        <div key={reminder.id} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-accent/20 bg-arc-accent/10 text-arc-accent">
                              <Bell size={14} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="space-y-1">
                                <p className="text-sm leading-relaxed text-arc-text">
                                  {reminder.text}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">
                                  {getReminderStatusLabel(reminder)} - {getReminderDueLabel(reminder)}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  className="h-8 px-3 text-[10px]"
                                  onClick={() => void handlePlannerComplete(reminder.id)}
                                >
                                  {t('planner.complete')}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-3 text-[10px]"
                                  onClick={() => void handlePlannerDelete(reminder.id)}
                                >
                                  {t('planner.delete')}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {plannerUpcomingReminders.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">
                        {t('planner.upcoming')}
                      </p>
                      {plannerUpcomingReminders.map((reminder) => (
                        <div key={reminder.id} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-border/70 bg-arc-elevated text-arc-text-dim">
                              <Bell size={14} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="space-y-1">
                                <p className="text-sm leading-relaxed text-arc-text">
                                  {reminder.text}
                                </p>
                                <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">
                                  {getReminderStatusLabel(reminder)} - {getReminderDueLabel(reminder)}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-3 text-[10px]"
                                  onClick={() => void handlePlannerComplete(reminder.id)}
                                >
                                  {t('planner.complete')}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-3 text-[10px]"
                                  onClick={() => void handlePlannerDelete(reminder.id)}
                                >
                                  {t('planner.delete')}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <p className="text-sm font-medium text-arc-text">{t('planner.noReminders')}</p>
                  <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{t('planner.noRemindersHint')}</p>
                </div>
              )}
            </section>

            <section className="space-y-3 border-t border-arc-border/60 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                    {t('planner.smartSuggestions')}
                  </p>
                  <p className="mt-1 text-[11px] text-arc-text-dim">
                    {formatText('planner.suggestionsCount', { count: plannerSuggestions.length })}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-arc-border/70 bg-arc-bg/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-arc-text-dim">
                  {plannerSuggestions.length}
                </span>
              </div>

              {plannerSuggestionsLoading ? (
                <div className="space-y-2">
                  {[0, 1].map((index) => (
                    <div key={index} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-arc-border/70" />
                      <div className="mt-2 h-2 w-3/4 animate-pulse rounded bg-arc-border/70" />
                      <div className="mt-3 h-2 w-1/3 animate-pulse rounded bg-arc-border/70" />
                    </div>
                  ))}
                </div>
              ) : plannerSuggestions.length > 0 ? (
                <div className="space-y-2">
                  {plannerSuggestions.map((suggestion) => (
                    <div key={suggestion.id} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                      <p className="text-sm font-medium text-arc-text">{suggestion.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{suggestion.reason}</p>
                      <p className="mt-2 text-[10px] uppercase tracking-widest text-arc-accent/85">
                        {suggestion.actionHint}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                  <p className="text-sm font-medium text-arc-text">{t('planner.noSuggestions')}</p>
                  <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{t('planner.noSuggestionsHint')}</p>
                </div>
              )}
            </section>
          </div>

          <div className="space-y-3 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                  {t('dailyBrief.tipAdvisorTitle')}
                </p>
                {tipAdvisor?.summary && (
                  <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
                    {tipAdvisor.summary}
                  </p>
                )}
              </div>
              {pendingTipSuggestions.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-[10px]"
                    onClick={() => void handleTipAdvisorSendAll()}
                    disabled={tipAdvisorBatchLoading || tipAdvisorLoading || tipAdvisorAnySending || pendingTipSuggestions.length === 0}
                  >
                  {tipAdvisorBatchLoading ? t('gogo.working') : t('dailyBrief.tipAdvisorSendAll')}
                </Button>
              )}
            </div>

            {tipAdvisorLoading ? (
              <div className="space-y-2">
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
            ) : tipAdvisorError ? (
              <ErrorState
                title={t('state.error')}
                description={tipAdvisorError}
                actionLabel={t('state.retry')}
                onAction={retryBrief}
              />
            ) : tipAdvisor?.suggestions.length ? (
              <div className="space-y-2">
                {tipAdvisorBatchMessage && (
                  <p className="text-[10px] text-arc-text-dim">
                    {tipAdvisorBatchMessage}
                  </p>
                )}
                {tipAdvisor.suggestions.map((suggestion) => {
                  const execution = tipAdvisorExecution[suggestion.handle]
                  const isSending = execution?.status === 'sending'
                  const isSent = execution?.status === 'sent'
                  const isFailed = execution?.status === 'failed'
                  const executionLabel = isSent
                    ? execution?.autonomous
                      ? execution.autonomousSource === 'paired'
                        ? t('gogo.sentFromYourAgentWallet')
                        : t('gogo.sentAutonomously')
                      : t('common.done')
                    : isFailed
                      ? t('gogo.gatewayBatchFailed')
                      : isSending
                        ? t('gogo.working')
                        : t('dailyBrief.tipAdvisorApprove')
                  const executionTxHash = execution?.txHash ?? ''
                  const executionIsAutonomous = execution?.autonomous === true
                  const executionExplorerLink = isSent && executionTxHash
                    ? executionIsAutonomous
                      ? execution?.explorerUrl ?? `https://arcscan.io/tx/${executionTxHash}`
                      : `${execution?.explorerUrl ?? 'https://arcscan.io'}/tx/${executionTxHash}`
                    : ''

                  return (
                    <div key={suggestion.handle} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${isSent ? 'border-arc-success/30 bg-arc-success/10 text-arc-success' : isFailed ? 'border-arc-danger/30 bg-arc-danger/10 text-arc-danger' : 'border-arc-border bg-arc-card text-white'}`}>
                          {isSent ? <BadgeCheck size={14} /> : <Send size={14} />}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-arc-text">
                                @{suggestion.handle}
                              </p>
                              <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">
                                {suggestion.amount} {t('common.usdc')}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${isSent ? 'border-arc-success/20 bg-arc-success/10 text-arc-success' : isFailed ? 'border-arc-danger/20 bg-arc-danger/10 text-arc-danger' : 'border-arc-border bg-arc-elevated text-arc-text-dim'}`}>
                              {executionLabel}
                            </span>
                          </div>

                          <p className="text-xs leading-relaxed text-arc-text-dim">
                            {suggestion.reason}
                          </p>

                          {isSent && executionTxHash && (
                            <div className="rounded-lg border border-arc-success/20 bg-arc-success/10 px-2.5 py-2">
                              <p className="text-[10px] uppercase tracking-widest text-arc-text-dim">
                                {t('gogo.txHash')}
                              </p>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <p className="font-mono text-[11px] text-arc-text">
                                  {shortenTxHash(executionTxHash)}
                                </p>
                                <a
                                  href={executionExplorerLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-medium text-arc-accent hover:underline"
                                >
                                  {t('gogo.viewOnArcScan')}
                                </a>
                              </div>
                              {executionIsAutonomous && (
                                <p className="mt-2 text-[10px] text-arc-text-dim">
                                  {execution?.autonomousSource === 'paired'
                                    ? t('gogo.sentFromYourAgentWallet')
                                    : t('gogo.sentAutonomously')}
                                </p>
                              )}
                            </div>
                          )}

                          {isFailed && execution?.error && (
                            <p className="text-xs leading-relaxed text-arc-danger">
                              {execution.error}
                            </p>
                          )}
                          <UserAgentErrorActions error={execution?.userAgentError ?? null} />

                          <div className="flex flex-wrap gap-2">
                            {!isSent && (
                              <Button
                                variant="primary"
                                size="sm"
                                className="h-8 px-3 text-[10px]"
                                onClick={() => void handleTipSuggestionSend(suggestion)}
                                disabled={tipAdvisorBatchLoading || isSending}
                              >
                                {isSending ? t('gogo.working') : t('dailyBrief.tipAdvisorApprove')}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-arc-border bg-arc-bg/70 px-3 py-4 text-center">
                <p className="text-sm font-medium text-arc-text">
                  {tipAdvisor?.summary ?? t('dailyBrief.tipAdvisorEmpty')}
                </p>
                <p className="mt-1 text-xs text-arc-text-dim">
                  {tipAdvisor?.explanation ?? t('dailyBrief.tipAdvisorEmpty')}
                </p>
              </div>
            )}
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
              <p className="text-sm font-medium text-arc-text">{t('state.empty')}</p>
              <p className="mt-1 text-xs text-arc-text-dim">{t('dailyBrief.noNewPatterns')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.slice(0, 3).map((item) => {
                const Icon = item.kind === 'pattern' ? Send : item.kind === 'whale' ? Eye : Activity

                return (
                  <div key={`${item.kind}-${item.title}-${item.actionLabel}`} className="rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-border bg-arc-card text-white">
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
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.yourBalance')}</p>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-white">{balance}</span>
            <span className="mb-0.5 text-base text-arc-text-dim">{t('common.usdc')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {changeLoading ? (
              <div className="h-4 w-28 animate-pulse rounded bg-arc-border" />
            ) : balanceChange ? (
              <>
                {isPositive && <TrendingUp size={12} className="text-arc-success" />}
                {isNegative && <TrendingDown size={12} className="text-arc-text-dim" />}
                <span className={`text-xs font-medium ${isPositive ? 'text-arc-success' : 'text-arc-text-dim'}`}>
                  {balanceChange} USDC (last 24h)
                </span>
              </>
            ) : (
              <span className="text-xs text-arc-text-dim">{t('dailyBrief.noActivityIn24h')}</span>
            )}
          </div>
        </div>

        <div ref={recentActivityRef} className="space-y-1 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.recentActivity')}</p>
          {transferError ? (
            <ErrorState
              title={t('activity.couldNotLoad')}
              description={transferError}
              actionLabel={t('state.retry')}
              onAction={retryBrief}
            />
          ) : activityLoading ? (
            <div className="space-y-2">
              {[0, 100, 200].map((d) => (
                <div key={d} className="h-10 animate-pulse rounded-xl bg-arc-border/70" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          ) : safeActivity.length === 0 ? (
            <p className="py-2 text-center text-xs text-arc-text-dim">{t('dailyBrief.noRecentActivity')}</p>
          ) : (
            <div className="space-y-px">
              {safeActivity.map((tx, i) => {
                const mem = getMemory(tx.otherAddress)
                const label = mem?.label ?? formatAddress(tx.otherAddress, 4)
                return (
                  <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-arc-border/30">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tx.direction === 'in' ? 'bg-arc-success/15 text-arc-success' : 'border border-arc-border bg-arc-card text-arc-text-dim'}`}>
                      {tx.direction === 'in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-arc-text">
                        {tx.direction === 'in' ? 'Received from' : 'Sent to'} {label}
                      </p>
                      <p className="text-[10px] text-arc-text-dim">{formatRelativeTime(tx.timestamp)}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${tx.direction === 'in' ? 'text-arc-success' : 'text-arc-text-dim'}`}>
                      {tx.direction === 'in' ? '+' : '-'}{tx.amount} USDC
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.arcEcosystem')}</p>
          {statsError ? (
            <ErrorState
              title={t('discover.couldNotLoadStats')}
              description={statsError}
              actionLabel={t('state.retry')}
              onAction={retryBrief}
            />
          ) : statsLoading ? (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="space-y-1.5 rounded-xl border border-arc-border bg-arc-bg p-2">
                  <div className="h-2.5 w-16 animate-pulse rounded bg-arc-border/70" />
                  <div className="h-4 animate-pulse rounded bg-arc-border/70" />
                </div>
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: t('dailyBrief.blockTime'), value: stats.blockTime },
                { label: t('dailyBrief.totalTx'), value: stats.totalTx },
                { label: t('dailyBrief.wallets'), value: stats.totalAddresses },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-1.5 rounded-xl border border-arc-border bg-arc-bg p-2">
                  <p className="text-[9px] text-arc-text-dim">{label}</p>
                  <p className="text-sm font-bold text-arc-text">{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-arc-border bg-arc-bg/70 px-3 py-4 text-center">
              <Activity size={16} className="text-white" />
              <p className="text-sm font-medium text-arc-text">{t('activity.noActivityYet')}</p>
              <p className="text-xs leading-relaxed text-arc-text-dim">{t('dailyBrief.noEcosystemStats')}</p>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Rss size={14} className="text-arc-accent" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                {t('dailyBrief.ecosystemPulse')}
              </p>
            </div>
            {newsFetchedAt && (
              <p className="text-[10px] text-arc-text-dim/80">
                {formatFeedRefreshLabel(newsFetchedAt)}
              </p>
            )}
          </div>

          {newsLoading ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-xl bg-arc-border/70" />
              <div className="space-y-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-14 animate-pulse rounded-xl bg-arc-border/70" />
                ))}
              </div>
            </div>
          ) : newsFetchStatus === 'no-feeds' ? (
            <div className="rounded-xl border border-arc-border bg-arc-bg/70 p-3">
              <p className="text-sm font-medium text-arc-text">{t('settings.newsFeedsTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
                {newsError ?? t('dailyBrief.newsNoFeedsConfigured')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 h-8 px-3 text-[10px]"
                onClick={() => setCurrentView('settings')}
              >
                {t('nav.settings')}
              </Button>
            </div>
          ) : newsFetchStatus === 'error' ? (
            <ErrorState
              title={t('dailyBrief.newsCouldNotLoad')}
              description={newsError ?? t('dailyBrief.newsCouldNotLoadHint')}
              actionLabel={t('state.retry')}
              onAction={retryBrief}
            />
          ) : newsItems.length > 0 ? (
            <div className="space-y-3">
              {newsSummaryMode === 'ai' ? (
                <div className="rounded-xl border border-arc-border bg-arc-bg/70 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                    {t('dailyBrief.newsSummaryLabel')}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-arc-text">
                    {newsBrief}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-arc-border bg-arc-bg/70 p-3">
                  <p className="text-xs leading-relaxed text-arc-text-dim">
                    {t('dailyBrief.newsFallbackLabel')}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                  {t('dailyBrief.newsTopHeadlines')}
                </p>
                <div className="space-y-2">
                  {newsItems.slice(0, 3).map((item) => (
                    <a
                      key={item.link}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex gap-3 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3 transition-colors hover:border-arc-borderEmphasis hover:bg-arc-elevated"
                    >
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-border bg-arc-card text-arc-accent transition-colors group-hover:text-white">
                        <ArrowUpRight size={14} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="rounded-sm border border-arc-border bg-arc-card px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-arc-text-dim">
                            {item.source}
                          </span>
                          <span className="text-[10px] text-arc-text-dim">{formatRelativeTime(item.publishedAt)}</span>
                        </div>
                        <p className="line-clamp-2 text-xs leading-snug text-arc-text transition-colors group-hover:text-white">
                          {item.title}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="py-2 text-center text-xs text-arc-text-dim">
              {newsError ?? t('dailyBrief.newsCouldNotLoad')}
            </p>
          )}
        </div>

        <div className={`space-y-3 rounded-2xl border bg-arc-card p-4 ${anyWhaleRecent ? 'border-l-2 border-arc-borderEmphasis' : 'border-arc-border'}`}>
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-white" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.whaleMovements')}</p>
          </div>

          {whaleError ? (
            <ErrorState
              title={t('activity.couldNotLoad')}
              description={whaleError}
              actionLabel={t('state.retry')}
              onAction={retryBrief}
            />
          ) : whaleLoading && (
            <div className="h-10 animate-pulse rounded-xl bg-arc-border/70" />
          )}

          {!whaleError && !whaleLoading && whaleReady && whales.length === 0 && (
            <div className="space-y-2 py-1 text-center">
              <p className="text-xs text-arc-text-dim">{t('dailyBrief.noWhalesTrackedYet')}</p>
              <p className="text-[10px] text-arc-text-dim">{t('dailyBrief.markWhaleInAddressBook')}</p>
              <button
                onClick={() => setCurrentView('address-book')}
                className="text-[10px] font-semibold text-white underline-offset-2 hover:underline"
              >
                {t('dailyBrief.browseAddressBook')}
              </button>
            </div>
          )}

          {!whaleError && !whaleLoading && whaleReady && safeWhaleEntries.length > 0 && (
            <div className="space-y-px">
              {safeWhaleEntries.map((entry, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-arc-border/30 ${entry.hasRecent ? 'bg-white/5' : ''}`}>
                  <Eye size={14} className="shrink-0 text-white" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-arc-text">{entry.label}</p>
                    <p className="text-[10px] text-arc-text-dim">
                      {entry.direction === 'out' ? t('activity.sent') : t('activity.received')} {entry.amount} {t('common.usdc')} · {formatRelativeTime(entry.timestamp)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${entry.direction === 'out' ? 'text-arc-text-dim' : 'text-arc-success'}`}>
                    {entry.amount}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!whaleError && !whaleLoading && whaleReady && whales.length > 0 && whaleEntries.length === 0 && (
            <p className="py-1 text-center text-xs text-arc-text-dim">{t('dailyBrief.noRecentWhaleActivity')}</p>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageCircle size={14} className="text-white" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.arcCommunity')}</p>
            </div>
          </div>

          {arcCommunityError ? (
            <ErrorState
              title={t('dailyBrief.arcCommunityCouldNotLoad')}
              description={arcCommunityError}
              actionLabel={t('state.retry')}
              onAction={retryBrief}
            />
          ) : arcCommunityLoading ? (
            <div className="space-y-2">
              {[0, 110, 220].map((delay) => (
                <div key={delay} className="flex gap-3 animate-pulse" style={{ animationDelay: `${delay}ms` }}>
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-arc-border/70" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-14 rounded bg-arc-border/70" />
                      <div className="h-2.5 w-20 rounded bg-arc-border/70" />
                    </div>
                    <div className="h-3 w-full rounded bg-arc-border/70" />
                  </div>
                </div>
              ))}
            </div>
          ) : arcCommunityItems.length > 0 ? (
            <div className="space-y-3">
              {arcCommunityStaleAt && (
                <p className="text-[10px] text-arc-text-dim/80">
                  {formatFeedRefreshLabel(arcCommunityStaleAt)}
                </p>
              )}
              <div className="space-y-2">
                {arcCommunityItems.map((item) => (
                  <a
                    key={item.url}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex gap-3 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3 transition-colors hover:border-arc-borderEmphasis hover:bg-arc-elevated"
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-border bg-arc-card text-white">
                      <ArrowUpRight size={14} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <TweetBadgePill badge={getArcCommunityBadge(item.type)} />
                        <span className="text-[10px] text-arc-text-dim">{formatRelativeTime(item.date)}</span>
                      </div>
                      <p className="line-clamp-2 text-xs leading-snug text-arc-text transition-colors group-hover:text-white">
                        {item.title}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <p className="py-2 text-center text-xs text-arc-text-dim">{t('dailyBrief.arcCommunityCouldNotLoad')}</p>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-arc-border bg-arc-card text-white">
                <Users size={14} />
              </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.arcDiscord')}</p>
                <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                  {t('dailyBrief.arcDiscordServerName')}
                </span>
              </div>

              {arcDiscordLoading ? (
                <div className="space-y-2 pt-0.5">
                  <div className="h-3.5 w-40 animate-pulse rounded bg-arc-border/70" />
                  <div className="h-3 w-28 animate-pulse rounded bg-arc-border/70" />
                </div>
              ) : arcDiscordDisplayError ? (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-arc-borderEmphasis bg-arc-card px-3 py-2">
                  <p className="text-xs leading-relaxed text-arc-text-dim">{arcDiscordDisplayError}</p>
                  <Button variant="outline" size="sm" onClick={retryBrief} className="shrink-0">
                    {t('state.retry')}
                  </Button>
                </div>
              ) : arcDiscordCountsLabel ? (
                <p className="text-xs leading-relaxed text-arc-text-dim">{arcDiscordCountsLabel}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Button type="button" fullWidth onClick={handleArcDiscordJoin}>
              <ArrowUpRight size={14} />
              {t('dailyBrief.arcDiscordJoin')}
            </Button>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="ghost"
                fullWidth
                size="sm"
                onClick={() => handleArcDiscordChannelOpen('https://discord.com/channels/1423729540160815207/1430952602606112788')}
              >
                <Hash size={12} />
                {t('dailyBrief.arcDiscordTechnicalSupport')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                fullWidth
                size="sm"
                onClick={() => handleArcDiscordChannelOpen('https://discord.com/channels/1423729540160815207/1423729542148788252')}
              >
                <Hash size={12} />
                {t('dailyBrief.arcDiscordEngagement')}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-card p-4">
          <div className="flex items-center gap-2">
            <Twitter size={14} className="text-white" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('dailyBrief.arcOnX')}</p>
          </div>

          {officialTweetsError ? (
            <ErrorState
              title={t('activity.couldNotLoad')}
              description={officialTweetsError}
              actionLabel={t('state.retry')}
              onAction={retryBrief}
            />
          ) : hasOfficialTweets && (
            <div className="space-y-3 rounded-xl border border-arc-border/70 bg-arc-bg/70 p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-white/80">
                {t('dailyBrief.official')}
              </p>
              {officialTweetsStaleAt && (
                <p className="text-[10px] text-arc-text-dim/80">
                  {formatFeedRefreshLabel(officialTweetsStaleAt)}
                </p>
              )}
              <div className="space-y-4">
                {safeOfficialTweets.slice(0, 3).map((tweet) => (
                  <TweetListItem
                    key={`official-${tweet.id}`}
                    tweet={tweet}
                    badge={{
                      label: t('dailyBrief.official'),
                      className: OFFICIAL_TWEET_BADGE_CLASS,
                    }}
                    onClick={() => {
                      if (!openSafeUrl(tweet.tweetUrl)) {
                        debugWarn('[DailyBrief] blocked unsafe tweet url:', tweet.tweetUrl)
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {hasOfficialTweets && (
            <div className="border-t border-arc-border/60 pt-3">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
                {t('dailyBrief.community')}
              </p>
            </div>
          )}

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
              <p className="text-xs text-arc-text-dim">{tweetsError}</p>
              <button
                onClick={() => setCurrentView('settings')}
                className="text-[10px] font-semibold text-arc-accent underline-offset-2 hover:underline"
              >
                {t('dailyBrief.updateKeyInSettings')}
              </button>
            </div>
          ) : safeTweets.length === 0 ? (
            <p className="py-2 text-center text-xs text-arc-text-dim">{t('dailyBrief.noArcTweetsFoundYet')}</p>
          ) : (
            <div className="space-y-4">
              {tweetsStaleAt && (
                <p className="text-[10px] text-arc-text-dim/80">
                  {formatFeedRefreshLabel(tweetsStaleAt)}
                </p>
              )}
              {safeTweets.slice(0, 3).map((tweet) => (
                <TweetListItem
                  key={tweet.id}
                  tweet={tweet}
                  badge={tweet.category ? TWEET_CATEGORY_BADGES[tweet.category] : null}
                  onClick={() => {
                    if (!openSafeUrl(tweet.tweetUrl)) {
                      debugWarn('[DailyBrief] blocked unsafe tweet url:', tweet.tweetUrl)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-arc-accent/20 bg-arc-card p-4">
          <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-arc-accent" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-accent/80">{t('dailyBrief.insight')}</p>
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
                  {activePattern.kind === 'recurring-recipient' && t('dailyBrief.sendAgain')}
                  {activePattern.kind === 'day-of-week' && t('dailyBrief.gotIt')}
                  {activePattern.kind === 'amount-cluster' && (
                    locale === 'tr'
                      ? `${formatUsdcAmount(activePattern.amount)} USDC gönder`
                      : `Send ${formatUsdcAmount(activePattern.amount)} USDC`
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm leading-relaxed text-arc-text-dim">
                {rawTransfers.length < 3 ? t('dailyBrief.buildingPatterns') : t('dailyBrief.noNewPatterns')}
              </p>
              {rawTransfers.length < 3 && (
                <p className="text-[10px] text-arc-text-dim/60">{t('dailyBrief.needAtLeast3Tx')}</p>
              )}
            </div>
          )}
        </div>

        {Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) && (
          <button
            onClick={() => {
              chrome.runtime.sendMessage({ type: 'CHECK_WHALES_NOW' }, (res) => {
                debugLog('[DailyBrief] CHECK_WHALES_NOW response:', res)
              })
            }}
            className="w-full py-1 text-center text-[10px] text-arc-text-dim/40 transition-colors hover:text-arc-text-dim"
          >
                {t('dailyBrief.checkWhalesNowDev')}
              </button>
        )}
      </div>
    </div>
  )
}

