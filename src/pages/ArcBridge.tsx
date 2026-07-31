import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, ExternalLink, GitBranch, Info, ShieldCheck } from 'lucide-react'
import { chromeStorageSet } from '@/lib/external'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'

interface ArcBridgeProps {
  onBack: () => void
  onOpenGogo?: () => void
}

type BridgeChain = {
  id: string
  label: string
  appKitChain: string
  type: 'EVM' | 'Solana'
  chainId?: number
  explorer?: string
}

const chains: BridgeChain[] = [
  {
    id: 'ethereum-sepolia',
    label: 'Ethereum Sepolia',
    appKitChain: 'Ethereum_Sepolia',
    type: 'EVM',
  },
  {
    id: 'base-sepolia',
    label: 'Base Sepolia',
    appKitChain: 'Base_Sepolia',
    type: 'EVM',
  },
  {
    id: 'arbitrum-sepolia',
    label: 'Arbitrum Sepolia',
    appKitChain: 'Arbitrum_Sepolia',
    type: 'EVM',
  },
  {
    id: 'solana-devnet',
    label: 'Solana Devnet',
    appKitChain: 'Solana_Devnet',
    type: 'Solana',
  },
  {
    id: 'arc-testnet',
    label: 'Arc Testnet',
    appKitChain: 'Arc_Testnet',
    type: 'EVM',
    chainId: 5042002,
    explorer: 'https://testnet.arcscan.app',
  },
]

const popularRoutes = [
  ['ethereum-sepolia', 'arc-testnet'],
  ['base-sepolia', 'arc-testnet'],
  ['arc-testnet', 'base-sepolia'],
  ['solana-devnet', 'arc-testnet'],
] as const

const bridgeSteps = [
  ['01', 'Approve', 'Allow Circle CCTP to use the exact USDC amount on the source chain.'],
  ['02', 'Burn', 'Burn source-chain USDC and create a message for the destination chain.'],
  ['03', 'Attest', 'Fetch Circle attestation; fast mode is normally seconds, standard mode is minutes.'],
  ['04', 'Mint', 'Mint native USDC on the destination chain, optionally through the forwarding service.'],
] as const

