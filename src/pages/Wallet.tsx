import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import {
  Activity as ActivityIcon,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Copy,
  Droplet,
  FileText,
  Flame,
  Loader2,
  QrCode,
  Settings2,
  Sparkles,
  Wallet as WalletIcon,
  X,
  type LucideIcon,
} from 'lucide-react'
import { t, formatText } from '@/lib/i18n'
import { useStore, type PortfolioTokenBalance } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { usePortfolioBalances } from '@/lib/portfolio'
import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { copyToClipboard, formatAddress, formatUSD } from '@/lib/utils'
import { ONBOARDING_SEEN, PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'
import { isValidAddress } from '@/lib/validation'
import { readAddressFromImage } from '@/lib/imageReader'
import { MONOCHROME_DARK } from '@/lib/designTokens'

function makeCardStyle(backgroundColor: string, borderColor: string, borderRadius: number, borderWidth = 1) {
  return {
    backgroundColor,
    borderColor,
    borderRadius,
    borderWidth,
    borderStyle: 'solid' as const,
  }
}

function formatUsdFromBalance(balance: string | null): string | null {
  if (balance == null) return null
  const parsed = Number(balance)
  return Number.isFinite(parsed) ? formatUSD(parsed) : null
}

function getTokenBadgeLabel(token: PortfolioTokenBalance): string {
  if (token.isUsdc) return '$'

  const symbolInitial = token.symbol.trim().slice(0, 1)
  if (symbolInitial) return symbolInitial.toUpperCase()

  const nameInitial = token.name.trim().slice(0, 1)
  if (nameInitial) return nameInitial.toUpperCase()

  return 'â€¢'
}

function ActionTile({
  label,
  Icon,
  onClick,
}: {
  label: string
  Icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[82px] flex-1 flex-col items-center justify-start gap-2 rounded-none text-center"
    >
      <div
        className="flex h-12 w-12 items-center justify-center border text-white"
        style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.iconTile)}
      >
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <span className="text-[11px] font-medium leading-none text-white">{label}</span>
    </button>
  )
}

function BottomNavItem({
  label,
  Icon,
  active,
  onClick,
}: {
  label: string
  Icon: LucideIcon
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors"
      style={{ color: active ? MONOCHROME_DARK.colors.text : MONOCHROME_DARK.colors.hint }}
    >
      <Icon size={16} strokeWidth={1.9} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  )
}

function PortfolioSection({
  tokens,
  isLoading,
  error,
  onRetry,
}: {
  tokens: PortfolioTokenBalance[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}) {
  const showSkeleton = isLoading && tokens.length === 0
  const showErrorState = Boolean(error) && tokens.length === 0 && !isLoading
  const showEmptyState = !isLoading && tokens.length === 0 && !error
  const showRefreshing = isLoading && tokens.length > 0
  const subtitle = showRefreshing ? t('portfolio.loading') : showEmptyState ? t('portfolio.emptyDescription') : ''

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-arc-hint">
            {t('portfolio.title')}
          </p>
          {subtitle ? <p className="mt-1 text-xs text-arc-hint">{subtitle}</p> : null}
        </div>
        <span
          className="shrink-0 border px-2.5 py-1 text-[11px] font-medium text-white"
          style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.pill)}
        >
          {tokens.length}
        </span>
      </div>

      {showErrorState ? (
        <div
          className="space-y-3 border px-4 py-4"
          style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.card)}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center border text-white"
              style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.iconTile)}
            >
              <WalletIcon size={18} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{t('portfolio.couldNotLoad')}</p>
              <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{error ?? t('portfolio.couldNotLoad')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center rounded-full border border-arc-borderEmphasis px-3 py-2 text-[11px] font-medium text-white transition-colors hover:border-white/30"
          >
            {t('state.retry')}
          </button>
        </div>
      ) : showSkeleton ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="flex items-center gap-3 border px-3 py-3 animate-pulse"
              style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.card)}
            >
              <div className="h-10 w-10 shrink-0 rounded-[15px] bg-white/[0.06]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-24 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-16 rounded bg-white/[0.05]" />
              </div>
              <div className="space-y-2 text-right">
                <div className="h-3.5 w-16 rounded bg-white/[0.06]" />
                <div className="h-2.5 w-12 rounded bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      ) : showEmptyState ? (
        <div
          className="space-y-3 border px-4 py-4"
          style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.card)}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center border text-white"
              style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.iconTile)}
            >
              <WalletIcon size={18} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{t('portfolio.title')}</p>
              <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{t('portfolio.emptyDescription')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => {
            const usdValue = token.isUsdc ? formatUsdFromBalance(token.balance) : null

            return (
              <div
                key={`${token.address}-${token.symbol}`}
                className="border px-3 py-3"
                style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.card)}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center border text-sm font-medium text-white"
                    style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.iconTile)}
                  >
                    {getTokenBadgeLabel(token)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{token.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-arc-text-dim">{token.symbol}</p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-medium text-white">{token.balance}</p>
                    <p className="mt-0.5 text-[11px] text-arc-hint">{usdValue ?? 'â€”'}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!isLoading && tokens.length === 1 && tokens[0]?.isUsdc ? (
        <p className="px-0.5 text-[11px] text-arc-hint">{t('portfolio.otherTokensNote')}</p>
      ) : null}
    </section>
  )
}

