import { useState, useMemo } from 'react'
import { ArrowLeft, Search, Plus, User, Briefcase, AlertTriangle, ShieldCheck, HelpCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { useStore, type AddressMemory } from '@/lib/store'
import { formatAddress } from '@/lib/utils'
import { MemoryCard } from '@/components/MemoryCard'

interface AddressBookProps {
  onBack: () => void
}

const TAG_OPTIONS = [
  { value: 'friend', label: 'Friend', icon: User, color: 'text-green-500' },
  { value: 'work', label: 'Work', icon: Briefcase, color: 'text-blue-500' },
  { value: 'warning', label: 'Warning', icon: AlertTriangle, color: 'text-red-500' },
  { value: 'self', label: 'Self', icon: ShieldCheck, color: 'text-arc-gold' },
  { value: 'other', label: 'Other', icon: HelpCircle, color: 'text-gray-400' },
] as const

export function AddressBook({ onBack }: AddressBookProps) {
  const addressMemories = useStore((s) => s.addressMemories)
  const addAddressMemory = useStore((s) => s.addAddressMemory)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)

  const [search, setSearch] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  
  // New address form state
  const [newAddress, setNewAddress] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newTag, setNewTag] = useState<AddressMemory['tag']>('friend')
  const [newNote, setNewNote] = useState('')
  const [addError, setAddError] = useState('')

  const memories = useMemo(() => Object.values(addressMemories), [addressMemories])
  
  const filteredMemories = useMemo(() => {
    const q = search.toLowerCase()
    return memories.filter(m => 
      m.label?.toLowerCase().includes(q) || 
      m.address.toLowerCase().includes(q) ||
      m.note?.toLowerCase().includes(q)
    ).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  }, [memories, search])

  const handleAdd = () => {
    setAddError('')
    if (!newAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setAddError('Invalid address')
      return
    }
    if (addressMemories[newAddress.toLowerCase()]) {
      setAddError('Address already in book')
      return
    }

    addAddressMemory(newAddress, {
      label: newLabel || undefined,
      tag: newTag,
      note: newNote || undefined,
    })

    // Reset and close
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
          <h2 className="text-base font-semibold text-arc-text">Address Book</h2>
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
            placeholder="Search label or address..."
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
            <p className="text-sm font-medium text-arc-text">No addresses found</p>
            <p className="text-xs text-arc-text-dim mt-1">
              {search ? 'Try a different search term' : 'Add your first contact to get started'}
            </p>
            {!search && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setIsAddModalOpen(true)}
              >
                <Plus size={14} />
                Add Address
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
              <h3 className="text-lg font-bold text-arc-text">New Address</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-arc-text-dim hover:text-arc-text">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <Input
                label="Address"
                placeholder="0x..."
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                error={addError}
              />
              <Input
                label="Label (Optional)"
                placeholder="e.g. Osman Abi"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider font-bold text-arc-text-dim ml-1">
                  Tag
                </label>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map((opt) => {
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
                  Note (Optional)
                </label>
                <textarea
                  className="w-full bg-arc-bg border border-arc-border rounded-xl p-3 text-sm text-arc-text placeholder:text-arc-text-dim focus:outline-none focus:border-arc-gold/50 transition-colors min-h-[80px] resize-none"
                  placeholder="Notes about this address..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
              </div>
            </div>

            <Button variant="primary" fullWidth onClick={handleAdd}>
              Save to Address Book
            </Button>
          </Card>
        </div>
      )}
    </div>
  )
}
