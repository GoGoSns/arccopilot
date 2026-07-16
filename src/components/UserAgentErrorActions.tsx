import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PairingApiError, provisionAgent, updatePolicy } from '@/lib/pairing'
import { copyToClipboard } from '@/lib/utils'
import { formatText, t } from '@/lib/i18n'

interface UserAgentErrorActionsProps {
  error: PairingApiError | null
  onResolved?: () => void
}

export function UserAgentErrorActions({ error, onResolved }: UserAgentErrorActionsProps) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState('')

  if (!error?.action) return null

  const runAction = async () => {
    setBusy(true)
    setActionError('')
    try {
      if (error.action === 'finish-setup') {
        await provisionAgent()
      } else if (error.action === 'enable-autonomous') {
        await updatePolicy({ autonomousEnabled: true })
      }
      onResolved?.()
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : t('state.error'))
    } finally {
      setBusy(false)
    }
  }

  if (error.action === 'fund-agent') {
    if (!error.agentAddress) return null
    return (
      <div className="space-y-2 rounded-xl border border-arc-danger/30 bg-arc-danger/10 p-3">
        <p className="break-all text-xs text-arc-text">
          {formatText('settings.userAgentFundWallet', { address: error.agentAddress })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyToClipboard(error.agentAddress ?? '').then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void runAction()} disabled={busy}>
        {busy
          ? t('common.loading')
          : error.action === 'finish-setup'
            ? t('settings.pairingFinishSetup')
            : t('settings.userAgentTurnOnAction')}
      </Button>
      {actionError && <p className="text-xs text-arc-danger">{actionError}</p>}
    </div>
  )
}
