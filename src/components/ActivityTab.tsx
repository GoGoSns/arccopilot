import { ArrowDownLeft, ArrowUpRight, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingState } from '@/components/LoadingState'
import { useTxHistory } from '@/lib/hooks/useTxHistory'
import { formatAddress } from '@/lib/utils'
import { useStore, type AddressMemory } from '@/lib/store'
import { t } from '@/lib/i18n'

interface ActivityTabProps {
  address: string | null
}

const TAG_COLORS: Record<NonNullable<AddressMemory['tag']>, string> = {
  friend: 'bg-green-500',
  work: 'bg-blue-500',
  warning: 'bg-red-500',
  self: 'bg-arc-gold',
  whale: 'bg-arc-gold',
  other: 'bg-gray-400',
}

export function ActivityTab({ address }: ActivityTabProps) {
  const { transactions, isLoading, error, refresh } = useTxHistory(address)
  const addressMemories = useStore((s) => s.addressMemories)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)

  if (isLoading) {
    return (
      <div className="px-4 py-3">
        <LoadingState title={t('state.loading')} description={t('activity.noActivityDescription')} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-3">
        <ErrorState
          title={t('activity.couldNotLoad')}
          description={error}
          actionLabel={t('activity.retry')}
          onAction={() => void refresh()}
        />
      </div>
    )
  }

  if (!transactions.length) {
    return (
      <div className="px-4 py-3">
        <EmptyState
          icon={Clock3}
          title={t('activity.noActivityYet')}
          description={t('activity.noActivityDescription')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {transactions.map((tx) => {
        const isSend = tx.direction === 'send'
        const amountColor = isSend ? 'text-arc-danger' : 'text-arc-success'
        const amountBg = isSend ? 'bg-arc-danger/10 text-arc-danger' : 'bg-arc-success/10 text-arc-success'
        const Icon = isSend ? ArrowUpRight : ArrowDownLeft

        const memory = addressMemories[tx.counterpartyAddress.toLowerCase()]
        const label = memory?.label || formatAddress(tx.counterpartyAddress)
        const tagColor = memory?.tag ? TAG_COLORS[memory.tag] : null

        return (
          <button
            key={tx.hash}
            onClick={() => {
              setSelectedAddress(tx.counterpartyAddress)
              setCurrentView('address-detail')
            }}
            className="flex items-center gap-3 rounded-2xl border border-arc-border bg-arc-card px-4 py-3 text-left transition-colors hover:border-arc-gold/30 hover:bg-arc-card/80"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${amountBg}`}>
              <Icon size={18} />
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium text-arc-text">
                  {isSend ? t('activity.sent') : t('activity.received')}{' '}
                  <span className={`font-semibold ${amountColor}`}>{tx.signedAmount} USDC</span>
                </p>
                <p className={`shrink-0 text-sm font-semibold ${amountColor}`}>{tx.signedAmount}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {tagColor && <div className={`h-1.5 w-1.5 rounded-full ${tagColor}`} />}
                <p className="truncate text-xs text-arc-text-dim">
                  {tx.counterpartyPrefix} {label} · {tx.timeLabel}
                </p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
