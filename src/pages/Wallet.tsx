import { useEffect, useRef, useState } from 'react'
import { Copy, Sparkles, Wallet as WalletIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { t } from '@/lib/i18n'
import { WalletHeader } from '@/components/WalletHeader'
import { BalanceCard } from '@/components/BalanceCard'
import { ActionButtons } from '@/components/ActionButtons'
import { TabBar } from '@/components/TabBar'
import { TokenList } from '@/components/TokenList'
import { ActivityTab } from '@/components/ActivityTab'
import { DiscoverTab } from '@/components/DiscoverTab'
import { BottomStatus } from '@/components/BottomStatus'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ErrorState'
import { useStore, type PortfolioTokenBalance } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { usePortfolioBalances } from '@/lib/portfolio'
import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { copyToClipboard, formatAddress } from '@/lib/utils'
import { ONBOARDING_SEEN } from '@/lib/storageKeys'

type Tab = 'tokens' | 'activity' | 'nfts' | 'discover'

interface PortfolioSectionProps {
  tokens: PortfolioTokenBalance[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

function PortfolioSection({ tokens, isLoading, error, onRetry }: PortfolioSectionProps) {
  const showSkeleton = isLoading && tokens.length === 0
  const showRefreshing = isLoading && tokens.length > 0
  const hasUsdcOnly = tokens.length === 1 && tokens[0].isUsdc
  const showErrorState = Boolean(error) && tokens.length === 0 && !isLoading
  const showEmptyState = !isLoading && tokens.length === 0 && !error

  return (
    <Card className="mx-4 mt-3 overflow-hidden">
      <div className="flex items-center justify-between border-b border-arc-border/80 px-4 py-3">
        <h2 className="text-sm font-semibold text-arc-text">{t('portfolio.title')}</h2>
        {showRefreshing ? (
          <span className="text-xs text-arc-gold">{t('portfolio.loading')}</span>
        ) : null}
      </div>

      <div className="px-4 py-2">
        {showErrorState ? (
          <div className="py-2">
            <ErrorState
              title={t('portfolio.title')}
              description={error ?? t('portfolio.couldNotLoad')}
              actionLabel={t('state.retry')}
              onAction={onRetry}
            />
          </div>
        ) : showSkeleton ? (
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-3 animate-pulse">
              <div className="h-9 w-9 rounded-full bg-arc-bg/60" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-24 rounded bg-arc-bg/60" />
                <div className="h-2.5 w-32 rounded bg-arc-bg/50" />
              </div>
              <div className="h-3.5 w-16 rounded bg-arc-bg/60" />
            </div>
            <div className="flex items-center gap-3 animate-pulse">
              <div className="h-9 w-9 rounded-full bg-arc-bg/60" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-20 rounded bg-arc-bg/60" />
                <div className="h-2.5 w-28 rounded bg-arc-bg/50" />
              </div>
              <div className="h-3.5 w-16 rounded bg-arc-bg/60" />
            </div>
          </div>
        ) : tokens.length > 0 ? (
          <div className="divide-y divide-arc-border/60">
            {tokens.map((token) => (
              <div key={`${token.address}-${token.symbol}`} className="flex items-center gap-3 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-arc-gold/25 bg-arc-gold/10 text-sm font-semibold text-arc-gold">
                  {token.isUsdc ? '$' : token.symbol.slice(0, 1) || token.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-arc-text">{token.name}</p>
                  <p className="truncate text-xs text-arc-text-dim">{token.symbol}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-medium text-arc-text">{token.balance}</p>
                </div>
              </div>
            ))}
          </div>
        ) : showEmptyState ? (
          <div className="flex flex-col items-center gap-3 px-3 py-5 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-arc-gold/20 bg-arc-gold/10 text-arc-gold">
              <WalletIcon size={20} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-arc-text">{t('activity.noActivityYet')}</p>
              <p className="text-xs leading-relaxed text-arc-text-dim">{t('portfolio.emptyDescription')}</p>
            </div>
          </div>
        ) : null}

        {!isLoading && hasUsdcOnly ? (
          <p className="pb-2 text-xs text-arc-text-dim">{t('portfolio.otherTokensNote')}</p>
        ) : null}
      </div>
    </Card>
  )
}

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onDiscover: () => void
  onMenu: () => void
  onOpenGogo?: () => void
}

export function Wallet({ onSend, onReceive, onDiscover, onMenu, onOpenGogo }: WalletProps) {
  const [activeTab, setActiveTab] = useState<Tab>('tokens')
  const [copied, setCopied] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingReady, setOnboardingReady] = useState(false)
  const onboardingDismissedRef = useRef(false)

  const address = useStore((s) => s.walletAddress)
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const { balance, isLoading } = useUSDCBalance()
  const { tokens: portfolioTokens, isLoading: isPortfolioLoading, error: portfolioError, refresh: refreshPortfolio } = usePortfolioBalances(address)

  useEffect(() => {
    let active = true

    void chromeStorageGet(ONBOARDING_SEEN).then((result) => {
      if (!active) return
      const onboardingSeen = result[ONBOARDING_SEEN] === true
      if (onboardingSeen || onboardingDismissedRef.current) {
        setShowOnboarding(false)
      } else {
        setShowOnboarding(true)
      }
      setOnboardingReady(true)
    })

    return () => {
      active = false
    }
  }, [])

  const level = Math.max(1, Math.floor(xp / 100))

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
  }

  const handleCopy = async () => {
    if (!address) return

    await copyToClipboard(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const dismissOnboarding = () => {
    onboardingDismissedRef.current = true
    setShowOnboarding(false)
    setOnboardingReady(true)
    void chromeStorageSet({ [ONBOARDING_SEEN]: true })
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <WalletHeader onMenu={onMenu} onNotifications={() => {}} />

      <div className="relative flex items-center gap-3 border-b border-arc-border px-4 py-2">
        <div className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-arc-gold/20 text-sm font-bold text-arc-gold">
          {address ? address[2].toUpperCase() : 'G'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-arc-text">{t('wallet.myWallet')}</p>
          <p className="font-mono text-xs text-arc-text-dim">
            {address ? formatAddress(address, 4) : '-'}
          </p>
        </div>
        <button
          onClick={handleCopy}
          title={t('wallet.copyAddress')}
          className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-gold"
        >
          <Copy size={14} />
        </button>
        {copied && (
          <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 rounded border border-arc-border bg-arc-card px-1.5 py-0.5 text-[10px] text-arc-success">
            {t('wallet.copied')}
          </span>
        )}
      </div>

      {onboardingReady && showOnboarding && (
        <Card className="relative mx-4 mt-3 overflow-hidden border-arc-gold/20 bg-gradient-to-br from-arc-gold/10 via-arc-card to-arc-card p-4 shadow-lg shadow-arc-gold/5">
          <button
            type="button"
            onClick={dismissOnboarding}
            aria-label={t('common.close')}
            className="absolute right-3 top-3 rounded-lg border border-arc-border bg-arc-bg/80 p-1.5 text-arc-text-dim transition-colors hover:border-arc-gold/40 hover:text-arc-gold"
          >
            <X size={14} />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-arc-gold/25 bg-arc-gold/10 text-arc-gold">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-arc-text">{t('onboarding.title')}</p>
                <p className="text-xs leading-relaxed text-arc-text-dim">{t('onboarding.subtitle')}</p>
              </div>
              <ul className="space-y-2 text-xs leading-relaxed text-arc-text-dim">
                {[
                  ['1', t('onboarding.point1')],
                  ['2', t('onboarding.point2')],
                  ['3', t('onboarding.point3')],
                ].map(([icon, label]) => (
                  <li key={label} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-arc-gold/20 bg-arc-gold/10 text-[10px] font-semibold text-arc-gold">
                      {icon}
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={dismissOnboarding} className="min-w-[92px]">
                  {t('onboarding.getStarted')}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <BalanceCard
        address={address ?? ''}
        balance={balance}
        isLoading={isLoading}
      />

      <PortfolioSection
        tokens={portfolioTokens}
        isLoading={isPortfolioLoading}
        error={portfolioError}
        onRetry={() => void refreshPortfolio()}
      />

      <ActionButtons onSend={onSend} onReceive={onReceive} onScan={() => {}} onBuy={() => {}} />

      <TabBar active={activeTab} onChange={handleTabChange} />

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'tokens' && <TokenList usdcBalance={balance} />}
        {activeTab === 'activity' && <ActivityTab address={address} />}
        {activeTab === 'nfts' && (
          <div className="flex h-32 flex-col items-center justify-center text-sm text-arc-text-dim">
            {t('wallet.nftsEmpty')}
          </div>
        )}
        {activeTab === 'discover' && <DiscoverTab address={address} onViewAll={onDiscover} />}
      </div>

      <BottomStatus
        level={level}
        streak={streak}
        onOpenDashboard={onDiscover}
        onOpenAddressBook={() => setCurrentView('address-book')}
        onOpenProfile={() => setCurrentView('profile')}
        onOpenBrief={() => setCurrentView('daily-brief')}
        onOpenGogo={onOpenGogo}
      />
    </div>
  )
}
