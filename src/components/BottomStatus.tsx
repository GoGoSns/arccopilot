import { ChevronRight, Book } from 'lucide-react'

interface BottomStatusProps {
  level: number
  streak: number
  onOpenDashboard: () => void
  onOpenAddressBook?: () => void
  onOpenProfile?: () => void
}

export function BottomStatus({ level, streak, onOpenDashboard, onOpenAddressBook, onOpenProfile }: BottomStatusProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-arc-border bg-arc-card/50">
      <button 
        onClick={onOpenProfile}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-arc-gold/15 text-arc-gold">
          Lv {Math.max(1, level)}
        </span>
        {streak > 0 ? (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-arc-danger/15 text-arc-danger">
            {streak}d streak
          </span>
        ) : (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-arc-success/15 text-arc-success">
            New
          </span>
        )}
      </button>
      <div className="flex items-center gap-3">
        {onOpenAddressBook && (
          <button
            onClick={onOpenAddressBook}
            className="inline-flex items-center gap-1 rounded-full border border-arc-border bg-arc-card/60 px-3 py-1 text-xs font-medium text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
          >
            <Book size={12} />
            Address Book
            <ChevronRight size={12} />
          </button>
        )}
        <button
          onClick={onOpenDashboard}
          className="inline-flex items-center gap-1 rounded-full border border-arc-border bg-arc-card/60 px-3 py-1 text-xs font-medium text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
        >
          Open dashboard
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}
