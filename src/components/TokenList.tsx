import { Plus } from 'lucide-react'

interface Token {
  symbol: string
  name: string
  balance: string
  valueUsd: string
  changePercent: number
  monogram: string
}

const MOCK_TOKENS: Token[] = [
  { symbol: 'USDC', name: 'USD Coin',     balance: '138.15', valueUsd: '138.15', changePercent: 2.4,  monogram: '$' },
  { symbol: 'ARC',  name: 'Arc Network',  balance: '450',    valueUsd: '18.00',  changePercent: -1.2, monogram: 'A' },
]

export function TokenList() {
  return (
    <div className="flex flex-col">
      {MOCK_TOKENS.map((token) => (
        <div
          key={token.symbol}
          className="flex items-center gap-3 px-4 py-3 hover:bg-arc-card/50 transition-colors cursor-pointer"
        >
          <div className="w-9 h-9 rounded-full bg-arc-gold/10 border border-arc-gold/20 flex items-center justify-center text-arc-gold text-sm font-bold">
            {token.monogram}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-arc-text">{token.symbol}</p>
            <p className="text-xs text-arc-text-dim">{token.name}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-arc-text">{token.balance}</p>
            <p className={`text-xs ${token.changePercent >= 0 ? 'text-arc-success' : 'text-arc-danger'}`}>
              {token.changePercent >= 0 ? '+' : ''}{token.changePercent}%
            </p>
          </div>
        </div>
      ))}
      <button className="flex items-center gap-2 px-4 py-3 text-xs text-arc-text-dim hover:text-arc-text transition-colors">
        <Plus size={14} />
        Add token
      </button>
    </div>
  )
}
