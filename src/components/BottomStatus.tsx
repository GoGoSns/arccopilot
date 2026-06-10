import { Book, ChevronRight, Sun, Sparkles } from 'lucide-react'
import { formatText, t } from '@/lib/i18n'

interface BottomStatusProps {
  level: number
  streak: number
  onOpenDashboard: () => void
  onOpenAddressBook?: () => void
  onOpenProfile?: () => void
  onOpenBrief?: () => void
  onOpenGogo?: () => void
}

export function BottomStatus({
  level,
  streak,
  onOpenDashboard,
  onOpenAddressBook,
  onOpenProfile,
  onOpenBrief,
  onOpenGogo,
}: BottomStatusProps) {
  return (
    <div className="flex items-center justify-between border-t border-arc-border bg-arc-card/50 px-4 py-3">
      {/* Left: profile badges + brief button */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenProfile}
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <span className="rounded-full bg-arc-gold/15 px-2 py-0.5 text-xs font-bold text-arc-gold">
            Lv {Math.max(1, level)}
          </span>
          {streak > 0 ? (
            <span className="rounded-full bg-arc-danger/15 px-2 py-0.5 text-xs font-bold text-arc-danger">
              {formatText('common.streak', { streak })}
            </span>
          ) : (
            <span className="rounded-full bg-arc-success/15 px-2 py-0.5 text-xs font-bold text-arc-success">
              {t('bottom.new')}
            </span>
          )}
        </button>

        {onOpenBrief && (
          <button
            onClick={onOpenBrief}
            title={t('bottom.dailyBrief')}
            className="rounded-full border border-arc-border bg-arc-card/60 p-1.5 text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
          >
            <Sun size={13} />
          </button>
        )}

        {onOpenGogo && (
          <button
            onClick={onOpenGogo}
            title={t('bottom.gogoAI')}
            className="rounded-full border border-arc-border bg-arc-card/60 p-1.5 text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
          >
            <Sparkles size={13} />
          </button>
        )}
      </div>

      {/* Right: address book + dashboard */}
      <div className="flex items-center gap-3">
        {onOpenAddressBook && (
          <button
            onClick={onOpenAddressBook}
            className="inline-flex items-center gap-1 rounded-full border border-arc-border bg-arc-card/60 px-3 py-1 text-xs font-medium text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
          >
            <Book size={12} />
            {t('bottom.addressBook')}
            <ChevronRight size={12} />
          </button>
        )}
        <button
          onClick={onOpenDashboard}
          className="inline-flex items-center gap-1 rounded-full border border-arc-border bg-arc-card/60 px-3 py-1 text-xs font-medium text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
        >
          {t('bottom.openDashboard')}
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}
