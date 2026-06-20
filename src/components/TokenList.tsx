import { Plus } from 'lucide-react'
import { t } from '@/lib/i18n'

interface TokenListProps {
  usdcBalance?: string | null
}

export function TokenList({ usdcBalance = null }: TokenListProps) {
  const displayBalance = usdcBalance ?? t('common.unknown')

  return (
    <div className="flex flex-col">
      <div className="hover:bg-arc-card/50 flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-arc-border bg-arc-card text-sm font-bold text-white">
          $
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-arc-text">USDC</p>
          <p className="text-xs text-arc-text-dim">{t('tokenList.usdcNative')}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-arc-text">{displayBalance}</p>
        </div>
      </div>

      <button className="mx-4 my-1 flex items-center gap-2 rounded-xl border border-dashed border-arc-border px-4 py-3 text-xs text-arc-text-dim transition-colors hover:border-arc-borderEmphasis hover:text-arc-text">
        <Plus size={14} />
        {t('tokenList.addToken')}
      </button>
    </div>
  )
}
