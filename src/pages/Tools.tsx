import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronRight,
  FileText,
  GitBranch,
  Radar,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { chromeStorageSet } from '@/lib/external'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'
import { MONOCHROME_DARK } from '@/lib/designTokens'

interface ToolsProps {
  onBack: () => void
  onOpenGogo: () => void
  onOpenRadar: () => void
  onOpenBridge: () => void
  onOpenCalendar: () => void
  onOpenAddressBook: () => void
  onOpenBrief: () => void
  onOpenSettings: () => void
}

type ToolItem = {
  title: string
  eyebrow: string
  body: string
  badge: string
  tone: 'emerald' | 'sky' | 'violet' | 'amber' | 'white'
  Icon: typeof Sparkles
  onClick: () => void
}

const toneStyles = {
  emerald: {
    border: 'rgba(110, 231, 183, 0.22)',
    bg: 'rgba(110, 231, 183, 0.08)',
    text: 'rgb(167, 243, 208)',
  },
  sky: {
    border: 'rgba(125, 211, 252, 0.22)',
    bg: 'rgba(125, 211, 252, 0.08)',
    text: 'rgb(186, 230, 253)',
  },
  violet: {
    border: 'rgba(196, 181, 253, 0.24)',
    bg: 'rgba(196, 181, 253, 0.09)',
    text: 'rgb(221, 214, 254)',
  },
  amber: {
    border: 'rgba(252, 211, 77, 0.24)',
    bg: 'rgba(252, 211, 77, 0.08)',
    text: 'rgb(254, 240, 138)',
  },
  white: {
    border: 'rgba(255, 255, 255, 0.13)',
    bg: 'rgba(255, 255, 255, 0.055)',
    text: 'rgb(255, 255, 255)',
  },
} as const

function makeCardStyle(backgroundColor: string, borderColor: string, borderRadius: number) {
  return {
    backgroundColor,
    borderColor,
    borderRadius,
    borderWidth: 1,
    borderStyle: 'solid' as const,
  }
}

export function Tools({
  onBack,
  onOpenGogo,
  onOpenRadar,
  onOpenBridge,
  onOpenCalendar,
  onOpenAddressBook,
  onOpenBrief,
  onOpenSettings,
}: ToolsProps) {
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

  const tools: ToolItem[] = [
    {
      title: 'Gogo AI',
      eyebrow: 'Assistant',
      body: 'Ask, plan, analyze, and prepare policy-bound USDC actions.',
      badge: 'Core',
      tone: 'emerald',
      Icon: Sparkles,
      onClick: onOpenGogo,
    },
    {
      title: 'Agent Stack',
      eyebrow: 'Circle',
      body: 'Verify wallet, policy, backend, Gateway/x402, scheduler, and bridge state.',
      badge: 'Proof',
      tone: 'violet',
      Icon: ShieldCheck,
      onClick: () => void openGogoPrompt('agent stack status'),
    },
    {
      title: 'Arc Radar',
      eyebrow: 'Safety',
      body: 'Track Arc token signals, contract proof, risk, and early meme movement.',
      badge: 'Watch',
      tone: 'sky',
      Icon: Radar,
      onClick: onOpenRadar,
    },
    {
      title: 'Arc Bridge',
      eyebrow: 'CCTP',
      body: 'Prepare USDC bridge routes before any signature or real transfer.',
      badge: 'Preflight',
      tone: 'emerald',
      Icon: GitBranch,
      onClick: onOpenBridge,
    },
    {
      title: 'Calendar',
      eyebrow: 'Planner',
      body: 'Review reminders, scheduled USDC actions, and due follow-ups.',
      badge: 'Time',
      tone: 'amber',
      Icon: CalendarDays,
      onClick: onOpenCalendar,
    },
    {
      title: 'Address Book',
      eyebrow: 'Memory',
      body: 'Saved recipients, labels, whales, notes, and risk context.',
      badge: 'People',
      tone: 'white',
      Icon: BookOpen,
      onClick: onOpenAddressBook,
    },
    {
      title: 'Brief',
      eyebrow: 'Signals',
      body: 'Wallet, portfolio, news, and ecosystem pulse in one read.',
      badge: 'Daily',
      tone: 'white',
      Icon: FileText,
      onClick: onOpenBrief,
    },
    {
      title: 'Settings',
      eyebrow: 'Control',
      body: 'Keys, backend URL, provider, topics, and extension controls.',
      badge: 'Config',
      tone: 'white',
      Icon: Settings2,
      onClick: onOpenSettings,
    },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-arc-bg text-white">
      <header className="shrink-0 border-b border-arc-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center border text-white"
            style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.pill)}
            aria-label="Back"
          >
            <ArrowLeft size={17} strokeWidth={1.9} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">Tools</p>
            <p className="text-[11px] text-arc-text-dim">Everything ArcCopilot can see, know, prepare, and prove.</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section
          className="relative overflow-hidden border px-4 py-4"
          style={{
            ...makeCardStyle('rgba(6, 18, 15, 0.96)', 'rgba(110, 231, 183, 0.22)', MONOCHROME_DARK.radius.card),
            backgroundImage:
              'radial-gradient(circle at 88% 12%, rgba(110,231,183,0.18), transparent 34%), linear-gradient(rgba(255,255,255,0.034) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.034) 1px, transparent 1px)',
            backgroundSize: 'auto, 28px 28px, 28px 28px',
          }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-200/80">Control surface</div>
          <p className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.04em]">
            Signal → Risk → Policy → Action → Proof
          </p>
          <p className="mt-2 text-xs leading-relaxed text-arc-text-dim">
            The wallet stays clean; advanced agent tools live here.
          </p>
        </section>

        <section className="mt-3 grid grid-cols-2 gap-2">
          {tools.map(({ title, eyebrow, body, badge, tone, Icon, onClick }) => {
            const toneStyle = toneStyles[tone]
            return (
              <button
                key={title}
                type="button"
                onClick={onClick}
                className="group min-h-[146px] overflow-hidden border p-3 text-left transition-transform active:scale-[0.99]"
                style={makeCardStyle(toneStyle.bg, toneStyle.border, MONOCHROME_DARK.radius.card)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center border"
                    style={makeCardStyle('rgba(0,0,0,0.18)', toneStyle.border, MONOCHROME_DARK.radius.iconTile)}
                  >
                    <Icon size={18} strokeWidth={1.8} style={{ color: toneStyle.text }} />
                  </div>
                  <span
                    className="rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
                    style={{ borderColor: toneStyle.border, color: toneStyle.text }}
                  >
                    {badge}
                  </span>
                </div>
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: toneStyle.text }}>
                  {eyebrow}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{title}</p>
                <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-arc-text-dim">{body}</p>
                <ChevronRight size={15} className="mt-3 text-white/35 transition-transform group-hover:translate-x-0.5" />
              </button>
            )
          })}
        </section>
      </main>
    </div>
  )
}
