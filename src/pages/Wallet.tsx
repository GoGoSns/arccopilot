import { useState } from 'react'
import { Copy } from 'lucide-react'
import { WalletHeader }  from '@/components/WalletHeader'
import { BalanceCard }   from '@/components/BalanceCard'
import { ActionButtons } from '@/components/ActionButtons'
import { TabBar }        from '@/components/TabBar'
import { TokenList }     from '@/components/TokenList'
import { ActivityList }  from '@/components/ActivityList'
import { BottomStatus }  from '@/components/BottomStatus'
import { useStore }      from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { formatAddress, copyToClipboard } from '@/lib/utils'

type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onDiscover: () => void
  onMenu: () => void
}

export function Wallet({ onSend, onReceive, onDiscover, onMenu }: WalletProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens')
  const [copied,    setCopied]    = useState(false)

  const address            = useStore((s) => s.walletAddress)
  const { balance, isLoading } = useUSDCBalance()

  const handleTabChange = (tab: Tab) => {
    if (tab === 'discover') { onDiscover(); return }
    setActiveTab(tab)
  }

  const handleCopy = async () => {
    if (!address) return
    await copyToClipboard(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <WalletHeader onMenu={onMenu} onNotifications={() => {}} />

      {/* Account row */}
      <div className="relative flex items-center gap-3 px-4 py-2 border-b border-arc-border">
        <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center text-arc-gold text-sm font-bold select-none">
          {address ? address[2].toUpperCase() : 'G'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-arc-text">My Wallet</p>
          <p className="text-xs text-arc-text-dim font-mono">
            {address ? formatAddress(address, 4) : '—'}
          </p>
        </div>
        <button
          onClick={handleCopy}
          title="Copy address"
          className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-gold transition-colors"
        >
          <Copy size={14} />
        </button>
        {copied && (
          <span className="absolute right-12 top-1/2 -translate-y-1/2 text-[10px] text-arc-success bg-arc-card border border-arc-border rounded px-1.5 py-0.5 pointer-events-none">
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
        {activeTab === 'tokens'   && <TokenList usdcBalance={balance} />}
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
