import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Coins, ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { fetchArcCommunity, type ArcCommunityFeedResult, type ArcCommunityItem } from '@/lib/arcCommunity'
import { fetchNews, type NewsItem } from '@/lib/newsPulse'
import { chromeStorageSet } from '@/lib/external'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'

interface DeFiRadarProps {
  onBack: () => void
  onOpenGogo?: () => void
}

type SignalSource = 'Arc Community' | 'News'

type DefiCategoryId = 'lending' | 'savings' | 'fx' | 'payments' | 'cirbtc' | 'risk'

type DefiCategory = {
  id: DefiCategoryId
  label: string
  keywords: string[]
}

type DefiSignal = {
  id: string
  title: string
  url: string
  source: SignalSource
  publishedAt: string
  categories: DefiCategoryId[]
  proofLevel: 'official' | 'headline'
}

const paper = '#efe8d8'
const ink = '#12110f'
const muted = '#686154'
const line = 'rgba(18, 17, 15, 0.14)'
const green = '#24d66f'

const DEFI_CATEGORIES: DefiCategory[] = [
  {
    id: 'lending',
    label: 'Lending / Borrowing',
    keywords: ['lend', 'lending', 'borrow', 'borrowing', 'credit', 'loan', 'collateral', 'debt'],
  },
  {
    id: 'savings',
    label: 'Savings / Yield',
    keywords: ['savings', 'save', 'yield', 'earn', 'apy', 'vault', 'interest', 'treasury'],
  },
  {
    id: 'fx',
    label: 'FX / Remittance',
    keywords: ['fx', 'foreign exchange', 'remittance', 'remit', 'cross-border', 'cross border', 'payments abroad'],
  },
  {
    id: 'payments',
    label: 'USDC Apps',
    keywords: ['usdc', 'stablecoin', 'payment', 'pay', 'settlement', 'merchant', 'card', 'checkout'],
  },
  {
    id: 'cirbtc',
    label: 'cirBTC / Wrapped Assets',
    keywords: ['cirbtc', 'bitcoin', 'btc', 'wrapped', 'wbtc'],
  },
  {
    id: 'risk',
    label: 'Risk / Controls',
    keywords: ['risk', 'exploit', 'hack', 'liquidity', 'rug', 'fraud', 'scam', 'regulator', 'compliance'],
  },
]

