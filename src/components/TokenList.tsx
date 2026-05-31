import { Plus } from 'lucide-react'

interface TokenListProps {
  usdcBalance?: string
}

export function TokenList({ usdcBalance = '0.00' }: TokenListProps) {
  return (
    <div className="flex flex-col">
      {/* USDC row — real balance */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-arc-card/50 transition-colors cursor-pointer">
        <div className="w-9 h-9 rounded-full bg-arc-gold/10 border border-arc-gold/20 flex items-center justify-center text-arc-gold text-sm font-bold">
          $
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-arc-text">USDC</p>
          <p className="text-xs text-arc-text-dim">Arc Native · $1.00</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-arc-text">{usdcBalance}</p>
          <p className="text-xs text-arc-success">+2.4%</p>
        </div>
      </div>

      {/* ARC row — mock */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-arc-card/50 transition-colors cursor-pointer">
        <div className="w-9 h-9 rounded-full bg-arc-gold/10 border border-arc-gold/20 flex items-center justify-center text-arc-gold text-sm font-bold">
          A
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-arc-text">ARC</p>
          <p className="text-xs text-arc-text-dim">Reward token</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-arc-text">450</p>
          <p className="text-xs text-arc-text-dim">$18.00</p>
        </div>
      </div>

      {/* Add token */}
      <button className="flex items-center gap-2 px-4 py-3 mx-4 my-1 rounded-xl border border-dashed border-arc-border text-xs text-arc-text-dim hover:text-arc-text hover:border-arc-gold/30 transition-colors">
        <Plus size={14} />
        Add token
      </button>
    </div>
  )
}
