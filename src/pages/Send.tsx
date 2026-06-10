import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Loader2, Share2, User, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore } from '@/lib/store'
import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'
import { formatText, t } from '@/lib/i18n'
import {
  ARC_CHAIN_ID,
  ensureMetaMaskAccounts,
  getMetaMaskFriendlyError,
  probeMetaMaskAccounts,
  requestMetaMaskAccounts,
  switchToArcTestnet,
  type MetaMaskAccountResult,
} from '@/lib/metamask'
import { EXPLORER_URL, USDC_ADDRESS } from '@/lib/arc'
import { formatAddress, shortenTxHash } from '@/lib/utils'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { MemoryCard } from '@/components/MemoryCard'

interface SendProps {
  onBack: () => void
}

type MetaMaskError = {
  code?: number
  message: string
}

type SendResult =
  | { hash: string }
  | { error: MetaMaskError }

type ReceiptResult = {
  receipt?: { status?: string } | null
  error?: string
}

type TxStatus = 'idle' | 'pending' | 'confirmed'
type MetaMaskAccessState = 'checking' | 'authorized' | 'unauthorized' | 'missing'
type PendingSend = {
  recipient?: string
  amount?: string
  ts: number
}

function isPendingSend(value: unknown): value is PendingSend {
  if (!value || typeof value !== 'object') return false

  const pending = value as PendingSend & { recipient?: unknown; amount?: unknown; ts?: unknown }
  return typeof pending.ts === 'number'
    && (pending.recipient === undefined || typeof pending.recipient === 'string')
    && (pending.amount === undefined || typeof pending.amount === 'string')
}

