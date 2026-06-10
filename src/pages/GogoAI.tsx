import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { ArrowLeft, Check, ExternalLink, Image as ImageIcon, Loader2, Mic, Send, Sparkles, Trash2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EXPLORER_URL } from '@/lib/arc'
import { formatText, getLocaleSync, t } from '@/lib/i18n'
import { formatAddress, openSafeUrl } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { useUSDCBalance } from '@/lib/hooks/useUSDCBalance'
import { usePortfolioBalances, PORTFOLIO_CACHE_TTL_MS } from '@/lib/portfolio'
import {
  askGogo,
  analyzeAddress,
  analyzeSpending,
  clearGogoHistory,
  getApiKey,
  getProactiveGreeting,
  loadGogoHistory,
  saveGogoHistory,
  sanitizeActions,
  setApiKey as saveGeminiApiKey,
  type AddressAnalysis,
  type GogoAction,
  type GogoContext,
  type GogoImageResult,
  type Message,
  type SpendingAnalysis,
} from '@/lib/gogoAI'
import { readAddressFromImage } from '@/lib/imageReader'
import type { ReadAddressFromImageResult } from '@/lib/imageReader'
import { debugWarn } from '@/lib/debug'
import {
  addReminder,
  buildReminderFromAction,
  getReminderScheduleLabel,
  type Reminder,
} from '@/lib/reminders'
import {
  PENDING_SEND_STORAGE_KEY,
  VOICE_INPUT_STORAGE_KEY,
  VOICE_RESPONSES_STORAGE_KEY,
} from '@/lib/storageKeys'
import { isValidAddress, isValidAmount } from '@/lib/validation'

interface GogoAIProps {
  onBack: () => void
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike
}

const QUICK_SUGGESTIONS = [
  'Check my balance',
  'Show last 24h activity',
  'Find whale moves',
  'Analyze this address',
] as const

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

function getSpeechRecognitionCtor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function getPreferredSpeechLanguage(): string {
  return getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US'
}

function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function getActionLabel(action?: GogoAction | null): string {
  switch (action?.type) {
    case 'send':
      return t('gogo.openSend')
    case 'view_address':
      return t('gogo.viewAddress')
    case 'track_whale':
      return t('gogo.trackWhale')
    case 'analyze_address':
      return t('gogo.analyzeAddress')
    case 'summarize_activity':
      return t('gogo.summarizeActivity')
    case 'find_pattern':
      return t('gogo.findPatterns')
    case 'open_brief':
      return t('gogo.openBrief')
    case 'create_reminder':
      return t('gogo.setReminder')
    case 'draft_tweet':
      return t('gogo.draftTweet')
    case 'none':
    default:
      return ''
  }
}

function getActionLoadingLabel(action?: GogoAction | null): string {
  switch (action?.type) {
    case 'summarize_activity':
      return t('gogo.working')
    case 'analyze_address':
      return t('gogo.working')
    case 'create_reminder':
      return t('gogo.working')
    default:
      return t('gogo.working')
  }
}

function getCompletedActionLabel(action?: GogoAction | null): string {
  if (action?.type === 'create_reminder') {
    return t('gogo.reminderSet')
  }

  return t('gogo.done')
}

function getRiskTone(analysis: AddressAnalysis): 'contract' | 'empty' | 'normal' {
  if (analysis.isContract) return 'contract'
  if (analysis.isKnownNewAddress || analysis.hasActivity === false) return 'empty'
  return 'normal'
}

function formatAddressTxCount(txCount: number | null | undefined): string {
  return txCount == null ? t('common.unknown') : String(txCount)
}

function getAddressActivityStatusLabel(analysis: AddressAnalysis): string {
  if (analysis.hasActivity === true) return t('gogo.activityDetected')
  if (analysis.hasActivity === false) return t('gogo.noTransactionActivity')
  return t('common.unknown')
}

function getRiskStyles(tone: 'contract' | 'empty' | 'normal') {
  switch (tone) {
    case 'contract':
      return {
        card: 'border-arc-danger/30 bg-arc-danger/10',
        badge: 'border-arc-danger/30 bg-arc-danger/20 text-arc-danger',
        accent: 'text-arc-danger',
      }
    case 'empty':
      return {
        card: 'border-amber-400/30 bg-amber-400/10',
        badge: 'border-amber-400/30 bg-amber-400/20 text-amber-200',
        accent: 'text-amber-200',
      }
    case 'normal':
    default:
      return {
        card: 'border-emerald-400/30 bg-emerald-400/10',
        badge: 'border-emerald-400/30 bg-emerald-400/20 text-emerald-200',
        accent: 'text-emerald-200',
      }
  }
}

function formatSpendingAmount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value)
}

function formatUsdcAmount(amount: string | number | undefined): string {
  const parsed = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(parsed)) return '0 USDC'

  return `${parsed.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDC`
}

function getSpendingTone(net: number): 'negative' | 'neutral' | 'positive' {
  if (net < 0) return 'negative'
  if (net > 0) return 'positive'
  return 'neutral'
}

function getSpendingStyles(tone: 'negative' | 'neutral' | 'positive') {
  switch (tone) {
    case 'negative':
      return {
        card: 'border-arc-danger/30 bg-arc-danger/10',
        badge: 'border-arc-danger/30 bg-arc-danger/20 text-arc-danger',
        accent: 'text-arc-danger',
      }
    case 'positive':
      return {
        card: 'border-emerald-400/30 bg-emerald-400/10',
        badge: 'border-emerald-400/30 bg-emerald-400/20 text-emerald-200',
        accent: 'text-emerald-200',
      }
    case 'neutral':
    default:
      return {
        card: 'border-arc-border bg-arc-card',
        badge: 'border-arc-border bg-arc-bg/60 text-arc-text-dim',
        accent: 'text-arc-text',
      }
  }
}

function getRiskLabel(tone: 'contract' | 'empty' | 'normal'): string {
  switch (tone) {
    case 'contract':
      return t('gogo.highRisk')
    case 'empty':
      return t('gogo.mediumRisk')
    case 'normal':
    default:
      return t('gogo.lowRisk')
  }
}

function getMessageActions(message: Message): GogoAction[] {
  const actions = sanitizeActions(message.actions)
  if (actions.length > 0) return actions
  return sanitizeActions(message.action ? [message.action] : [])
}

function getRecipientDisplayName(
  value: string | undefined,
  resolveAddress: (value?: string) => string | null,
  addressMemories: Record<string, { label?: string }>,
): string {
  const trimmed = value?.trim()
  if (!trimmed) return t('gogo.unknownRecipient')

  const resolved = resolveAddress(trimmed)
  if (resolved) {
    return addressMemories[resolved]?.label?.trim() || formatAddress(resolved, 4)
  }

  return trimmed
}

