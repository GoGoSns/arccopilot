import { ArrowLeft } from 'lucide-react'
import { ActivityTab } from '@/components/ActivityTab'
import { t } from '@/lib/i18n'
import { useStore } from '@/lib/store'

interface ActivityProps {
  onBack: () => void
}

export function Activity({ onBack }: ActivityProps) {
  const address = useStore((s) => s.walletAddress)

  return (
    <div className="flex h-full flex-col bg-arc-bg">
      <div className="flex items-center gap-3 border-b border-arc-border px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">{t('activity.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ActivityTab address={address} />
      </div>
    </div>
  )
}
