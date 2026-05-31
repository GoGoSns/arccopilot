import { useState } from 'react'
import { WalletHeader } from '@/components/WalletHeader'
import { BalanceCard } from '@/components/BalanceCard'
import { ActionButtons } from '@/components/ActionButtons'
import { TabBar } from '@/components/TabBar'
import { TokenList } from '@/components/TokenList'
import { ActivityList } from '@/components/ActivityList'
import { BottomStatus } from '@/components/BottomStatus'

type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onDiscover: () => void
  onMenu: () => void
  onSettings: () => void
}

export function Wallet({ onSend, onReceive, onDiscover, onMenu, onSettings }: WalletProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens')

  const handleTabChange = (tab: Tab) => {
    if (tab === 'discover') { onDiscover(); return }
    setActiveTab(tab)
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <WalletHeader onMenu={onMenu} onNotifications={() => {}} />

      {/* Account row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-arc-border">
        <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center text-arc-gold text-sm font-bold">
          G
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-arc-text">GoGo Wallet</p>
          <p className="text-xs text-arc-text-dim font-mono">0x1a2b...3c4d</p>
        </div>
      </div>

      <BalanceCard address="0x1a2b3c4d5e6f7890" balance="138.15" changePercent={2.4} />
      <ActionButtons onSend={onSend} onReceive={onReceive} onScan={() => {}} onBuy={() => {}} />
      <TabBar active={activeTab} onChange={handleTabChange} />

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'tokens'   && <TokenList />}
        {activeTab === 'activity' && <ActivityList />}
        {activeTab === 'nfts'     && (
          <div className="flex flex-col items-center justify-center h-32 text-arc-text-dim text-sm">
            No NFTs yet
          </div>
        )}
      </div>

      <BottomStatus level={47} streak={21} onOpenDashboard={onDiscover} />
    </div>
  )
}
