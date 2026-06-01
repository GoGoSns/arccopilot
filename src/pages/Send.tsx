import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore } from '@/lib/store'
import { EXPLORER_URL, USDC_ADDRESS } from '@/lib/arc'
import { formatAddress, shortenTxHash } from '@/lib/utils'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'

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
  const { balance, refresh } = useUSDCBalance()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [lastTransfer, setLastTransfer] = useState<{ recipient: string; amount: string } | null>(null)

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

    const trimmedRecipient = recipient.trim()

    if (!walletAddress) {
      setError('Connect your wallet first')
      return
    }

    if (!trimmedRecipient.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Invalid recipient address')
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

      const amountWei = BigInt(Math.floor(amountNum * 1e6))
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
  const isSendDisabled = isLoading || !recipient || !amount || !!txHash

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Send USDC</h2>
      </div>

      <div className="flex-1 px-4 py-6 space-y-4 overflow-y-auto">
        <Input
          label="Recipient address"
          placeholder="0x..."
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value)
            setError('')
            setTxHash('')
            setTxStatus('idle')
            setLastTransfer(null)
          }}
        />
        <Input
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
