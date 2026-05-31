import { useEffect, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { Copy } from 'lucide-react'
import { WalletHeader }   from '@/components/WalletHeader'
import { BalanceCard }    from '@/components/BalanceCard'
import { ActionButtons }  from '@/components/ActionButtons'
import { TabBar }         from '@/components/TabBar'
import { TokenList }      from '@/components/TokenList'
import { ActivityList }   from '@/components/ActivityList'
import { BottomStatus }   from '@/components/BottomStatus'
import { useStore }       from '@/lib/store'
import { formatAddress, copyToClipboard, formatBalance } from '@/lib/utils'

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const

type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onDiscover: () => void
  onMenu: () => void
}

export function Wallet({ onSend, onReceive, onDiscover, onMenu }: WalletProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens')
  const [copied, setCopied]       = useState(false)

  const { address: wagmiAddress, isConnected } = useAccount()
  const storedAddress = useStore((s) => s.walletAddress)
  const setWalletAddress = useStore((s) => s.setWalletAddress)
  const setBalance = useStore((s) => s.setBalance)

  // Keep store in sync if wagmi reconnected automatically
  useEffect(() => {
    if (isConnected && wagmiAddress && wagmiAddress !== storedAddress) {
      setWalletAddress(wagmiAddress)
    }
  }, [isConnected, wagmiAddress, storedAddress, setWalletAddress])

  const address = wagmiAddress ?? storedAddress ?? undefined

  // Real USDC balance from RPC
  const { data: rawBalance, isLoading: balanceLoading } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  const balance = rawBalance !== undefined ? formatBalance(rawBalance as bigint, 18) : '0.00'

  // Persist balance in store
  useEffect(() => {
    if (rawBalance !== undefined) setBalance(balance)
  }, [rawBalance, balance, setBalance])

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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-arc-border">
        <div className="w-8 h-8 rounded-full bg-arc-gold/20 flex items-center justify-center text-arc-gold text-sm font-bold select-none">
          {address ? address[2].toUpperCase() : 'G'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-arc-text">My Wallet</p>
          <p className="text-xs text-arc-text-dim font-mono truncate">
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
          <span className="absolute right-16 text-[10px] text-arc-success bg-arc-card border border-arc-border rounded px-1.5 py-0.5 pointer-events-none">
            Copied!
          </span>
        )}
      </div>

      <BalanceCard
        address={address ?? ''}
        balance={balance}
        isLoading={balanceLoading}
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
