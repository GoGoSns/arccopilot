type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface TabBarProps {
  active: Tab
  onChange: (tab: Tab) => void
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'tokens',   label: 'Tokens'   },
  { id: 'activity', label: 'Activity' },
  { id: 'nfts',     label: 'NFTs'     },
  { id: 'discover', label: 'Discover' },
]

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <div className="flex border-b border-arc-border">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
            active === id ? 'text-arc-gold' : 'text-arc-text-dim hover:text-arc-text'
          }`}
        >
          {label}
          {active === id && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-arc-gold rounded-full" />
          )}
        </button>
      ))}
    </div>
  )
}
