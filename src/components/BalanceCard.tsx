import { t } from '@/lib/i18n'
import { formatAddress } from '@/lib/utils'

interface BalanceCardProps {
  address: string
  balance: string | null
  isLoading?: boolean
}

export function BalanceCard({ address, balance, isLoading = false }: BalanceCardProps) {
  const displayBalance = balance ?? t('common.unknown')

  return (
    <div className="px-4 py-5 text-center">
      <p className="font-mono text-xs text-arc-text-dim">
        {address ? formatAddress(address, 4) : t('wallet.addressMissing')}
      </p>
      <div className="mt-3 flex items-baseline justify-center gap-2">
        {isLoading ? (
          <span className="font-display text-5xl font-bold animate-pulse text-arc-accent/40">...</span>
        ) : (
          <span className="font-display text-5xl font-bold text-arc-accent">{displayBalance}</span>
        )}
        <span className="text-lg text-arc-text-dim">{t('common.usdc')}</span>
      </div>
      <p className="mt-1 text-sm text-arc-text-dim">
        {balance != null ? `${t('common.usdc')} ~ $${balance}` : t('common.unknown')}
      </p>
    </div>
  )
}
