import { ArrowUpRight, ArrowDownLeft, QrCode, Plus } from 'lucide-react'
import { t } from '@/lib/i18n'

interface ActionButtonsProps {
  onSend: () => void
  onReceive: () => void
  onScan: () => void
  onBuy: () => void
}

export function ActionButtons({ onSend, onReceive, onScan, onBuy }: ActionButtonsProps) {
  const handlers = { send: onSend, receive: onReceive, scan: onScan, buy: onBuy } as const
  const actions = [
    { label: t('actions.send'), Icon: ArrowUpRight, key: 'send' },
    { label: t('actions.receive'), Icon: ArrowDownLeft, key: 'receive' },
    { label: t('actions.scan'), Icon: QrCode, key: 'scan' },
    { label: t('actions.getUsdc'), Icon: Plus, key: 'buy' },
  ] as const

  return (
    <div className="grid grid-cols-4 gap-2 px-4 py-3">
      {actions.map(({ label, Icon, key }) => (
        <button
          key={key}
          type="button"
          onClick={handlers[key]}
          className="flex flex-col items-center gap-1.5 rounded-2xl border border-arc-border bg-arc-card p-3 transition-all hover:border-arc-borderEmphasis hover:bg-arc-elevated active:scale-95"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-arc-border bg-arc-elevated text-white">
            <Icon size={18} />
          </div>
          <span className="text-[10px] text-arc-text-dim">{label}</span>
        </button>
      ))}
    </div>
  )
}
