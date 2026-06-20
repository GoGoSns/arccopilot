import { ARC_CHAIN_ID, ARC_RPC_URL } from '@/lib/constants'

export function Options() {
  return (
    <div className="min-h-screen bg-arc-bg text-arc-text font-sans">
      <div className="max-w-2xl mx-auto py-12 px-6">
        <div className="flex items-center gap-4 mb-10">
          <div
            className="w-10 h-10 flex items-center justify-center text-xl font-black text-white border border-arc-border"
            style={{
              background: '#141414',
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            }}
          >
            A
          </div>
          <div>
            <h1 className="text-xl font-bold font-display">ArcCopilot Settings</h1>
            <p className="text-xs text-arc-text-dim">v0.2.0 - Arc Testnet</p>
          </div>
        </div>

        <div className="space-y-6">
          {[
            { title: 'Network', desc: `Arc Testnet (chainId ${ARC_CHAIN_ID})`, value: 'Active' },
            { title: 'RPC', desc: ARC_RPC_URL.replace(/^https?:\/\//, ''), value: 'Connected' },
            { title: 'Version', desc: 'ArcCopilot', value: 'v0.2.0' },
          ].map(({ title, desc, value }) => (
            <div key={title} className="flex items-center justify-between p-4 rounded-2xl bg-arc-card border border-arc-border">
              <div>
                <p className="font-medium text-arc-text">{title}</p>
                <p className="text-sm text-arc-text-dim">{desc}</p>
              </div>
              <span className="text-xs text-white bg-arc-card border border-arc-border px-2 py-1 rounded-full">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
