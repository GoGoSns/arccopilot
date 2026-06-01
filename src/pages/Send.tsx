import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Search, User } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore } from '@/lib/store'
import { EXPLORER_URL, USDC_ADDRESS } from '@/lib/arc'
import { formatAddress, shortenTxHash } from '@/lib/utils'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { MemoryCard } from '@/components/MemoryCard'

interface SendProps {
  onBack: () => void
}

type SendResult =
  | { hash: string }
  | { error: string }

type ReceiptResult = {
  receipt: { status?: string } | null
  error?: string
}

type TxStatus = 'idle' | 'pending' | 'confirmed'

export function Send({ onBack }: SendProps) {
  const walletAddress = useStore((s) => s.walletAddress)
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
  
  const amountRef = useRef<HTMLInputElement>(null)
  const contractLookupTokenRef = useRef(0)
  const [showSuggestions, setShowSuggestions] = useState(false)

  const trimmedRecipient = recipient.trim()
  const isExactRecipient = /^0x[a-fA-F0-9]{40}$/.test(trimmedRecipient)
  const recipientValidationError = trimmedRecipient && !isExactRecipient ? 'Invalid recipient address.' : ''
  const recipientMemory = isExactRecipient ? addressMemories[trimmedRecipient.toLowerCase()] ?? null : null
  const isUnknownRecipient = isExactRecipient && !recipientMemory && recipientContractStatus === 'unknown'
  const isAmountValid = amount.trim().length > 0 && !Number.isNaN(Number(amount)) && Number(amount) > 0
  const showRecipientSafetyWarning = fromUniversalTip && isExactRecipient
  const isSendDisabled = isLoading || !walletAddress || !isExactRecipient || !isAmountValid || !!txHash

  const suggestions = useMemo(() => {
    const q = recipient.toLowerCase()
    if (!q || q.startsWith('0x')) return []
    return Object.values(addressMemories)
      .filter(m => m.label?.toLowerCase().includes(q))
      .slice(0, 3)
  }, [addressMemories, recipient])

  // Pre-fill recipient when opened via the Universal Tip Button
  useEffect(() => {
    chrome.storage.local.get('arccopilot:pending_send', (result) => {
      const pending = result['arccopilot:pending_send']
      if (pending?.recipient && Date.now() - pending.ts < 5_000) {
        setRecipient(pending.recipient)
        setFromUniversalTip(true)
        chrome.storage.local.remove('arccopilot:pending_send')
        // Give React a tick to render the input, then focus amount
        setTimeout(() => amountRef.current?.focus(), 50)
      } else {
        setFromUniversalTip(false)
      }
    })
  }, [])

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
    const results = await chrome.scripting.executeScript<[string], ReceiptResult>({
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
  }

  const handleSend = async () => {
    setError('')
    setTxHash('')
    setTxStatus('idle')
    setLastTransfer(null)
    clearScheduledRefresh()
    receiptPollTokenRef.current += 1

    if (!walletAddress) {
      setError('Connect your wallet first')
      return
    }

    if (!isExactRecipient) {
      setError('Invalid recipient address.')
      return
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Invalid amount')
      return
    }

    if (amountNum > parseFloat(balance)) {
      setError('Insufficient balance')
      return
    }

    setIsLoading(true)

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error('Please open a web page first')
      }

      const amountWei = BigInt(Math.round(amountNum * 1_000_000))
      const paddedRecipient = trimmedRecipient.slice(2).toLowerCase().padStart(64, '0')
      const paddedAmount = amountWei.toString(16).padStart(64, '0')
      const txData = '0xa9059cbb' + paddedRecipient + paddedAmount

      const results = await chrome.scripting.executeScript<[string, string, string], SendResult>({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [walletAddress, txData, USDC_ADDRESS],
        func: async (from: string, data: string, to: string): Promise<SendResult> => {
          try {
            const ethereum = (window as any).ethereum
            if (!ethereum) return { error: 'MetaMask is not installed or not active on this page.' }

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
            return { error: err?.message ?? 'Failed to send transaction' }
          }
        },
      })

      const result = results[0]?.result
      if (!result) throw new Error('No response from the page.')
      if ('error' in result) throw new Error(result.error)
      if (!result.hash) throw new Error('No tx hash returned')

      setTxHash(result.hash)
      setTxStatus('pending')
      setLastTransfer({ recipient: trimmedRecipient, amount: amount.trim() })
      scheduleBalanceRefresh()

      const pollToken = receiptPollTokenRef.current
      void pollTransactionReceipt(tab.id, result.hash, pollToken)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send')
    } finally {
      setIsLoading(false)
    }
  }

  const explorerUrl = txHash ? `${EXPLORER_URL}/tx/${txHash}` : ''
  const currentAmount = lastTransfer?.amount ?? amount.trim()
  const currentRecipient = lastTransfer?.recipient ?? recipient.trim()

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Send USDC</h2>
      </div>

      <div className="flex-1 px-4 py-6 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <div className="relative">
            <Input
              label="Recipient address"
              placeholder="0x... or label"
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
                Valid address
              </span>
            )}
            {isUnknownRecipient && (
              <span className="rounded-full border border-arc-gold/20 bg-arc-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-arc-gold">
                Unknown recipient
              </span>
            )}
            {recipientContractStatus === 'contract' && (
              <span className="rounded-full border border-arc-border bg-arc-card/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-arc-text">
                Contract address
              </span>
            )}
          </div>

          {showRecipientSafetyWarning && (
            <p className="text-[11px] leading-relaxed text-arc-gold">
              Verify this recipient before sending.
            </p>
          )}
        </div>

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
          label="Amount (USDC)"
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
          <span>Available balance</span>
          <span className="text-arc-gold">{balance} USDC</span>
        </div>

        {txHash && lastTransfer && (
          <Card className="p-3 border-arc-success/30 bg-arc-success/10 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <CheckCircle2 className="mt-0.5 text-arc-success" size={18} />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-arc-success">
                    Sent {currentAmount} USDC to {formatAddress(currentRecipient)}
                  </p>
                  <p className="text-xs text-arc-text-dim break-all">
                    TX hash: {shortenTxHash(txHash)}
                  </p>
                </div>
              </div>

              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  txStatus === 'confirmed'
                    ? 'bg-arc-success/15 text-arc-success'
                    : 'bg-arc-gold/15 text-arc-gold'
                }`}
              >
                {txStatus === 'confirmed' ? 'Confirmed' : 'Pending'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                size="sm"
                fullWidth
                onClick={() => window.open(explorerUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink size={14} />
                View on ArcScan
              </Button>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                onClick={resetSendForm}
              >
                Send another
              </Button>
            </div>
          </Card>
        )}

        <div className="p-3 rounded-xl bg-arc-card border border-arc-border text-xs text-arc-text-dim space-y-1">
          <div className="flex justify-between">
            <span>Network fee</span>
            <span className="text-arc-text">0.001 USDC</span>
          </div>
          <div className="flex justify-between">
            <span>Estimated time</span>
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
          {isLoading ? 'Sending...' : 'Confirm Send'}
        </Button>
      </div>
    </div>
  )
}
