import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'

interface Tx {
  hash: string
  type: 'send' | 'receive'
  amount: string
  address: string
  time: string
}

const MOCK_TXS: Tx[] = [
  { hash: '0xabc...def', type: 'receive', amount: '+50.00', address: '0x1234...5678', time: '2m ago'  },
  { hash: '0xbcd...ef0', type: 'send',    amount: '-12.50', address: '0xabcd...ef01', time: '1h ago'  },
  { hash: '0xcde...f01', type: 'receive', amount: '+100.65',address: '0x9876...5432', time: '3h ago'  },
]

export function ActivityList() {
  return (
    <div className="flex flex-col">
      {MOCK_TXS.map((tx) => (
        <div key={tx.hash} className="flex items-center gap-3 px-4 py-3 hover:bg-arc-card/50 transition-colors cursor-pointer">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
            tx.type === 'receive' ? 'bg-arc-success/10 text-arc-success' : 'bg-arc-danger/10 text-arc-danger'
          }`}>
            {tx.type === 'receive' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-arc-text capitalize">{tx.type}</p>
            <p className="text-xs text-arc-text-dim truncate">{tx.address}</p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-medium ${tx.type === 'receive' ? 'text-arc-success' : 'text-arc-danger'}`}>
              {tx.amount} USDC
            </p>
            <p className="text-xs text-arc-text-dim">{tx.time}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
