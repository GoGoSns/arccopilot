import { TrendingUp } from 'lucide-react'
import { t } from '@/lib/i18n'
import { formatAddress } from '@/lib/utils'

interface BalanceCardProps {
  address: string
  balance: string
  isLoading?: boolean
  changePercent?: number
}

export function BalanceCard({ address, balance, isLoading = false, changePercent = 2.4 }: BalanceCardProps) {
  const isPositive = changePercent >= 0

  return (
    <div className="px-4 py-5 text-center">
      <p className="text-xs text-arc-text-dim font-mono">
        {address ? formatAddress(address, 4) : t('wallet.addressMissing')}
      </p>
      <div className="mt-3 flex items-baseline justify-center gap-2">
        {isLoading ? (
          <span className="text-5xl font-bold text-arc-gold/40 font-display animate-pulse">...</span>
        ) : (
          <span className="text-5xl font-bold text-arc-gold font-display">{balance}</span>
        )}
        <span className="text-lg text-arc-text-dim">{t('common.usdc')}</span>
      </div>
      <p className="mt-1 text-sm text-arc-text-dim">
        {t('common.usdc')} · ≈ ${balance}
      </p>
      <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
        isPositive ? 'bg-arc-success/15 text-arc-success' : 'bg-arc-danger/15 text-arc-danger'
      }`}>
        <TrendingUp size={10} />
        {isPositive ? '+' : ''}{changePercent.toFixed(1)}% {t('dailyBrief.last24h')}
      </div>
    </div>
  )
}
