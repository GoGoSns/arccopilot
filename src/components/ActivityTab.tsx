import { AlertCircle, ArrowDownLeft, ArrowUpRight, Clock3, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useTxHistory } from '@/lib/hooks/useTxHistory'
import { formatAddress } from '@/lib/utils'
import { useStore } from '@/lib/store'

interface ActivityTabProps {
  address: string | null
}

const TAG_COLORS = {
  friend: 'bg-green-500',
  work: 'bg-blue-500',
  warning: 'bg-red-500',
  self: 'bg-arc-gold',
  other: 'bg-gray-400',
}

export function ActivityTab({ address }: ActivityTabProps) {
  const { transactions, isLoading, error, refresh } = useTxHistory(address)
  const addressMemories = useStore((s) => s.addressMemories)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-2xl border border-arc-border bg-arc-card px-4 py-3 animate-pulse"
          >
            <div className="h-9 w-9 rounded-xl bg-arc-border/80" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-2/3 rounded-full bg-arc-border/80" />
              <div className="h-2.5 w-1/2 rounded-full bg-arc-border/60" />
            </div>
            <div className="h-3 w-12 rounded-full bg-arc-border/80" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-3">
        <Card className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-arc-danger" size={18} />
            <div className="space-y-1">
              <p className="text-sm font-medium text-arc-text">Couldn&apos;t load activity</p>
              <p className="text-xs leading-relaxed text-arc-text-dim">{error}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCcw size={14} />
            Retry
          </Button>
        </Card>
      </div>
    )
  }

  if (!transactions.length) {
    return (
      <div className="px-4 py-10">
        <Card className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-gold/10 text-arc-gold">
            <Clock3 size={22} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-arc-text">No activity yet</p>
            <p className="text-xs leading-relaxed text-arc-text-dim">
              USDC transfers on Arc Testnet will appear here once you send or receive funds.
            </p>
          </div>
        </Card>
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
                  {isSend ? 'Sent' : 'Received'}{' '}
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
