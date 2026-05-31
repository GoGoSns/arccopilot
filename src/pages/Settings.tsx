import { ArrowLeft } from 'lucide-react'

interface SettingsProps {
  onBack: () => void
}

export function Settings({ onBack }: SettingsProps) {
  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {[
          { section: 'Network',   items: [{ label: 'Current Network', value: 'Arc Testnet' }, { label: 'RPC URL', value: 'rpc.testnet.arc.network' }] },
          { section: 'Security',  items: [{ label: 'Lock Extension', value: '' }, { label: 'Export Private Key', value: '' }] },
          { section: 'Preferences', items: [{ label: 'Theme', value: 'Dark' }, { label: 'Currency', value: 'USD' }] },
          { section: 'About',     items: [{ label: 'Version', value: 'v0.1.0' }, { label: 'Arc Testnet chainId', value: '5042002' }] },
        ].map(({ section, items }) => (
          <div key={section}>
            <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
              {section}
            </p>
            {items.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors cursor-pointer">
                <span className="text-sm text-arc-text">{label}</span>
                {value && <span className="text-xs text-arc-text-dim">{value}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
