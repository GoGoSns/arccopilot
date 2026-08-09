import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, ChevronDown, Info, ShieldAlert, Shuffle, Sparkles } from 'lucide-react'
import { chromeStorageSet } from '@/lib/external'
import { PENDING_GOGO_PROMPT_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'

interface ArcSwapPreflightProps {
  onBack: () => void
  onOpenGogo?: () => void
}

const tokens = [
  { symbol: 'USDC', name: 'USD Coin', address: '0x3600000000000000000000000000000000000000', decimals: 6, core: true },
  { symbol: 'EURC', name: 'EURC', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6, core: true },
  { symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', address: 'Arc-listed token; verify exact route before execution', decimals: 8, core: true },
] as const

const slippageOptions = [
  { label: '0.1%', bps: 10, risk: 'Tight; may fail if route moves.' },
  { label: '0.5%', bps: 50, risk: 'Balanced for stable pairs.' },
  { label: '1.0%', bps: 100, risk: 'More tolerant; more price movement exposure.' },
] as const

function getToken(symbol: string) {
  return tokens.find((token) => token.symbol === symbol) ?? tokens[0]
}

export function ArcSwapPreflight({ onBack, onOpenGogo }: ArcSwapPreflightProps) {
  const [amount, setAmount] = useState('1')
  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [slippageBps, setSlippageBps] = useState(50)

  const from = getToken(tokenIn)
  const to = getToken(tokenOut)
  const slippage = slippageOptions.find((item) => item.bps === slippageBps) ?? slippageOptions[1]
  const amountNumber = Number(amount)
  const blockers = useMemo(() => [
    !Number.isFinite(amountNumber) || amountNumber <= 0 ? 'Enter a positive amount.' : null,
    from.symbol === to.symbol ? 'Choose two different tokens.' : null,
    from.symbol === 'cirBTC' || to.symbol === 'cirBTC' ? 'cirBTC route must be verified by a server-side App Kit quote before signing.' : null,
  ].filter(Boolean), [amountNumber, from.symbol, to.symbol])

  const askGogo = async () => {
    await chromeStorageSet({
      [PENDING_GOGO_PROMPT_STORAGE_KEY]: {
        prompt: `swap preflight ${amount || '1'} ${from.symbol} to ${to.symbol} on Arc Testnet with ${slippage.label} slippage`,
        ts: Date.now(),
      },
      [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai',
    })
    onOpenGogo?.()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f1ecdf] text-[#14120f]">
      <header className="shrink-0 border-b border-black/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white/70" aria-label="Back">
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">Arc Swap Preflight</p>
            <p className="text-[11px] text-black/50">App Kit-ready quote desk · no signature yet</p>
          </div>
          <Shuffle size={18} className="text-black/45" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section className="rounded-[30px] border border-black/10 bg-white/70 p-4 shadow-[0_18px_55px_rgba(20,18,15,0.08)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-700">Arc Testnet</p>
          <label className="mt-3 block">
            <span className="text-[11px] text-black/50">You pay</span>
            <div className="mt-1 flex items-center gap-2 rounded-2xl border border-black/10 bg-[#faf7ef] px-3 py-2">
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-[-0.05em] outline-none" />
              <select value={tokenIn} onChange={(event) => setTokenIn(event.target.value)} className="rounded-full border border-black/10 bg-white px-2 py-1 text-xs font-semibold outline-none">
                {tokens.map((token) => <option key={token.symbol}>{token.symbol}</option>)}
              </select>
            </div>
          </label>

          <div className="my-3 flex justify-center">
            <button
              type="button"
              onClick={() => {
                setTokenIn(tokenOut)
                setTokenOut(tokenIn)
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white"
              aria-label="Reverse swap pair"
            >
              <ArrowRight size={16} className="rotate-90" />
            </button>
          </div>

          <label className="block">
            <span className="text-[11px] text-black/50">You receive</span>
            <div className="mt-1 flex items-center justify-between rounded-2xl border border-black/10 bg-[#faf7ef] px-3 py-3">
              <span className="text-sm font-semibold text-black/45">Server quote required</span>
              <select value={tokenOut} onChange={(event) => setTokenOut(event.target.value)} className="rounded-full border border-black/10 bg-white px-2 py-1 text-xs font-semibold outline-none">
                {tokens.map((token) => <option key={token.symbol}>{token.symbol}</option>)}
              </select>
            </div>
          </label>
        </section>

        <section className="mt-3 rounded-[24px] border border-black/10 bg-white/70 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Quote controls</p>
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700">PREVIEW ONLY</span>
          </div>
          <label className="mt-3 block rounded-2xl border border-black/10 bg-[#faf7ef] px-3 py-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45">Slippage</span>
            <div className="mt-1 flex items-center gap-2">
              <select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} className="flex-1 bg-transparent text-sm font-semibold outline-none">
                {slippageOptions.map((option) => <option key={option.bps} value={option.bps}>{option.label}</option>)}
              </select>
              <ChevronDown size={14} />
            </div>
            <p className="mt-1 text-[10px] text-black/50">{slippage.risk}</p>
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-2xl border border-black/10 bg-[#faf7ef] p-3">
              <p className="font-mono uppercase tracking-[0.16em] text-black/45">Route</p>
              <p className="mt-1 font-semibold">{from.symbol} → {to.symbol}</p>
            </div>
            <div className="rounded-2xl border border-black/10 bg-[#faf7ef] p-3">
              <p className="font-mono uppercase tracking-[0.16em] text-black/45">Decimals</p>
              <p className="mt-1 font-semibold">{from.decimals} → {to.decimals}</p>
            </div>
          </div>
        </section>

        <section className="mt-3 rounded-[24px] border border-black/10 bg-[#14120f] p-4 text-white">
          <div className="flex gap-2">
            <ShieldAlert size={17} className="mt-0.5 text-emerald-300" />
            <div>
              <p className="text-sm font-semibold">Risk line</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                Swap Kit/App Kit quotes need a server-side kit key. ArcCopilot does not expose that key in the extension and does not request a wallet signature from this screen.
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-[11px] text-white/58">
            <li>• Chain: Arc_Testnet / 5042002.</li>
            <li>• Core tokens only: USDC, EURC, cirBTC.</li>
            <li>• Aggregator route must be quoted before execution.</li>
            <li>• Nothing has been signed yet.</li>
          </ul>
          {blockers.length > 0 && (
            <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-[11px] text-amber-100">
              {blockers.map((blocker) => <p key={blocker}>• {blocker}</p>)}
            </div>
          )}
          <button type="button" onClick={() => void askGogo()} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#14120f]">
            <Bot size={16} />
            Ask Gogo to analyze preflight
          </button>
        </section>

        <section className="mt-3 rounded-[18px] border border-black/10 bg-white/60 p-3">
          <div className="flex gap-2">
            <Info size={15} className="mt-0.5" />
            <p className="text-[11px] leading-relaxed text-black/55">
              This is a product surface for safe review. Live quote + execution should be added via a backend App Kit endpoint with KIT_KEY stored only on the server.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
