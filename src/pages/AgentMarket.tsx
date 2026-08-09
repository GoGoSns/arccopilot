import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  Loader2,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
} from 'lucide-react'
import { DEFAULT_AGENT_BACKEND_URL, getAgentBackendConfig } from '@/lib/agentBackend'
import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { inspectX402Resource, type X402PaymentPreview } from '@/lib/x402'
import { listX402PaymentHistory, type X402PaymentHistoryEntry } from '@/lib/x402History'
import { MONOCHROME_DARK } from '@/lib/designTokens'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY, X402_MARKET_AUTOPAY_MODE_STORAGE_KEY } from '@/lib/storageKeys'
import { formatAddress, openSafeUrl, timeAgo } from '@/lib/utils'

interface AgentMarketProps {
  onBack: () => void
  onOpenGogo: () => void
}

type InspectState = 'idle' | 'loading' | 'verified' | 'failed'
type MarketAutopayMode = 'manual' | 'semi' | 'auto'

const AUTOPAY_MODES: Array<{
  id: MarketAutopayMode
  title: string
  badge: string
  body: string
  rule: string
}> = [
  {
    id: 'manual',
    title: 'Manual',
    badge: 'Safest',
    body: 'Every paid service opens a review card. Nothing signs until Pay & access.',
    rule: 'User approves every x402 payment.',
  },
  {
    id: 'semi',
    title: 'Semi-auto',
    badge: 'Recommended',
    body: 'Gogo may inspect and recommend services, but payment still waits for one-tap approval.',
    rule: 'Agent prepares; user signs.',
  },
  {
    id: 'auto',
    title: 'Full auto',
    badge: 'Policy',
    body: 'Reserved for saved caps, allowlists, and repeat services. Current wallet flow still blocks on explicit approval.',
    rule: 'Armed only after policy proof.',
  },
]

function normalizeAutopayMode(value: unknown): MarketAutopayMode {
  return value === 'semi' || value === 'auto' || value === 'manual' ? value : 'manual'
}

function cardStyle(
  backgroundColor: string,
  borderColor: string = MONOCHROME_DARK.colors.border,
  borderRadius: number = MONOCHROME_DARK.radius.card,
) {
  return {
    backgroundColor,
    borderColor,
    borderRadius,
    borderWidth: 1,
    borderStyle: 'solid' as const,
  }
}

