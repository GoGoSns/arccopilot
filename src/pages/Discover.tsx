import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'

interface DiscoverProps {
  onBack: () => void
}

const ECOSYSTEM_STATS = [
  { label: 'Total Volume',   value: '$2.4M'  },
  { label: 'Active Users',   value: '12,481' },
  { label: 'Transactions',   value: '89,230' },
  { label: 'Avg Gas',        value: '0.001 USDC' },
]

export function Discover({ onBack }: DiscoverProps) {
  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Discover Arc</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-arc-text-dim mb-3">Ecosystem Stats</p>
          <div className="grid grid-cols-2 gap-2">
            {ECOSYSTEM_STATS.map(({ label, value }) => (
              <Card key={label} className="p-3">
                <p className="text-xs text-arc-text-dim">{label}</p>
                <p className="text-lg font-bold text-arc-gold mt-1">{value}</p>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-arc-text-dim mb-3">Apps</p>
          <div className="space-y-2">
            {[
              { name: 'Arc Pay',     desc: 'USDC payments & invoices', url: 'https://arcpaymain.vercel.app' },
              { name: 'Arc Creator', desc: 'Tips, subs & freelance',   url: 'https://arccreatormain.vercel.app' },
              { name: 'Arc Play',    desc: 'Gaming & prediction',      url: 'https://arcplaymain.vercel.app' },
            ].map((app) => (
              <a
                key={app.name}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl bg-arc-card border border-arc-border hover:border-arc-gold/30 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-arc-gold/10 flex items-center justify-center text-arc-gold text-xs font-bold">
                  {app.name.split(' ')[1][0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-arc-text">{app.name}</p>
                  <p className="text-xs text-arc-text-dim">{app.desc}</p>
                </div>
                <ExternalLink size={12} className="text-arc-text-dim" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
