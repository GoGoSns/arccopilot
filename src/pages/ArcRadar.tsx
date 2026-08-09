import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bell, Bot, ExternalLink, Loader2, Radar, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { BLOCKSCOUT_BASE } from '@/lib/constants'
import { DEFAULT_AGENT_BACKEND_URL, getAgentBackendConfig } from '@/lib/agentBackend'
import { chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { formatAddress } from '@/lib/utils'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'

interface ArcRadarProps {
  onBack: () => void
  onOpenGogo?: () => void
  onOpenCalendar?: () => void
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
  firstSeenAt?: string | null
  lastSeenAt?: string | null
  risk?: {
    score?: number
    label?: string
    note?: string
  }
  attention?: {
    score?: number
    label?: string
    note?: string
  }
  detection?: {
    source?: string
    firstSeenBlock?: number
    firstSeenTxHash?: string | null
    creationTxHash?: string | null
    deployedBlockNumber?: number | null
    deployedAt?: string | null
    freshLaunchProven?: boolean | null
    metadataStatus?: string
  }
}

type ArcRadarSnapshot = {
  network?: string
  chainId?: number
  source?: string
  fetchedAt?: string
  cacheStatus?: string
  observedCount?: number
  newSignalCount?: number
  newSignals?: ArcRadarToken[]
  recentLaunchSignals?: ArcRadarToken[]
  indexedSignals?: ArcRadarToken[]
  indexedObservedCount?: number
  newSignalWindowMinutes?: number
  memeSignals?: ArcRadarToken[]
  tokenSignals?: ArcRadarToken[]
  coreTokens?: ArcRadarToken[]
  scan?: {
    mode?: string
    persistence?: string
    previousSeenCount?: number
    currentSeenCount?: number
    baselineCreated?: boolean
    scannedAt?: string
  }
  safety?: {
    readOnly?: boolean
    tradeRecommendations?: boolean
    requiresContractAddress?: boolean
    requiresExplorerProof?: boolean
  }
  indexer?: {
    status?: string
    indexedThroughBlock?: number | null
    lastRunAt?: string | null
    lastSuccessAt?: string | null
    evidenceModel?: string
  }
}

const paper = '#efe8d8'
const ink = '#12110f'
const muted = '#686154'
const line = 'rgba(18, 17, 15, 0.14)'
const green = '#24d66f'

const safetyRules = [
  'No contract address, no tradable label.',
  'No buy recommendation without liquidity, holder, and control proof.',
  'Risk stays visible until ArcScan proof is strong.',
  'Arc is treated as testnet-focused unless official mainnet data is confirmed.',
]

const nodePositions = [
  ['18%', '54%'],
  ['26%', '35%'],
  ['34%', '68%'],
  ['44%', '42%'],
  ['52%', '58%'],
  ['62%', '31%'],
  ['70%', '66%'],
  ['79%', '45%'],
  ['38%', '22%'],
  ['57%', '78%'],
  ['84%', '62%'],
  ['23%', '76%'],
] as const

function openExternal(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url })
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function formatDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

function formatTokenAmount(value?: string | number | null): string {
  if (value == null || value === '') return 'unknown'
  return String(value)
}

function formatBlock(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-'
}

function getIndexerLabel(status?: string): string {
  switch (status) {
    case 'ready':
      return 'ready'
    case 'not-started':
      return 'waiting for cron'
    case 'degraded':
      return 'degraded'
    case 'unavailable':
      return 'unavailable'
    default:
      return status || 'starting'
  }
}

function getIndexerCaption(snapshot?: ArcRadarSnapshot | null): string {
  const status = snapshot?.indexer?.status
  if (status === 'not-started') return 'Backend is deployed. Add the radar cron job to start proof scans.'
  if (status === 'ready') return 'Proof scanner is active. Fresh launches require mint, ERC-20, and creation evidence.'
  if (status === 'degraded' || status === 'unavailable') return 'Proof scanner is not healthy, so launch alerts are suppressed.'
  return 'First successful scan creates a no-alert baseline before launch alerts can appear.'
}

