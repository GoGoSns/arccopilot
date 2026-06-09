import { useState } from 'react'
import { Settings, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/lib/store'

type ConnectResult =
  | { accounts: string[]; chainId: string }
  | { error: string }

export function Welcome() {
  const setIsOnboarded   = useStore((s) => s.setIsOnboarded)
  const setCurrentView   = useStore((s) => s.setCurrentView)
  const setWalletAddress = useStore((s) => s.setWalletAddress)

  const [connecting, setConnecting] = useState(false)
  const [errorMsg,   setErrorMsg]   = useState('')

  const handleMetaMask = async () => {
    setConnecting(true)
    setErrorMsg('')

    try {
      // Need an active regular tab — chrome:// pages block executeScript
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error(
          'Please open a web page first (e.g. arcpaymain.vercel.app), ' +
          'then click Connect MetaMask again. MetaMask is unavailable on browser system pages.'
        )
      }

      // Inject into page's MAIN world so window.ethereum is accessible
      const results = await chrome.scripting.executeScript<[], ConnectResult>({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (async (): Promise<ConnectResult> => {
          const eth = (window as any).ethereum
          if (!eth) return { error: 'MetaMask is not installed or not active on this page.' }
          try {
            const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
            const chainId: string    = await eth.request({ method: 'eth_chainId' })
            return { accounts, chainId }
          } catch (e: any) {
            return { error: e?.message ?? 'User rejected connection' }
          }
        }) as unknown as () => ConnectResult,
      })

      const payload = results[0]?.result
      if (!payload) throw new Error('No response from the page.')
      if ('error' in payload) throw new Error(payload.error)
      if (!payload.accounts.length) throw new Error('MetaMask returned no accounts.')

      const address = payload.accounts[0]

      // Add / switch to Arc Testnet — non-fatal if user rejects
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: async () => {
            await (window as any).ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x4cef52', // 5042002 decimal
                chainName: 'Arc Testnet',
                nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                rpcUrls: ['https://rpc.testnet.arc.network'],
                blockExplorerUrls: ['https://testnet.arcscan.app'],
              }],
            })
          },
        })
      } catch {
        // User skipped chain add — continue anyway
      }

      setWalletAddress(address)
      setIsOnboarded(true)
      setCurrentView('wallet')
    } catch (err: any) {
      console.error('MetaMask connect error:', err)
      setErrorMsg(err.message ?? 'Connection failed.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-mono text-arc-text-dim">ArcCopilot v0.1.0</span>
        <button className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <Settings size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 gap-6">
        {/* Gold hexagon logo */}
        <div
          className="w-24 h-24 flex items-center justify-center text-4xl font-black text-black select-none"
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
          {/* Create wallet — Phase 3 */}
          <div className="relative">
            <Button variant="primary" fullWidth size="lg" disabled>
              Create new wallet
            </Button>
            <span className="absolute -top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-arc-gold/20 text-arc-gold border border-arc-gold/30 pointer-events-none">
              Coming soon
            </span>
          </div>

          {/* Import wallet — Phase 3 */}
          <div className="relative">
            <Button variant="outline" fullWidth size="lg" disabled>
              Import existing wallet
            </Button>
            <span className="absolute -top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-arc-gold/20 text-arc-gold border border-arc-gold/30 pointer-events-none">
              Coming soon
            </span>
          </div>

          {/* MetaMask connect */}
          <Button
            variant="ghost"
            fullWidth
            size="lg"
            onClick={handleMetaMask}
            disabled={connecting}
          >
            {connecting
              ? <><Loader2 size={16} className="animate-spin" /> Connecting…</>
              : 'Connect MetaMask'
            }
          </Button>
        </div>

        {/* Error */}
        {errorMsg && (
          <p className="text-xs text-arc-danger text-center leading-relaxed max-w-xs">
            {errorMsg}
          </p>
        )}

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
