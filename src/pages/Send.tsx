import { useState } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore } from '@/lib/store'
import { EXPLORER_URL, USDC_ADDRESS } from '@/lib/arc'
import { shortenTxHash } from '@/lib/utils'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'

interface SendProps {
  onBack: () => void
}

type SendResult =
  | { hash: string }
  | { error: string }

export function Send({ onBack }: SendProps) {
  const walletAddress = useStore((s) => s.walletAddress)
  const { balance } = useUSDCBalance()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')

  const handleSend = async () => {
    setError('')
    setTxHash('')

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
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send')
    } finally {
      setIsLoading(false)
    }
  }

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

        {txHash && (
          <Card className="p-3 border-arc-success/30 bg-arc-success/10">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 text-arc-success" size={18} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-arc-success">Sent!</p>
                <a
                  href={`${EXPLORER_URL}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-arc-text-dim hover:text-arc-gold transition-colors break-all"
                >
                  <span>{shortenTxHash(txHash)}</span>
                  <ExternalLink size={12} />
                </a>
              </div>
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
          disabled={isLoading || !recipient || !amount}
          style={isLoading ? { opacity: 0.5 } : undefined}
        >
          {isLoading && <Loader2 size={16} className="animate-spin" />}
          {isLoading ? 'Sending...' : 'Confirm Send'}
        </Button>
      </div>
    </div>
  )
}