const paper = '#f0eadc'
const ink = '#12110f'
const muted = '#6b6254'
const green = '#25d66f'
const line = 'rgba(18, 17, 15, 0.14)'

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

  const source = getChain(sourceId)
  const destination = getChain(destinationId)

  const parsedAmount = Number(amount)
  const blockers = useMemo(() => {
    const next: string[] = []
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      next.push('Enter a positive USDC amount.')
    }
    if (source.id === destination.id) {
      next.push('Source and destination must be different.')
    }
    if (source.id !== 'arc-testnet' && destination.id !== 'arc-testnet') {
      next.push('At least one side should be Arc Testnet for this ArcCopilot bridge flow.')
    }
    if (recipient.trim() && destination.type === 'EVM' && !/^0x[a-fA-F0-9]{40}$/.test(recipient.trim())) {
      next.push('Recipient should be a valid EVM address for this destination.')
    }
    if (Number.isFinite(parsedAmount) && parsedAmount > 100) {
      next.push('Large bridge amount: require an extra manual confirmation before any real transfer.')
    }
    return next
  }, [amount, parsedAmount, recipient, source.id, destination.id, destination.type])

  const askGogo = async () => {
    const prompt = `bridge ${amount.trim() || '1'} USDC from ${source.label} to ${destination.label}${recipient.trim() ? ` for recipient ${recipient.trim()}` : ''}`
    await chromeStorageSet({
      [PENDING_GOGO_PROMPT_STORAGE_KEY]: {
        prompt,
        ts: Date.now(),
      },
      [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai',
    })
    onOpenGogo?.()
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        color: ink,
        backgroundColor: paper,
        backgroundImage:
          'linear-gradient(rgba(18,17,15,0.052) 1px, transparent 1px), linear-gradient(90deg, rgba(18,17,15,0.052) 1px, transparent 1px), radial-gradient(circle at 78% 12%, rgba(37,214,111,0.14), transparent 30%)',
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
              <p className="text-base font-semibold leading-tight">Arc Bridge</p>
              <p className="text-[11px]" style={{ color: muted }}>USDC route preflight for Circle CCTP</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openExternal('https://docs.arc.network/app-kit/bridge')}
            className="flex h-10 w-10 items-center justify-center rounded-full border bg-white/45"
            style={{ borderColor: line }}
            aria-label="Open bridge docs"
          >
            <ExternalLink size={16} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section className="rounded-[28px] border bg-white/40 p-4 shadow-[0_18px_55px_rgba(18,17,15,0.08)]" style={{ borderColor: line }}>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: '#138743' }}>Bridge desk</div>
          <h1 className="mt-3 text-[34px] font-semibold leading-[0.96] tracking-[-0.07em]">
            Move USDC
            <span className="block font-serif italic font-normal tracking-[-0.04em]" style={{ color: green }}>into Arc</span>
          </h1>
          <p className="mt-4 max-w-[270px] text-sm leading-relaxed" style={{ color: muted }}>
            This screen prepares the route, checks obvious blockers, and explains the CCTP flow before any wallet signature.
          </p>

          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="rounded-2xl border bg-[#12110f] p-3 text-white" style={{ borderColor: 'rgba(18,17,15,0.22)' }}>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">From</p>
              <select
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                className="mt-2 w-full bg-transparent text-sm font-semibold outline-none"
              >
                {chains.map((chain) => (
                  <option key={chain.id} value={chain.id} className="bg-[#12110f] text-white">
                    {chain.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-white/45">{source.appKitChain}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border bg-white" style={{ borderColor: line }}>
              <ArrowRight size={15} />
            </div>
            <div className="rounded-2xl border bg-[#12110f] p-3 text-white" style={{ borderColor: 'rgba(18,17,15,0.22)' }}>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">To</p>
              <select
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
                className="mt-2 w-full bg-transparent text-sm font-semibold outline-none"
              >
                {chains.map((chain) => (
                  <option key={chain.id} value={chain.id} className="bg-[#12110f] text-white">
                    {chain.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-white/45">{destination.appKitChain}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="rounded-2xl border bg-white/55 p-3" style={{ borderColor: line }}>
              <span className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: muted }}>Amount</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="mt-1 w-full bg-transparent text-lg font-semibold outline-none"
                placeholder="1"
              />
              <span className="text-[10px]" style={{ color: muted }}>USDC · 6 decimals</span>
            </label>
            <label className="rounded-2xl border bg-white/55 p-3" style={{ borderColor: line }}>
              <span className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: muted }}>Recipient</span>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                className="mt-1 w-full bg-transparent text-sm font-semibold outline-none"
                placeholder="same wallet / 0x..."
              />
              <span className="text-[10px]" style={{ color: muted }}>optional preflight</span>
            </label>
          </div>
        </section>

        <section className="mt-3 rounded-[24px] border bg-[#12110f] p-4 text-white" style={{ borderColor: 'rgba(18,17,15,0.22)' }}>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-200/20 bg-emerald-200/10 text-emerald-100">
              <ShieldCheck size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Preflight result</p>
              <p className="mt-1 text-xs leading-relaxed text-white/58">
                {source.label} → {destination.label} · {amount || '—'} USDC · no signature requested.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/45">App Kit route</p>
            <p className="mt-1 break-all text-sm font-medium">{source.appKitChain} → {destination.appKitChain}</p>
            {destination.chainId ? <p className="mt-1 text-[11px] text-white/50">Arc chain id: {destination.chainId}</p> : null}
          </div>

          {blockers.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-amber-200/20 bg-amber-200/10 p-3">
              <p className="text-xs font-semibold text-amber-100">Needs attention</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-amber-50/78">
                {blockers.map((blocker) => <li key={blocker}>• {blocker}</li>)}
              </ul>
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-200/20 bg-emerald-200/10 p-3 text-emerald-50">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">Route looks valid for a testnet bridge preflight. A real transfer still requires explicit confirmation and wallet signing.</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void askGogo()}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#12110f] transition-transform active:scale-[0.99]"
          >
            <Bot size={16} />
            Ask Gogo to analyze this bridge
          </button>
        </section>

        <section className="mt-3 rounded-[24px] border bg-white/42 p-4" style={{ borderColor: line }}>
          <div className="flex items-center gap-2">
            <GitBranch size={16} />
            <p className="text-sm font-semibold">CCTP steps</p>
          </div>
          <div className="mt-3 space-y-2">
            {bridgeSteps.map(([index, title, body]) => (
              <div key={index} className="grid grid-cols-[34px_1fr] gap-3 rounded-2xl border bg-white/45 p-3" style={{ borderColor: line }}>
                <span className="font-mono text-xs" style={{ color: '#138743' }}>{index}</span>
                <span>
                  <span className="block text-xs font-semibold">{title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed" style={{ color: muted }}>{body}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-3 rounded-[24px] border bg-white/42 p-4" style={{ borderColor: line }}>
          <div className="flex items-center gap-2">
            <Info size={16} />
            <p className="text-sm font-semibold">Fast routes</p>
          </div>
          <div className="mt-3 grid gap-2">
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
                  className="flex items-center justify-between rounded-2xl border bg-white/45 px-3 py-2 text-left text-xs"
                  style={{ borderColor: line }}
                >
                  <span>{routeSource.label}</span>
                  <ArrowRight size={13} style={{ color: muted }} />
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
