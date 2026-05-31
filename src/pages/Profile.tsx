import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface ProfileProps {
  onBack: () => void
}

export function Profile({ onBack }: ProfileProps) {
  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Profile</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-arc-gold/20 flex items-center justify-center text-arc-gold text-2xl font-bold">
            G
          </div>
          <div className="text-center">
            <p className="font-semibold text-arc-text">GoGo</p>
            <p className="text-xs text-arc-text-dim font-mono">0x1a2b...3c4d</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full bg-arc-gold/15 text-arc-gold font-bold">Lv 47</span>
            <span className="text-xs px-2 py-1 rounded-full bg-arc-danger/15 text-arc-danger font-bold">21d streak</span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-arc-text-dim">Social</p>
          <Button variant="outline" fullWidth>
            <ExternalLink size={14} />
            Connect X (Twitter)
          </Button>
        </div>

        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-arc-text-dim mb-3">Badges</p>
          <div className="grid grid-cols-4 gap-2">
            {['Early Adopter', 'Tx Pioneer', '100 Streak', 'USDC Whale'].map((badge) => (
              <div key={badge} className="flex flex-col items-center gap-1 p-2 rounded-xl bg-arc-card border border-arc-border">
                <div className="w-8 h-8 rounded-full bg-arc-gold/10 flex items-center justify-center text-arc-gold text-xs font-bold">
                  {badge[0]}
                </div>
                <p className="text-[8px] text-arc-text-dim text-center leading-tight">{badge}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
