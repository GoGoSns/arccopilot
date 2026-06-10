import { Edit2, Plus, User, Briefcase, AlertTriangle, ShieldCheck, HelpCircle, Eye } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useStore } from '@/lib/store'
import { formatAddress, formatBalance, timeAgo } from '@/lib/utils'
import { useAddressInsights } from '@/lib/hooks/useAddressInsights'
import { t } from '@/lib/i18n'
import type { AddressMemory } from '@/lib/store'

interface MemoryCardProps {
  address: string
  compact?: boolean
  onEdit?: () => void
  onSave?: () => void
}

const TAG_COLORS: Record<NonNullable<AddressMemory['tag']>, string> = {
  friend: 'text-green-500 bg-green-500/10',
  work: 'text-blue-500 bg-blue-500/10',
  warning: 'text-red-500 bg-red-500/10',
  self: 'text-arc-gold bg-arc-gold/10',
  whale: 'text-arc-gold bg-arc-gold/10',
  other: 'text-gray-400 bg-gray-400/10',
}

const TAG_ICONS: Record<NonNullable<AddressMemory['tag']>, typeof User> = {
  friend: User,
  work: Briefcase,
  warning: AlertTriangle,
  self: ShieldCheck,
  whale: Eye,
  other: HelpCircle,
}

export function MemoryCard({ address, compact, onEdit, onSave }: MemoryCardProps) {
  const getAddressMemory = useStore((s) => s.getAddressMemory)
  const memory = getAddressMemory(address)
  const { totalTx, totalVolume, lastTx, dataComplete, isLoading } = useAddressInsights(address)

  const TagIcon = memory?.tag ? TAG_ICONS[memory.tag] : HelpCircle
  const tagColor = memory?.tag ? TAG_COLORS[memory.tag] : ''

  if (compact) {
    return (
      <Card className="p-2 border-arc-border/50 bg-arc-card/30">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-arc-border/50 ${memory ? tagColor : ''}`}>
              {memory ? <TagIcon size={14} /> : <User size={14} className="text-arc-text-dim" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-arc-text">
                {memory?.label || formatAddress(address)}
              </p>
              <p className="text-[10px] text-arc-text-dim">
                {isLoading
                  ? t('memory.loadingInsights')
                  : dataComplete
                    ? `${totalTx ?? 0} ${t('memory.transactions').toLowerCase()} · ${t('memory.lastInteraction')} ${lastTx ? timeAgo(lastTx) : t('memory.never')}`
                    : `${t('common.unknown')} · ${t('memory.lastInteraction')} ${t('common.unknown')}`}
              </p>
            </div>
          </div>
          {memory ? (
            <button
              onClick={onEdit}
              className="p-1 text-arc-text-dim hover:text-arc-gold transition-colors"
            >
              <Edit2 size={14} />
            </button>
          ) : (
            <button
              onClick={onSave}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-arc-gold bg-arc-gold/10 hover:bg-arc-gold/20 transition-colors"
            >
              <Plus size={12} />
              {t('memory.save')}
            </button>
          )}
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-border/50 ${tagColor}`}>
            <TagIcon size={24} />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-lg font-bold text-arc-text">
              {memory?.label || t('memory.unknownAddress')}
            </h3>
            <p className="text-xs font-mono text-arc-text-dim">
              {formatAddress(address, 8)}
            </p>
          </div>
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="rounded-lg p-2 text-arc-text-dim hover:bg-arc-border/30 hover:text-arc-text transition-colors"
          >
            <Edit2 size={18} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-arc-border bg-arc-bg/50 p-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-arc-text-dim">{t('memory.transactions')}</p>
          <p className="text-sm font-bold text-arc-text">{isLoading ? t('common.loadingDots') : dataComplete ? totalTx ?? 0 : '—'}</p>
        </div>
        <div className="rounded-xl border border-arc-border bg-arc-bg/50 p-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-arc-text-dim">{t('memory.volume')}</p>
          <p className="text-sm font-bold text-arc-text">
            {isLoading ? t('common.loadingDots') : dataComplete && totalVolume != null ? `$${formatBalance(totalVolume, 6)}` : '—'}
          </p>
        </div>
      </div>

      {memory?.note && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-arc-text-dim">{t('memory.note')}</p>
          <p className="text-xs text-arc-text italic leading-relaxed">
            &quot;{memory.note}&quot;
          </p>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-arc-text-dim">
        <span>{t('memory.added')} {memory ? new Date(memory.createdAt).toLocaleDateString() : t('memory.never')}</span>
        <span>{t('memory.lastInteraction')} {dataComplete ? (lastTx ? timeAgo(lastTx) : t('memory.never')) : t('common.unknown')}</span>
      </div>
    </Card>
  )
}
