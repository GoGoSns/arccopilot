import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/lib/store'

interface WelcomeProps {
  onComplete: (path: 'create' | 'import' | 'metamask') => void
}

export function Welcome({ onComplete }: WelcomeProps) {
  const setOnboarded = useStore((s) => s.setOnboarded)

  const handleAction = (path: 'create' | 'import' | 'metamask') => {
    setOnboarded(true)
    onComplete(path)
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-mono text-arc-text-dim">ArcCopilot v0.1.0</span>
        <button className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <Settings size={14} />
        </button>
      </div>

      {/* Logo */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 gap-6">
        <div
          className="w-24 h-24 flex items-center justify-center text-4xl font-black text-black"
          style={{
            background: '#d4af37',
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          }}
        >
          A
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-arc-text font-display">Welcome to ArcCopilot</h1>
          <p className="text-sm text-arc-text-dim leading-relaxed">
            Your copilot for the Arc economy. Wallet, dashboard, community, and AI in one place.
          </p>
        </div>

        <div className="w-full space-y-3">
          <Button variant="primary" fullWidth size="lg" onClick={() => handleAction('create')}>
            Create new wallet
          </Button>
          <Button variant="outline" fullWidth size="lg" onClick={() => handleAction('import')}>
            Import existing wallet
          </Button>
          <Button variant="ghost" fullWidth size="lg" onClick={() => handleAction('metamask')}>
            Connect MetaMask
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-arc-success" />
          <span className="text-xs text-arc-text-dim">Arc Testnet</span>
        </div>
      </div>

      <div className="px-6 py-3 text-center">
        <p className="text-[10px] text-arc-text-dim">
          By continuing, you agree to our{' '}
          <button className="text-arc-gold/80 hover:text-arc-gold underline-offset-2 hover:underline">Terms</button>
          {' '}and{' '}
          <button className="text-arc-gold/80 hover:text-arc-gold underline-offset-2 hover:underline">Privacy Policy</button>
        </p>
      </div>
    </div>
  )
}
