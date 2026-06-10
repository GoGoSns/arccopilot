import { useMemo, useState } from 'react'
import { ArrowLeft, Eye, Search, Plus, User, Briefcase, AlertTriangle, ShieldCheck, HelpCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore, type AddressMemory } from '@/lib/store'
import { MemoryCard } from '@/components/MemoryCard'
import { t } from '@/lib/i18n'
import { isValidAddress } from '@/lib/validation'

interface AddressBookProps {
  onBack: () => void
}

export function AddressBook({ onBack }: AddressBookProps) {
  const addressMemories = useStore((s) => s.addressMemories)
  const addAddressMemory = useStore((s) => s.addAddressMemory)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)

  const [search, setSearch] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newAddress, setNewAddress] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newTag, setNewTag] = useState<AddressMemory['tag']>('friend')
  const [newNote, setNewNote] = useState('')
  const [addError, setAddError] = useState('')

  const memories = useMemo(() => Object.values(addressMemories), [addressMemories])

  const filteredMemories = useMemo(() => {
    const q = search.toLowerCase()
    return memories.filter((m) =>
      m.label?.toLowerCase().includes(q) ||
      m.address.toLowerCase().includes(q) ||
      m.note?.toLowerCase().includes(q)
    ).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  }, [memories, search])

  const tagOptions = [
    { value: 'friend', label: t('tag.friend'), icon: User, color: 'text-green-500' },
    { value: 'work', label: t('tag.work'), icon: Briefcase, color: 'text-blue-500' },
    { value: 'warning', label: t('tag.warning'), icon: AlertTriangle, color: 'text-red-500' },
    { value: 'self', label: t('tag.self'), icon: ShieldCheck, color: 'text-arc-gold' },
    { value: 'whale', label: t('tag.whale'), icon: Eye, color: 'text-arc-gold' },
    { value: 'other', label: t('tag.other'), icon: HelpCircle, color: 'text-gray-400' },
  ] as const

  const handleAdd = () => {
    setAddError('')
    const trimmedAddress = newAddress.trim()

    if (!isValidAddress(trimmedAddress)) {
      setAddError(t('addressBook.invalidAddress'))
      return
    }

    if (addressMemories[trimmedAddress.toLowerCase()]) {
      setAddError(t('addressBook.alreadyInBook'))
      return
    }

    addAddressMemory(trimmedAddress, {
      label: newLabel || undefined,
      tag: newTag,
      note: newNote || undefined,
    })

    setNewAddress('')
    setNewLabel('')
    setNewTag('friend')
    setNewNote('')
    setIsAddModalOpen(false)
  }

  const openDetail = (address: string) => {
    setSelectedAddress(address)
    setCurrentView('address-detail')
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-arc-border">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-base font-semibold text-arc-text">{t('addressBook.title')}</h2>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="p-1.5 rounded-lg text-arc-gold hover:bg-arc-gold/10 transition-colors"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-arc-text-dim" size={16} />
          <Input
            placeholder={t('addressBook.searchPlaceholder')}
            className="pl-10 h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 flex items-center justify-center rounded-2xl bg-arc-card border border-arc-border text-arc-text-dim mb-4">
              <User size={32} />
            </div>
            <p className="text-sm font-medium text-arc-text">{t('addressBook.noAddressesFound')}</p>
            <p className="text-xs text-arc-text-dim mt-1">
              {search ? t('addressBook.tryDifferentSearch') : t('addressBook.addFirstContact')}
            </p>
            {!search && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setIsAddModalOpen(true)}
              >
                <Plus size={14} />
                {t('addressBook.addAddress')}
              </Button>
            )}
          </div>
        ) : (
          filteredMemories.map((memory) => (
            <div key={memory.address} onClick={() => openDetail(memory.address)} className="cursor-pointer">
              <MemoryCard address={memory.address} compact />
            </div>
          ))
        )}
      </div>

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm p-5 space-y-4 shadow-2xl border-arc-gold/20">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-arc-text">{t('addressBook.newAddress')}</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-arc-text-dim hover:text-arc-text">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <Input
                label={t('addressBook.address')}
                placeholder="0x..."
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                error={addError}
              />
              <Input
                label={t('addressBook.labelOptional')}
                placeholder="e.g. Osman Abi"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">
                  {t('common.tag')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {tagOptions.map((opt) => {
                    const Icon = opt.icon
                    const isSelected = newTag === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setNewTag(opt.value as AddressMemory['tag'])}
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
                  {t('addressBook.noteOptional')}
                </label>
                <textarea
                  className="w-full bg-arc-bg border border-arc-border rounded-xl p-3 text-sm text-arc-text placeholder:text-arc-text-dim focus:outline-none focus:border-arc-gold/50 transition-colors min-h-[80px] resize-none"
                  placeholder={t('addressBook.notePlaceholder')}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
              </div>
            </div>

            <Button variant="primary" fullWidth onClick={handleAdd}>
              {t('addressBook.saveToBook')}
            </Button>
          </Card>
        </div>
      )}
    </div>
  )
}