interface WalletProps {
  onSend: () => void
  onReceive: () => void
  onOpenBrief: () => void
  onOpenActivity: () => void
  onMenu: () => void
  onOpenGogo?: () => void
}

export function Wallet({
  onSend,
  onReceive,
  onOpenBrief,
  onOpenActivity,
  onMenu,
  onOpenGogo,
}: WalletProps) {
  const [copied, setCopied] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingReady, setOnboardingReady] = useState(false)
  const [scanPanelOpen, setScanPanelOpen] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState('')
  const [actionError, setActionError] = useState('')
  const onboardingDismissedRef = useRef(false)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const scanDropzoneRef = useRef<HTMLDivElement>(null)

  const address = useStore((s) => s.walletAddress)
  const xp = useStore((s) => s.xp)
  const streak = useStore((s) => s.streak)
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

  useEffect(() => {
    if (scanPanelOpen) {
      scanDropzoneRef.current?.focus()
    }
  }, [scanPanelOpen])

  const level = Math.max(1, Math.floor(xp / 100))
  const displayBalance = balance ?? null
  const displayUsdBalance = formatUsdFromBalance(displayBalance)
  const streakLabel = formatText('wallet.streakLevel', {
    streak: Math.max(0, streak),
    level,
  })
  const openGogo = onOpenGogo ?? (() => {})

  const dismissOnboarding = () => {
    onboardingDismissedRef.current = true
    setShowOnboarding(false)
    setOnboardingReady(true)
    void chromeStorageSet({ [ONBOARDING_SEEN]: true })
  }

  const handleCopy = async () => {
    if (!address) return

    await copyToClipboard(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleOpenSend = () => {
    setActionError('')
    setScanError('')
    onSend()
  }

  const handleOpenReceive = () => {
    setActionError('')
    setScanError('')
    onReceive()
  }

  const closeScanPanel = () => {
    setScanPanelOpen(false)
    setScanError('')
    setScanBusy(false)
  }

  const queueSendWithRecipient = async (recipient: string) => {
    const normalized = recipient.trim().toLowerCase()
    if (!isValidAddress(normalized)) {
      throw new Error('INVALID_ADDRESS')
    }

    await chromeStorageSet({
      [PENDING_SEND_STORAGE_KEY]: {
        recipient: normalized,
        ts: Date.now(),
      },
    })

    setScanPanelOpen(false)
    setScanError('')
    setActionError('')
    onSend()
  }

  const handleScanBlob = async (blob: Blob) => {
    setScanBusy(true)
    setScanError('')
    setActionError('')

    try {
      const result = await readAddressFromImage(blob)
      const addressCandidate = result.address?.trim() ?? ''

      if (!isValidAddress(addressCandidate)) {
        throw new Error('COULD_NOT_READ_ADDRESS')
      }

      await queueSendWithRecipient(addressCandidate)
    } catch (error) {
      console.error('[Wallet] scan failed:', error)
      setScanError(t('wallet.scanFailed'))
    } finally {
      setScanBusy(false)
    }
  }

  const handleScanInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    await handleScanBlob(file)
  }

  const handleScanPaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const pastedImage = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
    if (!pastedImage) return

    event.preventDefault()
    await handleScanBlob(pastedImage)
  }

  const handleOpenScan = () => {
    setActionError('')
    setScanError('')
    setScanPanelOpen(true)
    scanInputRef.current?.click()
  }

  const handleOpenBuy = () => {
    setActionError('')
    const faucetUrl = 'https://faucet.circle.com'

    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: faucetUrl })
      return
    }

    const opened = window.open(faucetUrl, '_blank', 'noopener,noreferrer')
    if (!opened) {
      setActionError(t('wallet.faucetUnavailable'))
    }
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        backgroundColor: MONOCHROME_DARK.colors.background,
        color: MONOCHROME_DARK.colors.text,
      }}
    >
      <main className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center border text-sm font-medium text-white"
                  style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, 999)}
                >
                  {address ? address.slice(2, 3).toUpperCase() : 'C'}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-tight text-white">{t('wallet.myWallet')}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="truncate text-[11px] font-normal text-arc-text-dim">
                      {address ? formatAddress(address, 4) : t('wallet.addressMissing')}
                    </p>
                    <button
                      type="button"
                      onClick={handleCopy}
                      disabled={!address}
                      aria-label={t('wallet.copyAddress')}
                      title={t('wallet.copyAddress')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center border text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.pill)}
                    >
                      <Copy size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div
                className="inline-flex h-11 items-center gap-2 border px-3 text-[11px] font-medium text-white"
                style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.pill)}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                <span>Arc</span>
              </div>
              <button
                type="button"
                onClick={onMenu}
                aria-label={t('nav.settings')}
                title={t('nav.settings')}
                className="flex h-11 w-11 shrink-0 items-center justify-center border text-white transition-colors"
                style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.pill)}
              >
                <Settings2 size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {copied ? (
            <div
              className="inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-medium text-white"
              style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.pill)}
            >
              {t('wallet.copied')}
            </div>
          ) : null}

          {onboardingReady && showOnboarding ? (
            <div className="border px-4 py-4" style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.elevatedBorder, MONOCHROME_DARK.radius.card)}>
              <div className="flex items-start gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-white"
                  style={makeCardStyle(MONOCHROME_DARK.colors.text, MONOCHROME_DARK.colors.text, MONOCHROME_DARK.radius.iconTile)}
                >
                  <Sparkles size={18} strokeWidth={1.75} color={MONOCHROME_DARK.colors.background} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white">{t('onboarding.title')}</p>
                    <p className="text-xs leading-relaxed text-arc-text-dim">{t('onboarding.subtitle')}</p>
                  </div>

                  <ul className="space-y-2 text-xs leading-relaxed text-arc-text-dim">
                    {[
                      ['1', t('onboarding.point1')],
                      ['2', t('onboarding.point2')],
                      ['3', t('onboarding.point3')],
                    ].map(([step, label]) => (
                      <li key={label} className="flex items-start gap-2">
                        <span
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] font-medium text-white"
                          style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, 999)}
                        >
                          {step}
                        </span>
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={dismissOnboarding}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-white bg-white px-4 text-[11px] font-medium text-black transition-opacity hover:opacity-90"
                    >
                      {t('onboarding.getStarted')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="border px-4 py-4" style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.elevatedBorder, MONOCHROME_DARK.radius.hero, 0.5)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-arc-hint">
                  {t('wallet.totalBalance')}
                </p>
              </div>
              <div
                className="inline-flex items-center gap-1.5 border px-3 py-1 text-[11px] font-medium text-white"
                style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.pill)}
              >
                <Flame size={12} strokeWidth={1.9} />
                <span>{streakLabel}</span>
              </div>
            </div>

            <div className="mt-5">
              {isLoading && displayBalance == null ? (
                <div className="space-y-3">
                  <div className="h-10 w-36 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-4 w-28 animate-pulse rounded bg-white/[0.05]" />
                </div>
              ) : (
                <>
                  <p className="text-[38px] font-medium leading-none tracking-[-0.05em] text-white">
                    {displayUsdBalance ?? t('common.unknown')}
                  </p>
                  <p className="mt-2 text-sm font-normal text-arc-text-dim">
                    {displayBalance != null ? `${displayBalance} ${t('common.usdc')}` : t('common.unknown')}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <ActionTile label={t('actions.send')} Icon={ArrowUpRight} onClick={handleOpenSend} />
            <ActionTile label={t('actions.receive')} Icon={ArrowDownLeft} onClick={handleOpenReceive} />
            <ActionTile label={t('actions.scan')} Icon={QrCode} onClick={handleOpenScan} />
            <ActionTile label={t('actions.getUsdc')} Icon={Droplet} onClick={handleOpenBuy} />
          </div>

          {actionError ? <p className="px-0.5 text-[11px] text-arc-text-dim">{actionError}</p> : null}

          {scanPanelOpen ? (
            <div className="border px-4 py-4" style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.card)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center border text-white"
                    style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.iconTile)}
                  >
                    <QrCode size={18} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-white">{t('wallet.scanTitle')}</p>
                    <p className="text-xs leading-relaxed text-arc-text-dim">{t('wallet.scanSubtitle')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeScanPanel}
                  aria-label={t('common.close')}
                  className="flex h-11 w-11 shrink-0 items-center justify-center border text-white transition-colors"
                  style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.borderEmphasis, MONOCHROME_DARK.radius.pill)}
                >
                  <X size={14} strokeWidth={1.9} />
                </button>
              </div>

              <div
                ref={scanDropzoneRef}
                tabIndex={0}
                onPaste={handleScanPaste}
                className="mt-4 rounded-[16px] border border-dashed border-arc-border bg-arc-elevated p-4 outline-none focus:border-arc-borderEmphasis"
              >
                <p className="text-xs leading-relaxed text-arc-text-dim">{t('wallet.scanPasteHint')}</p>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => scanInputRef.current?.click()}
                    disabled={scanBusy}
                    className="inline-flex min-h-11 items-center gap-2 border px-3 text-[11px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={makeCardStyle(MONOCHROME_DARK.colors.elevated, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.pill)}
                  >
                    {scanBusy ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                    {scanBusy ? t('common.loading') : t('wallet.scanChooseImage')}
                  </button>
                </div>

                {scanError ? <p className="mt-3 text-[11px] text-arc-text-dim">{scanError}</p> : null}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={openGogo}
            className="w-full border px-4 py-4 text-left transition-colors hover:border-arc-borderEmphasis"
            style={makeCardStyle(MONOCHROME_DARK.colors.surface, MONOCHROME_DARK.colors.border, MONOCHROME_DARK.radius.card)}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center bg-white text-black"
                style={{ borderRadius: MONOCHROME_DARK.radius.iconTile }}
              >
                <Sparkles size={18} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{t('wallet.gogoCardTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{t('wallet.gogoCardSubtitle')}</p>
              </div>
              <ChevronRight size={16} className="shrink-0 text-arc-hint" />
            </div>
          </button>

          <div className="pt-1">
            <PortfolioSection
              tokens={portfolioTokens}
              isLoading={isPortfolioLoading}
              error={portfolioError}
              onRetry={() => void refreshPortfolio()}
            />
          </div>
        </div>
      </main>

      <nav className="shrink-0 border-t" style={{ borderTopColor: MONOCHROME_DARK.colors.border, borderTopWidth: 0.5, backgroundColor: MONOCHROME_DARK.colors.background }}>
        <div className="grid grid-cols-4">
          <BottomNavItem label={t('nav.wallet')} Icon={WalletIcon} active onClick={() => {}} />
          <BottomNavItem label={t('nav.brief')} Icon={FileText} active={false} onClick={onOpenBrief} />
          <BottomNavItem label={t('nav.gogo')} Icon={Sparkles} active={false} onClick={openGogo} />
          <BottomNavItem label={t('nav.activity')} Icon={ActivityIcon} active={false} onClick={onOpenActivity} />
        </div>
      </nav>

      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleScanInputChange}
      />
    </div>
  )
}
