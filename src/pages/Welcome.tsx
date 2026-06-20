import { useState } from 'react'
import { Settings, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ARC_CHAIN_PARAMS } from '@/lib/metamask'
import { t } from '@/lib/i18n'
import { useStore } from '@/lib/store'

type ConnectResult =
  | { accounts: string[]; chainId: string }
  | { error: string }

export function Welcome() {
  const setIsOnboarded = useStore((s) => s.setIsOnboarded)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setWalletAddress = useStore((s) => s.setWalletAddress)

  const [connecting, setConnecting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleMetaMask = async () => {
    setConnecting(true)
    setErrorMsg('')

    try {
      // Need an active regular tab - chrome:// pages block executeScript
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error(
          `${t('send.enterWebPageFirst')} ${t('welcome.metamaskMissing')}`
        )
      }

      // Inject into page's MAIN world so window.ethereum is accessible
      const results = await chrome.scripting.executeScript<[], ConnectResult>({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (async (): Promise<ConnectResult> => {
          const eth = (window as any).ethereum
          if (!eth) return { error: t('welcome.metamaskMissing') }
          try {
            const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
            const chainId: string = await eth.request({ method: 'eth_chainId' })
            return { accounts, chainId }
          } catch (e: any) {
            return { error: e?.message ?? 'User rejected connection' }
          }
        }) as unknown as () => ConnectResult,
      })

      const payload = results[0]?.result
      if (!payload) throw new Error(t('welcome.noResponseFromPage'))
      if ('error' in payload) throw new Error(payload.error)
      if (!payload.accounts.length) throw new Error(t('welcome.noAccounts'))

      const address = payload.accounts[0]

      // Add / switch to Arc Testnet - non-fatal if user rejects
      try {
        await chrome.scripting.executeScript<[typeof ARC_CHAIN_PARAMS], void>({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [ARC_CHAIN_PARAMS],
          func: async (params: typeof ARC_CHAIN_PARAMS): Promise<void> => {
            await (window as any).ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [params],
            })
          },
        })
      } catch {
        // User skipped chain add - continue anyway
      }

      setWalletAddress(address)
      setIsOnboarded(true)
      setCurrentView('wallet')
    } catch (err: any) {
      console.error('MetaMask connect error:', err)
      setErrorMsg(err.message ?? t('welcome.connectionFailed'))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-mono text-arc-text-dim">ArcCopilot v0.2.0</span>
        <button className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <Settings size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-col items-center justify-center flex-1 px-6 gap-6">
        {/* Monochrome hexagon logo */}
        <div
          className="w-24 h-24 flex items-center justify-center text-4xl font-black text-white select-none border border-arc-border"
          style={{
            background: '#141414',
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          }}
        >
          A
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-arc-text font-display">{t('welcome.title')}</h1>
          <p className="text-sm text-arc-text-dim leading-relaxed">
            {t('welcome.subtitle')}
          </p>
        </div>

        <div className="w-full space-y-3">
          {/* Create wallet - Phase 3 */}
          <div className="relative">
            <Button variant="primary" fullWidth size="lg" disabled>
              {t('welcome.createWallet')}
            </Button>
            <span className="absolute -top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-arc-card text-white border border-arc-border pointer-events-none">
              {t('welcome.comingSoon')}
            </span>
          </div>

          {/* Import wallet - Phase 3 */}
          <div className="relative">
            <Button variant="outline" fullWidth size="lg" disabled>
              {t('welcome.importWallet')}
            </Button>
            <span className="absolute -top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-arc-card text-white border border-arc-border pointer-events-none">
              {t('welcome.comingSoon')}
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
              ? <><Loader2 size={16} className="animate-spin" /> {t('welcome.connecting')}</>
              : t('welcome.connectMetaMask')
            }
        </Button>
        </div>

        {/* Error */}
        {errorMsg && (
          <p className="text-xs text-arc-text-dim text-center leading-relaxed max-w-xs">
            {errorMsg}
          </p>
        )}

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-arc-success" />
          <span className="text-xs text-arc-text-dim">{t('wallet.arcTestnet')}</span>
        </div>
      </div>

      <div className="px-6 py-3 text-center">
        <p className="text-[10px] text-arc-text-dim">
          By continuing, you agree to our{' '}
          <button className="text-white/80 hover:text-white underline-offset-2 hover:underline">{t('welcome.terms')}</button>
          {' '}and{' '}
          <button className="text-white/80 hover:text-white underline-offset-2 hover:underline">{t('welcome.privacyPolicy')}</button>
        </p>
      </div>
    </div>
  )
}
