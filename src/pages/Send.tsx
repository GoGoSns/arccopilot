import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface SendProps {
  onBack: () => void
}

export function Send({ onBack }: SendProps) {
  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Send USDC</h2>
      </div>

      <div className="flex-1 px-4 py-6 space-y-4">
        <Input label="Recipient address" placeholder="0x..." />
        <Input label="Amount (USDC)" placeholder="0.00" type="number" />
        <div className="flex items-center justify-between text-xs text-arc-text-dim">
          <span>Available balance</span>
          <span className="text-arc-gold">138.15 USDC</span>
        </div>
        <div className="p-3 rounded-xl bg-arc-card border border-arc-border text-xs text-arc-text-dim space-y-1">
          <div className="flex justify-between"><span>Network fee</span><span className="text-arc-text">0.001 USDC</span></div>
          <div className="flex justify-between"><span>Estimated time</span><span className="text-arc-text">~3s</span></div>
        </div>
      </div>

      <div className="px-4 pb-6">
        <Button variant="primary" fullWidth size="lg">Confirm Send</Button>
      </div>
    </div>
  )
}
