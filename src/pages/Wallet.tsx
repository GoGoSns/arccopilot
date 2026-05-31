import { useEffect, useState, useCallback } from 'react'
import { Copy } from 'lucide-react'
import { WalletHeader }  from '@/components/WalletHeader'
import { BalanceCard }   from '@/components/BalanceCard'
import { ActionButtons } from '@/components/ActionButtons'
import { TabBar }        from '@/components/TabBar'
import { TokenList }     from '@/components/TokenList'
import { ActivityList }  from '@/components/ActivityList'
import { BottomStatus }  from '@/components/BottomStatus'
import { useStore }      from '@/lib/store'
import { formatAddress, formatBalance, copyToClipboard } from '@/lib/utils'

const RPC_URL      = 'https://rpc.testnet.arc.network'
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const BALANCE_OF   = '0x70a08231' // balanceOf(address) selector

type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onDiscover: () => void
  onMenu: () => void
}

async function fetchUsdcBalance(address: string): Promise<string> {
  const data = BALANCE_OF + address.replace(/^0x/, '').padStart(64, '0')
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: USDC_ADDRESS, data }, 'latest'],
    }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  const wei = BigInt(json.result === '0x' ? '0x0' : json.result)
  return formatBalance(wei, 18)
}

export function Wallet({ onSend, onReceive, onDiscover, onMenu }: WalletProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens')
  const [copied,    setCopied]    = useState(false)
  const [balance,   setBalance]   = useState('0.00')
  const [balLoading, setBalLoading] = useState(true)

  const address    = useStore((s) => s.walletAddress)
  const setBalance_ = useStore((s) => s.setBalance)

  const loadBalance = useCallback(async () => {
    if (!address) return
    try {
      const b = await fetchUsdcBalance(address)
      setBalance(b)
      setBalance_(b)
    } catch (err) {
      console.error('Balance fetch error:', err)
    } finally {
      setBalLoading(false)
    }
  }, [address, setBalance_])

  // Initial fetch + 15s refresh
  useEffect(() => {
    loadBalance()
    const id = window.setInterval(loadBalance, 15_000)
    return () => window.clearInterval(id)
  }, [loadBalance])

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
        isLoading={balLoading}
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
