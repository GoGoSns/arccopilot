import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, Copy, Share } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { copyToClipboard } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { formatText, t } from '@/lib/i18n'

interface ReceiveProps {
  onBack: () => void
}

const QR_OPTIONS = {
  margin: 2,
  width: 220,
  errorCorrectionLevel: 'M' as const,
  color: {
    dark: '#0a0a0a',
    light: '#ffffff',
  },
}

export function Receive({ onBack }: ReceiveProps) {
  const address = useStore((s) => s.walletAddress)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [notice, setNotice] = useState('')
  const noticeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let isMounted = true

    if (!address) {
      setQrDataUrl('')
      return () => {
        isMounted = false
      }
    }

    setQrDataUrl('')

    void QRCode.toDataURL(address, QR_OPTIONS)
      .then((dataUrl) => {
        if (isMounted) setQrDataUrl(dataUrl)
      })
      .catch((err) => {
        console.error('[Receive] QR generation failed:', err)
      })

    return () => {
      isMounted = false
    }
  }, [address])

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current)
      }
    }
  }, [])

  const flashNotice = (message: string) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current)
    }

    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice('')
      noticeTimerRef.current = null
    }, 2000)
  }

  const handleCopy = async () => {
    if (!address) return

    try {
      await copyToClipboard(address)
      flashNotice(t('receive.copied'))
    } catch (err) {
      console.error('[Receive] copy failed:', err)
      flashNotice(t('receive.copyFailed'))
    }
  }

  const handleShare = async () => {
    if (!address) return

    try {
      if (navigator.share) {
        await navigator.share({
          title: t('receive.shareTitle'),
          text: formatText('receive.shareText', { address }),
        })
        flashNotice(t('receive.shared'))
        return
      }

      await copyToClipboard(address)
      flashNotice(t('receive.copied'))
    } catch (err: any) {
      if (err?.name === 'AbortError') return

      try {
        await copyToClipboard(address)
        flashNotice(t('receive.copied'))
      } catch (copyErr) {
        console.error('[Receive] share fallback failed:', copyErr)
        flashNotice(t('receive.shareUnavailable'))
      }
    }
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">{t('receive.receiveUsdc')}</h2>
      </div>

      <div className="relative flex-1 overflow-y-auto px-4 py-6">
        {notice && (
          <div className="absolute right-4 top-4 z-10 rounded-full border border-arc-border bg-arc-card px-3 py-1.5 text-xs font-medium text-arc-text shadow-lg">
            {notice}
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          <div className="rounded-3xl border border-arc-border bg-arc-card p-4 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={t('receive.qrAlt')}
                className="h-[220px] w-[220px]"
                width={220}
                height={220}
              />
            ) : (
              <div className="flex h-[220px] w-[220px] items-center justify-center rounded-2xl bg-white">
                <div className="h-8 w-8 animate-pulse rounded-full bg-slate-300" />
              </div>
            )}
          </div>

          <Card className="w-full p-4 space-y-4">
            <div className="space-y-1 text-center">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-arc-text-dim">
                {t('receive.walletAddress')}
              </p>
              <p className="break-all font-mono text-[11px] leading-5 text-arc-text select-all">
                {address ?? t('receive.noWalletAddress')}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                fullWidth
                size="md"
                onClick={handleCopy}
                disabled={!address}
              >
                <Copy size={14} />
                {t('receive.copyAddress')}
              </Button>
              <Button
                variant="ghost"
                fullWidth
                size="md"
                onClick={handleShare}
                disabled={!address}
              >
                <Share size={14} />
                {t('receive.share')}
              </Button>
            </div>
          </Card>

          <div className="rounded-2xl border border-arc-border bg-arc-card p-4">
            <p className="text-xs leading-relaxed text-arc-text-dim">
              {t('receive.onlySendWarning')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