function getTokenTitle(token: ArcRadarToken): string {
  const symbol = token.symbol?.trim() || 'UNKNOWN'
  const name = token.name?.trim()
  return name && name !== symbol ? `${symbol} · ${name}` : symbol
}

function getTokenStatus(token: ArcRadarToken): string {
  if (token.detection?.freshLaunchProven === true) return 'fresh launch proven'
  if (token.verified) return 'source verified'
  if ((token.attention?.score ?? 0) >= 70) return 'high attention'
  if ((token.risk?.score ?? 0) >= 66) return 'high risk'
  return 'watch'
}

function getRiskTone(token: ArcRadarToken): string {
  const score = token.risk?.score ?? 50
  if (score >= 66) return 'text-[#b9402b]'
  if (score <= 30) return 'text-[#0c8c47]'
  return 'text-[#9b6a13]'
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
      ...(snapshot?.indexedSignals ?? []),
    ]
    const deduped = new Map<string, ArcRadarToken>()
    for (const token of all) {
      const key = token.address?.toLowerCase() || `${token.symbol}-${token.name}`
      if (!key) continue
      deduped.set(key, token)
    }
    return Array.from(deduped.values())
  }, [snapshot])

  const proofBackedIndexer = snapshot?.chainId === 5042002
    && snapshot?.indexer?.evidenceModel === 'erc20-transfer-mint+contract-creation-proof'
  const newTokens = proofBackedIndexer
    ? (snapshot?.newSignals ?? []).filter((token) => token.detection?.freshLaunchProven === true)
    : []
  const verifiedCount = tokens.filter((token) => token.verified).length
  const reviewCount = Math.max(0, tokens.length - verifiedCount)
  const provenNewCount = newTokens.length
  const radarNodes = tokens.slice(0, nodePositions.length)

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

  const askGogo = async (prompt: string) => {
    await chromeStorageSet({
      [PENDING_GOGO_PROMPT_STORAGE_KEY]: {
        prompt,
        ts: Date.now(),
      },
      [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai',
    })
    onOpenGogo?.()
  }

  const firstTokenAddress = tokens.find((token) => token.address)?.address

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        color: ink,
        backgroundColor: paper,
        backgroundImage:
          'linear-gradient(rgba(18,17,15,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(18,17,15,0.055) 1px, transparent 1px), radial-gradient(circle at 78% 20%, rgba(36,214,111,0.14), transparent 32%)',
        backgroundSize: '22px 22px, 22px 22px, auto',
      }}
    >
      <header className="shrink-0 border-b px-4 py-3" style={{ borderBottomColor: line }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full border bg-white/45"
              style={{ borderColor: line }}
              aria-label="Back"
            >
              <ArrowLeft size={17} strokeWidth={1.9} />
            </button>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-tight">Arc Network Radar</p>
              <p className="text-[11px]" style={{ color: muted }}>Real token signals, risk, proof, and Gogo analysis</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            disabled={isLoading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white/45 disabled:opacity-50"
            style={{ borderColor: line }}
            aria-label="Refresh Arc Radar"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          <section className="overflow-hidden rounded-[28px] border bg-[#f7f1e5]/80 p-4 shadow-[0_18px_50px_rgba(31,28,20,0.08)]" style={{ borderColor: line }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: '#118744' }}>
                  — Network
                </p>
                <h1 className="mt-3 text-[27px] font-semibold leading-[1.02] tracking-[-0.055em]">
                  Arc signals, risks, and bridge readiness.
                </h1>
                <p className="mt-3 max-w-[260px] text-xs leading-relaxed" style={{ color: muted }}>
                  Arc RPC mint evidence, ERC-20 interface checks, and ArcScan creation proof. Unknown candidates cannot trigger launch alerts; no fake tokens or buy calls.
                </p>
              </div>
              <div className="rounded-full border bg-white/55 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em]" style={{ borderColor: line, color: '#166534' }}>
                {snapshot?.network ?? 'Arc Testnet'}
              </div>
            </div>

            <div className="mt-5 rounded-[22px] border bg-white/45 p-3" style={{ borderColor: line }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: muted }}>Detection rail</p>
                  <p className="mt-1 text-sm font-semibold">Arc RPC + ArcScan evidence</p>
                </div>
                <span className="rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em]" style={{ borderColor: line, color: '#118744' }}>
                  {snapshot?.indexer?.status ?? 'starting'} · block {snapshot?.indexer?.indexedThroughBlock ?? '—'}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-1.5 overflow-hidden rounded-full border bg-[#ebe2d0] px-3 py-3" style={{ borderColor: line }}>
                {radarNodes.length === 0 ? (
                  <div className="h-2 flex-1 rounded-full bg-black/10" />
                ) : (
                  radarNodes.map((token, index) => (
                    <button
                      key={token.address ?? `${token.symbol}-${index}`}
                      type="button"
                      onClick={() => token.address && void askGogo(`token risk ${token.address}`)}
                      className="h-2.5 rounded-full transition-transform hover:scale-y-150"
                      style={{
                        width: `${Math.max(14, Math.min(42, Number(token.attention?.score ?? 36) / 2))}px`,
                        backgroundColor: token.verified ? '#118744' : green,
                        opacity: token.verified ? 0.9 : 0.68,
                      }}
                      aria-label={`Ask Gogo about ${getTokenTitle(token)}`}
                    />
                  ))
                )}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: muted }}>
                {getIndexerCaption(snapshot)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]" style={{ color: muted }}>
                <span>Chain: eip155:{snapshot?.chainId ?? 5042002}</span>
                <span>Source: RPC + ArcScan</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ['Confirmed', isLoading ? '—' : String(snapshot?.indexedObservedCount ?? 0), 'ERC-20 interface'],
                ['New', isLoading ? '—' : String(provenNewCount), `${snapshot?.newSignalWindowMinutes ?? 15}m proven`],
                ['Review', isLoading ? '—' : String(reviewCount), 'Catalog signals'],
              ].map(([label, value, caption]) => (
                <div key={label} className="rounded-[16px] border bg-white/45 px-3 py-3" style={{ borderColor: line }}>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: muted }}>{label}</p>
                  <p className="mt-1 text-lg font-semibold">{value}</p>
                  <p className="mt-1 text-[10px]" style={{ color: muted }}>{caption}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border bg-[#11110f] p-4 text-white shadow-[0_14px_36px_rgba(0,0,0,0.16)]" style={{ borderColor: 'rgba(18,17,15,0.25)' }}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border border-emerald-200/25 bg-emerald-200/10 text-emerald-100">
                <Bell size={17} strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">Proof-backed launches</p>
                    <p className="mt-1 text-sm font-semibold">
                      {isLoading ? 'Scanning ArcScan...' : `${provenNewCount} fresh token signal${provenNewCount === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-white/65">
                    {getIndexerLabel(snapshot?.indexer?.status)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-white/58">
                  {getIndexerCaption(snapshot)}
                </p>
              </div>
            </div>

            {!isLoading && !error && newTokens.length === 0 ? (
              <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-xs leading-relaxed text-white/60">
                No proof-backed Arc ERC-20 launch in this window. Incomplete candidates stay quarantined instead of becoming fake alerts.
              </div>
            ) : null}

            {newTokens.length > 0 ? (
              <div className="mt-3 space-y-2">
                {newTokens.slice(0, 4).map((token) => (
                  <TokenRow key={token.address ?? `${token.symbol}-${token.name}`} token={token} askGogo={askGogo} dark />
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-[24px] border bg-[#f7f1e5]/75 p-4" style={{ borderColor: line }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#118744' }}>Arc Bridge</p>
                <p className="mt-1 text-base font-semibold">USDC bridge readiness</p>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: muted }}>
                  Circle App Kit can bridge USDC with CCTP routes such as Ethereum Sepolia ↔ Arc Testnet or Solana Devnet → Arc Testnet. Gogo can prepare a preflight, but no bridge runs without explicit amount, route, and wallet confirmation.
                </p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border bg-[#e8f8ec]" style={{ borderColor: 'rgba(17,135,68,0.18)', color: '#118744' }}>
                <Radar size={18} strokeWidth={1.8} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ['Asset', 'USDC'],
                ['Arc chain', '5042002'],
                ['Kit chain', 'Arc_Testnet'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[15px] border bg-white/55 px-2.5 py-2" style={{ borderColor: line }}>
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: muted }}>{label}</p>
                  <p className="mt-1 truncate text-xs font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void askGogo('arc bridge')}
                className="rounded-full border bg-[#11110f] px-3 py-2 text-xs font-medium text-white"
                style={{ borderColor: 'rgba(18,17,15,0.25)' }}
              >
                Ask Gogo bridge
              </button>
              <button
                type="button"
                onClick={() => openExternal('https://docs.arc.io/app-kit/bridge')}
                className="rounded-full border bg-white/55 px-3 py-2 text-xs font-medium"
                style={{ borderColor: line, color: ink }}
              >
                Docs
              </button>
            </div>
          </section>

          <section className="rounded-[24px] border bg-[#f7f1e5]/75 p-4" style={{ borderColor: line }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#118744' }}>Live ArcScan feed</p>
                <p className="mt-1 text-xs" style={{ color: muted }}>
                  Last fetched: {formatDateTime(snapshot?.fetchedAt)} · cache: {snapshot?.cacheStatus ?? '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadSnapshot()}
                disabled={isLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white/50 disabled:opacity-50"
                style={{ borderColor: line }}
                aria-label="Refresh Arc Radar"
              >
                {isLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-[16px] border border-amber-700/20 bg-amber-100/45 px-3 py-3 text-xs leading-relaxed text-amber-950">
                Could not load live radar: {error}. No token list is shown because Regent does not use fake radar data.
              </div>
            ) : null}

            {!error && isLoading && tokens.length === 0 ? (
              <div className="mt-3 space-y-2">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-16 animate-pulse rounded-[18px] bg-black/[0.06]" />
                ))}
              </div>
            ) : null}

            {!error && !isLoading && tokens.length === 0 ? (
              <div className="mt-3 rounded-[16px] border bg-white/45 px-3 py-3 text-xs leading-relaxed" style={{ borderColor: line, color: muted }}>
                ArcScan returned zero token candidates. Nothing is displayed until real contracts appear.
              </div>
            ) : null}

            {tokens.length > 0 ? (
              <div className="mt-3 space-y-2">
                {tokens.slice(0, 10).map((token) => (
                  <TokenRow key={token.address ?? `${token.symbol}-${token.name}`} token={token} askGogo={askGogo} />
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-[24px] border bg-white/40 p-4" style={{ borderColor: line }}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border bg-[#e8f8ec]" style={{ borderColor: 'rgba(17,135,68,0.18)', color: '#118744' }}>
                <ShieldCheck size={18} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Safety filter</p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: muted }}>
                  Arc Radar reduces rug-pull risk; it does not promise profit or mark unknown assets safe.
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {safetyRules.map((rule) => (
                <div key={rule} className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: muted }}>
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" color="#118744" strokeWidth={1.9} />
                  <span>{rule}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[24px] border bg-[#11110f] p-4 text-white" style={{ borderColor: 'rgba(18,17,15,0.25)' }}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">Ask Gogo</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                'token radar',
                firstTokenAddress ? `token risk ${firstTokenAddress}` : 'token risk 0x...',
                firstTokenAddress ? `watch token ${firstTokenAddress}` : 'watch token 0x...',
                'arc circle bilgi',
              ].map((command) => (
                <button
                  key={command}
                  type="button"
                  onClick={() => void askGogo(command)}
                  disabled={command.includes('0x...')}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-left font-mono text-[10px] text-white transition-colors hover:border-emerald-200/35 disabled:opacity-45"
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
              className="flex min-h-12 items-center justify-center gap-2 rounded-full border bg-[#11110f] text-sm font-medium text-white"
              style={{ borderColor: 'rgba(18,17,15,0.25)' }}
            >
              <Bell size={15} />
              Add alert
            </button>
            <button
              type="button"
              onClick={() => openExternal(BLOCKSCOUT_BASE)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-full border bg-white/55 text-sm font-medium"
              style={{ borderColor: line, color: ink }}
            >
              <ExternalLink size={15} />
              ArcScan
            </button>
          </div>

          <div className="mb-2 flex items-start gap-2 rounded-[18px] border bg-white/35 px-3 py-3 text-[11px] leading-relaxed" style={{ borderColor: line, color: muted }}>
            <Bot size={14} className="mt-0.5 shrink-0" color="#118744" />
            <p>
              Product stance: Gogo learns every available signal, but only acts when user policy, proof, and approval line up.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

function TokenRow({ token, askGogo, dark = false }: { token: ArcRadarToken; askGogo: (prompt: string) => Promise<void>; dark?: boolean }) {
  const explorerUrl = token.explorerUrl || (token.address ? `${BLOCKSCOUT_BASE}/token/${token.address}` : BLOCKSCOUT_BASE)
  const text = dark ? 'text-white' : ''
  const subText = dark ? 'text-white/55' : ''

  return (
    <div
      className={`rounded-[18px] border px-3 py-3 ${dark ? 'border-white/10 bg-white/[0.04]' : 'bg-white/55'}`}
      style={dark ? undefined : { borderColor: line }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border text-xs font-semibold ${
            dark ? 'border-emerald-200/20 bg-emerald-200/10 text-emerald-100' : ''
          }`}
          style={dark ? undefined : { borderColor: 'rgba(17,135,68,0.18)', backgroundColor: '#e8f8ec', color: '#118744' }}
        >
          {token.symbol?.slice(0, 3).toUpperCase() || 'TKN'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`truncate text-sm font-semibold ${text}`}>{getTokenTitle(token)}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                dark ? 'bg-emerald-200/10 text-emerald-100' : 'bg-[#e8f8ec]'
              }`}
              style={dark ? undefined : { color: '#118744' }}
            >
              {getTokenStatus(token)}
            </span>
          </div>
          <p className={`mt-1 truncate font-mono text-[10px] ${subText}`} style={dark ? undefined : { color: muted }}>
            {token.address ? formatAddress(token.address, 5) : 'address unavailable'}
          </p>
          <div className={`mt-2 grid grid-cols-3 gap-2 text-[10px] ${subText}`} style={dark ? undefined : { color: muted }}>
            <span>dec {formatTokenAmount(token.decimals)}</span>
            <span>holders {formatTokenAmount(token.holders)}</span>
            <span className={dark ? undefined : getRiskTone(token)}>risk {token.risk?.score ?? '—'}</span>
          </div>
          {token.address ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void askGogo(`token risk ${token.address}`)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  dark
                    ? 'border-sky-200/25 bg-sky-200/10 text-sky-100 hover:border-sky-100/50'
                    : 'border-black/10 bg-white/45 hover:border-black/25'
                }`}
              >
                Ask Gogo
              </button>
              <button
                type="button"
                onClick={() => void askGogo(`watch token ${token.address}`)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  dark
                    ? 'border-emerald-200/25 bg-emerald-200/10 text-emerald-100 hover:border-emerald-100/50'
                    : 'border-black/10 bg-white/45 hover:border-black/25'
                }`}
              >
                Watch
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => openExternal(explorerUrl)}
          className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
            dark ? 'border-white/10 bg-white/[0.04] text-white/70 hover:border-sky-200/35' : 'bg-white/45 hover:border-black/25'
          }`}
          style={dark ? undefined : { borderColor: line, color: ink }}
          aria-label={`Open ${getTokenTitle(token)} on ArcScan`}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      {(token.attention?.score != null || token.risk?.label) ? (
        <div className={`mt-3 flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] ${dark ? 'border-white/10 bg-white/[0.03] text-white/58' : 'bg-[#f7f1e5]/80'}`} style={dark ? undefined : { borderColor: line, color: muted }}>
          <Sparkles size={12} color={dark ? '#86efac' : '#118744'} />
          <span>attention {token.attention?.score ?? '—'} · risk {token.risk?.label ?? 'unknown'}</span>
        </div>
      ) : null}
    </div>
  )
}
