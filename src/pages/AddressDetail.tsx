import { useState, useEffect } from 'react'
import { ArrowLeft, Edit2, Eye, Trash2, Copy, ExternalLink, Send, Clock, ArrowUpRight, ArrowDownLeft, User, Briefcase, AlertTriangle, ShieldCheck, HelpCircle, Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore, type AddressMemory } from '@/lib/store'
import { formatAddress, formatBalance, openSafeUrl, timeAgo, copyToClipboard } from '@/lib/utils'
import { useAddressInsights } from '@/lib/hooks/useAddressInsights'
import { EXPLORER_URL } from '@/lib/arc'
import { t } from '@/lib/i18n'

interface AddressDetailProps {
  onBack: () => void
}

const TAG_OPTIONS = [
  { value: 'friend', label: t('tag.friend'), icon: User, color: 'text-green-500' },
  { value: 'work', label: t('tag.work'), icon: Briefcase, color: 'text-blue-500' },
  { value: 'warning', label: t('tag.warning'), icon: AlertTriangle, color: 'text-red-500' },
  { value: 'self', label: t('tag.self'), icon: ShieldCheck, color: 'text-arc-gold' },
  { value: 'whale', label: t('tag.whale'), icon: Eye, color: 'text-arc-gold' },
  { value: 'other', label: t('tag.other'), icon: HelpCircle, color: 'text-gray-400' },
] as const