function openExternal(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function makeCardStyle(backgroundColor: string, borderColor: string, borderRadius = 22) {
  return {
    backgroundColor,
    borderColor,
    borderRadius,
    borderWidth: 1,
    borderStyle: 'solid' as const,
  }
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'unknown'
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function inferCategories(title: string): DefiCategoryId[] {
  const normalized = normalizeText(title)
  const matches = DEFI_CATEGORIES
    .filter((category) => category.keywords.some((keyword) => normalized.includes(keyword)))
    .map((category) => category.id)

  return Array.from(new Set(matches))
}

function mapCommunitySignal(item: ArcCommunityItem): DefiSignal | null {
  const categories = inferCategories(item.title)
  if (categories.length === 0) return null

  return {
    id: `community:${item.url}`,
    title: item.title,
    url: item.url,
    source: 'Arc Community',
    publishedAt: item.date,
    categories,
    proofLevel: 'official',
  }
}

function mapNewsSignal(item: NewsItem): DefiSignal | null {
  const categories = inferCategories(`${item.title} ${item.source}`)
  if (categories.length === 0) return null

  return {
    id: `news:${item.link}`,
    title: item.title,
    url: item.link,
    source: 'News',
    publishedAt: item.publishedAt,
    categories,
    proofLevel: 'headline',
  }
}

function dedupeSignals(signals: DefiSignal[]): DefiSignal[] {
  const seen = new Set<string>()
  const deduped: DefiSignal[] = []

  for (const signal of signals) {
    const key = normalizeText(signal.title)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(signal)
  }

  return deduped.sort((a, b) => {
    const aMs = new Date(a.publishedAt).getTime()
    const bMs = new Date(b.publishedAt).getTime()
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0)
  })
}

function getCategoryLabel(id: DefiCategoryId): string {
  return DEFI_CATEGORIES.find((category) => category.id === id)?.label ?? id
}

export function DeFiRadar({ onBack, onOpenGogo }: DeFiRadarProps) {
  const [community, setCommunity] = useState<ArcCommunityFeedResult | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (force = false) => {
    setIsLoading(true)
    setError(null)

    try {
      const [communityResult, newsItems] = await Promise.all([
        fetchArcCommunity(),
        fetchNews(force).catch(() => []),
      ])

      setCommunity(communityResult)
      setNews(newsItems)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load DeFi signals.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
  }, [])

  const signals = useMemo(() => {
    return dedupeSignals([
      ...(community?.items ?? []).map(mapCommunitySignal).filter((item): item is DefiSignal => item != null),
      ...news.map(mapNewsSignal).filter((item): item is DefiSignal => item != null),
    ])
  }, [community, news])

  const categoryCounts = useMemo(() => {
    const counts: Record<DefiCategoryId, number> = {
      lending: 0,
      savings: 0,
      fx: 0,
      payments: 0,
      cirbtc: 0,
      risk: 0,
    }

    for (const signal of signals) {
      for (const category of signal.categories) counts[category] += 1
    }

    return counts
  }, [signals])

  const askGogo = async (prompt: string) => {
    await chromeStorageSet({
      [PENDING_GOGO_PROMPT_STORAGE_KEY]: { prompt, ts: Date.now() },
      [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai',
    })
    onOpenGogo?.()
  }

  const officialCount = signals.filter((signal) => signal.proofLevel === 'official').length
  const candidateCount = signals.length - officialCount

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ backgroundColor: paper, color: ink }}>
      <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: line }}>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center border"
            style={makeCardStyle('rgba(255,255,255,0.58)', line, 999)}
            aria-label="Back"
          >
            <ArrowLeft size={17} strokeWidth={1.8} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">DeFi Radar</p>
            <p className="text-[11px]" style={{ color: muted }}>Real Arc/Circle signals. No fake protocol listings.</p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="flex h-10 w-10 items-center justify-center border"
            style={makeCardStyle('rgba(255,255,255,0.58)', line, 999)}
            aria-label="Refresh"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} strokeWidth={1.8} />}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section
          className="relative overflow-hidden border p-4"
          style={{
            ...makeCardStyle('rgba(255,255,255,0.42)', line, 26),
            backgroundImage:
              'linear-gradient(rgba(18,17,15,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(18,17,15,0.045) 1px, transparent 1px), radial-gradient(circle at 88% 28%, rgba(36,214,111,0.18), transparent 36%)',
            backgroundSize: '26px 26px, 26px 26px, auto',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#118744' }}>Arc H2 / DeFi</div>
              <h1 className="mt-2 text-3xl font-semibold leading-none tracking-[-0.06em]">Find signal before action</h1>
              <p className="mt-3 max-w-[260px] text-xs leading-relaxed" style={{ color: muted }}>
                ArcCopilot watches official/community/news signals, then separates discovery from tradability.
              </p>
            </div>
            <div className="rounded-[22px] border bg-black p-3 text-white shadow-[0_10px_30px_rgba(18,17,15,0.16)]" style={{ borderColor: green }}>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: green }}>Live</p>
              <p className="mt-1 text-xl font-semibold">{signals.length}</p>
              <p className="text-[10px] text-white/60">DeFi signals</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatCard label="official" value={officialCount} />
            <StatCard label="candidates" value={candidateCount} />
            <StatCard label="sources" value={(community?.items.length ?? 0) + news.length} />
          </div>
        </section>

        <section className="mt-3 grid grid-cols-2 gap-2">
          {DEFI_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => void askGogo(`explain ${category.label} on Arc`)}
              className="min-h-[88px] border p-3 text-left"
              style={makeCardStyle('rgba(255,255,255,0.44)', line, 20)}
            >
              <div className="flex items-center justify-between gap-2">
                <Coins size={15} strokeWidth={1.8} style={{ color: '#118744' }} />
                <span className="font-mono text-[10px]" style={{ color: muted }}>{categoryCounts[category.id]}</span>
              </div>
              <p className="mt-3 text-xs font-semibold">{category.label}</p>
              <p className="mt-1 text-[10px] leading-snug" style={{ color: muted }}>
                {categoryCounts[category.id] > 0 ? 'Signal detected' : 'No proven signal yet'}
              </p>
            </button>
          ))}
        </section>

        <section className="mt-3 border p-3" style={makeCardStyle('rgba(18,17,15,0.92)', 'rgba(18,17,15,0.9)', 24)}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/50">Safety filter</p>
              <p className="mt-1 text-sm font-semibold text-white">Discovery is not a buy call</p>
            </div>
            <ShieldCheck size={18} style={{ color: green }} />
          </div>
          <div className="mt-3 grid gap-2 text-[11px] leading-relaxed text-white/66">
            <p>No contract address means not tradable.</p>
            <p>No ArcScan / verified-contract / liquidity proof means risky.</p>
            <p>Gogo can explain signals, but ArcCopilot will not invent protocols or recommend buys.</p>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: muted }}>Signal feed</p>
            <button
              type="button"
              onClick={() => void askGogo('defi radar')}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
              style={{ borderColor: line }}
            >
              <Bot size={12} /> Ask Gogo
            </button>
          </div>

          {error ? (
            <div className="border p-4" style={makeCardStyle('rgba(255,255,255,0.44)', line, 22)}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert size={16} /> Could not load live DeFi signals
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: muted }}>{error}</p>
            </div>
          ) : null}

          {!error && !isLoading && signals.length === 0 ? (
            <div className="border p-4" style={makeCardStyle('rgba(255,255,255,0.44)', line, 22)}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles size={16} /> No DeFi signal yet
              </div>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: muted }}>
                ArcCopilot did not find official/community/news items matching DeFi categories. Nothing is shown just for looks.
              </p>
            </div>
          ) : null}

          <div className="grid gap-2">
            {signals.slice(0, 12).map((signal) => (
              <SignalRow key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border bg-white/45 p-3" style={makeCardStyle('rgba(255,255,255,0.45)', line, 18)}>
      <p className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: muted }}>{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  )
}

function SignalRow({ signal }: { signal: DefiSignal }) {
  return (
    <button
      type="button"
      onClick={() => openExternal(signal.url)}
      className="w-full border p-3 text-left"
      style={makeCardStyle('rgba(255,255,255,0.48)', line, 20)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              style={{ borderColor: signal.proofLevel === 'official' ? 'rgba(17,135,68,0.28)' : line, color: signal.proofLevel === 'official' ? '#118744' : muted }}
            >
              {signal.proofLevel === 'official' ? 'official' : 'headline'}
            </span>
            <span className="text-[10px]" style={{ color: muted }}>{signal.source} · {formatDate(signal.publishedAt)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{signal.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {signal.categories.map((category) => (
              <span key={category} className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px]" style={{ color: muted }}>
                {getCategoryLabel(category)}
              </span>
            ))}
          </div>
        </div>
        <ExternalLink size={14} className="shrink-0" style={{ color: muted }} />
      </div>
    </button>
  )
}
