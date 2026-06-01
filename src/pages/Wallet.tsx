import { useState } from 'react'
import { Copy } from 'lucide-react'
import { WalletHeader } from '@/components/WalletHeader'
import { BalanceCard } from '@/components/BalanceCard'
import { ActionButtons } from '@/components/ActionButtons'
import { TabBar } from '@/components/TabBar'
import { TokenList } from '@/components/TokenList'
import { ActivityTab } from '@/components/ActivityTab'
import { DiscoverTab } from '@/components/DiscoverTab'
import { BottomStatus } from '@/components/BottomStatus'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { copyToClipboard, formatAddress } from '@/lib/utils'

type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onDiscover: () => void
  onMenu: () => void
}

export function Wallet({ onSend, onReceive, onDiscover, onMenu }: WalletProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens')
  const [copied, setCopied] = useState(false)

  const address = useStore((s) => s.walletAddress)
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const { balance, isLoading } = useUSDCBalance()

  const level = Math.max(1, Math.floor(xp / 100))

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
  }

  const handleCopy = async () => {
    if (!address) return

    await copyToClipboard(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <WalletHeader onMenu={onMenu} onNotifications={() => {}} />

      <div className="relative flex items-center gap-3 border-b border-arc-border px-4 py-2">
        <div className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-arc-gold/20 text-sm font-bold text-arc-gold">
          {address ? address[2].toUpperCase() : 'G'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-arc-text">My Wallet</p>
          <p className="font-mono text-xs text-arc-text-dim">
            {address ? formatAddress(address, 4) : '-'}
          </p>
        </div>
        <button
          onClick={handleCopy}
          title="Copy address"
          className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-gold"
        >
          <Copy size={14} />
        </button>
        {copied && (
          <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 rounded border border-arc-border bg-arc-card px-1.5 py-0.5 text-[10px] text-arc-success">
            Copied!
          </span>
        )}
      </div>

      <BalanceCard
        address={address ?? ''}
        balance={balance}
        isLoading={isLoading}
        changePercent={2.4}
      />

      <ActionButtons onSend={onSend} onReceive={onReceive} onScan={() => {}} onBuy={() => {}} />

      <TabBar active={activeTab} onChange={handleTabChange} />

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'tokens' && <TokenList usdcBalance={balance} />}
        {activeTab === 'activity' && <ActivityTab address={address} />}
        {activeTab === 'nfts' && (
          <div className="flex h-32 flex-col items-center justify-center text-sm text-arc-text-dim">
            No NFTs yet
          </div>
        )}
        {activeTab === 'discover' && <DiscoverTab address={address} onViewAll={onDiscover} />}
      </div>

      <BottomStatus 
        level={level} 
        streak={streak} 
        onOpenDashboard={onDiscover} 
        onOpenAddressBook={() => setCurrentView('address-book')}
        onOpenProfile={() => setCurrentView('profile')}
      />
    </div>
  )
}