export function AddressDetail({ onBack }: AddressDetailProps) {
  const selectedAddress = useStore((s) => s.selectedAddress)
  const getAddressMemory = useStore((s) => s.getAddressMemory)
  const updateAddressMemory = useStore((s) => s.updateAddressMemory)
  const removeAddressMemory = useStore((s) => s.removeAddressMemory)
  const setCurrentView = useStore((s) => s.setCurrentView)

  const memory = selectedAddress ? getAddressMemory(selectedAddress) : null
  const { totalTx, totalVolume, firstTx, lastTx, direction, dataComplete, isLoading } = useAddressInsights(selectedAddress)

  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(memory?.label || '')
  const [editTag, setEditTag] = useState<AddressMemory['tag']>(memory?.tag || 'friend')
  const [editNote, setEditNote] = useState(memory?.note || '')
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const isWhale = memory?.tag === 'whale'

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const handleToggleWhale = () => {
    if (!selectedAddress) return
    if (isWhale) {
      updateAddressMemory(selectedAddress, { tag: 'other' })
      showToast(t('addressDetail.untracked'))
    } else {
      updateAddressMemory(selectedAddress, { tag: 'whale' })
      showToast(t('addressDetail.nowTrackingAsWhale'))
    }
  }

  useEffect(() => {
    if (memory) {
      setEditLabel(memory.label || '')
      setEditTag(memory.tag || 'friend')
      setEditNote(memory.note || '')
    }
  }, [memory])

  if (!selectedAddress) {
    return (
      <div className="flex flex-col h-full bg-arc-bg items-center justify-center p-6 text-center">
        <p className="text-arc-text-dim mb-4">{t('addressDetail.noAddressSelected')}</p>
        <Button onClick={onBack}>{t('addressDetail.goBack')}</Button>
      </div>
    )
  }

  const handleCopy = () => {
    void copyToClipboard(selectedAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = () => {
    updateAddressMemory(selectedAddress, {
      label: editLabel || undefined,
      tag: editTag,
      note: editNote || undefined,
    })
    setIsEditing(false)
  }

  const handleDelete = () => {
    if (confirm(t('addressDetail.areYouSureRemove'))) {
      removeAddressMemory(selectedAddress)
      onBack()
    }
  }

  const handleSend = () => {
    setCurrentView('send')
  }

  const TagIcon = memory?.tag ? TAG_OPTIONS.find((o) => o.value === memory.tag)?.icon || HelpCircle : HelpCircle
  const tagColor = memory?.tag ? TAG_OPTIONS.find((o) => o.value === memory.tag)?.color || '' : ''

  return (
    <div className="flex flex-col h-full bg-arc-bg overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-arc-border sticky top-0 bg-arc-bg/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-base font-semibold text-arc-text">{t('addressDetail.title')}</h2>
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleToggleWhale}
            title={isWhale ? t('addressDetail.untrackWhale') : t('addressDetail.trackAsWhale')}
            className={`p-1.5 rounded-lg transition-colors ${isWhale ? 'text-arc-gold bg-arc-gold/15' : 'text-arc-text-dim hover:text-arc-gold'}`}
          >
            <Eye size={18} />
          </button>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`p-1.5 rounded-lg transition-colors ${isEditing ? 'text-arc-gold bg-arc-gold/10' : 'text-arc-text-dim hover:text-arc-text'}`}
          >
            <Edit2 size={18} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-danger transition-colors"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-arc-border bg-arc-card px-4 py-2 text-xs font-medium text-arc-text shadow-xl">
          {toast}
        </div>
      )}

      <div className="p-4 space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className={`flex h-20 w-20 items-center justify-center rounded-3xl bg-arc-card border-2 border-arc-border shadow-xl ${tagColor}`}>
            <TagIcon size={40} />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-arc-text">
              {memory?.label || t('addressDetail.untitled')}
            </h1>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-arc-card border border-arc-border text-xs font-mono text-arc-text-dim hover:text-arc-text transition-colors mx-auto"
            >
              {formatAddress(selectedAddress, 6)}
              {copied ? <span className="text-arc-success text-[10px] font-sans font-bold uppercase">{t('addressDetail.copied')}</span> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {isEditing ? (
          <Card className="p-4 space-y-4 border-arc-gold/30">
            <Input
              label={t('addressDetail.label')}
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="e.g. Osman Abi"
            />

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">
                {t('common.tag')}
              </label>
              <div className="flex flex-wrap gap-2">
                {TAG_OPTIONS.map((opt) => {
                  const Icon = opt.icon
                  const isSelected = editTag === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setEditTag(opt.value as AddressMemory['tag'])}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        isSelected
                          ? `${opt.color} border-current bg-current/10`
                          : 'border-arc-border text-arc-text-dim hover:border-arc-text-dim'
                      }`}
                    >
                      <Icon size={12} />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">
                {t('addressDetail.note')}
              </label>
              <textarea
                className="w-full bg-arc-bg border border-arc-border rounded-xl p-3 text-sm text-arc-text placeholder:text-arc-text-dim focus:outline-none focus:border-arc-gold/50 transition-colors min-h-[100px] resize-none"
                placeholder={t('addressDetail.addSomeNotes')}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </div>

            <Button variant="primary" fullWidth onClick={handleSave}>
              <Save size={16} />
              {t('addressDetail.saveChanges')}
            </Button>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="primary" onClick={handleSend} className="h-12 shadow-lg shadow-arc-gold/10">
                <Send size={18} />
                {t('addressDetail.send')}
              </Button>
              <Button variant="outline" onClick={() => openSafeUrl(`${EXPLORER_URL}/address/${selectedAddress}`)} className="h-12">
                <ExternalLink size={18} />
                {t('addressDetail.explorer')}
              </Button>
            </div>

            {memory?.note && (
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">{t('addressDetail.note')}</h3>
                <Card className="p-3 bg-arc-card/50 border-arc-border/50">
                  <p className="text-sm text-arc-text italic leading-relaxed whitespace-pre-wrap">
                    &quot;{memory.note}&quot;
                  </p>
                </Card>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">{t('addressDetail.insights')}</h3>
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3 flex flex-col items-center justify-center text-center space-y-1">
                  <Clock className="text-arc-gold mb-1" size={20} />
                  <p className="text-[10px] uppercase text-arc-text-dim">{t('addressDetail.transactions')}</p>
                  <p className="text-lg font-bold text-arc-text">
                    {isLoading ? t('common.loadingDots') : dataComplete ? totalTx ?? 0 : '—'}
                  </p>
                </Card>
                <Card className="p-3 flex flex-col items-center justify-center text-center space-y-1">
                  <div className="h-5 w-5 rounded-full bg-arc-success/20 flex items-center justify-center mb-1">
                    <div className="h-2 w-2 rounded-full bg-arc-success" />
                  </div>
                  <p className="text-[10px] uppercase text-arc-text-dim">{t('addressDetail.volume')}</p>
                  <p className="text-lg font-bold text-arc-text">
                    {isLoading ? t('common.loadingDots') : dataComplete && totalVolume != null ? `$${formatBalance(totalVolume, 6)}` : '—'}
                  </p>
                </Card>
              </div>

              <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-arc-text-dim">
                    <Clock size={14} />
                    {t('addressDetail.firstInteraction')}
                  </div>
                  <span className="text-arc-text font-medium">
                    {isLoading ? t('common.loadingDots') : dataComplete ? (firstTx ? timeAgo(firstTx) : t('addressDetail.never')) : t('common.unknown')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-arc-text-dim">
                    <Clock size={14} />
                    {t('addressDetail.lastInteraction')}
                  </div>
                  <span className="text-arc-text font-medium">
                    {isLoading ? t('common.loadingDots') : dataComplete ? (lastTx ? timeAgo(lastTx) : t('addressDetail.never')) : t('common.unknown')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-2 border-t border-arc-border/50">
                  <div className="flex items-center gap-2 text-arc-text-dim">
                    {direction === 'mostly-sent' ? <ArrowUpRight size={14} className="text-arc-danger" /> :
                     direction === 'mostly-received' ? <ArrowDownLeft size={14} className="text-arc-success" /> :
                     <HelpCircle size={14} />}
                    {t('addressDetail.flowDirection')}
                  </div>
                  <span className={`font-bold capitalize ${
                    direction === 'mostly-sent' ? 'text-arc-danger' :
                    direction === 'mostly-received' ? 'text-arc-success' :
                    'text-arc-gold'
                  }`}>
                    {isLoading ? t('common.loadingDots') : dataComplete && direction ? direction.replace('-', ' ') : t('common.unknown')}
                  </span>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
