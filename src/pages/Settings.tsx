import { useEffect, useState } from 'react'
import { ArrowLeft, Book, ChevronRight, Key, Trash2, Twitter } from 'lucide-react'
import { useStore } from '@/lib/store'
import { getApiKey, clearApiKey, setApiKey as saveGeminiKey } from '@/lib/gogoAI'
import { clearTwitterApiKey, getTwitterApiKey, setTwitterApiKey } from '@/lib/twitterApi'

interface SettingsProps {
  onBack: () => void
}

export function Settings({ onBack }: SettingsProps) {
  const setCurrentView = useStore((s) => s.setCurrentView)
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null)
  const [twitterApiKey, setTwitterApiKeyState] = useState<string | null>(null)
  const [isAddingGemini, setIsAddingGemini] = useState(false)
  const [isAddingTwitter, setIsAddingTwitter] = useState(false)
  const [tempKey, setTempKey] = useState('')
  const [twitterTempKey, setTwitterTempKey] = useState('')

  useEffect(() => {
    Promise.all([getApiKey(), getTwitterApiKey()]).then(([geminiKey, twitterKey]) => {
      setGeminiApiKey(geminiKey)
      setTwitterApiKeyState(twitterKey)
    })
  }, [])

  const handleClearGeminiKey = async () => {
    await clearApiKey()
    setGeminiApiKey(null)
    setIsAddingGemini(false)
    setTempKey('')
  }

  const handleSaveGemini = async () => {
    if (!tempKey.trim()) return
    await saveGeminiKey(tempKey.trim())
    setGeminiApiKey(tempKey.trim())
    setIsAddingGemini(false)
    setTempKey('')
  }

  const handleClearTwitterKey = async () => {
    await clearTwitterApiKey()
    setTwitterApiKeyState(null)
    setIsAddingTwitter(false)
    setTwitterTempKey('')
  }

  const handleSaveTwitterKey = async () => {
    if (!twitterTempKey.trim()) return
    await setTwitterApiKey(twitterTempKey.trim())
    setTwitterApiKeyState(twitterTempKey.trim())
    setIsAddingTwitter(false)
    setTwitterTempKey('')
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors cursor-pointer group"
          onClick={() => setCurrentView('address-book')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-arc-gold/10 text-arc-gold group-hover:bg-arc-gold/20 transition-colors">
              <Book size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-arc-text">Address Book</p>
              <p className="text-[10px] text-arc-text-dim">Manage saved addresses and insights</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-arc-text-dim group-hover:text-arc-gold transition-colors" />
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
          AI Features
        </p>
        <div className="border-b border-arc-border/50">
          <div
            className="px-4 py-3 hover:bg-arc-card/30 transition-colors cursor-pointer group"
            onClick={() => geminiApiKey ? setCurrentView('gogo-ai') : setIsAddingGemini(!isAddingGemini)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-arc-gold/10 text-arc-gold group-hover:bg-arc-gold/20 transition-colors">
                  <Key size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-arc-text">Gemini API Key</p>
                  <p className={`text-[10px] ${geminiApiKey ? 'text-arc-success' : 'text-arc-text-dim'}`}>
                    {geminiApiKey ? 'Saved' : 'Not set'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {geminiApiKey && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClearGeminiKey() }}
                    className="p-2 rounded-lg text-arc-text-dim hover:text-arc-danger transition-colors"
                    title="Clear API Key"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                {!geminiApiKey && <ChevronRight size={16} className="text-arc-text-dim" />}
              </div>
            </div>
          </div>
          {isAddingGemini && !geminiApiKey && (
            <div className="px-4 pb-4 animate-in slide-in-from-top-2">
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="password"
                  placeholder="Paste Gemini API Key..."
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text focus:outline-none focus:border-arc-gold"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveGemini()}
                />
                <button
                  onClick={handleSaveGemini}
                  className="bg-arc-gold text-arc-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  Save
                </button>
              </div>
            </div>
          )}
          <div
            className="px-4 py-3 hover:bg-arc-card/30 transition-colors cursor-pointer group border-t border-arc-border/50"
            onClick={() => {
              if (!twitterApiKey) {
                setIsAddingTwitter(!isAddingTwitter)
              }
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#d4af37]/10 text-[#d4af37] group-hover:bg-[#d4af37]/20 transition-colors">
                  <Twitter size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-arc-text">TwitterAPI.io Key</p>
                  <p className={`text-[10px] ${twitterApiKey ? 'text-arc-success' : 'text-arc-text-dim'}`}>
                    {twitterApiKey ? 'Saved' : 'Not set'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {twitterApiKey ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setTwitterTempKey(twitterApiKey)
                        setIsAddingTwitter(true)
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
                    >
                      Update
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleClearTwitterKey() }}
                      className="p-2 rounded-lg text-arc-text-dim hover:text-arc-danger transition-colors"
                      title="Clear TwitterAPI.io Key"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <ChevronRight size={16} className="text-arc-text-dim" />
                )}
              </div>
            </div>
          </div>
          {isAddingTwitter && (
            <div className="px-4 pb-4 animate-in slide-in-from-top-2">
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="password"
                  placeholder="TwitterAPI.io key"
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text focus:outline-none focus:border-[#d4af37]"
                  value={twitterTempKey}
                  onChange={(e) => setTwitterTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTwitterKey()}
                />
                <button
                  onClick={handleSaveTwitterKey}
                  className="bg-[#d4af37] text-arc-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  {twitterApiKey ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>

        {[
          { section: 'Network', items: [{ label: 'Current Network', value: 'Arc Testnet' }, { label: 'RPC URL', value: 'rpc.testnet.arc.network' }] },
          { section: 'Security', items: [{ label: 'Lock Extension', value: '' }, { label: 'Export Private Key', value: '' }] },
          { section: 'Preferences', items: [{ label: 'Theme', value: 'Dark' }, { label: 'Currency', value: 'USD' }] },
          { section: 'About', items: [{ label: 'Version', value: 'v0.1.0' }, { label: 'Arc Testnet chainId', value: '5042002' }] },
        ].map(({ section, items }) => (
          <div key={section}>
            <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
              {section}
            </p>
            {items.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors cursor-pointer">
                <span className="text-sm text-arc-text">{label}</span>
                {value && <span className="text-xs text-arc-text-dim">{value}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
