import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bell, Bot, ExternalLink, Loader2, Radar, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { BLOCKSCOUT_BASE } from '@/lib/constants'
import { MONOCHROME_DARK } from '@/lib/designTokens'
import { DEFAULT_AGENT_BACKEND_URL, getAgentBackendConfig } from '@/lib/agentBackend'
import { fetchWithTimeout } from '@/lib/external'
import { formatAddress } from '@/lib/utils'

interface ArcRadarProps {
  onBack: () => void
  onOpenGogo?: () => void
  onOpenCalendar?: () => void
}

function cardStyle(border = 'rgba(110, 231, 183, 0.16)', background = 'rgba(7, 13, 11, 0.96)') {
  return {
    borderColor: border,
    backgroundColor: background,
    borderRadius: MONOCHROME_DARK.radius.card,
  }
}

function openExternal(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

type ArcRadarToken = {
  name?: string
  symbol?: string
  address?: string
  type?: string
  decimals?: string | number | null
  category?: string
  holders?: string | number | null
  totalSupply?: string | number | null
  verified?: boolean
  explorerUrl?: string | null
}

type ArcRadarSnapshot = {
  network?: string
  chainId?: number
  source?: string
  fetchedAt?: string
  cacheStatus?: string
  observedCount?: number
  memeSignals?: ArcRadarToken[]
  tokenSignals?: ArcRadarToken[]
  coreTokens?: ArcRadarToken[]
  safety?: {
    readOnly?: boolean
    tradeRecommendations?: boolean
    requiresContractAddress?: boolean
    requiresExplorerProof?: boolean
  }
}

const safetyRules = [
  'No contract address, no tradable label.',
  'No buy recommendation when liquidity or holder distribution is unknown.',
  'Flag risky owner, mint, pause, blacklist, proxy, or unverifiable controls.',
  'Use ArcScan proof links before trusting a token claim.',
  'Default to Arc Testnet until official mainnet details are confirmed.',
]

function formatDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

function formatTokenAmount(value?: string | number | null): string {
  if (value == null || value === '') return 'unknown'
  return String(value)
}

function getRiskNote(token: ArcRadarToken): string {
  if (token.verified) return 'Explorer metadata verified'
  const decimals = Number(token.decimals)
  if (Number.isFinite(decimals) && decimals !== 6) return `Watch decimals: ${token.decimals}`
  return 'Unverified metadata'
}

function getTokenTitle(token: ArcRadarToken): string {
  const symbol = token.symbol?.trim() || 'UNKNOWN'
  const name = token.name?.trim()
  return name && name !== symbol ? `${symbol} · ${name}` : symbol
}

async function fetchArcRadarSnapshot(): Promise<ArcRadarSnapshot> {
  const backend = await getAgentBackendConfig().catch(() => null)
  const backendUrl = (backend?.backendUrl ?? DEFAULT_AGENT_BACKEND_URL).replace(/\/+$/, '')
  const response = await fetchWithTimeout(`${backendUrl}/market/token-radar`, {
    headers: { accept: 'application/json' },
  }, 15_000)

  if (!response.ok) {
    throw new Error(`Radar endpoint HTTP ${response.status}`)
  }

  const payload = await response.json() as ArcRadarSnapshot
  if (!payload || typeof payload !== 'object') {
    throw new Error('Radar endpoint returned invalid data')
  }

  return payload
}

export function ArcRadar({ onBack, onOpenGogo, onOpenCalendar }: ArcRadarProps) {
  const [snapshot, setSnapshot] = useState<ArcRadarSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const tokens = useMemo(() => {
    const all = [
      ...(snapshot?.coreTokens ?? []),
      ...(snapshot?.memeSignals ?? []),
      ...(snapshot?.tokenSignals ?? []),
    ]
    const deduped = new Map<string, ArcRadarToken>()
    for (const token of all) {
      const key = token.address?.toLowerCase() || `${token.symbol}-${token.name}`
      if (!key) continue
      deduped.set(key, token)
    }
    return Array.from(deduped.values())
  }, [snapshot])

  const verifiedCount = tokens.filter((token) => token.verified).length
  const unverifiedCount = tokens.length - verifiedCount

  const loadSnapshot = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const next = await fetchArcRadarSnapshot()
      setSnapshot(next)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load Arc Radar')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSnapshot()
  }, [])

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        backgroundColor: MONOCHROME_DARK.colors.background,
        color: MONOCHROME_DARK.colors.text,
      }}
    >
      <header className="shrink-0 border-b px-4 py-3" style={{ borderBottomColor: MONOCHROME_DARK.colors.border }}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full border text-white"
            style={{ borderColor: MONOCHROME_DARK.colors.border }}
            aria-label="Back"
          >
            <ArrowLeft size={17} strokeWidth={1.9} />
          </button>
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight text-white">Arc Radar</p>
            <p className="text-[11px] text-arc-text-dim">Token safety, meme signals, and proof-first monitoring</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          <section
            className="relative overflow-hidden border px-4 py-4"
            style={{
              ...cardStyle('rgba(110, 231, 183, 0.22)', 'rgba(5, 10, 8, 0.98)'),
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), radial-gradient(circle at 82% 15%, rgba(52, 211, 153, 0.18), transparent 35%)',
              backgroundSize: '24px 24px, 24px 24px, auto',
            }}
          >
            <div className="absolute right-4 top-4 rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
              {snapshot?.network ?? 'Arc Testnet'}
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-emerald-200/25 bg-emerald-200/10 text-emerald-100">
              <Radar size={22} strokeWidth={1.8} />
            </div>
            <div className="mt-5 max-w-[260px]">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-100/80">Signal → Risk → Policy → Proof</p>
              <h1 className="mt-2 text-[26px] font-semibold leading-[1.02] tracking-[-0.05em] text-white">
                A safer radar for Arc meme/token waves.
              </h1>
              <p className="mt-3 text-xs leading-relaxed text-arc-text-dim">
                Live ArcScan-backed ERC-20 watch surface. If the endpoint cannot prove data, this page shows unavailable instead of inventing tokens.
              </p>
            </div>
          </section>

          <section className="grid grid-cols-3 gap-2">
            <div className="border px-2.5 py-3" style={cardStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.035)')}>
              <p className="text-[9px] uppercase tracking-[0.16em] text-arc-hint">Observed</p>
              <p className="mt-1 text-xs font-semibold text-white">{isLoading ? '—' : snapshot?.observedCount ?? tokens.length}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-arc-text-dim">ERC-20 contracts from ArcScan token index.</p>
            </div>
            <div className="border px-2.5 py-3" style={cardStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.035)')}>
              <p className="text-[9px] uppercase tracking-[0.16em] text-arc-hint">Verified</p>
              <p className="mt-1 text-xs font-semibold text-white">{isLoading ? '—' : verifiedCount}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-arc-text-dim">Explorer metadata marked verified.</p>
            </div>
            <div className="border px-2.5 py-3" style={cardStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.035)')}>
              <p className="text-[9px] uppercase tracking-[0.16em] text-arc-hint">Watch</p>
              <p className="mt-1 text-xs font-semibold text-white">{isLoading ? '—' : unverifiedCount}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-arc-text-dim">Needs proof before trust.</p>
            </div>
          </section>

          <section className="border px-4 py-4" style={cardStyle('rgba(125, 211, 252, 0.18)', 'rgba(255,255,255,0.035)')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-100/80">Live ArcScan feed</p>
                <p className="mt-1 text-xs text-arc-text-dim">
                  Last fetched: {formatDateTime(snapshot?.fetchedAt)} · cache: {snapshot?.cacheStatus ?? '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadSnapshot()}
                disabled={isLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white disabled:opacity-50"
                aria-label="Refresh Arc Radar"
              >
                {isLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-[16px] border border-amber-200/20 bg-amber-200/10 px-3 py-3 text-xs leading-relaxed text-amber-50/85">
                Could not load live radar: {error}. No token list is shown because ArcCopilot does not use fake radar data.
              </div>
            ) : null}

            {!error && isLoading && tokens.length === 0 ? (
              <div className="mt-3 space-y-2">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-16 animate-pulse rounded-[18px] bg-white/[0.05]" />
                ))}
              </div>
            ) : null}

            {!error && !isLoading && tokens.length === 0 ? (
              <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-3 text-xs leading-relaxed text-arc-text-dim">
                ArcScan returned zero token candidates. Nothing is displayed until real contracts appear.
              </div>
            ) : null}

            {tokens.length > 0 ? (
              <div className="mt-3 space-y-2">
                {tokens.slice(0, 12).map((token) => {
                  const explorerUrl = token.explorerUrl || (token.address ? `${BLOCKSCOUT_BASE}/token/${token.address}` : BLOCKSCOUT_BASE)
                  return (
                    <button
                      key={token.address ?? `${token.symbol}-${token.name}`}
                      type="button"
                      onClick={() => openExternal(explorerUrl)}
                      className="group w-full rounded-[18px] border border-white/10 bg-black/20 px-3 py-3 text-left transition-colors hover:border-sky-200/35"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border text-xs font-semibold ${
                          token.verified
                            ? 'border-emerald-200/25 bg-emerald-200/10 text-emerald-100'
                            : 'border-amber-200/25 bg-amber-200/10 text-amber-100'
                        }`}>
                          {token.symbol?.slice(0, 3).toUpperCase() || 'TKN'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-white">{getTokenTitle(token)}</p>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                              token.verified ? 'bg-emerald-200/10 text-emerald-100' : 'bg-amber-200/10 text-amber-100'
                            }`}>
                              {token.verified ? 'verified' : 'watch'}
                            </span>
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-arc-text-dim">
                            {token.address ? formatAddress(token.address, 5) : 'address unavailable'}
                          </p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-arc-text-dim">
                            <span>dec {formatTokenAmount(token.decimals)}</span>
                            <span>holders {formatTokenAmount(token.holders)}</span>
                            <span>{getRiskNote(token)}</span>
                          </div>
                        </div>
                        <ExternalLink size={14} className="mt-1 shrink-0 text-arc-hint transition-colors group-hover:text-sky-100" />
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </section>

          <section className="border px-4 py-4" style={cardStyle('rgba(251, 191, 36, 0.22)', 'rgba(251, 191, 36, 0.055)')}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border border-amber-200/25 bg-amber-200/10 text-amber-100">
                <ShieldAlert size={18} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">Safety filter</p>
                <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
                  Arc Radar helps reduce rug-pull risk; it does not promise profit or call unknown assets safe.
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {safetyRules.map((rule) => (
                <div key={rule} className="flex items-start gap-2 text-xs leading-relaxed text-arc-text-dim">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0 text-amber-100/80" strokeWidth={1.9} />
                  <span>{rule}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="border px-4 py-4" style={cardStyle('rgba(110, 231, 183, 0.16)', 'rgba(255,255,255,0.035)')}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">Try in Gogo</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {['token radar', 'analyze 0x...', 'watch token 0x...', 'arc circle bilgi'].map((command) => (
                <button
                  key={command}
                  type="button"
                  onClick={onOpenGogo}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-left font-mono text-[10px] text-white transition-colors hover:border-emerald-200/35"
                >
                  {command}
                </button>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2 pb-2">
            <button
              type="button"
              onClick={onOpenCalendar}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white text-sm font-medium text-black"
            >
              <Bell size={15} />
              Add alert
            </button>
            <button
              type="button"
              onClick={() => openExternal(BLOCKSCOUT_BASE)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] text-sm font-medium text-white"
            >
              <ExternalLink size={15} />
              ArcScan
            </button>
          </div>

          <div className="flex items-start gap-2 rounded-[18px] border border-white/10 bg-white/[0.025] px-3 py-3 text-[11px] leading-relaxed text-arc-text-dim">
            <Bot size={14} className="mt-0.5 shrink-0 text-emerald-100/70" />
            <p>
              Product stance: ArcCopilot should learn every available signal, but only act when the user’s policy, proof, and approval line up.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
