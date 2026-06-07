import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, Loader2, Send, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import {
  askGogo,
  clearGogoHistory,
  getApiKey,
  loadGogoHistory,
  saveGogoHistory,
  setApiKey as saveGeminiApiKey,
  type GogoAction,
  type GogoContext,
  type Message,
} from '@/lib/gogoAI'
import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'

interface GogoAIProps {
  onBack: () => void
}

const QUICK_SUGGESTIONS = [
  "What's my balance?",
  'Summarize my last 24h',
  'Find patterns in my activity',
  'Analyze an address',
]

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

function isValidAddress(value: string): boolean {
  return ADDRESS_REGEX.test(value.trim())
}

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp))
  } catch {
    return ''
  }
}

function getActionLabel(action: GogoAction): string {
  switch (action.type) {
    case 'send':
      return 'Open Send'
    case 'view_address':
      return 'View Address'
    case 'track_whale':
      return 'Track Whale'
    case 'analyze_address':
      return 'Analyze Address'
    case 'summarize_activity':
      return 'Open Brief'
    case 'find_pattern':
      return 'Find Patterns'
    case 'open_brief':
      return 'Open Brief'
    case 'none':
    default:
      return ''
  }
}

async function persistPendingSend(recipient?: string, amount?: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return

  await new Promise<void>((resolve) => {
    chrome.storage.local.set(
      {
        [PENDING_SEND_STORAGE_KEY]: {
          recipient,
          amount,
          ts: Date.now(),
        },
      },
      () => resolve(),
    )
  })
}

