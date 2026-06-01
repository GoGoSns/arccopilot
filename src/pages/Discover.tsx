import { ArrowLeft } from 'lucide-react'
import { DiscoverTab } from '@/components/DiscoverTab'
import { useStore } from '@/lib/store'

interface DiscoverProps {
  onBack: () => void
}

export function Discover({ onBack }: DiscoverProps) {
  const address = useStore((s) => s.walletAddress)

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 border-b border-arc-border px-4 py-3">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Discover Arc</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DiscoverTab address={address} />
      </div>
    </div>
  )
}
