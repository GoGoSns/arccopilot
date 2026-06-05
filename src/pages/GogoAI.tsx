import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Send, Sparkles, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { askGogo, getApiKey, setApiKey, type Message, type GogoContext, type GogoAction } from '@/lib/gogoAI'
import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'

interface GogoAIProps {
  onBack: () => void
}

export function GogoAI({ onBack }: GogoAIProps) {
  const address = useStore((s) => s.walletAddress)
  const addressMemories = useStore((s) => s.addressMemories)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)
  const updateAddressMemory = useStore((s) => s.updateAddressMemory)
  const { balance } = useUSDCBalance()

  const [apiKey, setLocalApiKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [userInput, setUserInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getApiKey().then((key) => {
      setLocalApiKey(key)
      setIsInitializing(false)
      if (key) {
        setMessages([{ role: 'model', content: "Ask me anything. Try: 'Send 5 USDC to dEaD'" }])
      }
    })
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return
    await setApiKey(keyInput.trim())
    setLocalApiKey(keyInput.trim())
    setMessages([{ role: 'model', content: "Ask me anything. Try: 'Send 5 USDC to dEaD'" }])
  }

  const handleSend = async () => {
    if (!userInput.trim() || isLoading || !address) return

    const userMsg: Message = { role: 'user', content: userInput.trim() }
    setMessages((prev) => [...prev, userMsg])
    setUserInput('')
    setIsLoading(true)
    setError(null)

    // Build context
    const context: GogoContext = {
      walletAddress: address,
      balance,
      recentTransfers: [], // Optional: could fetch if needed
      addressBook: Object.fromEntries(
        Object.entries(addressMemories).map(([addr, mem]) => [addr, { label: mem.label, tag: mem.tag }])
      ),
      whales: Object.values(addressMemories).filter(m => m.tag === 'whale').map(m => m.address),
      patterns: [] // Could pass current patterns here
    }

    try {
      const response = await askGogo(userMsg.content, context, messages)
      setMessages((prev) => [...prev, { role: 'model', content: response.reply, action: response.action }])
    } catch (err: any) {
      const errorMessage = err?.message || "Couldn't reach Gogo. Try again."
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAction = (action: GogoAction) => {
    switch (action.type) {
      case 'send':
        chrome.storage.local.set({
          [PENDING_SEND_STORAGE_KEY]: {
            recipient: action.params.recipient,
            amount: action.params.amount,
            ts: Date.now()
          }
        }, () => setCurrentView('send'))
        break
      case 'view_address':
        setSelectedAddress(action.params.address)
        setCurrentView('address-detail')
        break
      case 'track_whale':
        updateAddressMemory(action.params.address, { tag: 'whale' })
        // Could show a toast here if available
        setMessages(prev => [...prev, { role: 'model', content: `Address ${action.params.address} is now tracked as a whale.` }])
        break
    }
  }

  if (isInitializing) return null

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-arc-border px-4 py-3">
        <button onClick={onBack} className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <Sparkles size={16} className="text-arc-gold" />
          <h2 className="text-base font-semibold text-arc-text">Gogo AI</h2>
        </div>
      </div>

      {!apiKey ? (
        /* Empty State: API Key Setup */
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-arc-gold/10 flex items-center justify-center">
            <Sparkles size={32} className="text-arc-gold" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-arc-text">Hi, I'm Gogo.</h3>
            <p className="text-sm text-arc-text-dim leading-relaxed">
              Your AI copilot for Arc. To enable AI features, you need a free Gemini API key.
            </p>
          </div>
          <div className="w-full space-y-3">
            <Input
              placeholder="Enter Gemini API Key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              type="password"
            />
            <Button variant="primary" fullWidth onClick={handleSaveKey}>
              Save API Key
            </Button>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-arc-gold hover:underline"
            >
              Get a free key from Google AI Studio <ExternalLink size={10} />
            </a>
          </div>
        </div>
      ) : (
        /* Chat Interface */
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === 'user' 
                    ? 'bg-arc-gold text-arc-bg font-medium' 
                    : 'bg-arc-card border border-arc-border text-arc-text'
                }`}>
                  {m.content}
                </div>
                {m.action && m.action.type !== 'none' && (
                  <div className="mt-2 flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 text-[11px] bg-arc-gold/5 border-arc-gold/20 text-arc-gold hover:bg-arc-gold/10"
                      onClick={() => handleAction(m.action!)}
                    >
                      {m.action.type === 'send' && 'Open Send'}
                      {m.action.type === 'view_address' && 'View Address'}
                      {m.action.type === 'track_whale' && 'Track as Whale'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-start">
                <div className="bg-arc-card border border-arc-border rounded-2xl px-4 py-2.5">
                  <Loader2 size={16} className="animate-spin text-arc-gold" />
                </div>
              </div>
            )}
            {error && (
              <div className="flex justify-center">
                <p className="text-xs text-arc-danger bg-arc-danger/10 border border-arc-danger/20 rounded-lg px-3 py-1.5">
                  {error}
                </p>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-arc-border bg-arc-bg">
            <div className="relative">
              <input
                type="text"
                placeholder="Ask Gogo anything..."
                className="w-full bg-arc-card border border-arc-border rounded-xl pl-4 pr-12 py-3 text-sm text-arc-text placeholder:text-arc-text-dim focus:outline-none focus:border-arc-gold/50 transition-colors"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !userInput.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-arc-gold text-arc-bg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
