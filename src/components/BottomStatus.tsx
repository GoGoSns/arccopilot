import { ChevronRight } from 'lucide-react'

interface BottomStatusProps {
  level: number
  streak: number
  onOpenDashboard: () => void
}

export function BottomStatus({ level, streak, onOpenDashboard }: BottomStatusProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-arc-border bg-arc-card/50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-arc-gold/15 text-arc-gold">
          Lv {level}
        </span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-arc-danger/15 text-arc-danger">
          {streak}d streak
        </span>
      </div>
      <button
        onClick={onOpenDashboard}
        className="flex items-center gap-1 text-xs text-arc-text-dim hover:text-arc-gold transition-colors"
      >
        Open dashboard
        <ChevronRight size={12} />
      </button>
    </div>
  )
}
