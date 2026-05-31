import { ArrowLeft, Copy } from 'lucide-react'

interface ReceiveProps {
  onBack: () => void
}

export function Receive({ onBack }: ReceiveProps) {
  const address = '0x1a2b3c4d5e6f7890abcd1234'

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Receive USDC</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
        {/* QR placeholder */}
        <div className="w-48 h-48 bg-white rounded-2xl flex items-center justify-center">
          <div className="w-40 h-40 bg-arc-bg rounded-xl grid grid-cols-5 gap-1 p-2">
            {Array.from({ length: 25 }).map((_, i) => (
              <div key={i} className={`rounded-sm ${Math.random() > 0.5 ? 'bg-white' : 'bg-arc-bg'}`} />
            ))}
          </div>
        </div>

        <div className="text-center space-y-2">
          <p className="text-xs text-arc-text-dim">Your Arc Testnet address</p>
          <p className="text-sm font-mono text-arc-text break-all">{address}</p>
          <button
            onClick={() => navigator.clipboard.writeText(address)}
            className="flex items-center gap-1.5 mx-auto text-xs text-arc-gold hover:text-arc-gold/80 transition-colors"
          >
            <Copy size={12} />
            Copy address
          </button>
        </div>

        <p className="text-xs text-arc-text-dim text-center">
          Only send USDC on Arc Testnet to this address
        </p>
      </div>
    </div>
  )
}