export function GogoAI({ onBack }: GogoAIProps) {
  const address = useStore((s) => s.walletAddress)
  const addressMemories = useStore((s) => s.addressMemories)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)
  const addAddressMemory = useStore((s) => s.addAddressMemory)
  const updateAddressMemory = useStore((s) => s.updateAddressMemory)
  const { balance } = useUSDCBalance()

  const [apiKey, setLocalApiKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [userInput, setUserInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<Message[]>([])

  const addressEntries = useMemo(() => Object.values(addressMemories), [addressMemories])

  const addressBookContext = useMemo(
    () =>
      Object.fromEntries(
        addressEntries.map((entry) => [
          entry.address.toLowerCase(),
          {
            label: entry.label?.trim() || undefined,
            tag: entry.tag,
            lastUsedAt: entry.lastUsedAt,
          },
        ]),
      ),
    [addressEntries],
  )

  const whaleSummaries = useMemo(
    () =>
      addressEntries
        .filter((entry) => entry.tag === 'whale')
        .map((entry) => ({
          address: entry.address,
          label: entry.label?.trim() || undefined,
        })),
    [addressEntries],
  )

  const gogoContext = useMemo<GogoContext>(
    () => ({
      walletAddress: address ?? '',
      balance,
      addressBook: addressBookContext,
      whales: whaleSummaries,
    }),
    [address, balance, addressBookContext, whaleSummaries],
  )

  const hasMessages = messages.length > 0
  const hasApiKey = Boolean(apiKey)

  const resolveAddress = (value?: string): string | null => {
    const trimmed = value?.trim()
    if (!trimmed) return null
    if (isValidAddress(trimmed)) return trimmed.toLowerCase()

    const normalized = trimmed.toLowerCase()
    const exact = addressEntries.find((entry) => {
      const label = entry.label?.trim().toLowerCase()
      return entry.address.toLowerCase() === normalized || label === normalized
    })
    if (exact) return exact.address.toLowerCase()

    const partial = addressEntries.find((entry) => entry.label?.trim().toLowerCase().includes(normalized))
    return partial?.address.toLowerCase() ?? null
  }

  useEffect(() => {
    let active = true

    Promise.all([getApiKey(), loadGogoHistory()])
      .then(([storedKey, history]) => {
        if (!active) return
        setLocalApiKey(storedKey)
        setMessages(history)
        messagesRef.current = history
        setHistoryLoaded(true)
      })
      .catch((error) => {
        console.error('[GogoAI] bootstrap failed:', error)
        if (!active) return
        setMessages([])
        messagesRef.current = []
        setHistoryLoaded(true)
      })
      .finally(() => {
        if (active) setIsInitializing(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (!historyLoaded) return
    void saveGogoHistory(messages)
  }, [messages, historyLoaded])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, isLoading])

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) return

    await saveGeminiApiKey(trimmed)
    setLocalApiKey(trimmed)
    setKeyInput('')
  }

  const handleClearChat = async () => {
    if (isLoading) return

    setMessages([])
    messagesRef.current = []
    setUserInput('')
    await clearGogoHistory()
  }

  const handleQuickSuggestion = (value: string) => {
    setUserInput(value)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const handleSend = async () => {
    const trimmed = userInput.trim()
    if (!trimmed || isLoading || !address) return

    const history = messagesRef.current
    const userMessage: Message = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }

    const optimisticMessages = [...history, userMessage]
    messagesRef.current = optimisticMessages
    setMessages(optimisticMessages)
    setUserInput('')
    setIsLoading(true)
    void saveGogoHistory(optimisticMessages)

    try {
      const response = await askGogo(trimmed, gogoContext, history)
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.reply,
        action: response.action,
        timestamp: Date.now(),
      }

      const finalMessages = [...optimisticMessages, assistantMessage]
      messagesRef.current = finalMessages
      setMessages(finalMessages)
      void saveGogoHistory(finalMessages)
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Couldn't reach Gogo. Try again."
      const errorBubble: Message = {
        role: 'error',
        content: errorMessage,
        timestamp: Date.now(),
      }

      const finalMessages = [...optimisticMessages, errorBubble]
      messagesRef.current = finalMessages
      setMessages(finalMessages)
      void saveGogoHistory(finalMessages)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAction = async (messageIndex: number, action: GogoAction) => {
    if (action.completed) return

    const requiresAddress = action.type === 'view_address' || action.type === 'analyze_address' || action.type === 'track_whale'
    const resolvedAddress = requiresAddress ? resolveAddress(action.params.address) : null
    if (requiresAddress && !resolvedAddress) return

    const nextMessages = messagesRef.current.map((message, index) => {
      if (index !== messageIndex || !message.action) return message
      return {
        ...message,
        action: {
          ...message.action,
          completed: true,
        },
      }
    })

    messagesRef.current = nextMessages
    setMessages(nextMessages)
    void saveGogoHistory(nextMessages)

    switch (action.type) {
      case 'send': {
        const recipient = resolveAddress(action.params.recipient)
        const amount = action.params.amount?.trim() || undefined
        await persistPendingSend(recipient ?? undefined, amount)
        setCurrentView('send')
        break
      }
      case 'view_address':
      case 'analyze_address': {
        if (!resolvedAddress) return
        setSelectedAddress(resolvedAddress)
        setCurrentView('address-detail')
        break
      }
      case 'track_whale': {
        if (!resolvedAddress) return
        const current = addressMemories[resolvedAddress]
        if (current) {
          updateAddressMemory(resolvedAddress, { tag: 'whale' })
        } else {
          addAddressMemory(resolvedAddress, { tag: 'whale' })
        }
        setSelectedAddress(resolvedAddress)
        setCurrentView('address-detail')
        break
      }
      case 'summarize_activity':
      case 'find_pattern':
      case 'open_brief':
        setCurrentView('daily-brief')
        break
      case 'none':
      default:
        break
    }
  }

  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center bg-arc-bg">
        <div className="flex items-center gap-3 text-arc-text-dim">
          <Loader2 size={18} className="animate-spin text-arc-gold" />
          <span className="text-sm">Loading Gogo...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-arc-bg">
      <div className="flex items-center justify-between gap-3 border-b border-arc-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-arc-gold" />
            <div className="flex flex-col">
              <h2 className="text-base font-semibold text-arc-text">Gogo AI</h2>
              <p className="text-[11px] text-arc-text-dim">Context-aware assistant</p>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3"
          onClick={() => void handleClearChat()}
          disabled={isLoading || messages.length === 0}
        >
          <Trash2 size={14} />
          Clear chat
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!hasMessages && hasApiKey && (
          <div className="flex h-full items-center justify-center">
            <Card className="w-full max-w-md p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-gold/10">
                  <Sparkles size={22} className="text-arc-gold" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-arc-text">Hi, I'm Gogo.</p>
                  <p className="text-sm text-arc-text-dim">I checked your wallet context, recent activity, whales and patterns.</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {QUICK_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleQuickSuggestion(suggestion)}
                    className="rounded-full border border-arc-border bg-arc-bg/60 px-3 py-1.5 text-xs text-arc-text-dim transition-colors hover:border-arc-gold/30 hover:text-arc-text"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs text-arc-text-dim">
                Try asking about your balance, last 24h, whales, patterns or an address.
              </p>
            </Card>
          </div>
        )}

        {!hasMessages && !hasApiKey && (
          <div className="flex min-h-full items-center justify-center">
            <Card className="w-full max-w-md p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-gold/10">
                  <Sparkles size={22} className="text-arc-gold" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-arc-text">Hi, I'm Gogo.</p>
                  <p className="text-sm text-arc-text-dim">Your chat history is stored locally. Add a Gemini key to keep going.</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <Input
                  placeholder="Enter Gemini API Key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  type="password"
                />
                <Button variant="primary" fullWidth onClick={() => void handleSaveKey()}>
                  Save API Key
                </Button>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-arc-gold hover:underline"
                >
                  Get a free key from Google AI Studio
                  <ExternalLink size={10} />
                </a>
              </div>
            </Card>
          </div>
        )}

        {hasMessages && (
          <div className="space-y-4">
            {messages.map((message, index) => {
              const isUser = message.role === 'user'
              const isError = message.role === 'error'
              const action = message.action && message.action.type !== 'none' ? message.action : null

              return (
                <div key={`${message.timestamp}-${index}`} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-arc-gold text-arc-bg font-medium'
                        : isError
                          ? 'border border-arc-danger/20 bg-arc-danger/10 text-arc-danger'
                          : 'border border-arc-border bg-arc-card text-arc-text'
                    }`}
                  >
                    {message.content}
                  </div>

                  <div className={`mt-1 text-[11px] text-arc-text-dim ${isUser ? 'pr-1 text-right' : 'pl-1'}`}>
                    {formatTime(message.timestamp)}
                  </div>

                  {action && (
                    <div className={`mt-2 ${isUser ? 'flex justify-end' : 'flex justify-start'}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-8 text-[11px] ${
                          action.completed
                            ? 'border-arc-gold/30 bg-arc-gold/10 text-arc-gold hover:bg-arc-gold/10'
                            : 'border-arc-gold/20 bg-arc-gold/5 text-arc-gold hover:bg-arc-gold/10'
                        }`}
                        onClick={() => void handleAction(index, action)}
                        disabled={isLoading || action.completed}
                      >
                        {action.completed ? (
                          <>
                            <Check size={12} />
                            Done &#10003;
                          </>
                        ) : (
                          getActionLabel(action)
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}

            {isLoading && (
              <div className="flex items-start">
                <div className="max-w-[88%] rounded-2xl border border-arc-border bg-arc-card px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.2s]" />
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.1s]" />
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {hasMessages && !hasApiKey && (
          <div className="mt-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-arc-gold/10">
                  <Sparkles size={18} className="text-arc-gold" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-arc-text">Add your Gemini key to continue chatting.</p>
                  <p className="text-xs text-arc-text-dim">Your history is still here. Nothing was lost.</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <Input
                  placeholder="Enter Gemini API Key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  type="password"
                />
                <Button variant="primary" fullWidth onClick={() => void handleSaveKey()}>
                  Save API Key
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {hasApiKey && (
        <div className="border-t border-arc-border bg-arc-bg px-4 py-4">
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSend()
            }}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask Gogo anything..."
              className="w-full rounded-xl border border-arc-border bg-arc-card py-3 pl-4 pr-12 text-sm text-arc-text placeholder:text-arc-text-dim transition-colors focus:border-arc-gold/50 focus:outline-none"
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              disabled={isLoading || !address}
            />
            <button
              type="submit"
              disabled={isLoading || !userInput.trim() || !address}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-arc-gold p-2 text-arc-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {!hasApiKey && hasMessages && (
        <div className="border-t border-arc-border bg-arc-bg px-4 py-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-arc-gold/10">
                <Sparkles size={18} className="text-arc-gold" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-arc-text">Set a Gemini API key to keep chatting.</p>
                <p className="text-xs text-arc-text-dim">Your conversation is saved locally up to 50 messages.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Input
                placeholder="Enter Gemini API Key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                type="password"
              />
              <Button variant="primary" fullWidth onClick={() => void handleSaveKey()}>
                Save API Key
              </Button>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-arc-gold hover:underline"
              >
                Get a free key from Google AI Studio
                <ExternalLink size={10} />
              </a>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