function formatDate(timestamp?: number) {
  if (!timestamp) return 'not settled yet'
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function networkLabel(network: string) {
  return network === 'eip155:5042002' ? 'Arc Testnet' : network
}

function HistoryRow({ entry }: { entry: X402PaymentHistoryEntry }) {
  const proof = entry.txHash || entry.transaction || entry.paymentId || 'proof pending'
  return (
    <div className="rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-white">{entry.description}</p>
          <p className="mt-0.5 text-[10px] text-arc-text-dim">
            {entry.amountUsdc} USDC · {networkLabel(entry.network)} · {formatDate(entry.paidAt ?? entry.updatedAt)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
            entry.status === 'paid'
              ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
              : entry.status === 'failed'
                ? 'border-rose-300/25 bg-rose-300/10 text-rose-100'
                : 'border-sky-300/25 bg-sky-300/10 text-sky-100'
          }`}
        >
          {entry.status}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-arc-text-dim">
        <span className="truncate">{proof}</span>
        {entry.repeatCount && entry.repeatCount > 1 ? (
          <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5">x{entry.repeatCount}</span>
        ) : null}
      </div>
    </div>
  )
}

export function AgentMarket({ onBack, onOpenGogo }: AgentMarketProps) {
  const [demoUrl, setDemoUrl] = useState('')
  const [demoPreview, setDemoPreview] = useState<X402PaymentPreview | null>(null)
  const [inspectState, setInspectState] = useState<InspectState>('idle')
  const [inspectError, setInspectError] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [history, setHistory] = useState<X402PaymentHistoryEntry[]>([])
  const [autopayMode, setAutopayMode] = useState<MarketAutopayMode>('manual')

  const paidCount = useMemo(() => history.filter((entry) => entry.status === 'paid').length, [history])
  const repeatCount = useMemo(() => history.reduce((sum, entry) => sum + Math.max(0, (entry.repeatCount ?? 1) - 1), 0), [history])

  const openGogoPrompt = async (prompt: string) => {
    await chromeStorageSet({
      [PENDING_GOGO_PROMPT_STORAGE_KEY]: {
        prompt,
        ts: Date.now(),
      },
      [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai',
    })
    onOpenGogo()
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setInspectState('loading')
      setInspectError('')
      try {
        const config = await getAgentBackendConfig()
        const baseUrl = (config.backendUrl ?? DEFAULT_AGENT_BACKEND_URL).replace(/\/+$/, '')
        const url = `${baseUrl}/x402/arc-insight`
        const [preview, entries, storedMode] = await Promise.all([
          inspectX402Resource(url),
          listX402PaymentHistory(),
          chromeStorageGet(X402_MARKET_AUTOPAY_MODE_STORAGE_KEY).catch(() => ({})),
        ])
        if (cancelled) return
        setDemoUrl(url)
        setDemoPreview(preview)
        setHistory(entries)
        setAutopayMode(normalizeAutopayMode((storedMode as Record<string, unknown>)[X402_MARKET_AUTOPAY_MODE_STORAGE_KEY]))
        setInspectState('verified')
      } catch (error) {
        if (cancelled) return
        const [entries, storedMode] = await Promise.all([
          listX402PaymentHistory().catch(() => []),
          chromeStorageGet(X402_MARKET_AUTOPAY_MODE_STORAGE_KEY).catch(() => ({})),
        ])
        setDemoPreview(null)
        setHistory(entries)
        setAutopayMode(normalizeAutopayMode((storedMode as Record<string, unknown>)[X402_MARKET_AUTOPAY_MODE_STORAGE_KEY]))
        setInspectState('failed')
        setInspectError(error instanceof Error ? error.message : 'Could not verify the demo x402 offer.')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const inspectCustom = () => {
    const url = customUrl.trim()
    if (!url) return
    void openGogoPrompt(modePrompt(`x402 ${url}`))
  }

  const saveAutopayMode = (mode: MarketAutopayMode) => {
    setAutopayMode(mode)
    void chromeStorageSet({ [X402_MARKET_AUTOPAY_MODE_STORAGE_KEY]: mode })
  }

  const modePrompt = (basePrompt: string) => {
    if (autopayMode === 'manual') return basePrompt
    if (autopayMode === 'semi') return `${basePrompt} — semi-auto mode: inspect terms and recommend, but wait for Pay & access`
    return `${basePrompt} — full-auto policy mode: verify cap, allowlist, repeat proof, and never bypass wallet approval`
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-arc-bg text-white">
      <header className="shrink-0 border-b border-arc-border bg-arc-bg/95 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center border text-white"
            style={cardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.pill)}
            aria-label="Back"
          >
            <ArrowLeft size={17} strokeWidth={1.9} />
          </button>
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">Agent Market</p>
            <p className="text-[11px] text-arc-text-dim">x402 services, exact terms, approval-first access.</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section
          className="relative overflow-hidden px-4 py-4"
          style={{
            ...cardStyle('rgba(5, 18, 14, 0.97)', 'rgba(110, 231, 183, 0.24)'),
            backgroundImage:
              'radial-gradient(circle at 80% 20%, rgba(110,231,183,0.20), transparent 35%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: 'auto, 26px 26px, 26px 26px',
          }}
        >
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-200/80">
            <ShoppingBag size={13} />
            x402 marketplace
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.04em]">
            Pay-per-use services, without blind spending.
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-arc-text-dim">
            Regent verifies the offer first: price, network, seller, and resource. It never signs until you review the card and tap Pay & access.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { label: 'verified offers', value: inspectState === 'verified' ? '1' : '0' },
              { label: 'paid locally', value: String(paidCount) },
              { label: 'repeat pays', value: String(repeatCount) },
            ].map((metric) => (
              <div key={metric.label} className="rounded-[14px] border border-emerald-200/15 bg-emerald-200/[0.055] px-2.5 py-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-100/70">{metric.label}</p>
                <p className="mt-1 text-lg font-semibold text-white">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-3" style={cardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border)}>
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Autopay mode</p>
                <p className="mt-1 text-sm font-semibold text-white">How much can Gogo prepare alone?</p>
              </div>
              <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
                {autopayMode}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 px-4 py-4">
            {AUTOPAY_MODES.map((mode) => {
              const selected = autopayMode === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => saveAutopayMode(mode.id)}
                  className={`rounded-[18px] border px-3 py-3 text-left transition ${
                    selected
                      ? 'border-emerald-300/35 bg-emerald-300/10'
                      : 'border-white/10 bg-white/[0.035]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{mode.title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-arc-text-dim">{mode.body}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                        selected
                          ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
                          : 'border-white/10 text-arc-text-dim'
                      }`}
                    >
                      {mode.badge}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-arc-text-dim">{mode.rule}</p>
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-3" style={cardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border)}>
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Featured service</p>
                <p className="mt-1 text-sm font-semibold text-white">Regent paid Arc insight</p>
              </div>
              <span
                className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                  inspectState === 'verified'
                    ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
                    : inspectState === 'failed'
                      ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
                      : 'border-sky-300/25 bg-sky-300/10 text-sky-100'
                }`}
              >
                {inspectState === 'verified' ? 'verified' : inspectState === 'failed' ? 'needs retry' : 'checking'}
              </span>
            </div>
          </div>

          <div className="space-y-3 px-4 py-4">
            {inspectState === 'loading' ? (
              <div className="flex items-center gap-2 rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-arc-text-dim">
                <Loader2 size={15} className="animate-spin" />
                Reading the live x402 offer...
              </div>
            ) : inspectState === 'failed' ? (
              <div className="rounded-[16px] border border-amber-300/20 bg-amber-300/10 px-3 py-3 text-xs leading-relaxed text-amber-100">
                {inspectError || 'Could not verify this x402 resource yet.'}
              </div>
            ) : demoPreview ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-arc-text-dim">Exact price</p>
                    <p className="mt-1 text-sm font-semibold">{demoPreview.amountUsdc} USDC</p>
                  </div>
                  <div className="rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-arc-text-dim">Network</p>
                    <p className="mt-1 text-sm font-semibold">{networkLabel(demoPreview.network)}</p>
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-arc-text-dim">Seller</p>
                  <p className="mt-1 font-mono text-xs text-white">{formatAddress(demoPreview.payTo, 6)}</p>
                </div>
                <p className="text-xs leading-relaxed text-arc-text-dim">{demoPreview.description}</p>
              </>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void openGogoPrompt(modePrompt('x402 demo'))}
                className="rounded-[16px] bg-white px-3 py-3 text-xs font-semibold text-black"
              >
                Pay & access in Gogo
              </button>
              <button
                type="button"
                onClick={() => demoUrl && openSafeUrl(demoUrl)}
                disabled={!demoUrl}
                className="flex items-center justify-center gap-1.5 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-xs font-semibold text-white disabled:opacity-45"
              >
                Raw resource <ExternalLink size={13} />
              </button>
            </div>
          </div>
        </section>

        <section className="mt-3" style={cardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border)}>
          <div className="px-4 py-4">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">
              <Search size={13} />
              paste x402 URL
            </div>
            <p className="mt-1 text-sm font-semibold text-white">Inspect any paid resource through Gogo</p>
            <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">
              Public marketplace discovery is not hardcoded here. Paste a service URL and Gogo will inspect the live 402 terms before any payment card appears.
            </p>
            <input
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              placeholder="https://service.example/path"
              className="mt-3 w-full rounded-[14px] border border-white/10 bg-black/25 px-3 py-3 text-xs text-white outline-none placeholder:text-arc-text-dim focus:border-emerald-300/40"
            />
            <button
              type="button"
              onClick={inspectCustom}
              disabled={!customUrl.trim()}
              className="mt-2 w-full rounded-[16px] border border-emerald-300/25 bg-emerald-300/10 px-3 py-3 text-xs font-semibold text-emerald-50 disabled:opacity-45"
            >
              Inspect offer in Gogo
            </button>
          </div>
        </section>

        <section className="mt-3" style={cardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border)}>
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History size={15} className="text-arc-text-dim" />
                <p className="text-sm font-semibold">Recent x402 proof</p>
              </div>
              <button
                type="button"
                onClick={() => void openGogoPrompt('x402 history')}
                className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-arc-text-dim"
              >
                Open history
              </button>
            </div>
          </div>
          <div className="space-y-2 px-4 py-4">
            {history.length === 0 ? (
              <p className="rounded-[16px] border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-arc-text-dim">
                No local x402 approvals yet. Run x402 demo and approve one paid resource to create proof.
              </p>
            ) : (
              history.slice(0, 4).map((entry) => <HistoryRow key={entry.id} entry={entry} />)
            )}
          </div>
        </section>

        <section className="mt-3 grid grid-cols-1 gap-2 pb-4">
          {[
            { Icon: ShieldCheck, title: 'Approval-first rule', body: 'Market cards can prepare an action, but cannot sign or pay before Pay & access.' },
            { Icon: CheckCircle2, title: 'Exact terms only', body: 'Price, seller, network, txHash, and nonce are displayed only when returned by the real resource.' },
            { Icon: Clock3, title: 'No fake discovery', body: 'Until a live Discovery API is connected, this page uses a verified demo plus paste-your-own x402 URL.' },
            { Icon: Sparkles, title: 'Gogo as buyer agent', body: 'Ask Gogo which service fits a task; it should inspect before it recommends spending.' },
          ].map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-3 rounded-[18px] border border-white/10 bg-white/[0.035] px-3 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-emerald-300/20 bg-emerald-300/10">
                <Icon size={15} className="text-emerald-100" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">{title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-arc-text-dim">{body}</p>
              </div>
            </div>
          ))}
        </section>

        {history[0] ? (
          <p className="pb-4 text-center text-[10px] text-arc-text-dim">
            Last market activity {timeAgo(history[0].updatedAt)}
          </p>
        ) : null}
      </main>
    </div>
  )
}
