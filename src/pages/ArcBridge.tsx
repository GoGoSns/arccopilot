import { useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  History,
  Info,
  Network,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { chromeStorageSet } from '@/lib/external'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'

interface ArcBridgeProps {
  onBack: () => void
  onOpenGogo?: () => void
}

type BridgeChain = {
  id: string
  label: string
  short: string
  appKitChain: string
  type: 'EVM' | 'Solana'
  chainId?: number
}

const chains: BridgeChain[] = [
  { id: 'ethereum-sepolia', label: 'Ethereum Sepolia', short: 'ETH Sep', appKitChain: 'Ethereum_Sepolia', type: 'EVM' },
  { id: 'base-sepolia', label: 'Base Sepolia', short: 'Base', appKitChain: 'Base_Sepolia', type: 'EVM' },
  { id: 'arbitrum-sepolia', label: 'Arbitrum Sepolia', short: 'Arb', appKitChain: 'Arbitrum_Sepolia', type: 'EVM' },
  { id: 'solana-devnet', label: 'Solana Devnet', short: 'Sol Dev', appKitChain: 'Solana_Devnet', type: 'Solana' },
  { id: 'arc-testnet', label: 'Arc Testnet', short: 'Arc', appKitChain: 'Arc_Testnet', type: 'EVM', chainId: 5042002 },
]

const popularRoutes = [
  ['ethereum-sepolia', 'arc-testnet'],
  ['base-sepolia', 'arc-testnet'],
  ['arc-testnet', 'base-sepolia'],
  ['solana-devnet', 'arc-testnet'],
] as const

const bridgeSteps = [
  ['Approve', 'Exact USDC allowance'],
  ['Burn', 'Source-chain USDC'],
  ['Attest', 'Circle proof'],
  ['Mint', 'Destination USDC'],
] as const

const bg = '#f1ecdf'
const ink = '#14120f'
const muted = '#6d6558'
const line = 'rgba(20, 18, 15, 0.14)'
const green = '#24d66f'
const blue = '#7b8cff'

function getChain(id: string): BridgeChain {
  return chains.find((chain) => chain.id === id) ?? chains[0]
}

function openExternal(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function ArcBridge({ onBack, onOpenGogo }: ArcBridgeProps) {
  const [amount, setAmount] = useState('1')
  const [sourceId, setSourceId] = useState('ethereum-sepolia')
  const [destinationId, setDestinationId] = useState('arc-testnet')
  const [recipient, setRecipient] = useState('')
  const [speed, setSpeed] = useState<'FAST' | 'STANDARD'>('FAST')

  const source = getChain(sourceId)
  const destination = getChain(destinationId)
  const parsedAmount = Number(amount)

  const blockers = useMemo(() => {
    const next: string[] = []
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      next.push('Amount required')
    }
    if (source.id === destination.id) {
      next.push('Pick different chains')
    }
    if (source.id !== 'arc-testnet' && destination.id !== 'arc-testnet') {
      next.push('Route must include Arc Testnet')
    }
    if (recipient.trim() && destination.type === 'EVM' && !/^0x[a-fA-F0-9]{40}$/.test(recipient.trim())) {
      next.push('Recipient is not a valid EVM address')
    }
    if (Number.isFinite(parsedAmount) && parsedAmount > 100) {
      next.push('Large amount needs extra confirmation')
    }
    return next
  }, [amount, parsedAmount, recipient, source.id, destination.id, destination.type])

  const routeReady = blockers.length === 0

  const askGogoPrompt = async (prompt: string) => {
    await chromeStorageSet({
      [PENDING_GOGO_PROMPT_STORAGE_KEY]: { prompt, ts: Date.now() },
      [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai',
    })
    onOpenGogo?.()
  }

  const askGogo = async () => {
    const prompt = `bridge ${amount.trim() || '1'} USDC from ${source.label} to ${destination.label}${recipient.trim() ? ` for recipient ${recipient.trim()}` : ''} using ${speed} speed`
    await askGogoPrompt(prompt)
  }

  const toolTiles = [
    { label: 'Route', Icon: ArrowDownUp, action: askGogo },
    { label: 'Analyze', Icon: Bot, action: askGogo },
    { label: 'Docs', Icon: ExternalLink, action: () => openExternal('https://docs.arc.network/app-kit') },
    { label: 'CCTP', Icon: GitBranch, action: () => openExternal('https://developers.circle.com/cctp') },
    { label: 'History', Icon: History, action: () => askGogoPrompt('arc bridge history') },
    { label: 'Settings', Icon: Settings2, action: () => askGogoPrompt('agent stack status') },
  ]

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        color: ink,
        backgroundColor: bg,
        backgroundImage:
          'linear-gradient(rgba(20,18,15,0.046) 1px, transparent 1px), linear-gradient(90deg, rgba(20,18,15,0.046) 1px, transparent 1px)',
        backgroundSize: '22px 22px, 22px 22px',
      }}
    >
      <header className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full border bg-white/55"
            style={{ borderColor: line }}
            aria-label="Back"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0 text-center">
            <p className="text-sm font-semibold leading-tight">Arc Bridge</p>
            <p className="text-[10px]" style={{ color: muted }}>CCTP preflight desk</p>
          </div>
          <button
            type="button"
            onClick={() => openExternal('https://testnet.arcscan.app')}
            className="flex h-9 w-9 items-center justify-center rounded-full border bg-white/55"
            style={{ borderColor: line }}
            aria-label="Open ArcScan"
          >
            <Network size={16} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <section
          className="relative overflow-hidden rounded-[30px] px-5 pb-5 pt-6 text-white shadow-[0_18px_55px_rgba(65,79,220,0.22)]"
          style={{
            background:
              'linear-gradient(135deg, #7d8cff 0%, #8b73f7 46%, #7bb7ff 100%)',
          }}
        >
          <div className="absolute right-[-34px] top-[-34px] h-28 w-28 rounded-full border border-white/20" />
          <div className="absolute bottom-[-48px] left-[-28px] h-32 w-32 rounded-full bg-white/10 blur-xl" />

          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/82">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                Arc Testnet
              </div>
              <p className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.055em]">
                {amount || '—'} USDC
              </p>
              <p className="mt-2 text-sm text-white/70">Bridge preflight · no signature yet</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSourceId(destinationId)
                setDestinationId(sourceId)
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/14 text-white"
              aria-label="Swap bridge direction"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="relative mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="min-h-10 rounded-xl border border-white/18 bg-white/15 px-3 text-xs font-semibold outline-none"
            >
              {chains.map((chain) => (
                <option key={chain.id} value={chain.id} className="bg-[#1b1b24] text-white">
                  {chain.label}
                </option>
              ))}
            </select>
            <ArrowRight size={16} className="text-white/60" />
            <select
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              className="min-h-10 rounded-xl border border-white/18 bg-white/15 px-3 text-xs font-semibold outline-none"
            >
              {chains.map((chain) => (
                <option key={chain.id} value={chain.id} className="bg-[#1b1b24] text-white">
                  {chain.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="mt-3 rounded-[22px] border bg-white/72 p-3 shadow-[0_12px_40px_rgba(20,18,15,0.07)]" style={{ borderColor: line }}>
          <div className="grid grid-cols-3 gap-2">
            {toolTiles.map(({ label, Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => void action()}
                className="flex min-h-[70px] flex-col items-center justify-center gap-2 rounded-2xl border bg-white/72 text-center transition-transform active:scale-[0.98]"
                style={{ borderColor: line }}
              >
                <Icon size={18} strokeWidth={1.8} style={{ color: label === 'Analyze' ? blue : ink }} />
                <span className="text-[11px] font-medium">{label}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="rounded-2xl border bg-[#f8f5ee] p-3" style={{ borderColor: line }}>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: muted }}>Amount</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="mt-1 w-full bg-transparent text-lg font-semibold outline-none"
                placeholder="1"
              />
            </label>
            <label className="rounded-2xl border bg-[#f8f5ee] p-3" style={{ borderColor: line }}>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: muted }}>Recipient</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                className="mt-1 w-full bg-transparent text-xs font-semibold outline-none"
                placeholder="same / 0x..."
              />
            </label>
          </div>
          <label className="mt-2 block rounded-2xl border bg-[#f8f5ee] p-3" style={{ borderColor: line }}>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: muted }}>Fee / speed</span>
            <select
              value={speed}
              onChange={(event) => setSpeed(event.target.value === 'STANDARD' ? 'STANDARD' : 'FAST')}
              className="mt-1 w-full bg-transparent text-sm font-semibold outline-none"
            >
              <option value="FAST">FAST - usually 8-20s - dynamic forwarding fee</option>
              <option value="STANDARD">STANDARD - usually 15-19m - lower urgency</option>
            </select>
            <p className="mt-1 text-[10px]" style={{ color: muted }}>
              Exact fees must come from the bridge SDK / IRIS route at execution time. No fee is invented here.
            </p>
          </label>
        </section>

        <section className="mt-3 overflow-hidden rounded-[22px] border bg-white/72 shadow-[0_12px_40px_rgba(20,18,15,0.06)]" style={{ borderColor: line }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderBottomColor: line }}>
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck size={16} style={{ color: routeReady ? '#11904d' : '#a76a12' }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{routeReady ? 'Ready for Gogo review' : 'Needs attention'}</p>
                <p className="truncate text-[11px]" style={{ color: muted }}>
                  {source.short} → {destination.short} · {source.appKitChain} → {destination.appKitChain}
                </p>
              </div>
            </div>
            <span className="rounded-full border px-2 py-1 text-[10px] font-semibold" style={{ borderColor: line, color: routeReady ? '#11904d' : '#a76a12' }}>
              {routeReady ? 'SAFE' : blockers.length}
            </span>
          </div>

          {blockers.length > 0 ? (
            <div className="px-4 py-3">
              <ul className="space-y-1 text-xs" style={{ color: muted }}>
                {blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
              </ul>
            </div>
          ) : (
            <div className="flex items-start gap-2 px-4 py-3">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: '#11904d' }} />
              <p className="text-xs leading-relaxed" style={{ color: muted }}>
                This is still preflight only. A real bridge will require explicit route, amount, recipient, token confirmation, and wallet signing.
              </p>
            </div>
          )}
        </section>

        <section className="mt-3 rounded-[22px] border bg-[#14120f] p-4 text-white" style={{ borderColor: 'rgba(20,18,15,0.22)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">CCTP lifecycle</p>
              <p className="mt-1 text-[11px] text-white/48">Circle-native USDC bridge flow</p>
            </div>
            <Clock3 size={17} className="text-white/45" />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {bridgeSteps.map(([title, body], index) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.045] p-2">
                <p className="font-mono text-[10px] text-emerald-200">{String(index + 1).padStart(2, '0')}</p>
                <p className="mt-2 text-[11px] font-semibold">{title}</p>
                <p className="mt-1 text-[9px] leading-snug text-white/45">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3">
            <p className="text-[11px] font-semibold text-white/82">Failure recovery</p>
            <p className="mt-1 text-[10px] leading-relaxed text-white/48">
              If approve or burn succeeds but attestation or mint fails, the saved bridge result can be retried from the failed step instead of starting over. This screen stays review-only until the user explicitly confirms the route and wallet signature.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void askGogo()}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#14120f] transition-transform active:scale-[0.99]"
          >
            <Bot size={16} />
            Ask Gogo to prepare route
          </button>
        </section>

        <section className="mt-3 rounded-[18px] border bg-white/70 px-3 py-2" style={{ borderColor: line }}>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-2 truncate">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#ff5a2a] text-[10px] font-bold text-white">C</span>
              <span className="truncate">Circle CCTP · Connected concept</span>
            </span>
            <button
              type="button"
              onClick={() => openExternal('https://docs.arc.network/app-kit')}
              className="flex shrink-0 items-center gap-1 rounded-full border bg-white px-2 py-1 font-medium"
              style={{ borderColor: line }}
            >
              Docs <ExternalLink size={11} />
            </button>
          </div>
        </section>

        <section className="mt-3 rounded-[22px] border bg-white/50 p-3" style={{ borderColor: line }}>
          <div className="flex items-center gap-2">
            <Info size={15} />
            <p className="text-xs font-semibold">Quick routes</p>
          </div>
          <div className="mt-2 grid gap-2">
            {popularRoutes.map(([from, to]) => {
              const routeSource = getChain(from)
              const routeDestination = getChain(to)
              return (
                <button
                  key={`${from}-${to}`}
                  type="button"
                  onClick={() => {
                    setSourceId(from)
                    setDestinationId(to)
                  }}
                  className="flex items-center justify-between rounded-2xl border bg-white/60 px-3 py-2 text-left text-[11px]"
                  style={{ borderColor: line }}
                >
                  <span>{routeSource.label}</span>
                  <ArrowRight size={12} style={{ color: muted }} />
                  <span>{routeDestination.label}</span>
                </button>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
