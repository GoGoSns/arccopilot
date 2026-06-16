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
          className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-arc-card border border-arc-border hover:border-arc-gold/40 hover:bg-arc-card/80 transition-all active:scale-95"
        >
          <div className="w-9 h-9 rounded-xl bg-arc-gold/10 flex items-center justify-center">
            <Icon size={18} className="text-arc-gold" />
          </div>
          <span className="text-[10px] text-arc-text-dim">{label}</span>
        </button>
      ))}
    </div>
  )
}
