import { ArrowLeft, Bell, Bot, CalendarClock, CheckCircle2, ExternalLink, Radar, ShieldAlert, ShieldCheck, Sparkles, Telescope } from 'lucide-react'
import { BLOCKSCOUT_BASE } from '@/lib/constants'
import { ARC_CIRCLE_KNOWLEDGE_UPDATED_AT } from '@/lib/arcCircleKnowledge'
import { MONOCHROME_DARK } from '@/lib/designTokens'

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

const signalLanes = [
  {
    label: 'Onchain deploys',
    value: 'Contract-first',
    detail: 'New ERC-20s, contract age, verified source, owner/mint controls.',
  },
  {
    label: 'Social heat',
    value: 'Cached signals',
    detail: 'Arc meme, Arc token, Circle Arc, mint, launch, faucet, creator chatter.',
  },
  {
    label: 'Community pulse',
    value: 'Discord + X',
    detail: 'Public Discord counts and X/headline signals, never fake activity.',
  },
]

const safetyRules = [
  'No contract address, no tradable label.',
  'No buy recommendation when liquidity or holder distribution is unknown.',
  'Flag risky owner, mint, pause, blacklist, proxy, or unverifiable controls.',
  'Use ArcScan proof links before trusting a token claim.',
  'Default to Arc Testnet until official mainnet details are confirmed.',
]

const buildPhases = [
  {
    title: 'Phase 1 — Guard layer',
    body: 'Manual analyze/watch commands, risk cards, source-backed Arc/Circle knowledge, and proof links.',
    status: 'live',
  },
  {
    title: 'Phase 2 — Scanner endpoint',
    body: 'Backend scans ArcScan / explorer events every minute and stores candidate token launches.',
    status: 'next',
  },
  {
    title: 'Phase 3 — Agent actions',
    body: 'Calendar reminders, watchlist alerts, creator context, and policy-bound USDC actions.',
    status: 'planned',
  },
]

export function ArcRadar({ onBack, onOpenGogo, onOpenCalendar }: ArcRadarProps) {
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
              Arc Testnet
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
                This is not a copy of a token detective. It is ArcCopilot’s control layer: detect signals, explain risk, then route safe actions through Gogo, calendar, and policy.
              </p>
            </div>
          </section>

          <section className="grid grid-cols-3 gap-2">
            {signalLanes.map((lane) => (
              <div key={lane.label} className="border px-2.5 py-3" style={cardStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.035)')}>
                <p className="text-[9px] uppercase tracking-[0.16em] text-arc-hint">{lane.label}</p>
                <p className="mt-1 text-xs font-semibold text-white">{lane.value}</p>
                <p className="mt-2 text-[10px] leading-relaxed text-arc-text-dim">{lane.detail}</p>
              </div>
            ))}
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

          <section className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-arc-hint">Build path</p>
              <span className="text-[10px] text-arc-hint">Knowledge updated {ARC_CIRCLE_KNOWLEDGE_UPDATED_AT}</span>
            </div>
            {buildPhases.map((phase) => (
              <div key={phase.title} className="border px-4 py-3" style={cardStyle('rgba(255,255,255,0.08)', 'rgba(255,255,255,0.035)')}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    phase.status === 'live'
                      ? 'border-emerald-200/30 bg-emerald-200/10 text-emerald-100'
                      : phase.status === 'next'
                        ? 'border-sky-200/30 bg-sky-200/10 text-sky-100'
                        : 'border-white/10 bg-white/[0.04] text-arc-hint'
                  }`}>
                    {phase.status === 'live' ? <CheckCircle2 size={14} /> : phase.status === 'next' ? <Telescope size={14} /> : <CalendarClock size={14} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{phase.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{phase.body}</p>
                  </div>
                </div>
              </div>
            ))}
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