export function Send({ onBack }: SendProps) {
  const walletAddress = useStore((s) => s.walletAddress)
  const setWalletAddress = useStore((s) => s.setWalletAddress)
  const addressMemories = useStore((s) => s.addressMemories)
  const addAddressMemory = useStore((s) => s.addAddressMemory)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)
  const { balance, refresh } = useUSDCBalance()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [lastTransfer, setLastTransfer] = useState<{ recipient: string; amount: string } | null>(null)
  const [fromUniversalTip, setFromUniversalTip] = useState(false)
  const [recipientContractStatus, setRecipientContractStatus] = useState<'idle' | 'checking' | 'contract' | 'unknown'>('idle')
  const [metaMaskAccessState, setMetaMaskAccessState] = useState<MetaMaskAccessState>('checking')
  const [metaMaskConnecting, setMetaMaskConnecting] = useState(false)
  const [metaMaskAccount, setMetaMaskAccount] = useState<string | null>(walletAddress)

  const amountRef = useRef<HTMLInputElement>(null)
  const successTimerRef = useRef<number | null>(null)
  const contractLookupTokenRef = useRef(0)
  const [showSuggestions, setShowSuggestions] = useState(false)

  const trimmedRecipient = recipient.trim()
  const isExactRecipient = /^0x[a-fA-F0-9]{40}$/.test(trimmedRecipient)
  const recipientValidationError = trimmedRecipient && !isExactRecipient ? t('send.invalidRecipientAddress') : ''
  const recipientMemory = isExactRecipient ? addressMemories[trimmedRecipient.toLowerCase()] ?? null : null
  const isUnknownRecipient = isExactRecipient && !recipientMemory && recipientContractStatus === 'unknown'
  const isAmountValid = amount.trim().length > 0 && !Number.isNaN(Number(amount)) && Number(amount) > 0
  const showRecipientSafetyWarning = fromUniversalTip && isExactRecipient
  const senderAddress = metaMaskAccount ?? walletAddress
  const isSendDisabled = isLoading || !senderAddress || !isExactRecipient || !isAmountValid || !!txHash

  const suggestions = useMemo(() => {
    const q = recipient.toLowerCase()
    if (!q || q.startsWith('0x')) return []
    return Object.values(addressMemories)
      .filter((m) => m.label?.toLowerCase().includes(q))
      .slice(0, 3)
  }, [addressMemories, recipient])

  useEffect(() => {
    chrome.storage.local.get(PENDING_SEND_STORAGE_KEY, (result) => {
      const pending = result[PENDING_SEND_STORAGE_KEY]
      // 30s TTL for inter-page navigation
      if (isPendingSend(pending) && Date.now() - pending.ts < 30_000) {
        if (typeof pending.recipient === 'string') setRecipient(pending.recipient)
        if (typeof pending.amount === 'string') setAmount(pending.amount)
        setFromUniversalTip(true)
        chrome.storage.local.remove(PENDING_SEND_STORAGE_KEY)
        if (!pending.amount) {
          setTimeout(() => amountRef.current?.focus(), 50)
        }
      } else {
        setFromUniversalTip(false)
        chrome.storage.local.remove(PENDING_SEND_STORAGE_KEY)
      }
    })
  }, [])

  const syncMetaMaskAccount = (account: string): string => {
    const normalized = account.toLowerCase()
    setMetaMaskAccount(account)

    if (!walletAddress || walletAddress.toLowerCase() !== normalized) {
      setWalletAddress(account)
    }

    return account
  }

  const handleMetaMaskAccountResult = (result: MetaMaskAccountResult): string | null => {
    if ('error' in result) {
      setMetaMaskAccount(null)
      const message = getMetaMaskFriendlyError(result.error)
      setMetaMaskAccessState(/not installed|not active on this page/i.test(message) ? 'missing' : 'unauthorized')
      return null
    }

    if (result.accounts.length === 0) {
      setMetaMaskAccount(null)
      setMetaMaskAccessState('unauthorized')
      return null
    }

    setMetaMaskAccessState('authorized')
    return syncMetaMaskAccount(result.accounts[0])
  }

  const refreshMetaMaskAccess = async (): Promise<void> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        setMetaMaskAccessState('missing')
        return
      }

      const result = await probeMetaMaskAccounts(tab.id)
      handleMetaMaskAccountResult(result)
    } catch {
      setMetaMaskAccessState('missing')
    }
  }

  useEffect(() => {
    void refreshMetaMaskAccess()
  }, [walletAddress])

  const handleConnectMetaMask = async () => {
    setMetaMaskConnecting(true)
    setError('')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error(t('send.enterWebPageFirst'))
      }

      const result = await requestMetaMaskAccounts(tab.id)
      const account = handleMetaMaskAccountResult(result)
      if (!account) {
        const error = 'error' in result ? result.error : { message: 'MetaMask permission needed. Please connect your wallet to ArcCopilot and try again.' }
        throw new Error(getMetaMaskFriendlyError(error))
      }
    } catch (err: any) {
      const message = getMetaMaskFriendlyError(err)
      setMetaMaskAccessState(/not installed|not active on this page/i.test(message) ? 'missing' : 'unauthorized')
      setError(message)
    } finally {
      setMetaMaskConnecting(false)
    }
  }

  useEffect(() => {
    if (!isExactRecipient) {
      setRecipientContractStatus('idle')
      return
    }

    const lookupToken = ++contractLookupTokenRef.current
    const controller = new AbortController()

    setRecipientContractStatus('checking')

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${EXPLORER_URL}/api/v2/addresses/${trimmedRecipient}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json() as {
          is_contract?: boolean
          contract_code?: string | null
          smart_contract?: unknown
          contract?: unknown
          type?: string
        }

        const type = String(data?.type ?? '').toLowerCase()
        const isContract = Boolean(
          data?.is_contract ||
          (typeof data?.contract_code === 'string' && data.contract_code.length > 0) ||
          data?.smart_contract ||
          data?.contract ||
          type.includes('contract')
        )

        if (contractLookupTokenRef.current === lookupToken) {
          setRecipientContractStatus(isContract ? 'contract' : 'unknown')
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return
        if (contractLookupTokenRef.current === lookupToken) {
          setRecipientContractStatus('unknown')
        }
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [isExactRecipient, trimmedRecipient])

  const refreshTimerRef = useRef<number | null>(null)
  const receiptPollTokenRef = useRef(0)

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      receiptPollTokenRef.current += 1
    }
  }, [])

  const clearScheduledRefresh = () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }

  const scheduleBalanceRefresh = () => {
    clearScheduledRefresh()
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void refresh()
    }, 3000)
  }

  const readTransactionReceipt = async (tabId: number, hash: string): Promise<ReceiptResult> => {
    const results = await chrome.scripting.executeScript<[string], Promise<ReceiptResult>>({
      target: { tabId },
      world: 'MAIN',
      args: [hash],
      func: async (txHash: string): Promise<ReceiptResult> => {
        try {
          const ethereum = (window as any).ethereum
          if (!ethereum) return { error: 'MetaMask is not installed or not active on this page.' }

          const receipt = await ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          })

          return { receipt }
        } catch (err: any) {
          return { error: err?.message ?? 'Failed to fetch transaction receipt' }
        }
      },
    })

    return results[0]?.result ?? { error: 'No response from the page.' }
  }

  const pollTransactionReceipt = async (tabId: number, hash: string, pollToken: number) => {
    const maxAttempts = 15

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (receiptPollTokenRef.current !== pollToken) return

      let result: ReceiptResult
      try {
        result = await readTransactionReceipt(tabId, hash)
      } catch {
        result = { error: 'Failed to fetch transaction receipt' }
      }
      if (receiptPollTokenRef.current !== pollToken) return

      if (result.receipt) {
        setTxStatus('confirmed')
        void refresh()
        return
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000))
      }
    }

    if (receiptPollTokenRef.current === pollToken) {
      setTxStatus('pending')
    }
  }

  const resetSendForm = () => {
    clearScheduledRefresh()
    receiptPollTokenRef.current += 1
    setRecipient('')
    setAmount('')
    setError('')
    setTxHash('')
    setTxStatus('idle')
    setLastTransfer(null)
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current)
      successTimerRef.current = null
    }
  }

  // Auto-return to form 8s after a successful send
  useEffect(() => {
    if (!txHash) return
    successTimerRef.current = window.setTimeout(() => {
      successTimerRef.current = null
      resetSendForm()
    }, 8_000)
    return () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current)
        successTimerRef.current = null
      }
    }
  }, [txHash]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async () => {
    setError('')
    setTxHash('')
    setTxStatus('idle')
    setLastTransfer(null)
    clearScheduledRefresh()
    receiptPollTokenRef.current += 1

    if (!senderAddress) {
      setError(t('send.connectWalletFirst'))
      return
    }

    if (!isExactRecipient) {
      setError(t('send.invalidRecipientAddress'))
      return
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError(t('send.invalidAmount'))
      return
    }

    if (amountNum > parseFloat(balance)) {
      setError(t('send.insufficientBalance'))
      return
    }

    setIsLoading(true)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error(t('send.enterWebPageFirst'))
      }

      // We still probe/ensure accounts to update UI state, but the real enforcement
      // happens inside the consolidated executeScript to avoid 4100 unauthorized.
      const accessResult = await ensureMetaMaskAccounts(tab.id)
      const activeAccount = handleMetaMaskAccountResult(accessResult)
      if (!activeAccount) {
        const error = 'error' in accessResult
          ? accessResult.error
          : { message: 'MetaMask permission needed. Click Connect MetaMask.' }

        throw new Error(getMetaMaskFriendlyError(error))
      }

      // Switch to Arc Testnet before sending — non-fatal if user declines
      await switchToArcTestnet(tab.id)

      const amountWei = BigInt(Math.round(amountNum * 1_000_000))
      const paddedRecipient = trimmedRecipient.slice(2).toLowerCase().padStart(64, '0')
      const paddedAmount = amountWei.toString(16).padStart(64, '0')
      const txData = '0xa9059cbb' + paddedRecipient + paddedAmount

      const results = await chrome.scripting.executeScript<[string, string, string, string], Promise<SendResult>>({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [activeAccount, txData, USDC_ADDRESS, ARC_CHAIN_ID],
        func: async (from: string, data: string, to: string, targetChainId: string): Promise<SendResult> => {
          try {
            const ethereum = (window as any).ethereum
            if (!ethereum) {
              return { error: { message: 'MetaMask not detected' } }
            }

            // 1. Ensure authorized
            try {
              await ethereum.request({ method: 'eth_requestAccounts' })
            } catch (err: any) {
              if (err?.code === 4001) return { error: { code: 4001, message: 'MetaMask connection was rejected.' } }
              if (err?.code === 4100) return { error: { code: 4100, message: 'MetaMask permission needed. Click Connect MetaMask.' } }
              throw err
            }

            // 2. Ensure correct network
            const currentChainId = await ethereum.request({ method: 'eth_chainId' })
            if (currentChainId !== targetChainId) {
              try {
                await ethereum.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: targetChainId }],
                })
              } catch (switchError: any) {
                return { error: { message: 'Network mismatch. Please switch to Arc Testnet in MetaMask.' } }
              }
            }

            // 3. Send transaction
            const hash = await ethereum.request({
              method: 'eth_sendTransaction',
              params: [{
                from,
                to,
                data,
              }],
            })

            return { hash }
          } catch (err: any) {
            return {
              error: {
                code: typeof err?.code === 'number' ? err.code : undefined,
                message: typeof err?.message === 'string' && err.message.trim()
                  ? err.message
                  : 'Failed to send transaction',
              },
            }
          }
        },
      })

      const result = results[0]?.result
      if (!result) throw new Error(t('send.noResponseFromPage'))
      if ('error' in result) {
        if (result.error.code === 4100 || /not been authorized|unauthorized/i.test(result.error.message)) {
          setMetaMaskAccessState('unauthorized')
        }
        throw new Error(getMetaMaskFriendlyError(result.error))
      }
      if (!result.hash) throw new Error(t('send.noTxHashReturned'))

      setTxHash(result.hash)
      setTxStatus('pending')
      setLastTransfer({ recipient: trimmedRecipient, amount: amount.trim() })
      scheduleBalanceRefresh()

      const pollToken = receiptPollTokenRef.current
      void pollTransactionReceipt(tab.id, result.hash, pollToken)
    } catch (err: any) {
      const message = getMetaMaskFriendlyError(err)
      if (/MetaMask permission needed/i.test(message)) {
        setMetaMaskAccessState('unauthorized')
      }
      setError(message || (err?.message ?? t('send.failedToSend')))
    } finally {
      setIsLoading(false)
    }
  }

  // ── Success view ──────────────────────────────────────────────────────────
  if (txHash && lastTransfer) {
    const displayRecipient = recipientMemory?.label ?? formatAddress(lastTransfer.recipient, 4)
    const isInBook = Boolean(recipientMemory)
    const shareText =
      formatText('send.shareText', {
        amount: lastTransfer.amount,
        url: `${EXPLORER_URL}/tx/${txHash}`,
      })

    return (
      <div className="flex flex-col h-full bg-arc-bg">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
          <button onClick={resetSendForm} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-base font-semibold text-arc-text">{t('send.title')}</h2>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-5 py-6 gap-5">
          <CheckCircle2 size={52} className="text-arc-gold" />

          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-arc-text-dim">{t('send.sent')}</p>
            <p className="text-2xl font-bold text-arc-text">{lastTransfer.amount} USDC</p>
            <p className="text-sm text-arc-text-dim">{formatText('send.successTo', { recipient: displayRecipient })}</p>
            {txStatus === 'confirmed' && (
              <span className="inline-block mt-1 rounded-full bg-arc-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-arc-success">
                {t('send.confirmed')}
              </span>
            )}
          </div>

          <button
            onClick={() => navigator.clipboard.writeText(txHash)}
            className="flex items-center gap-2 rounded-xl bg-arc-card border border-arc-border px-3 py-2.5 w-full hover:border-arc-gold/30 transition-colors"
          >
            <p className="flex-1 text-left text-xs font-mono text-arc-text-dim truncate">{shortenTxHash(txHash)}</p>
            <Copy size={13} className="shrink-0 text-arc-text-dim" />
          </button>

          <div className="flex flex-col gap-2 w-full">
            <Button variant="outline" fullWidth
              onClick={() => window.open(`${EXPLORER_URL}/tx/${txHash}`, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={14} />
              {t('send.viewOnExplorer')}
            </Button>
            {!isInBook && (
              <Button variant="ghost" fullWidth
                onClick={() => {
                  addAddressMemory(lastTransfer.recipient, { label: 'Contact' })
                  setSelectedAddress(lastTransfer.recipient)
                  setCurrentView('address-detail')
                }}
              >
                <UserPlus size={14} />
                {t('send.saveRecipient')}
              </Button>
            )}
            <Button variant="ghost" fullWidth
              onClick={() => navigator.clipboard.writeText(shareText)}
            >
              <Share2 size={14} />
              {t('send.share')}
            </Button>
          </div>
        </div>

        <div className="px-4 pb-6">
          <Button variant="ghost" fullWidth onClick={resetSendForm}>
            {t('send.sendAnother')}
          </Button>
        </div>
      </div>
    )
  }
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">{t('send.title')}</h2>
      </div>

      <div className="flex-1 px-4 py-6 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <div className="relative">
            <Input
              label={t('send.recipientAddress')}
              placeholder={t('send.recipientPlaceholder')}
              value={recipient}
              error={recipientValidationError}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setRecipient(e.target.value)
                setError('')
                setTxHash('')
                setTxStatus('idle')
                setLastTransfer(null)
                setFromUniversalTip(false)
                setShowSuggestions(true)
              }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-20 bg-arc-card border border-arc-border rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                {suggestions.map((s) => (
                  <button
                    key={s.address}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-arc-border/30 transition-colors text-left"
                    onClick={() => {
                      setRecipient(s.address)
                      setShowSuggestions(false)
                    }}
                  >
                    <div className="h-8 w-8 rounded-full bg-arc-gold/10 flex items-center justify-center text-arc-gold">
                      <User size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-arc-text truncate">{s.label}</p>
                      <p className="text-[10px] text-arc-text-dim truncate">{formatAddress(s.address)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isExactRecipient && (
              <span className="rounded-full border border-arc-success/20 bg-arc-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-arc-success">
                {t('send.validAddress')}
              </span>
            )}
            {isUnknownRecipient && (
              <span className="rounded-full border border-arc-gold/20 bg-arc-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-arc-gold">
                {t('send.unknownRecipient')}
              </span>
            )}
            {recipientContractStatus === 'contract' && (
              <span className="rounded-full border border-arc-border bg-arc-card/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-arc-text">
                {t('send.contractAddress')}
              </span>
            )}
          </div>

          {showRecipientSafetyWarning && (
            <p className="text-[11px] leading-relaxed text-arc-gold">
              {t('send.verifyRecipient')}
            </p>
          )}
        </div>

        {metaMaskAccessState === 'unauthorized' && (
          <Card className="space-y-3 border-arc-gold/30 bg-arc-gold/10 p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-arc-gold">{t('send.metaMaskPermissionNeeded')}</p>
              <p className="text-xs leading-relaxed text-arc-text-dim">
                {t('send.metaMaskPermissionNeeded')}
              </p>
            </div>
            <Button
              variant="outline"
              fullWidth
              size="sm"
              onClick={handleConnectMetaMask}
              disabled={metaMaskConnecting}
            >
              {metaMaskConnecting && <Loader2 size={14} className="animate-spin" />}
              {metaMaskConnecting ? t('send.connecting') : t('send.connectMetaMask')}
            </Button>
          </Card>
        )}

        {isExactRecipient && (
          <MemoryCard
            address={trimmedRecipient}
            compact
            onEdit={() => {
              setSelectedAddress(trimmedRecipient)
              setCurrentView('address-detail')
            }}
            onSave={() => {
              addAddressMemory(trimmedRecipient, { label: 'New Contact' })
              setSelectedAddress(trimmedRecipient)
              setCurrentView('address-detail')
            }}
          />
        )}

        <Input
          ref={amountRef}
          label={t('send.amount')}
          placeholder="0.00"
          type="number"
          step="0.000001"
          min="0"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            setError('')
            setTxHash('')
            setTxStatus('idle')
            setLastTransfer(null)
          }}
        />

        {error && (
          <p className="text-xs text-arc-danger leading-relaxed">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-arc-text-dim">
          <span>{t('send.availableBalance')}</span>
          <span className="text-arc-gold">{balance} USDC</span>
        </div>

        <div className="p-3 rounded-xl bg-arc-card border border-arc-border text-xs text-arc-text-dim space-y-1">
          <div className="flex justify-between">
            <span>{t('send.networkFee')}</span>
            <span className="text-arc-text">0.001 USDC</span>
          </div>
          <div className="flex justify-between">
            <span>{t('send.estimatedTime')}</span>
            <span className="text-arc-text">~3s</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-6">
        <Button
          variant="primary"
          fullWidth
          size="lg"
          onClick={handleSend}
          disabled={isSendDisabled}
          style={isLoading ? { opacity: 0.5 } : undefined}
        >
          {isLoading && <Loader2 size={16} className="animate-spin" />}
          {isLoading ? t('send.sending') : t('send.confirmSend')}
        </Button>
      </div>
    </div>
  )
}
