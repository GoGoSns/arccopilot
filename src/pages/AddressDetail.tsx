import { useState, useEffect } from 'react'
import { ArrowLeft, Edit2, Trash2, Copy, ExternalLink, Send, Clock, ArrowUpRight, ArrowDownLeft, User, Briefcase, AlertTriangle, ShieldCheck, HelpCircle, Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore, type AddressMemory } from '@/lib/store'
import { formatAddress, formatBalance, timeAgo, copyToClipboard } from '@/lib/utils'
import { useAddressInsights } from '@/lib/hooks/useAddressInsights'
import { EXPLORER_URL } from '@/lib/arc'

interface AddressDetailProps {
  onBack: () => void
}

const TAG_OPTIONS = [
  { value: 'friend', label: 'Friend', icon: User, color: 'text-green-500' },
  { value: 'work', label: 'Work', icon: Briefcase, color: 'text-blue-500' },
  { value: 'warning', label: 'Warning', icon: AlertTriangle, color: 'text-red-500' },
  { value: 'self', label: 'Self', icon: ShieldCheck, color: 'text-arc-gold' },
  { value: 'other', label: 'Other', icon: HelpCircle, color: 'text-gray-400' },
] as const

export function AddressDetail({ onBack }: AddressDetailProps) {
  const selectedAddress = useStore((s) => s.selectedAddress)
  const getAddressMemory = useStore((s) => s.getAddressMemory)
  const updateAddressMemory = useStore((s) => s.updateAddressMemory)
  const removeAddressMemory = useStore((s) => s.removeAddressMemory)
  const setCurrentView = useStore((s) => s.setCurrentView)

  const memory = selectedAddress ? getAddressMemory(selectedAddress) : null
  const { totalTx, totalVolume, firstTx, lastTx, direction, isLoading } = useAddressInsights(selectedAddress)

  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(memory?.label || '')
  const [editTag, setEditTag] = useState<AddressMemory['tag']>(memory?.tag || 'friend')
  const [editNote, setEditNote] = useState(memory?.note || '')
  const [copied, setCopied] = useState(false)

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
        <p className="text-arc-text-dim mb-4">No address selected</p>
        <Button onClick={onBack}>Go Back</Button>
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
    if (confirm('Are you sure you want to remove this address?')) {
      removeAddressMemory(selectedAddress)
      onBack()
    }
  }

  const handleSend = () => {
    // This requires Send page to accept a recipient prop or use store
    // For now, let's just go to Send. In a real app we'd set the recipient in store.
    setCurrentView('send')
  }

  const TagIcon = memory?.tag ? TAG_OPTIONS.find(o => o.value === memory.tag)?.icon || HelpCircle : HelpCircle
  const tagColor = memory?.tag ? TAG_OPTIONS.find(o => o.value === memory.tag)?.color || '' : ''

  return (
    <div className="flex flex-col h-full bg-arc-bg overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-arc-border sticky top-0 bg-arc-bg/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-base font-semibold text-arc-text">Address Detail</h2>
        </div>
        <div className="flex gap-1">
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

      <div className="p-4 space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className={`flex h-20 w-20 items-center justify-center rounded-3xl bg-arc-card border-2 border-arc-border shadow-xl ${tagColor}`}>
            <TagIcon size={40} />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-arc-text">
              {memory?.label || 'Untitled'}
            </h1>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-arc-card border border-arc-border text-xs font-mono text-arc-text-dim hover:text-arc-text transition-colors mx-auto"
            >
              {formatAddress(selectedAddress, 6)}
              {copied ? <span className="text-arc-success text-[10px] font-sans font-bold uppercase">Copied</span> : <Copy size={12} />}
            </button>
          </div>
        </div>

        {isEditing ? (
          <Card className="p-4 space-y-4 border-arc-gold/30">
            <Input
              label="Label"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="e.g. Osman Abi"
            />
            
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">
                Tag
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
                Note
              </label>
              <textarea
                className="w-full bg-arc-bg border border-arc-border rounded-xl p-3 text-sm text-arc-text placeholder:text-arc-text-dim focus:outline-none focus:border-arc-gold/50 transition-colors min-h-[100px] resize-none"
                placeholder="Add some notes..."
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </div>

            <Button variant="primary" fullWidth onClick={handleSave}>
              <Save size={16} />
              Save Changes
            </Button>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="primary" onClick={handleSend} className="h-12 shadow-lg shadow-arc-gold/10">
                <Send size={18} />
                Send
              </Button>
              <Button variant="outline" onClick={() => window.open(`${EXPLORER_URL}/address/${selectedAddress}`, '_blank')} className="h-12">
                <ExternalLink size={18} />
                Explorer
              </Button>
            </div>

            {memory?.note && (
              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">Note</h3>
                <Card className="p-3 bg-arc-card/50 border-arc-border/50">
                  <p className="text-sm text-arc-text italic leading-relaxed whitespace-pre-wrap">
                    &quot;{memory.note}&quot;
                  </p>
                </Card>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">Insights</h3>
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3 flex flex-col items-center justify-center text-center space-y-1">
                  <Clock className="text-arc-gold mb-1" size={20} />
                  <p className="text-[10px] uppercase text-arc-text-dim">Transactions</p>
                  <p className="text-lg font-bold text-arc-text">{isLoading ? '...' : totalTx}</p>
                </Card>
                <Card className="p-3 flex flex-col items-center justify-center text-center space-y-1">
                  <div className="h-5 w-5 rounded-full bg-arc-success/20 flex items-center justify-center mb-1">
                    <div className="h-2 w-2 rounded-full bg-arc-success" />
                  </div>
                  <p className="text-[10px] uppercase text-arc-text-dim">Volume</p>
                  <p className="text-lg font-bold text-arc-text">
                    {isLoading ? '...' : `$${formatBalance(totalVolume, 6)}`}
                  </p>
                </Card>
              </div>

              <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-arc-text-dim">
                    <Clock size={14} />
                    First interaction
                  </div>
                  <span className="text-arc-text font-medium">
                    {isLoading ? '...' : firstTx ? timeAgo(firstTx) : 'Never'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-arc-text-dim">
                    <Clock size={14} />
                    Last interaction
                  </div>
                  <span className="text-arc-text font-medium">
                    {isLoading ? '...' : lastTx ? timeAgo(lastTx) : 'Never'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-2 border-t border-arc-border/50">
                  <div className="flex items-center gap-2 text-arc-text-dim">
                    {direction === 'mostly-sent' ? <ArrowUpRight size={14} className="text-arc-danger" /> : 
                     direction === 'mostly-received' ? <ArrowDownLeft size={14} className="text-arc-success" /> :
                     <HelpCircle size={14} />}
                    Flow Direction
                  </div>
                  <span className={`font-bold capitalize ${
                    direction === 'mostly-sent' ? 'text-arc-danger' : 
                    direction === 'mostly-received' ? 'text-arc-success' : 
                    'text-arc-gold'
                  }`}>
                    {isLoading ? '...' : direction.replace('-', ' ')}
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