function getMultiStepActionTitle(
  action: GogoAction | null | undefined,
  resolveAddress: (value?: string) => string | null,
  addressMemories: Record<string, { label?: string }>,
): string {
  const params = (action?.params ?? {}) as Record<string, unknown>

  switch (action?.type) {
    case 'send': {
      const amount = typeof params.amount === 'string' ? params.amount.trim() : ''
      const amountLabel = amount ? formatUsdcAmount(amount) : 'USDC'
      const recipientValue = typeof params.recipient === 'string' ? params.recipient : undefined
      const recipient = getRecipientDisplayName(recipientValue, resolveAddress, addressMemories)
      return recipientValue
        ? `${t('common.send')} ${amountLabel} ${formatText('send.successTo', { recipient })}`
        : `${t('common.send')} ${amountLabel}`
    }
    case 'view_address':
      return `${t('gogo.viewAddress')} ${getRecipientDisplayName(typeof params.address === 'string' ? params.address : undefined, resolveAddress, addressMemories)}`
    case 'track_whale':
      return `${t('gogo.trackWhale')} ${getRecipientDisplayName(typeof params.address === 'string' ? params.address : undefined, resolveAddress, addressMemories)}`
    case 'analyze_address':
      return `${t('gogo.analyzeAddress')} ${getRecipientDisplayName(typeof params.address === 'string' ? params.address : undefined, resolveAddress, addressMemories)}`
    case 'summarize_activity':
      return `${t('gogo.summarizeActivity')} ${typeof params.period === 'string' ? params.period : '24h'}`
    case 'find_pattern':
      return t('gogo.findPatterns')
    case 'open_brief':
      return t('gogo.openBrief')
    case 'create_reminder': {
      const title = typeof params.title === 'string' && params.title.trim()
        ? params.title.trim()
        : t('gogo.reminderSet')
      const reminder: Reminder = {
        id: 'preview',
        title,
        recipient: typeof params.recipient === 'string' ? params.recipient : undefined,
        amount: typeof params.amount === 'string' ? params.amount : undefined,
        frequency: params.frequency === 'weekly'
          ? 'weekly'
          : params.frequency === 'monthly'
            ? 'monthly'
            : 'daily',
        dayOfWeek: typeof params.dayOfWeek === 'number' ? params.dayOfWeek : undefined,
        dayOfMonth: typeof params.dayOfMonth === 'number' ? params.dayOfMonth : undefined,
        createdAt: '',
      }

      return `${t('dailyBrief.reminderPrefix')}: ${title} (${getReminderScheduleLabel(reminder)})`
    }
    case 'draft_tweet':
      return t('gogo.tweetDraft')
    case 'none':
    default:
      return t('gogo.nextStep')
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

function buildSendValidationWarning(options: {
  recipientInvalid: boolean
  amountInvalid: boolean
  amountOverBalance: boolean
}): string {
  const warnings: string[] = []
  if (options.recipientInvalid) warnings.push(t('gogo.invalidAddress'))
  if (options.amountInvalid) warnings.push(t('gogo.invalidAmount'))
  else if (options.amountOverBalance) warnings.push(t('gogo.amountOverBalance'))
  return warnings.join(' ')
}

function buildAddressValidationWarning(): string {
  return t('gogo.invalidAddress')
}

function getImageSourceLabel(source: ReadAddressFromImageResult['source']): string {
  switch (source) {
    case 'qr':
      return t('gogo.imageSourceQr')
    case 'vision':
      return t('gogo.imageSourceVision')
    case 'none':
    default:
      return t('gogo.imageSourceVision')
  }
}

function buildImageReadMessage(result: ReadAddressFromImageResult): string {
  if (result.address) {
    return formatText('gogo.imageFound', {
      address: formatAddress(result.address, 4),
      source: getImageSourceLabel(result.source),
    })
  }

  if (result.source === 'none') {
    return t('gogo.imageNeedsGemini')
  }

  return t('gogo.imageNotFound')
}

export function GogoAI({ onBack }: GogoAIProps) {
  const address = useStore((s) => s.walletAddress)
  const addressMemories = useStore((s) => s.addressMemories)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const setSelectedAddress = useStore((s) => s.setSelectedAddress)
  const addAddressMemory = useStore((s) => s.addAddressMemory)
  const updateAddressMemory = useStore((s) => s.updateAddressMemory)
  const { balance, isLoading: balanceLoading } = useUSDCBalance()
  usePortfolioBalances(address)

  const [apiKey, setLocalApiKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [userInput, setUserInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [copiedDraftKey, setCopiedDraftKey] = useState<string | null>(null)
  const [analysisLoadingKey, setAnalysisLoadingKey] = useState<string | null>(null)
  const [voiceInputEnabled, setVoiceInputEnabled] = useState(false)
  const [voiceResponsesEnabled, setVoiceResponsesEnabled] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceInputUnavailableReason, setVoiceInputUnavailableReason] = useState<string | null>(null)
  const [speakingMessageKey, setSpeakingMessageKey] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isReadingImage, setIsReadingImage] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<Message[]>([])
  const proactiveGreetingQueuedRef = useRef(false)
  const proactiveGreetingStartedRef = useRef(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const imagePreviewUrlRef = useRef<string | null>(null)
  const imageReadRequestRef = useRef(0)

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

  const portfolioTokens = useStore((state) => state.portfolioTokens)
  const portfolioAddress = useStore((state) => state.portfolioAddress)
  const portfolioUpdatedAt = useStore((state) => state.portfolioUpdatedAt)

  const portfolio = useMemo(
    () => {
      const normalizedAddress = address?.trim().toLowerCase() ?? ''
      if (!normalizedAddress) return []
      if (portfolioAddress !== normalizedAddress) return []
      if (!portfolioUpdatedAt || Date.now() - portfolioUpdatedAt > PORTFOLIO_CACHE_TTL_MS) return []

      return portfolioTokens.slice(0, 20).map((token) => ({
        symbol: token.symbol,
        name: token.name,
        balance: token.balance,
      }))
    },
    [address, portfolioAddress, portfolioTokens, portfolioUpdatedAt],
  )

  const gogoContext = useMemo<GogoContext>(
    () => ({
      walletAddress: address ?? '',
      balance,
      addressBook: addressBookContext,
      whales: whaleSummaries,
      portfolio,
    }),
    [address, balance, addressBookContext, whaleSummaries, portfolio],
  )

  const hasMessages = messages.length > 0
  const hasUserMessages = messages.some((message) => message.role === 'user')
  const hasApiKey = Boolean(apiKey)
  const hasActionLoading = Boolean(analysisLoadingKey)
  const speechRecognitionSupported = Boolean(getSpeechRecognitionCtor())
  const speechSynthesisSupported = isSpeechSynthesisAvailable()
  const voiceInputReady = voiceInputEnabled && speechRecognitionSupported && !voiceInputUnavailableReason
  const voiceResponsesReady = voiceResponsesEnabled && speechSynthesisSupported
  const isProactiveGreetingPending = Boolean(
    historyLoaded &&
      proactiveGreetingQueuedRef.current &&
      !proactiveGreetingStartedRef.current &&
      hasApiKey &&
      !hasMessages &&
      address &&
      balanceLoading,
  )
  const isComposerLocked = isLoading || isProactiveGreetingPending || hasActionLoading
  const showStarterSuggestions = hasApiKey && !hasUserMessages && !isComposerLocked
  const voiceInputTooltip = !voiceInputEnabled
    ? 'Enable Voice input in Settings'
    : voiceInputUnavailableReason ?? (speechRecognitionSupported ? 'Voice not available' : 'Voice not available')
  const voiceResponsesTooltip = !voiceResponsesEnabled
    ? 'Enable Voice responses in Settings'
    : 'Voice not available'
  const imagePreviewNode = (isReadingImage || imagePreviewUrl) ? (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-arc-border bg-arc-card/60 p-3">
      {imagePreviewUrl ? (
        <img
          src={imagePreviewUrl}
          alt={t('gogo.imagePreviewAlt')}
          className="h-12 w-12 shrink-0 rounded-lg border border-arc-border object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-arc-border bg-arc-bg">
          <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.2s]" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-arc-text">{t('gogo.imageReading')}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-arc-gold" />
        </div>
      </div>
    </div>
  ) : null

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

    void (async () => {
      try {
        const [storedKey, history] = await Promise.all([getApiKey(), loadGogoHistory()])
        if (!active) return

        setLocalApiKey(storedKey)
        setMessages(history)
        messagesRef.current = history
        proactiveGreetingQueuedRef.current = Boolean(storedKey && history.length === 0)
        proactiveGreetingStartedRef.current = false
      } catch (error) {
        console.error('[GogoAI] bootstrap failed:', error)
        if (!active) return

        setMessages([])
        messagesRef.current = []
        proactiveGreetingQueuedRef.current = false
        proactiveGreetingStartedRef.current = false
      } finally {
        if (!active) return
        setHistoryLoaded(true)
        setIsInitializing(false)
      }
    })()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return

    let active = true

    chrome.storage.local.get([VOICE_INPUT_STORAGE_KEY, VOICE_RESPONSES_STORAGE_KEY], (result) => {
      if (!active) return
      setVoiceInputEnabled(result[VOICE_INPUT_STORAGE_KEY] === true)
      setVoiceResponsesEnabled(result[VOICE_RESPONSES_STORAGE_KEY] === true)
      setVoiceInputUnavailableReason(null)
    })

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return
      if (VOICE_INPUT_STORAGE_KEY in changes) {
        const nextValue = changes[VOICE_INPUT_STORAGE_KEY]?.newValue === true
        setVoiceInputEnabled(nextValue)
        setVoiceInputUnavailableReason(null)
        if (!nextValue) {
          stopVoiceInput()
        }
      }
      if (VOICE_RESPONSES_STORAGE_KEY in changes) {
        const nextValue = changes[VOICE_RESPONSES_STORAGE_KEY]?.newValue === true
        setVoiceResponsesEnabled(nextValue)
        if (!nextValue) {
          stopVoiceResponse()
        }
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    if (!historyLoaded) return
    if (!proactiveGreetingQueuedRef.current) return
    if (proactiveGreetingStartedRef.current) return
    if (!apiKey || !address || balanceLoading) return
    if (messagesRef.current.length > 0) {
      proactiveGreetingQueuedRef.current = false
      return
    }

    let cancelled = false
    proactiveGreetingStartedRef.current = true
    proactiveGreetingQueuedRef.current = false
    setIsLoading(true)

    void (async () => {
      try {
        const response = await getProactiveGreeting()
        if (cancelled) return

        const assistantMessage: Message = {
          role: 'assistant',
          content: response.reply,
          actions: response.action ? [response.action] : [],
          action: response.action,
          timestamp: Date.now(),
        }

        const finalMessages = [assistantMessage]
        messagesRef.current = finalMessages
        setMessages(finalMessages)
      } catch (error) {
        console.error('[GogoAI] proactive greeting failed:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [address, apiKey, balanceLoading, historyLoaded])

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

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
      if (speechSynthesisSupported) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      imageReadRequestRef.current += 1
      if (imagePreviewUrlRef.current) {
        URL.revokeObjectURL(imagePreviewUrlRef.current)
        imagePreviewUrlRef.current = null
      }
    }
  }, [])

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) return

    await saveGeminiApiKey(trimmed)
    setLocalApiKey(trimmed)
    setKeyInput('')
  }

  const handleClearChat = async () => {
    if (isLoading || analysisLoadingKey) return

    stopVoiceInput()
    stopVoiceResponse()
    imageReadRequestRef.current += 1
    setIsReadingImage(false)
    clearImagePreview()
    setMessages([])
    messagesRef.current = []
    setUserInput('')
    await clearGogoHistory()
  }

  const handleQuickSuggestion = (value: string) => {
    setUserInput(value)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const stopVoiceInput = () => {
    const recognition = recognitionRef.current
    if (recognition) {
      try {
        recognition.abort()
      } catch (error) {
        debugWarn('[GogoAI] failed to stop voice input:', error)
      }
      recognitionRef.current = null
    }
    setIsListening(false)
  }

  const stopVoiceResponse = () => {
    if (!speechSynthesisSupported) return
    window.speechSynthesis.cancel()
    setSpeakingMessageKey(null)
  }

  const startVoiceInput = () => {
    if (!voiceInputReady) {
      if (!speechRecognitionSupported) {
        debugWarn('[GogoAI] voice input unavailable: SpeechRecognition is not supported in this context')
        setVoiceInputUnavailableReason('Voice not available')
      }
      return
    }

    const RecognitionCtor = getSpeechRecognitionCtor()
    if (!RecognitionCtor) {
      debugWarn('[GogoAI] voice input unavailable: SpeechRecognition constructor missing')
      setVoiceInputUnavailableReason('Voice not available')
      return
    }

    try {
      const recognition = new RecognitionCtor()
      recognitionRef.current = recognition
      recognition.lang = getPreferredSpeechLanguage()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      setVoiceInputUnavailableReason(null)
      setIsListening(true)

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results as ArrayLike<any>)
          .map((result) => result?.[0]?.transcript ?? '')
          .join(' ')
          .trim()

        if (transcript) {
          setUserInput(transcript)
          requestAnimationFrame(() => inputRef.current?.focus())
        }
      }

      recognition.onerror = (event: any) => {
        debugWarn('[GogoAI] voice input error:', event?.error ?? event)
        setVoiceInputUnavailableReason('Voice not available')
        setIsListening(false)
        recognitionRef.current = null
      }

      recognition.onend = () => {
        setIsListening(false)
        recognitionRef.current = null
      }

      recognition.start()
    } catch (error) {
      debugWarn('[GogoAI] failed to start voice input:', error)
      setVoiceInputUnavailableReason('Voice not available')
      setIsListening(false)
      recognitionRef.current = null
    }
  }

  const toggleVoiceInput = () => {
    if (isListening) {
      stopVoiceInput()
      return
    }
    startVoiceInput()
  }

  const clearImagePreview = () => {
    if (imagePreviewUrlRef.current) {
      URL.revokeObjectURL(imagePreviewUrlRef.current)
      imagePreviewUrlRef.current = null
    }
    setImagePreviewUrl(null)
  }

  const showImagePreview = (blob: Blob) => {
    clearImagePreview()
    const nextPreviewUrl = URL.createObjectURL(blob)
    imagePreviewUrlRef.current = nextPreviewUrl
    setImagePreviewUrl(nextPreviewUrl)
  }

  const appendMessage = (message: Message) => {
    const nextMessages = [...messagesRef.current, message]
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    void saveGogoHistory(nextMessages)
  }

  const updateMessageByIndex = (
    messageIndex: number,
    updater: (message: Message) => Message,
  ): Message[] => {
    const nextMessages = messagesRef.current.map((message, index) => (
      index === messageIndex ? updater(message) : message
    ))

    messagesRef.current = nextMessages
    setMessages(nextMessages)
    void saveGogoHistory(nextMessages)
    return nextMessages
  }

  const handleImageResult = async (blob: Blob) => {
    const requestId = ++imageReadRequestRef.current
    setIsReadingImage(true)
    showImagePreview(blob)

    try {
      const result = await readAddressFromImage(blob)
      if (requestId !== imageReadRequestRef.current) return

      const content = buildImageReadMessage(result)
      const imageResult: GogoImageResult | undefined = result.address
        ? {
            address: result.address,
            source: result.source === 'vision' ? 'vision' : 'qr',
            raw: result.raw,
          }
        : undefined

      appendMessage({
        role: 'assistant',
        content,
        actions: [],
        timestamp: Date.now(),
        imageResult,
      })
    } catch (error) {
      debugWarn('[GogoAI] image read failed:', error)
      if (requestId !== imageReadRequestRef.current) return

      appendMessage({
        role: 'assistant',
        content: t('gogo.imageNotFound'),
        actions: [],
        timestamp: Date.now(),
      })
    } finally {
      if (requestId === imageReadRequestRef.current) {
        setIsReadingImage(false)
        clearImagePreview()
      }
    }
  }

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void handleImageResult(file)
  }

  const handleImagePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const items = Array.from(event.clipboardData.items ?? [])
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    const file = imageItem?.getAsFile() ?? null
    if (!file) return

    event.preventDefault()
    void handleImageResult(file)
  }

  const openImagePicker = () => {
    imageInputRef.current?.click()
  }

  const handleImageSend = async (messageIndex: number, address: string) => {
    await persistPendingSend(address)
    updateMessageByIndex(messageIndex, (message) => ({
      ...message,
      imageResult: message.imageResult
        ? {
            ...message.imageResult,
            sendCompleted: true,
          }
        : message.imageResult,
    }))
    setCurrentView('send')
  }

  const handleImageAnalyze = async (messageIndex: number, address: string, messageKey: string) => {
    const currentMessage = messagesRef.current[messageIndex]
    if (currentMessage?.imageResult?.analysis) return

    setAnalysisLoadingKey(messageKey)
    updateMessageByIndex(messageIndex, (message) => ({
      ...message,
      imageResult: message.imageResult
        ? {
            ...message.imageResult,
            analysisError: null,
          }
        : message.imageResult,
    }))

    try {
      const analysis = await analyzeAddress(address)
      updateMessageByIndex(messageIndex, (message) => ({
        ...message,
        imageResult: message.imageResult
          ? {
              ...message.imageResult,
              analysis,
              analysisError: null,
            }
          : message.imageResult,
      }))
    } catch (error) {
      console.error('[GogoAI] image address analysis failed:', error)
      const errorMessage = t('gogo.partialActivityData')
      updateMessageByIndex(messageIndex, (message) => ({
        ...message,
        imageResult: message.imageResult
          ? {
              ...message.imageResult,
              analysisError: errorMessage,
            }
          : message.imageResult,
      }))
    } finally {
      setAnalysisLoadingKey(null)
    }
  }

  const handleImageSave = async (messageIndex: number, address: string) => {
    const existing = addressMemories[address]
    const defaultLabel = formatAddress(address, 4)
    const promptLabel = window.prompt(t('gogo.imageAddressBookPrompt'), existing?.label?.trim() || defaultLabel)
    const nextLabel = promptLabel?.trim() || defaultLabel

    if (existing) {
      updateAddressMemory(address, {
        label: nextLabel,
        tag: existing.tag ?? 'other',
        lastUsedAt: Date.now(),
      })
    } else {
      addAddressMemory(address, {
        label: nextLabel,
        tag: 'other',
      })
    }

    setSelectedAddress(address)
    setCurrentView('address-detail')
    updateMessageByIndex(messageIndex, (message) => ({
      ...message,
      imageResult: message.imageResult
        ? {
            ...message.imageResult,
            savedCompleted: true,
          }
        : message.imageResult,
    }))
  }

  const renderImageResultCard = (
    message: Message,
    messageIndex: number,
    messageKey: string,
    isUser: boolean,
  ) => {
    const imageResult = message.imageResult
    if (!imageResult) return null

    const analysis = imageResult.analysis ?? null
    const riskTone = analysis ? getRiskTone(analysis) : null
    const riskStyles = riskTone ? getRiskStyles(riskTone) : null
    const riskLabel = riskTone ? getRiskLabel(riskTone) : ''
    const isAnalysisLoading = analysisLoadingKey === messageKey && !analysis
    const sendCompleted = Boolean(imageResult.sendCompleted)
    const savedCompleted = Boolean(imageResult.savedCompleted)
    const actionButtonClass = 'h-8 px-3 text-[11px]'

    return (
      <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
        <Card className="border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                {t('gogo.imageResultTitle')}
              </p>
              <h4 className="mt-1 text-base font-semibold text-arc-text">
                {formatAddress(imageResult.address, 4)}
              </h4>
            </div>
            <span className="rounded-full border border-arc-gold/30 bg-arc-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-gold">
              {imageResult.source === 'qr' ? t('gogo.imageSourceQr') : t('gogo.imageSourceVision')}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className={actionButtonClass}
              onClick={() => void handleImageSend(messageIndex, imageResult.address)}
              disabled={sendCompleted}
            >
              {sendCompleted ? <Check size={12} /> : null}
              {sendCompleted ? t('gogo.done') : t('gogo.imageActionSend')}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={actionButtonClass}
              onClick={() => void handleImageAnalyze(messageIndex, imageResult.address, messageKey)}
              disabled={isAnalysisLoading || Boolean(analysis)}
            >
              {isAnalysisLoading ? <Loader2 size={12} className="animate-spin" /> : analysis ? <Check size={12} /> : null}
              {isAnalysisLoading ? t('gogo.working') : analysis ? t('gogo.done') : t('gogo.imageActionRisk')}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={actionButtonClass}
              onClick={() => void handleImageSave(messageIndex, imageResult.address)}
              disabled={savedCompleted}
            >
              {savedCompleted ? <Check size={12} /> : null}
              {savedCompleted ? t('gogo.done') : t('gogo.imageActionAddressBook')}
            </Button>
          </div>

          {imageResult.analysisError && (
            <p className="mt-3 text-xs text-arc-danger">{imageResult.analysisError}</p>
          )}

          {isAnalysisLoading ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-arc-border bg-arc-bg/80 p-3">
              <Loader2 size={18} className="animate-spin text-arc-gold" />
              <div>
                <p className="text-sm font-medium text-arc-text">{t('gogo.checkingAddress')}</p>
                <p className="text-xs text-arc-text-dim">{t('gogo.fetchingAddressHistory')}</p>
              </div>
            </div>
          ) : analysis && riskStyles ? (
            <Card className={`mt-3 border p-4 shadow-lg shadow-black/10 ${riskStyles.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                    {t('gogo.addressRiskAnalysis')}
                  </p>
                  <h4 className={`mt-1 text-base font-semibold ${riskStyles.accent}`}>
                    {riskLabel}
                  </h4>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${riskStyles.badge}`}>
                  ArcScan
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.contract')}</p>
                  <p className="mt-1 text-sm font-medium text-arc-text">
                    {analysis.isContract ? 'Yes' : 'No'}
                  </p>
                </div>
                <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.transactions')}</p>
                  <p className="mt-1 text-sm font-medium text-arc-text">{formatAddressTxCount(analysis.txCount)}</p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.summary')}</p>
                <p className="mt-1 text-sm leading-relaxed text-arc-text">{analysis.summary}</p>
              </div>

              {analysis.activityPartial && (
                <p className="mt-2 text-xs text-amber-200">
                  {t('gogo.partialActivityData')}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-arc-text-dim">
                  {getAddressActivityStatusLabel(analysis)}
                </p>
                <a
                  href={`${EXPLORER_URL}/address/${imageResult.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-arc-gold hover:underline"
                >
                  {t('gogo.viewOnArcScan')}
                  <ExternalLink size={10} />
                </a>
              </div>
            </Card>
          ) : null}
        </Card>
      </div>
    )
  }

  const speakMessage = (messageKey: string, text: string) => {
    if (!voiceResponsesReady || !speechSynthesisSupported) {
      debugWarn('[GogoAI] voice responses unavailable in this context')
      return
    }

    if (speakingMessageKey === messageKey && window.speechSynthesis.speaking) {
      stopVoiceResponse()
      return
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = getPreferredSpeechLanguage()
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onend = () => {
      setSpeakingMessageKey((current) => (current === messageKey ? null : current))
    }
    utterance.onerror = () => {
      setSpeakingMessageKey((current) => (current === messageKey ? null : current))
    }

    try {
      setSpeakingMessageKey(messageKey)
      window.speechSynthesis.speak(utterance)
    } catch (error) {
      debugWarn('[GogoAI] failed to speak response:', error)
      setSpeakingMessageKey(null)
    }
  }

  const handleSend = async () => {
    const trimmed = userInput.trim()
    if (!trimmed || isComposerLocked || !address) return

    if (isListening) {
      stopVoiceInput()
    }

    const history = messagesRef.current
    const userMessage: Message = {
      role: 'user',
      content: trimmed,
      actions: [],
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
        actions: response.actions ?? [],
        action: response.actions?.[0],
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
        actions: [],
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

  const updateMessageAction = (
    messageIndex: number,
    actionIndex: number,
    updater: (action: GogoAction) => GogoAction,
    messageUpdater?: (message: Message) => Message,
  ): Message[] => {
    const nextMessages = messagesRef.current.map((message, index) => {
      if (index !== messageIndex) return message

      const actions = getMessageActions(message)
      if (!actions[actionIndex]) return message

      const nextActions = actions.map((existingAction, idx) => (
        idx === actionIndex ? updater(existingAction) : existingAction
      ))

      const nextMessage: Message = {
        ...message,
        actions: nextActions,
        action: nextActions[0],
      }

      return messageUpdater ? messageUpdater(nextMessage) : nextMessage
    })

    messagesRef.current = nextMessages
    setMessages(nextMessages)
    void saveGogoHistory(nextMessages)
    return nextMessages
  }

  const handleAction = async (messageIndex: number, actionIndex: number, action: GogoAction | null | undefined, messageKey: string) => {
    if (!action || action.type === 'none' || action.completed) return
    if ((action.type === 'analyze_address' || action.type === 'summarize_activity' || action.type === 'create_reminder') && analysisLoadingKey === messageKey) return

    const requiresAddress = action.type === 'view_address' || action.type === 'analyze_address' || action.type === 'track_whale'
    const resolvedAddress = requiresAddress ? resolveAddress(action.params?.address) : null
    if (requiresAddress && (!resolvedAddress || !isValidAddress(resolvedAddress))) {
      updateMessageAction(
        messageIndex,
        actionIndex,
        (currentAction) => ({
          ...currentAction,
          completed: true,
        }),
        (message) => ({
          ...message,
          content: buildAddressValidationWarning(),
        }),
      )
      return
    }

    switch (action.type) {
      case 'send': {
        const recipientInput = typeof action.params?.recipient === 'string' ? action.params.recipient.trim() : ''
        const resolvedRecipient = recipientInput ? resolveAddress(recipientInput) : null
        const recipientInvalid = Boolean(recipientInput) && (!resolvedRecipient || !isValidAddress(resolvedRecipient))
        const amountInput = typeof action.params?.amount === 'string' ? action.params.amount.trim() : ''
        const amountValidation = amountInput ? isValidAmount(amountInput, balance) : { valid: true, overBalance: false, amountMicros: null }
        const amountInvalid = Boolean(amountInput) && !amountValidation.valid
        const amountOverBalance = Boolean(amountInput) && amountValidation.valid && amountValidation.overBalance
        const warning = buildSendValidationWarning({
          recipientInvalid,
          amountInvalid,
          amountOverBalance,
        })

        const recipientToPersist = resolvedRecipient && isValidAddress(resolvedRecipient) ? resolvedRecipient : undefined
        const amountToPersist = amountValidation.valid && !amountValidation.overBalance ? (amountInput || undefined) : undefined
        if (recipientInvalid || warning) {
          updateMessageAction(
            messageIndex,
            actionIndex,
            (currentAction) => ({
              ...currentAction,
              completed: true,
            }),
            (message) => ({
              ...message,
              content: warning || buildAddressValidationWarning(),
            }),
          )
        } else {
          updateMessageAction(messageIndex, actionIndex, (currentAction) => ({
            ...currentAction,
            completed: true,
          }))
        }

        if (!recipientToPersist && !amountToPersist) {
          break
        }

        await persistPendingSend(recipientToPersist, amountToPersist)
        setCurrentView('send')
        break
      }
      case 'create_reminder': {
        setAnalysisLoadingKey(messageKey)

        try {
          const reminderFrequency: 'daily' | 'weekly' | 'monthly' = action.params?.frequency === 'weekly'
            ? 'weekly'
            : action.params?.frequency === 'monthly'
              ? 'monthly'
              : 'daily'

          const reminder = buildReminderFromAction({
            title: action.params?.title ?? '',
            recipient: action.params?.recipient,
            amount: action.params?.amount,
            frequency: reminderFrequency,
            dayOfWeek: action.params?.dayOfWeek,
            dayOfMonth: action.params?.dayOfMonth,
          })

          await addReminder(reminder)
          updateMessageAction(messageIndex, actionIndex, (currentAction) => ({
            ...currentAction,
            completed: true,
          }))
        } catch (error) {
          console.error('[GogoAI] reminder save failed:', error)
          const errorMessage = error instanceof Error ? error.message : 'Could not save this reminder right now.'
          const nextMessages = messagesRef.current.map((message, index) => {
            if (index !== messageIndex) return message
            return {
              ...message,
              content: errorMessage,
            }
          })

          messagesRef.current = nextMessages
          setMessages(nextMessages)
          void saveGogoHistory(nextMessages)
        } finally {
          setAnalysisLoadingKey(null)
        }
        break
      }
      case 'view_address':
      case 'track_whale':
      case 'find_pattern':
      case 'open_brief':
      case 'draft_tweet': {
        updateMessageAction(messageIndex, actionIndex, (currentAction) => ({
          ...currentAction,
          completed: true,
        }))

        if (action.type === 'view_address') {
          if (!resolvedAddress) return
          setSelectedAddress(resolvedAddress)
          setCurrentView('address-detail')
          break
        }

        if (action.type === 'track_whale') {
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

        if (action.type === 'find_pattern' || action.type === 'open_brief') {
          setCurrentView('daily-brief')
          break
        }

        break
      }
      case 'summarize_activity': {
        if (analysisLoadingKey === messageKey) return
        setAnalysisLoadingKey(messageKey)

        try {
          const period = action.params?.period === '7d'
            ? '7d'
            : action.params?.period === '30d'
              ? '30d'
              : '24h'
          const analysis = await analyzeSpending(period)
          updateMessageAction(
            messageIndex,
            actionIndex,
            (currentAction) =>
              currentAction.type === 'summarize_activity'
                ? {
                    ...currentAction,
                    completed: true,
                    analysis,
                  }
                : currentAction,
            (message) => ({
              ...message,
              content: analysis.summary,
            }),
          )
        } catch (error) {
          console.error('[GogoAI] spending analysis failed:', error)
          const errorMessage = error instanceof Error ? error.message : 'Could not summarize spending right now.'
          const nextMessages = messagesRef.current.map((message, index) => {
            if (index !== messageIndex) return message
            return {
              ...message,
              content: errorMessage,
            }
          })

          messagesRef.current = nextMessages
          setMessages(nextMessages)
          void saveGogoHistory(nextMessages)
        } finally {
          setAnalysisLoadingKey(null)
        }
        break
      }
      case 'analyze_address': {
        if (!resolvedAddress) return
        setAnalysisLoadingKey(messageKey)

        try {
          const analysis = await analyzeAddress(resolvedAddress)
          updateMessageAction(
            messageIndex,
            actionIndex,
            (currentAction) =>
              currentAction.type === 'analyze_address'
                ? {
                    ...currentAction,
                    completed: true,
                    params: {
                      ...currentAction.params,
                      address: resolvedAddress,
                    },
                    analysis,
                  }
                : currentAction,
            (message) => ({
              ...message,
              content: analysis.summary,
            }),
          )
        } catch (error) {
          console.error('[GogoAI] address analysis failed:', error)
          const errorMessage = t('gogo.partialActivityData')
          const nextMessages = messagesRef.current.map((message, index) => {
            if (index !== messageIndex) return message
            return {
              ...message,
              content: errorMessage,
            }
          })

          messagesRef.current = nextMessages
          setMessages(nextMessages)
          void saveGogoHistory(nextMessages)
        } finally {
          setAnalysisLoadingKey(null)
        }
        break
      }
      default:
        break
    }
  }

  const handleCopyDraftTweet = async (text: string, draftKey: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedDraftKey(draftKey)
    } catch (error) {
      console.error('[GogoAI] copy draft failed:', error)
    }
  }

  const handleOpenTweetCompose = (text: string) => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
    if (!openSafeUrl(url)) {
      debugWarn('[GogoAI] blocked unsafe tweet compose url:', url)
    }
  }

  const renderActionStep = (
    message: Message,
    messageIndex: number,
    action: GogoAction | null | undefined,
    actionIndex: number,
    baseKey: string,
    isUser: boolean,
  ) => {
    if (!action || action.type === 'none') return null

    const actionKey = `${baseKey}-step-${actionIndex}`
    const actionCompleted = Boolean(action.completed)
    const analyzeAction = action.type === 'analyze_address' ? action : null
    const summaryAction = action.type === 'summarize_activity' ? action : null
    const draftTweetAction = action.type === 'draft_tweet' ? action : null
    const isAnalyzeAction = Boolean(analyzeAction)
    const isSummaryAction = Boolean(summaryAction)
    const isActionLoading = Boolean(
      action &&
      analysisLoadingKey === actionKey &&
      !action.completed &&
      (isAnalyzeAction || isSummaryAction || action.type === 'create_reminder'),
    )
    const draftText = draftTweetAction?.params?.text ?? ''
    const draftLength = draftText.length
    const draftKey = `${baseKey}-draft-${actionIndex}`
    const analysis = analyzeAction?.analysis ?? null
    const spendingAnalysis: SpendingAnalysis | null = summaryAction?.analysis ?? null
    const riskTone = analysis ? getRiskTone(analysis) : null
    const riskStyles = riskTone ? getRiskStyles(riskTone) : null
    const riskLabel = riskTone ? getRiskLabel(riskTone) : ''
    const spendingTone = spendingAnalysis ? getSpendingTone(spendingAnalysis.net) : null
    const spendingStyles = spendingTone ? getSpendingStyles(spendingTone) : null
    const spendingLabel = spendingTone === 'negative' ? 'Net spend' : spendingTone === 'positive' ? 'Net gain' : 'Break-even'
    const actionLoadingLabel = getActionLoadingLabel(action)

    return (
      <div
        key={`${baseKey}-step-card-${actionIndex}`}
        className="rounded-2xl border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10"
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
              actionCompleted
                ? 'border-arc-gold/30 bg-arc-gold/10 text-arc-gold'
                : 'border-arc-border bg-arc-bg/80 text-arc-text-dim'
            }`}
          >
            {actionIndex + 1}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                  Adım {actionIndex + 1}
                </p>
                <p className="mt-1 text-sm font-medium text-arc-text">
                  {getMultiStepActionTitle(action, resolveAddress, addressMemories)}
                </p>
              </div>
              <span className="rounded-full border border-arc-border bg-arc-bg/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-text-dim">
                {getActionLabel(action)}
              </span>
            </div>

            {draftTweetAction && (
              <div className="rounded-xl border border-arc-border bg-arc-bg/80 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                    Tweet draft
                  </p>
                  <span className={`text-xs font-medium ${draftLength > 280 ? 'text-arc-danger' : 'text-arc-text-dim'}`}>
                    {draftLength}/280
                  </span>
                </div>

                <div className="rounded-xl border border-arc-border bg-arc-card/80 p-3 text-sm leading-relaxed whitespace-pre-wrap text-arc-text">
                  {draftText}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-[11px]"
                    onClick={() => void handleCopyDraftTweet(draftText, draftKey)}
                  >
                    {copiedDraftKey === draftKey ? 'Copied ✓' : 'Copy'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-8 px-3 text-[11px]"
                    onClick={() => handleOpenTweetCompose(draftText)}
                  >
                    Tweet
                  </Button>
                </div>
              </div>
            )}

            {isAnalyzeAction && (
              <Card className={`border p-4 shadow-lg shadow-black/10 ${riskStyles?.card ?? 'border-arc-border bg-arc-card'}`}>
                {isActionLoading ? (
                  <div className="flex items-center gap-3">
                    <Loader2 size={18} className="animate-spin text-arc-gold" />
                    <div>
                      <p className="text-sm font-medium text-arc-text">Checking this address on ArcScan...</p>
                      <p className="text-xs text-arc-text-dim">Fetching contract status and transaction history.</p>
                    </div>
                  </div>
                ) : analysis && riskStyles ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                          Address risk analysis
                        </p>
                        <h4 className={`mt-1 text-base font-semibold ${riskStyles.accent}`}>
                          {riskLabel}
                        </h4>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${riskStyles.badge}`}>
                        ArcScan
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Contract</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">
                          {analysis.isContract ? 'Yes' : 'No'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Transactions</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">{formatAddressTxCount(analysis.txCount)}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Summary</p>
                      <p className="mt-1 text-sm leading-relaxed text-arc-text">{analysis.summary}</p>
                    </div>

                    {analysis.activityPartial && (
                      <p className="mt-2 text-xs text-amber-200">
                        {t('gogo.partialActivityData')}
                      </p>
                    )}
                  </>
                ) : null}
              </Card>
            )}

            {isSummaryAction && (
              <Card className={`border p-4 shadow-lg shadow-black/10 ${spendingStyles?.card ?? 'border-arc-border bg-arc-card'}`}>
                {isActionLoading ? (
                  <div className="flex items-center gap-3">
                    <Loader2 size={18} className="animate-spin text-arc-gold" />
                    <div>
                      <p className="text-sm font-medium text-arc-text">Summarizing your spending...</p>
                      <p className="text-xs text-arc-text-dim">Counting sent and received USDC transfers.</p>
                    </div>
                  </div>
                ) : spendingAnalysis && spendingStyles ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                          Spending summary
                        </p>
                        <h4 className={`mt-1 text-base font-semibold ${spendingStyles.accent}`}>
                          {spendingLabel}
                        </h4>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${spendingStyles.badge}`}>
                        USDC
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Sent</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">
                          {formatSpendingAmount(spendingAnalysis.totalSent)} USDC
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Received</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">
                          {formatSpendingAmount(spendingAnalysis.totalReceived)} USDC
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Net</p>
                        <p className={`mt-1 text-sm font-medium ${spendingStyles.accent}`}>
                          {spendingAnalysis.net > 0 ? '+' : spendingAnalysis.net < 0 ? '-' : ''}
                          {formatSpendingAmount(Math.abs(spendingAnalysis.net))} USDC
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Tx count</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">{spendingAnalysis.txCount}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Top recipient</p>
                      <p className="mt-1 text-sm leading-relaxed text-arc-text">
                        {spendingAnalysis.topRecipient
                          ? `${spendingAnalysis.topRecipient.label} (${formatSpendingAmount(spendingAnalysis.topRecipient.amount)} USDC)`
                          : 'No outgoing transfers in this period.'}
                      </p>
                    </div>

                    <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Summary</p>
                      <p className="mt-1 text-sm leading-relaxed text-arc-text">{spendingAnalysis.summary}</p>
                    </div>
                  </>
                ) : null}
              </Card>
            )}

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className={`h-8 text-[11px] ${
                  actionCompleted
                    ? 'border-arc-gold/30 bg-arc-gold/10 text-arc-gold hover:bg-arc-gold/10'
                    : 'border-arc-gold/20 bg-arc-gold/5 text-arc-gold hover:bg-arc-gold/10'
                }`}
                onClick={() => void handleAction(messageIndex, actionIndex, action, actionKey)}
                disabled={isLoading || hasActionLoading || actionCompleted || isActionLoading}
              >
                {isActionLoading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    {actionLoadingLabel}
                  </>
                ) : actionCompleted ? (
                  <>
                    <Check size={12} />
                            {getCompletedActionLabel(action)}
                  </>
                ) : (
                  'Onayla'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
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
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageInputChange}
      />
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
          disabled={isLoading || hasActionLoading || messages.length === 0}
        >
          <Trash2 size={14} />
          Clear chat
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!hasMessages && hasApiKey && isComposerLocked && (
          <div className="flex h-full items-center justify-center">
            <Card className="w-full max-w-md p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-gold/10">
                  <Sparkles size={22} className="text-arc-gold" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-arc-text">Gogo is preparing your brief.</p>
                  <p className="text-sm text-arc-text-dim">I&apos;m checking your balance, activity, whales and patterns.</p>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-arc-border bg-arc-bg/50 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.2s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold [animation-delay:-0.1s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-gold" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {!hasMessages && hasApiKey && !isComposerLocked && (
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
                {imagePreviewNode}
                <Button
                  variant="outline"
                  fullWidth
                  size="sm"
                  onClick={openImagePicker}
                  disabled={isReadingImage}
                  title={t('gogo.imageButtonTooltip')}
                >
                  <ImageIcon size={14} />
                  {t('gogo.readImage')}
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
              const messageActions = getMessageActions(message)
              const hasMultipleActions = messageActions.length > 1
              const primaryAction = messageActions[0] ?? null
              const draftTweet = primaryAction && primaryAction.type === 'draft_tweet' ? primaryAction : null
              const action = primaryAction && primaryAction.type !== 'none' && primaryAction.type !== 'draft_tweet'
                ? primaryAction
                : null
              const draftKey = `${message.timestamp}-${index}`
              const actionKey = `${draftKey}-0`
              const analyzeAction = action && action.type === 'analyze_address' ? action : null
              const summaryAction = action && action.type === 'summarize_activity' ? action : null
              const isAnalyzeAction = Boolean(analyzeAction)
              const isSummaryAction = Boolean(summaryAction)
              const actionCompleted = Boolean(action?.completed)
              const isActionLoading = Boolean(action && analysisLoadingKey === actionKey && !action.completed && (analyzeAction || summaryAction || action.type === 'create_reminder'))
              const draftText = draftTweet?.params.text ?? ''
              const draftLength = draftText.length
              const analysis = analyzeAction?.analysis ?? null
              const spendingAnalysis: SpendingAnalysis | null = summaryAction?.analysis ?? null
              const riskTone = analysis ? getRiskTone(analysis) : null
              const riskStyles = riskTone ? getRiskStyles(riskTone) : null
              const riskLabel = riskTone ? getRiskLabel(riskTone) : ''
              const spendingTone = spendingAnalysis ? getSpendingTone(spendingAnalysis.net) : null
              const spendingStyles = spendingTone ? getSpendingStyles(spendingTone) : null
              const spendingLabel = spendingTone === 'negative' ? 'Net spend' : spendingTone === 'positive' ? 'Net gain' : 'Break-even'
              const actionLoadingLabel = action ? getActionLoadingLabel(action) : 'Working...'
              const canSpeakMessage = !isUser && !isError && Boolean(message.content.trim())
              const isSpeakingThisMessage = speakingMessageKey === actionKey
              const speechButtonLabel = isSpeakingThisMessage && speechSynthesisSupported ? 'Stop' : 'Sesli oku'

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

                  {canSpeakMessage && (
                    <div className={`mt-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-7 px-2 text-[11px] ${
                          isSpeakingThisMessage ? 'border-arc-gold/40 bg-arc-gold/10 text-arc-gold' : ''
                        }`}
                        onClick={() => void speakMessage(actionKey, message.content)}
                        disabled={!voiceResponsesReady}
                        title={voiceResponsesTooltip}
                        aria-pressed={isSpeakingThisMessage}
                      >
                        <Volume2 size={12} />
                        {speechButtonLabel}
                      </Button>
                    </div>
                  )}

                  {renderImageResultCard(message, index, actionKey, isUser)}

                  {hasMultipleActions ? (
                    <div className={`mt-3 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
                      <div className="space-y-3">
                        {messageActions?.map((stepAction, actionIndex) =>
                          renderActionStep(message, index, stepAction, actionIndex, draftKey, isUser),
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                  {draftTweet && (
                    <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
                      <div className="rounded-2xl border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                            Tweet draft
                          </p>
                          <span className={`text-xs font-medium ${draftLength > 280 ? 'text-arc-danger' : 'text-arc-text-dim'}`}>
                            {draftLength}/280
                          </span>
                        </div>

                        <div className="rounded-xl border border-arc-border bg-arc-bg/80 p-3 text-sm leading-relaxed whitespace-pre-wrap text-arc-text">
                          {draftText}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 text-[11px]"
                            onClick={() => void handleCopyDraftTweet(draftText, draftKey)}
                          >
                            {copiedDraftKey === draftKey ? 'Copied ✓' : 'Copy'}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            className="h-8 px-3 text-[11px]"
                            onClick={() => handleOpenTweetCompose(draftText)}
                          >
                            Tweet
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {action && (
                    <div className={`mt-2 ${isUser ? 'flex justify-end' : 'flex justify-start'}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className={`h-8 text-[11px] ${
                          actionCompleted
                            ? 'border-arc-gold/30 bg-arc-gold/10 text-arc-gold hover:bg-arc-gold/10'
                            : 'border-arc-gold/20 bg-arc-gold/5 text-arc-gold hover:bg-arc-gold/10'
                        }`}
                        onClick={() => void handleAction(index, 0, action, actionKey)}
                        disabled={isLoading || hasActionLoading || actionCompleted || isActionLoading}
                      >
                        {isActionLoading ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            {actionLoadingLabel}
                          </>
                        ) : actionCompleted ? (
                          <>
                            <Check size={12} />
                            {getCompletedActionLabel(action)}
                          </>
                        ) : (
                          getActionLabel(action)
                        )}
                      </Button>
                    </div>
                  )}

                  {isAnalyzeAction && (
                    <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
                      {isActionLoading ? (
                        <Card className="border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10">
                          <div className="flex items-center gap-3">
                            <Loader2 size={18} className="animate-spin text-arc-gold" />
                            <div>
                              <p className="text-sm font-medium text-arc-text">Checking this address on ArcScan...</p>
                              <p className="text-xs text-arc-text-dim">Fetching contract status and transaction history.</p>
                            </div>
                          </div>
                        </Card>
                      ) : analysis && riskStyles ? (
                        <Card className={`border p-4 shadow-lg shadow-black/10 ${riskStyles.card}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                                Address risk analysis
                              </p>
                              <h4 className={`mt-1 text-base font-semibold ${riskStyles.accent}`}>
                                {riskLabel}
                              </h4>
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${riskStyles.badge}`}>
                              ArcScan
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Contract</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">
                                {analysis.isContract ? 'Yes' : 'No'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Transactions</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">{formatAddressTxCount(analysis.txCount)}</p>
                            </div>
                          </div>

                          <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Summary</p>
                            <p className="mt-1 text-sm leading-relaxed text-arc-text">{analysis.summary}</p>
                          </div>

                          {analysis.activityPartial && (
                            <p className="mt-2 text-xs text-amber-200">
                              {t('gogo.partialActivityData')}
                            </p>
                          )}

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-[11px] text-arc-text-dim">
                              {getAddressActivityStatusLabel(analysis)}
                            </p>
                            <a
                              href={`${EXPLORER_URL}/address/${analyzeAction?.params.address ?? ''}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-arc-gold hover:underline"
                            >
                              View on ArcScan
                              <ExternalLink size={10} />
                            </a>
                          </div>
                        </Card>
                      ) : null}
                    </div>
                  )}

                  {isSummaryAction && (
                    <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
                      {isActionLoading ? (
                        <Card className="border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10">
                          <div className="flex items-center gap-3">
                            <Loader2 size={18} className="animate-spin text-arc-gold" />
                            <div>
                              <p className="text-sm font-medium text-arc-text">Summarizing your spending...</p>
                              <p className="text-xs text-arc-text-dim">Counting sent and received USDC transfers.</p>
                            </div>
                          </div>
                        </Card>
                      ) : spendingAnalysis && spendingStyles ? (
                        <Card className={`border p-4 shadow-lg shadow-black/10 ${spendingStyles.card}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                                Spending summary
                              </p>
                              <h4 className={`mt-1 text-base font-semibold ${spendingStyles.accent}`}>
                                {spendingLabel}
                              </h4>
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${spendingStyles.badge}`}>
                              USDC
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Sent</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">
                                {formatSpendingAmount(spendingAnalysis.totalSent)} USDC
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Received</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">
                                {formatSpendingAmount(spendingAnalysis.totalReceived)} USDC
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Net</p>
                              <p className={`mt-1 text-sm font-medium ${spendingStyles.accent}`}>
                                {spendingAnalysis.net > 0 ? '+' : spendingAnalysis.net < 0 ? '-' : ''}
                                {formatSpendingAmount(Math.abs(spendingAnalysis.net))} USDC
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Tx count</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">{spendingAnalysis.txCount}</p>
                            </div>
                          </div>

                          <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Top recipient</p>
                            <p className="mt-1 text-sm leading-relaxed text-arc-text">
                              {spendingAnalysis.topRecipient
                                ? `${spendingAnalysis.topRecipient.label} (${formatSpendingAmount(spendingAnalysis.topRecipient.amount)} USDC)`
                                : 'No outgoing transfers in this period.'}
                            </p>
                          </div>

                          <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">Summary</p>
                            <p className="mt-1 text-sm leading-relaxed text-arc-text">{spendingAnalysis.summary}</p>
                          </div>
                        </Card>
                      ) : null}
                    </div>
                  )}
                    </>
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

            {showStarterSuggestions && (
              <Card className="border border-arc-border/80 bg-arc-card/80 p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                  Quick suggestions
                </p>
                <div className="flex flex-wrap gap-2">
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
              </Card>
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
          {isListening && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-arc-danger/30 bg-arc-danger/10 px-2.5 py-1 text-[10px] font-medium text-arc-danger animate-pulse">
              <span className="h-2 w-2 rounded-full bg-arc-danger" />
              Listening...
            </div>
          )}
          {imagePreviewNode}
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSend()
            }}
          >
            <div className="relative">
              <div className="absolute left-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-2">
                <button
                  type="button"
                  onClick={openImagePicker}
                  disabled={isReadingImage}
                  className="rounded-lg border border-arc-border bg-arc-card p-2 text-arc-text-dim transition-all hover:border-arc-gold/30 hover:text-arc-text disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('gogo.imageButtonTooltip')}
                  title={t('gogo.imageButtonTooltip')}
                >
                  <ImageIcon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleVoiceInput()}
                  disabled={isComposerLocked || !address || (!voiceInputReady && !isListening)}
                  className={`rounded-lg border p-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    isListening
                      ? 'border-arc-danger/40 bg-arc-danger text-white shadow-lg shadow-arc-danger/20 animate-pulse'
                      : 'border-arc-border bg-arc-card text-arc-text-dim hover:border-arc-gold/30 hover:text-arc-text'
                  }`}
                  aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                  title={isListening ? 'Stop listening' : voiceInputTooltip}
                >
                  <Mic size={15} />
                </button>
              </div>

              <input
                ref={inputRef}
                type="text"
                placeholder="Ask Gogo anything..."
                className="w-full rounded-xl border border-arc-border bg-arc-card py-3 pl-24 pr-12 text-sm text-arc-text placeholder:text-arc-text-dim transition-colors focus:border-arc-gold/50 focus:outline-none"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                onPaste={handleImagePaste}
                disabled={isComposerLocked || !address}
              />
            </div>
            <button
              type="submit"
              disabled={isComposerLocked || !userInput.trim() || !address}
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
              {imagePreviewNode}
              <Button
                variant="outline"
                fullWidth
                size="sm"
                onClick={openImagePicker}
                disabled={isReadingImage}
                title={t('gogo.imageButtonTooltip')}
              >
                <ImageIcon size={14} />
                {t('gogo.readImage')}
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
