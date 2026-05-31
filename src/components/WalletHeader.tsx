import { Bell, Menu } from 'lucide-react'

interface WalletHeaderProps {
  onMenu: () => void
  onNotifications: () => void
}

export function WalletHeader({ onMenu, onNotifications }: WalletHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-arc-border">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-arc-success" />
        <span className="text-xs font-medium text-arc-text-dim">Arc Testnet</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onNotifications}
          className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text hover:bg-arc-card transition-colors"
        >
          <Bell size={16} />
        </button>
        <button
          onClick={onMenu}
          className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text hover:bg-arc-card transition-colors"
        >
          <Menu size={16} />
        </button>
      </div>
    </div>
  )
}
