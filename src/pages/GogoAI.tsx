import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type ReactNode } from 'react'
import { ArrowLeft, Check, ExternalLink, Image as ImageIcon, Loader2, Mic, Send, Sparkles, Trash2, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { EXPLORER_URL } from '@/lib/arc'
import { formatText, getLocaleSync, t } from '@/lib/i18n'
import { formatAddress, openSafeUrl, shortenTxHash } from '@/lib/utils'
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
  type GatewayBatchTipRecipientAction,
  type GogoAction,
  type GogoContext,
  type GogoImageResult,
  type Message,
  type SpendingAnalysis,
} from '@/lib/gogoAI'
import { findCreatorHandleByAddress, getCreatorWallet, normalizeCreatorHandle } from '@/lib/creatorRegistry'
import { readAddressFromImage } from '@/lib/imageReader'
import type { ReadAddressFromImageResult } from '@/lib/imageReader'
import { debugWarn } from '@/lib/debug'
import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { gatewayBatchTip, gatewayWithdraw } from '@/lib/gatewayMetamask'
import {
  agentTip,
  isAutonomousEnabled,
  logAutoTipError,
  logAutoTipFallback,
  logAutoTipResult,
  logAutoTipStart,
} from '@/lib/agentBackend'
import { canTip, formatTipBudgetAmount, getBudgetState, recordTip } from '@/lib/tipBudget'
import {
  addReminder,
  buildReminderFromAction,
  getReminderScheduleLabel,
  type Reminder,
} from '@/lib/reminders'
import {
  PENDING_SEND_STORAGE_KEY,
  PENDING_VIEW_STORAGE_KEY,
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
  onstart: (() => void) | null
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike

type VoiceInputFeedbackTone = 'info' | 'warning' | 'error'

type VoiceInputFeedback = {
  message: string
  tone: VoiceInputFeedbackTone
}

type VoiceInputContext = {
  isFullPage: boolean
  autoStart: boolean
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructorLike
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike
}

const QUICK_SUGGESTION_KEYS = [
  'gogo.quickSuggestionBalance',
  'gogo.quickSuggestionSummary',
  'gogo.quickSuggestionPatterns',
  'gogo.quickSuggestionAddress',
] as const

function getQuickSuggestions(): Array<{ key: string; label: string }> {
  return QUICK_SUGGESTION_KEYS.map((key) => ({
    key,
    label: t(key),
  }))
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

function getSpeechRecognitionCtor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function getVoiceInputContext(): VoiceInputContext {
  if (typeof window === 'undefined') {
    return {
      isFullPage: false,
      autoStart: false,
    }
  }

  const params = new URLSearchParams(window.location.search)
  return {
    isFullPage: params.get('fullpage') === '1',
    autoStart: params.get('voice') === '1',
  }
}

function getPreferredSpeechLanguage(): string {
  return getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US'
}

function normalizeVoiceRecognitionError(error: unknown): string {
  if (typeof error === 'string') {
    return error.toLowerCase()
  }

  if (error && typeof error === 'object') {
    const candidate = (error as { error?: unknown; name?: unknown; message?: unknown }).error
      ?? (error as { name?: unknown }).name
      ?? (error as { message?: unknown }).message

    if (typeof candidate === 'string') {
      return candidate.toLowerCase()
    }
  }

  return ''
}

function getVoiceRecognitionErrorFeedback(error: unknown): VoiceInputFeedback {
  const normalized = normalizeVoiceRecognitionError(error)

  if (
    normalized.includes('not-allowed')
    || normalized.includes('permission')
    || normalized.includes('notallowed')
    || normalized.includes('service-not-allowed')
  ) {
    return {
      message: t('gogo.microphonePermissionDenied'),
      tone: 'error',
    }
  }

  if (normalized === 'no-speech' || normalized === 'audio-capture') {
    return {
      message: t('gogo.voiceTryAgain'),
      tone: 'warning',
    }
  }

  return {
    message: t('gogo.voiceNotAvailable'),
    tone: 'error',
  }
}

function getVoiceFeedbackClassName(tone: VoiceInputFeedbackTone): string {
  switch (tone) {
    case 'warning':
      return 'border-arc-border bg-arc-card text-arc-text-dim'
    case 'error':
      return 'border-arc-borderEmphasis bg-arc-card text-arc-text-dim'
    case 'info':
    default:
      return 'border-white/25 bg-white/10 text-white'
  }
}

function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function getActionLabel(action?: GogoAction | null): string {
  switch (action?.type) {
    case 'send':
      return t('gogo.openSend')
    case 'tip_creator':
      return t('gogo.tipCreator')
    case 'gateway_tip':
      return t('gogo.gatewayTip')
    case 'gateway_batch_tip':
      return t('gogo.gatewayBatchTip')
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
    case 'open_settings':
      return t('gogo.openSettings')
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
    case 'send':
      return t('gogo.working')
    case 'tip_creator':
      return t('gogo.preparingTip')
    case 'gateway_tip':
      return t('gogo.preparingGatewayTip')
    case 'gateway_batch_tip':
      return t('gogo.preparingGatewayBatchTip')
    default:
      return t('gogo.working')
  }
}

function getCompletedActionLabel(action?: GogoAction | null): string {
  if (action?.type === 'create_reminder') {
    return t('gogo.reminderSet')
  }

  if (action?.type === 'send') {
    if (action.params?.autonomous) return t('gogo.sentAutonomously')
    return action.params?.txHash ? t('send.confirmed') : t('gogo.done')
  }

  if (action?.type === 'tip_creator') {
    if (action.params?.autonomous) return t('gogo.sentAutonomously')
    if (action.params?.txHash) return t('gogo.done')
    return action.params?.prepared ? t('gogo.tipPrepared') : t('gogo.done')
  }

  if (action?.type === 'gateway_tip') {
    if (action.params?.autonomous) return t('gogo.sentAutonomously')
    return action.params?.txHash ? t('gogo.gatewayTipSent') : t('gogo.done')
  }

  if (action?.type === 'gateway_batch_tip') {
    if (action.params?.autonomous) return t('gogo.sentAutonomously')
    const { paidCount } = getGatewayBatchTipStats(action)
    return formatText('gogo.gatewayBatchPaidCreators', { count: paidCount })
  }

  if (action?.type === 'open_settings') {
    return t('gogo.settingsOpened')
  }

  return t('gogo.done')
}

function getActionTransferResult(action?: GogoAction | null): { txHash: string; explorerUrl: string; autonomous: boolean } {
  const params = (action?.params ?? {}) as Record<string, unknown>
  const txHash = typeof params.txHash === 'string' ? params.txHash.trim() : ''
  const explorerUrl = typeof params.explorerUrl === 'string' && params.explorerUrl.trim()
    ? params.explorerUrl.trim()
    : EXPLORER_URL
  const autonomous = params.autonomous === true

  return {
    txHash,
    explorerUrl,
    autonomous,
  }
}

function getRiskTone(analysis: AddressAnalysis): 'contract' | 'unknown' | 'empty' | 'normal' {
  if (analysis.isContract) return 'contract'
  if (!analysis.dataComplete) return 'unknown'
  if (analysis.isKnownNewAddress || analysis.hasActivity === false) return 'empty'
  return 'normal'
}

function formatAddressTxCount(txCount: number | null | undefined): string {
  return txCount == null ? '—' : String(txCount)
}

function getAddressActivityStatusLabel(analysis: AddressAnalysis): string {
  if (analysis.isContract) return t('gogo.contract')
  if (!analysis.dataComplete) return t('gogo.dataUnavailable')
  if (analysis.isKnownNewAddress || analysis.hasActivity === false || analysis.txCount === 0) {
    return t('gogo.addressRiskNewOrEmpty')
  }
  return t('gogo.activityDetected')
}

function getRiskStyles(tone: 'contract' | 'unknown' | 'empty' | 'normal') {
  switch (tone) {
    case 'contract':
      return {
        card: 'border-arc-borderEmphasis bg-arc-card',
        badge: 'border-arc-borderEmphasis bg-arc-elevated text-arc-text-dim',
        accent: 'text-arc-text-dim',
      }
    case 'unknown':
      return {
        card: 'border-arc-border bg-arc-card',
        badge: 'border-arc-border bg-arc-elevated text-arc-text-dim',
        accent: 'text-arc-text-dim',
      }
    case 'empty':
      return {
        card: 'border-arc-border bg-arc-card',
        badge: 'border-arc-border bg-arc-elevated text-arc-text-dim',
        accent: 'text-arc-text-dim',
      }
    case 'normal':
    default:
      return {
        card: 'border-arc-success/20 bg-arc-success/10',
        badge: 'border-arc-success/20 bg-arc-success/10 text-arc-success',
        accent: 'text-arc-success',
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

function normalizeUsdcAmountText(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''

  const withoutCurrency = trimmed.replace(/\s*USDC$/i, '').trim()
  if (/^\d+,\d{1,6}$/.test(withoutCurrency) && !withoutCurrency.includes('.')) {
    return withoutCurrency.replace(',', '.')
  }

  return withoutCurrency
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
        card: 'border-arc-border bg-arc-card',
        badge: 'border-arc-border bg-arc-elevated text-arc-text-dim',
        accent: 'text-arc-text-dim',
      }
    case 'positive':
      return {
        card: 'border-arc-success/20 bg-arc-success/10',
        badge: 'border-arc-success/20 bg-arc-success/10 text-arc-success',
        accent: 'text-arc-success',
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

function getSpendingLabel(tone: 'negative' | 'neutral' | 'positive'): string {
  switch (tone) {
    case 'negative':
      return t('gogo.netSpend')
    case 'positive':
      return t('gogo.netGain')
    case 'neutral':
    default:
      return t('gogo.breakEven')
  }
}

function getRiskLabel(analysis: AddressAnalysis): string {
  const tone = getRiskTone(analysis)

  switch (tone) {
    case 'contract':
      return t('gogo.highRisk')
    case 'unknown':
      return t('gogo.dataUnavailable')
    case 'empty':
      return t('gogo.addressRiskNewOrEmpty')
    case 'normal':
    default:
      return formatText('gogo.normalWalletWithTransactions', { count: analysis.txCount ?? 0 })
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
    case 'tip_creator': {
      const handle = typeof params.handle === 'string' ? params.handle.trim() : ''
      const amount = typeof params.amount === 'string' ? params.amount.trim() : ''
      const amountLabel = amount ? formatUsdcAmount(amount) : t('common.usdc')
      const normalizedHandle = normalizeCreatorHandle(handle)
      return formatText('gogo.tipCreatorTitle', {
        handle: normalizedHandle ? `@${normalizedHandle}` : t('gogo.tipCreator'),
        amount: amountLabel,
      })
    }
    case 'gateway_tip': {
      const handle = typeof params.handle === 'string' ? params.handle.trim() : ''
      const recipientValue = typeof params.recipient === 'string' ? params.recipient : undefined
      const amount = typeof params.amount === 'string' ? params.amount.trim() : ''
      const amountLabel = amount ? formatUsdcAmount(amount) : t('common.usdc')
      const normalizedHandle = normalizeCreatorHandle(handle)
      return formatText('gogo.gatewayTipTitle', {
        handle: normalizedHandle
          ? `@${normalizedHandle}`
          : recipientValue
            ? getRecipientDisplayName(recipientValue, resolveAddress, addressMemories)
            : t('gogo.gatewayTip'),
        amount: amountLabel,
      })
    }
    case 'gateway_batch_tip': {
      const recipients = Array.isArray(params.recipients) ? params.recipients : []
      const amounts = recipients
        .map((recipient) => (typeof recipient?.amount === 'string' ? normalizeUsdcAmountText(recipient.amount) : ''))
        .filter((amount): amount is string => Boolean(amount))
      const uniqueAmounts = new Set(amounts)

      if (uniqueAmounts.size > 1) {
        const totalAmount = recipients.reduce((sum, recipient) => sum + Number(normalizeUsdcAmountText(typeof recipient?.amount === 'string' ? recipient.amount : '') || 0), 0)
        return formatText('gogo.gatewayBatchTipPlanTitle', {
          count: recipients.length,
          total: formatUsdcAmount(totalAmount),
        })
      }

      const amount = amounts[0] ?? ''
      const amountLabel = amount ? formatUsdcAmount(amount) : t('common.usdc')
      return formatText('gogo.gatewayBatchTipTitle', {
        amount: amountLabel,
        count: recipients.length,
      })
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
    case 'open_settings':
      return t('gogo.openSettings')
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

function getGatewayBatchTipStats(action?: GogoAction | null): {
  recipients: GatewayBatchTipRecipientAction[]
  paidCount: number
  failedCount: number
  totalSentAmount: string
  totalRequestedAmount: string
} {
  if (!action || action.type !== 'gateway_batch_tip') {
    return {
      recipients: [],
      paidCount: 0,
      failedCount: 0,
      totalSentAmount: '0',
      totalRequestedAmount: '0',
    }
  }

  const recipients = Array.isArray(action.params?.recipients) ? action.params.recipients : []
  const paidRecipients = recipients.filter((recipient) => Boolean(recipient.txHash))
  const failedCount = recipients.filter((recipient) => Boolean(recipient.error)).length
  const totalRequestedAmount = typeof action.params.totalRequestedAmount === 'string' && action.params.totalRequestedAmount.trim()
    ? action.params.totalRequestedAmount.trim()
    : recipients.reduce((sum, recipient) => sum + Number(recipient.amount || 0), 0).toString()
  const totalSentAmount = typeof action.params.totalSentAmount === 'string' && action.params.totalSentAmount.trim()
    ? action.params.totalSentAmount.trim()
    : paidRecipients.reduce((sum, recipient) => sum + Number(recipient.amount || 0), 0).toString()

  return {
    recipients,
    paidCount: typeof action.params.paidCount === 'number' ? action.params.paidCount : paidRecipients.length,
    failedCount,
    totalSentAmount,
    totalRequestedAmount,
  }
}

async function persistPendingSend(recipient?: string, amount?: string, tipHandle?: string): Promise<void> {
  await chromeStorageSet({
    [PENDING_SEND_STORAGE_KEY]: {
      recipient,
      amount,
      tipHandle,
      ts: Date.now(),
    },
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

  if (result.qrDecoderLoadFailed) {
    return t('gogo.imageDecoderLoadFailed')
  }

  if (result.source === 'none') {
    return t('gogo.imageNeedsGemini')
  }

  return t('gogo.imageNotFound')
}

function sanitizeSpeechText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderMessageContent(content: string): ReactNode {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = linkPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    const label = match[1] ?? match[0]
    const href = match[2] ?? ''

    parts.push(
      <a
        key={`${match.index}-${href}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-arc-accent underline decoration-arc-accent/30 underline-offset-2 hover:decoration-arc-accent"
      >
        {label}
      </a>,
    )

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length > 0 ? <>{parts}</> : content
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
  const [voiceResponsesEnabled, setVoiceResponsesEnabled] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceInputUnavailableReason, setVoiceInputUnavailableReason] = useState<string | null>(null)
  const [voiceInputFeedback, setVoiceInputFeedback] = useState<VoiceInputFeedback | null>(null)
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

  const voiceInputContext = useMemo(getVoiceInputContext, [])

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
  const voiceInputTooltip = voiceInputContext.isFullPage
    ? (voiceInputUnavailableReason ?? t('gogo.startListening'))
    : t('gogo.openingVoiceMode')
  const voiceResponsesTooltip = !voiceResponsesEnabled
    ? t('gogo.voiceResponsesSettings')
    : t('gogo.voiceNotAvailable')
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
          <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.2s]" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-arc-text">{t('gogo.imageReading')}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.2s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.1s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-arc-accent" />
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
    let active = true

    void chromeStorageGet([VOICE_RESPONSES_STORAGE_KEY]).then((result) => {
      if (!active) return
      setVoiceResponsesEnabled(result[VOICE_RESPONSES_STORAGE_KEY] === true)
    })

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return
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
    if (!voiceInputContext.isFullPage || !voiceInputContext.autoStart) return

    const timer = window.setTimeout(() => {
      void startVoiceInput()
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [voiceInputContext.autoStart, voiceInputContext.isFullPage])

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
    setVoiceInputFeedback(null)
    setVoiceInputUnavailableReason(null)
  }

  const stopVoiceResponse = () => {
    if (!speechSynthesisSupported) return
    window.speechSynthesis.cancel()
    setSpeakingMessageKey(null)
  }

  const openVoiceModeTab = async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL || !chrome.tabs?.create) {
      debugWarn('[GogoAI] failed to open voice mode tab: chrome tabs API unavailable')
      const message = t('gogo.voiceNotAvailable')
      setVoiceInputUnavailableReason(message)
      setVoiceInputFeedback({ message, tone: 'error' })
      return
    }

    try {
      await chromeStorageSet({ [PENDING_VIEW_STORAGE_KEY]: 'gogo-ai' })
    } catch (error) {
      debugWarn('[GogoAI] failed to persist pending Gogo view:', error)
    }

    const voiceUrl = new URL(chrome.runtime.getURL('src/popup/index.html'))
    voiceUrl.searchParams.set('fullpage', '1')
    voiceUrl.searchParams.set('voice', '1')

    chrome.tabs.create({ url: voiceUrl.toString() })
  }

  const startVoiceInput = () => {
    if (!voiceInputContext.isFullPage) {
      void openVoiceModeTab()
      return
    }

    if (!speechRecognitionSupported) {
      const message = t('gogo.voiceNotAvailable')
      debugWarn('[GogoAI] voice input unavailable: SpeechRecognition is not supported in this context')
      setVoiceInputUnavailableReason(message)
      setVoiceInputFeedback({ message, tone: 'error' })
      return
    }

    const RecognitionCtor = getSpeechRecognitionCtor()
    if (!RecognitionCtor) {
      const message = t('gogo.voiceNotAvailable')
      debugWarn('[GogoAI] voice input unavailable: SpeechRecognition constructor missing')
      setVoiceInputUnavailableReason(message)
      setVoiceInputFeedback({ message, tone: 'error' })
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
      setVoiceInputFeedback({ message: t('gogo.openingVoiceMode'), tone: 'info' })
      setIsListening(false)

      recognition.onstart = () => {
        setIsListening(true)
        setVoiceInputFeedback({ message: t('gogo.listening'), tone: 'info' })
      }

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
        const normalizedError = normalizeVoiceRecognitionError(event?.error ?? event)
        if (normalizedError === 'aborted') {
          setIsListening(false)
          recognitionRef.current = null
          setVoiceInputFeedback((current) => (current?.tone === 'info' ? null : current))
          return
        }

        const feedback = getVoiceRecognitionErrorFeedback(event?.error ?? event)
        debugWarn('[GogoAI] voice input error:', event?.error ?? event)
        setVoiceInputUnavailableReason(feedback.message)
        setVoiceInputFeedback(feedback)
        setIsListening(false)
        recognitionRef.current = null
      }

      recognition.onend = () => {
        setIsListening(false)
        recognitionRef.current = null
        setVoiceInputFeedback((current) => (current?.tone === 'info' ? null : current))
      }

      recognition.start()
    } catch (error) {
      debugWarn('[GogoAI] failed to start voice input:', error)
      const feedback = getVoiceRecognitionErrorFeedback(error)
      setVoiceInputUnavailableReason(feedback.message)
      setVoiceInputFeedback(feedback)
      setIsListening(false)
      recognitionRef.current = null
    }
  }

  const toggleVoiceInput = () => {
    if (!voiceInputContext.isFullPage) {
      void openVoiceModeTab()
      return
    }

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
    const riskLabel = analysis ? getRiskLabel(analysis) : ''
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
            <span className="rounded-full border border-arc-accent/30 bg-arc-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-accent">
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
              <Loader2 size={18} className="animate-spin text-arc-accent" />
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
                <p className="mt-2 text-xs text-arc-text-dim">
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
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-arc-accent hover:underline"
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

  const renderGatewayBatchTipCard = (
    action: GogoAction | null | undefined,
    isUser: boolean,
    isActionLoading: boolean,
  ) => {
    if (!action || action.type !== 'gateway_batch_tip') return null
    if (!action.completed && !isActionLoading) return null

    const { recipients, paidCount, failedCount, totalSentAmount } = getGatewayBatchTipStats(action)
    const hasPartialFailure = failedCount > 0
    const isAutonomousBatch = recipients.some((recipient) => recipient.autonomous)
    const batchAmount = typeof recipients[0]?.amount === 'string' ? recipients[0].amount : ''

    return (
      <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
        <Card className="border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10">
          {isActionLoading ? (
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-arc-accent" />
              <div>
                <p className="text-sm font-medium text-arc-text">{t('gogo.preparingGatewayBatchTip')}</p>
                <p className="text-xs text-arc-text-dim">
                  {formatText('gogo.gatewayBatchTipTitle', {
                    amount: batchAmount ? formatUsdcAmount(batchAmount) : t('common.usdc'),
                    count: recipients.length,
                  })}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                    {t('gogo.gatewayBatchSummaryTitle')}
                  </p>
                  <h4 className="mt-1 text-base font-semibold text-arc-text">
                    {formatText('gogo.gatewayBatchPaidCreators', { count: paidCount })}
                  </h4>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${isAutonomousBatch ? 'border-arc-success/20 bg-arc-success/10 text-arc-success' : 'border-arc-border bg-arc-elevated text-arc-text-dim'}`}>
                  {isAutonomousBatch ? t('gogo.sentAutonomously') : 'ArcScan'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">
                    {t('gogo.gatewayBatchTotalSent')}
                  </p>
                  <p className="mt-1 text-sm font-medium text-arc-text">
                    {formatUsdcAmount(totalSentAmount)}
                  </p>
                </div>
                <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">
                    {t('gogo.gatewayBatchCreatorsPaid')}
                  </p>
                  <p className="mt-1 text-sm font-medium text-arc-text">
                    {paidCount}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-arc-border bg-arc-bg/60">
                <div className="grid grid-cols-[1.4fr_0.8fr_1fr] gap-2 border-b border-arc-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">
                  <span>{t('gogo.gatewayBatchCreator')}</span>
                  <span className="text-right">{t('gogo.gatewayBatchAmount')}</span>
                  <span className="text-right">{t('gogo.gatewayBatchStatus')}</span>
                </div>
                <div className="space-y-2 p-2">
                  {recipients.map((recipient, recipientIndex) => {
                    const txHash = recipient.txHash?.trim() ?? ''
                    const explorerUrl = recipient.explorerUrl?.trim() || EXPLORER_URL
                    const handleLabel = recipient.handle ? `@${recipient.handle}` : formatAddress(recipient.address, 4)
                    const statusLabel = txHash
                      ? (recipient.autonomous ? t('gogo.sentAutonomously') : t('gogo.gatewayBatchPaid'))
                      : t('gogo.gatewayBatchFailed')
                    const statusClassName = txHash
                      ? 'border-arc-success/20 bg-arc-success/10 text-arc-success'
                      : 'border-arc-danger/20 bg-arc-danger/10 text-arc-danger'
                    const explorerHref = txHash
                      ? recipient.autonomous
                        ? explorerUrl
                        : `${explorerUrl}/tx/${txHash}`
                      : ''

                    return (
                      <div key={`${recipient.handle}-${recipient.address}-${recipientIndex}`} className="rounded-xl border border-arc-border bg-arc-card px-3 py-2">
                        <div className="grid grid-cols-[1.4fr_0.8fr_1fr] items-start gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-arc-text">
                              {handleLabel}
                            </p>
                            <p className="mt-0.5 text-[11px] text-arc-text-dim">
                              {formatAddress(recipient.address, 4)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-arc-text">
                              {formatUsdcAmount(recipient.amount)}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 text-right">
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusClassName}`}>
                              {statusLabel}
                            </span>
                            {txHash ? (
                              <a
                                href={explorerHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-arc-accent hover:underline"
                              >
                                {shortenTxHash(txHash)}
                                <ExternalLink size={10} />
                              </a>
                            ) : null}
                          </div>
                        </div>

                        {recipient.error && (
                          <p className="mt-2 text-xs text-arc-danger">
                            {recipient.error}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {hasPartialFailure && (
                <p className="mt-3 text-xs text-arc-text-dim">
                  {t('gogo.gatewayBatchPartialFailureNote')}
                </p>
              )}
            </>
          )}
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

    const utterance = new SpeechSynthesisUtterance(sanitizeSpeechText(text))
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

      const autonomousEnabled = await isAutonomousEnabled()
      const primaryAction = assistantMessage.action
      if (
        autonomousEnabled &&
        primaryAction &&
        (primaryAction.type === 'send' || primaryAction.type === 'tip_creator' || primaryAction.type === 'gateway_tip' || primaryAction.type === 'gateway_batch_tip')
      ) {
        const messageIndex = finalMessages.length - 1
        const actionKey = `${assistantMessage.timestamp}-${messageIndex}`
        void handleAction(messageIndex, 0, primaryAction, actionKey)
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('gogo.couldNotReach')
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
    if ((action.type === 'analyze_address' || action.type === 'summarize_activity' || action.type === 'create_reminder' || action.type === 'send' || action.type === 'tip_creator' || action.type === 'gateway_tip' || action.type === 'gateway_batch_tip') && analysisLoadingKey === messageKey) return

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
        let autonomousEnabled = false

        try {
          const recipientInput = typeof action.params?.recipient === 'string' ? action.params.recipient.trim() : ''
          const resolvedRecipient = recipientInput ? resolveAddress(recipientInput) : null
          const recipientInvalid = Boolean(recipientInput) && (!resolvedRecipient || !isValidAddress(resolvedRecipient))
          const amountInput = normalizeUsdcAmountText(typeof action.params?.amount === 'string' ? action.params.amount : '')
          const amountValidation = amountInput ? isValidAmount(amountInput, balance) : { valid: true, overBalance: false, amountMicros: null }
          const amountInvalid = Boolean(amountInput) && !amountValidation.valid
          const amountOverBalance = Boolean(amountInput) && amountValidation.valid && amountValidation.overBalance
          const warning = buildSendValidationWarning({
            recipientInvalid,
            amountInvalid,
            amountOverBalance,
          })

          const recipientToPersist = resolvedRecipient && isValidAddress(resolvedRecipient) ? resolvedRecipient : undefined
          const amountToPersist = amountInput || undefined
          const tipHandle = recipientToPersist ? await findCreatorHandleByAddress(recipientToPersist) : null
          autonomousEnabled = await isAutonomousEnabled()
          logAutoTipStart('GogoAI.handleAction.send', autonomousEnabled, recipientToPersist ?? '', amountToPersist ?? '')

          if (recipientInvalid || amountInvalid || (!autonomousEnabled && amountOverBalance)) {
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
            break
          }

          if (autonomousEnabled && recipientToPersist && amountToPersist) {
            setAnalysisLoadingKey(messageKey)

            const autonomousResult = await agentTip(recipientToPersist ?? '', amountToPersist ?? '')
            logAutoTipResult(autonomousResult.state)

            const recipientLabel = tipHandle
              ? `@${tipHandle}`
              : getRecipientDisplayName(recipientToPersist, resolveAddress, addressMemories)

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'send'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                        ...currentAction.params,
                        recipient: recipientToPersist || currentAction.params.recipient,
                        amount: amountToPersist || currentAction.params.amount,
                        txHash: autonomousResult.txHash,
                        explorerUrl: autonomousResult.arcscanUrl,
                        autonomous: true,
                      },
                    }
                  : currentAction,
              (message) => ({
                ...message,
                content: `${formatText('gogo.autonomousGatewayTipSuccess', {
                  handle: recipientLabel,
                  amount: amountToPersist,
                })}\n${autonomousResult.txHash}\n${autonomousResult.arcscanUrl}`,
              }),
            )

            if (tipHandle) {
              await recordTip(tipHandle, amountToPersist ?? amountInput).catch((recordError) => {
                debugWarn('[GogoAI] send tip budget record failed:', recordError)
              })
            }
          } else {
            if (autonomousEnabled) {
              logAutoTipFallback('GogoAI.handleAction.send.openSend')
            }

            updateMessageAction(messageIndex, actionIndex, (currentAction) => ({
              ...currentAction,
              completed: true,
            }))

            if (!recipientToPersist && !amountToPersist) {
              break
            }

            await persistPendingSend(recipientToPersist, amountToPersist, tipHandle ?? undefined)
            setCurrentView('send')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : t('settings.agentBackendUnreachable')
          if (autonomousEnabled) {
            logAutoTipError(message)
          }

          updateMessageAction(
            messageIndex,
            actionIndex,
            (currentAction) => ({
              ...currentAction,
              completed: true,
            }),
            (messageNode) => ({
              ...messageNode,
              content: message || t('send.failedToSend'),
            }),
          )
        } finally {
          if (autonomousEnabled) {
            setAnalysisLoadingKey(null)
          }
        }
        break
      }
      case 'open_settings': {
        updateMessageAction(
          messageIndex,
          actionIndex,
          (currentAction) => ({
            ...currentAction,
            completed: true,
          }),
        )
        setCurrentView('settings')
        break
      }
      case 'tip_creator': {
        let autonomousEnabled = false

        try {
          const handleInput = typeof action.params?.handle === 'string' ? action.params.handle.trim() : ''
          const handle = normalizeCreatorHandle(handleInput)
          const amountInput = normalizeUsdcAmountText(typeof action.params?.amount === 'string' ? action.params.amount : '')

          const creatorWallet = handle ? await getCreatorWallet(handle) : null
          const recipientInvalid = !creatorWallet || !isValidAddress(creatorWallet)
          const creatorHandleLabel = handle ? `@${handle}` : t('gogo.tipCreator')

          if (recipientInvalid) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: formatText('gogo.creatorNotFoundReply', { handle: creatorHandleLabel }),
              }),
            )
            break
          }

          if (!amountInput) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: t('gogo.tipBudgetNeedAmount'),
              }),
            )
            break
          }

          const amountValidation = isValidAmount(amountInput, balance)
          const amountInvalid = !amountValidation.valid
          const amountOverBalance = amountValidation.valid && amountValidation.overBalance
          const warning = buildSendValidationWarning({
            recipientInvalid,
            amountInvalid,
            amountOverBalance,
          })
          autonomousEnabled = await isAutonomousEnabled()

          if (amountInvalid || (!autonomousEnabled && amountOverBalance)) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: warning || t('gogo.invalidAmount'),
              }),
            )
            break
          }

          const budgetState = await getBudgetState()
          const budgetDecision = await canTip(amountInput)
          if (!budgetDecision.allowed) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: formatText('gogo.tipBudgetOver', {
                  limit: formatTipBudgetAmount(budgetState.dailyLimitUsdc),
                  remaining: formatTipBudgetAmount(budgetDecision.remaining),
                }),
              }),
            )
            break
          }

          const recipientToPersist = creatorWallet && isValidAddress(creatorWallet) ? creatorWallet : undefined
          const amountToPersist = amountInput || undefined

          autonomousEnabled = await isAutonomousEnabled()
          logAutoTipStart('GogoAI.handleAction.tip_creator', autonomousEnabled, recipientToPersist ?? '', amountToPersist ?? '')
          if (autonomousEnabled && recipientToPersist && amountToPersist) {
            setAnalysisLoadingKey(messageKey)

            const autonomousResult = await agentTip(recipientToPersist ?? '', amountToPersist ?? '')
            logAutoTipResult(autonomousResult.state)

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'tip_creator'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                        ...currentAction.params,
                        handle,
                        amount: amountToPersist || currentAction.params.amount,
                        recipient: recipientToPersist || currentAction.params.recipient,
                        prepared: true,
                        autonomous: true,
                        txHash: autonomousResult.txHash,
                        explorerUrl: autonomousResult.arcscanUrl,
                      },
                    }
                  : currentAction,
              (message) => ({
                ...message,
                content: `${formatText('gogo.autonomousGatewayTipSuccess', {
                  handle: creatorHandleLabel,
                  amount: amountToPersist,
                })}\n${autonomousResult.txHash}\n${autonomousResult.arcscanUrl}`,
              }),
            )

            await recordTip(handle, amountToPersist ?? amountInput).catch((recordError) => {
              debugWarn('[GogoAI] tip_creator autonomous budget record failed:', recordError)
            })
          } else {
            if (autonomousEnabled) {
              logAutoTipFallback('GogoAI.handleAction.tip_creator.openSend')
            }

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'tip_creator'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                        ...currentAction.params,
                        handle,
                        amount: amountToPersist || currentAction.params.amount,
                        recipient: recipientToPersist || currentAction.params.recipient,
                        prepared: true,
                      },
                    }
                  : currentAction,
            )

            await persistPendingSend(recipientToPersist, amountToPersist, handle)
            setCurrentView('send')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : t('settings.agentBackendUnreachable')
          if (autonomousEnabled) {
            logAutoTipError(message)
          }

          updateMessageAction(
            messageIndex,
            actionIndex,
            (currentAction) => ({
              ...currentAction,
              completed: true,
            }),
            (messageNode) => ({
              ...messageNode,
              content: message || t('send.failedToSend'),
            }),
          )
        } finally {
          if (autonomousEnabled) {
            setAnalysisLoadingKey(null)
          }
        }
        break
      }
      case 'gateway_tip': {
        let autonomousEnabled = false

        try {
          const handleInput = typeof action.params?.handle === 'string' ? action.params.handle.trim() : ''
          const handle = normalizeCreatorHandle(handleInput)
          const recipientInput = typeof action.params?.recipient === 'string' ? action.params.recipient.trim().toLowerCase() : ''
          const amountInput = normalizeUsdcAmountText(typeof action.params?.amount === 'string' ? action.params.amount : '')
          const destinationDomain = typeof action.params?.destinationDomain === 'number'
            ? action.params.destinationDomain
            : 26

          const creatorWallet = handle ? await getCreatorWallet(handle) : null
          const recipientToPersist = recipientInput || creatorWallet || undefined
          const resolvedHandle = handle || (recipientToPersist ? await findCreatorHandleByAddress(recipientToPersist) : '')
          const creatorHandleLabel = resolvedHandle
            ? `@${resolvedHandle}`
            : recipientToPersist
              ? getRecipientDisplayName(recipientToPersist, resolveAddress, addressMemories)
              : t('gogo.gatewayTip')

          if (!recipientToPersist || !isValidAddress(recipientToPersist)) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: resolvedHandle
                  ? formatText('gogo.creatorNotFoundReply', { handle: creatorHandleLabel })
                  : t('gogo.invalidAddress'),
              }),
            )
            break
          }

          if (!amountInput) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: t('gogo.tipBudgetNeedAmount'),
              }),
            )
            break
          }

          const amountValidation = isValidAmount(amountInput, balance)
          const amountInvalid = !amountValidation.valid
          const amountOverBalance = amountValidation.valid && amountValidation.overBalance
          const warning = buildSendValidationWarning({
            recipientInvalid: false,
            amountInvalid,
            amountOverBalance,
          })
          autonomousEnabled = await isAutonomousEnabled()

          if (amountInvalid || (!autonomousEnabled && amountOverBalance)) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: warning || t('gogo.invalidAmount'),
              }),
            )
            break
          }

          const amountToPersist = amountInput || undefined
          logAutoTipStart('GogoAI.handleAction.gateway_tip', autonomousEnabled, recipientToPersist ?? '', amountToPersist ?? '')

          if (autonomousEnabled) {
            setAnalysisLoadingKey(messageKey)

            const autonomousResult = await agentTip(recipientToPersist ?? '', amountToPersist ?? amountInput)
            logAutoTipResult(autonomousResult.state)

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'gateway_tip'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                        ...currentAction.params,
                        handle: resolvedHandle || undefined,
                        amount: amountToPersist || currentAction.params.amount,
                        recipient: recipientToPersist || currentAction.params.recipient,
                        destinationDomain,
                        autonomous: true,
                        txHash: autonomousResult.txHash,
                        explorerUrl: autonomousResult.arcscanUrl,
                      },
                    }
                  : currentAction,
              (message) => ({
                ...message,
                content: `${formatText('gogo.autonomousGatewayTipSuccess', {
                  handle: creatorHandleLabel,
                  amount: amountInput,
                })}\n${autonomousResult.txHash}\n${autonomousResult.arcscanUrl}`,
              }),
            )

            const recordHandle = resolvedHandle || handle
            if (recordHandle) {
              await recordTip(recordHandle, amountInput).catch((recordError) => {
                console.error('[GogoAI] gateway tip autonomous budget record failed:', recordError)
              })
            }
          } else {
            const budgetState = await getBudgetState()
            const budgetDecision = await canTip(amountInput)
            if (!budgetDecision.allowed) {
              updateMessageAction(
                messageIndex,
                actionIndex,
                (currentAction) => ({
                  ...currentAction,
                  completed: true,
                }),
                (message) => ({
                  ...message,
                  content: formatText('gogo.tipBudgetOver', {
                    limit: formatTipBudgetAmount(budgetState.dailyLimitUsdc),
                    remaining: formatTipBudgetAmount(budgetDecision.remaining),
                  }),
                }),
              )
              break
            }

            const gatewayResult = await gatewayWithdraw(
              recipientToPersist,
              amountToPersist ?? amountInput,
              destinationDomain,
            )

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'gateway_tip'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                        ...currentAction.params,
                        handle: resolvedHandle || undefined,
                        amount: amountToPersist || currentAction.params.amount,
                        recipient: recipientToPersist || currentAction.params.recipient,
                        destinationDomain,
                        txHash: gatewayResult.mintTxHash,
                        explorerUrl: gatewayResult.destinationExplorerUrl,
                      },
                    }
                  : currentAction,
              (message) => ({
                ...message,
                content: formatText('gogo.gatewayTipSuccess', {
                  handle: creatorHandleLabel,
                  amount: amountInput,
                }),
              }),
            )

            if (resolvedHandle || handle) {
              await recordTip(resolvedHandle || handle, amountInput).catch((recordError) => {
                console.error('[GogoAI] gateway tip budget record failed:', recordError)
              })
            }
          }
        } catch (error) {
          const rawError = error instanceof Error
            ? error.message
            : autonomousEnabled
              ? t('settings.agentBackendUnreachable')
              : t('gogo.couldNotSendViaGateway')
          const insufficientMatch = rawError.match(/Insufficient available balance\. Have: ([\d.]+), Need: ([\d.]+)/)
          const errorMessage = insufficientMatch
            ? formatText('gogo.gatewayInsufficientBalance', {
                current: insufficientMatch[1] ?? '0',
                needed: insufficientMatch[2] ?? '?',
              })
            : rawError
          if (autonomousEnabled) {
            logAutoTipError(errorMessage)
          }
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
          if (autonomousEnabled) {
            setAnalysisLoadingKey(null)
          }
        }
        break
      }
      case 'gateway_batch_tip': {
        setAnalysisLoadingKey(messageKey)
        let autonomousEnabled = false

        try {
          const recipients = Array.isArray(action.params?.recipients)
            ? action.params.recipients
                .map((recipient) => {
                  const handle = typeof recipient?.handle === 'string' ? normalizeCreatorHandle(recipient.handle) : ''
                  const address = typeof recipient?.address === 'string' ? recipient.address.trim() : ''
                  const amount = normalizeUsdcAmountText(typeof recipient?.amount === 'string' ? recipient.amount : '')

                  if (!handle || !address || !amount) return null

                  return {
                    handle,
                    address,
                    amount,
                  }
                })
                .filter((recipient): recipient is { handle: string; address: string; amount: string } => Boolean(recipient))
            : []

          if (recipients.length === 0) {
            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) => ({
                ...currentAction,
                completed: true,
              }),
              (message) => ({
                ...message,
                content: t('gogo.gatewayBatchEmpty'),
              }),
            )
            break
          }

          autonomousEnabled = await isAutonomousEnabled()
          logAutoTipStart('GogoAI.handleAction.gateway_batch_tip', autonomousEnabled, recipients[0]?.address ?? '', recipients[0]?.amount ?? '')

          if (autonomousEnabled) {
            const nextRecipients: GatewayBatchTipRecipientAction[] = []
            let paidCount = 0
            let failedCount = 0
            let totalSentAmount = 0
            const totalRequestedAmount = recipients.reduce((sum, recipient) => sum + Number(recipient.amount || 0), 0)

            for (const recipient of recipients) {
              try {
                logAutoTipStart('GogoAI.handleAction.gateway_batch_tip', autonomousEnabled, recipient.address, recipient.amount)
                const result = await agentTip(recipient.address, recipient.amount)
                paidCount += 1
                totalSentAmount += Number(recipient.amount)
                nextRecipients.push({
                  ...recipient,
                  txHash: result.txHash,
                  explorerUrl: result.arcscanUrl,
                  autonomous: true,
                })
                await recordTip(recipient.handle, recipient.amount).catch((recordError) => {
                  console.error('[GogoAI] gateway batch tip budget record failed:', recordError)
                })
              } catch (error) {
                failedCount += 1
                nextRecipients.push({
                  ...recipient,
                  error: error instanceof Error
                    ? error.message
                    : t('settings.agentBackendUnreachable'),
                  autonomous: true,
                })
              }
            }

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'gateway_batch_tip'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                      ...currentAction.params,
                      recipients: nextRecipients,
                        totalRequestedAmount: formatTipBudgetAmount(totalRequestedAmount),
                        totalSentAmount: formatTipBudgetAmount(totalSentAmount),
                        paidCount,
                        failedCount,
                        availableBalance: currentAction.params.availableBalance,
                        prepared: true,
                        autonomous: true,
                      },
                    }
                  : currentAction,
              (message) => ({
                ...message,
                content: `${formatText('gogo.autonomousBatchTipSuccess', {
                  count: paidCount,
                  total: formatTipBudgetAmount(totalSentAmount),
                })}${failedCount > 0 ? ` ${t('gogo.gatewayBatchPartialFailureNote')}` : ''}`,
              }),
            )
          } else {
            const gatewayBatchResult = await gatewayBatchTip(recipients)

            updateMessageAction(
              messageIndex,
              actionIndex,
              (currentAction) =>
                currentAction.type === 'gateway_batch_tip'
                  ? {
                      ...currentAction,
                      completed: true,
                      params: {
                        ...currentAction.params,
                        recipients: gatewayBatchResult.recipients,
                        totalRequestedAmount: gatewayBatchResult.totalRequestedAmount,
                        totalSentAmount: gatewayBatchResult.totalSentAmount,
                        paidCount: gatewayBatchResult.paidCount,
                        failedCount: gatewayBatchResult.failedCount,
                        availableBalance: gatewayBatchResult.availableBalance,
                        prepared: true,
                      },
                    }
                  : currentAction,
              (message) => ({
                ...message,
                content: `${formatText('gogo.gatewayBatchTipSuccess', {
                  count: gatewayBatchResult.paidCount,
                  total: gatewayBatchResult.totalSentAmount,
                })}${gatewayBatchResult.failedCount > 0 ? ` ${t('gogo.gatewayBatchPartialFailureNote')}` : ''}`,
              }),
            )

            for (const recipient of gatewayBatchResult.recipients) {
              if (!recipient.txHash) continue
              await recordTip(recipient.handle, recipient.amount).catch((recordError) => {
                console.error('[GogoAI] gateway batch tip budget record failed:', recordError)
              })
            }
          }
        } catch (error) {
          console.error('[GogoAI] gateway batch tip failed:', error)
          const rawError = error instanceof Error
            ? error.message
            : autonomousEnabled
              ? t('settings.agentBackendUnreachable')
              : t('gogo.couldNotSendViaGateway')
          const nextMessages = messagesRef.current.map((message, index) => {
            if (index !== messageIndex) return message
            return {
              ...message,
              content: rawError,
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
          const errorMessage = error instanceof Error ? error.message : t('gogo.couldNotSaveReminder')
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
          const errorMessage = error instanceof Error ? error.message : t('gogo.couldNotSummarizeSpending')
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
      (isAnalyzeAction || isSummaryAction || action.type === 'create_reminder' || action.type === 'send' || action.type === 'tip_creator' || action.type === 'gateway_tip' || action.type === 'gateway_batch_tip'),
    )
    const draftText = draftTweetAction?.params?.text ?? ''
    const draftLength = draftText.length
    const draftKey = `${baseKey}-draft-${actionIndex}`
    const analysis = analyzeAction?.analysis ?? null
    const spendingAnalysis: SpendingAnalysis | null = summaryAction?.analysis ?? null
    const riskTone = analysis ? getRiskTone(analysis) : null
    const riskStyles = riskTone ? getRiskStyles(riskTone) : null
    const riskLabel = analysis ? getRiskLabel(analysis) : ''
    const spendingTone = spendingAnalysis ? getSpendingTone(spendingAnalysis.net) : null
    const spendingStyles = spendingTone ? getSpendingStyles(spendingTone) : null
    const spendingLabel = spendingTone ? getSpendingLabel(spendingTone) : ''
    const actionLoadingLabel = getActionLoadingLabel(action)
    const transferResult = getActionTransferResult(action)
    const transferExplorerLink = transferResult.txHash
      ? transferResult.autonomous
        ? transferResult.explorerUrl
        : `${transferResult.explorerUrl}/tx/${transferResult.txHash}`
      : ''

    return (
      <div
        key={`${baseKey}-step-card-${actionIndex}`}
        className="rounded-2xl border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10"
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
              actionCompleted
                ? 'border-arc-accent/30 bg-arc-accent/10 text-arc-accent'
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="rounded-full border border-arc-border bg-arc-bg/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-text-dim">
                  {getActionLabel(action)}
                </span>
              </div>
            </div>

            {transferResult.txHash && (
              <div className="rounded-xl border border-arc-success/20 bg-arc-success/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                      {t('gogo.txHash')}
                    </p>
                    {transferResult.autonomous && (
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-success">
                        {t('gogo.sentAutonomously')}
                      </p>
                    )}
                    <p className="mt-1 break-all font-mono text-xs text-arc-text">
                      {transferResult.txHash}
                    </p>
                  </div>
                  <a
                    href={transferExplorerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-arc-accent hover:underline"
                  >
                    {t('gogo.viewOnArcScan')}
                    <ExternalLink size={10} />
                  </a>
                </div>
                <p className="mt-2 text-xs text-arc-text-dim">
                  {shortenTxHash(transferResult.txHash)}
                </p>
              </div>
            )}

            {renderGatewayBatchTipCard(action, isUser, isActionLoading)}

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
                    <Loader2 size={18} className="animate-spin text-arc-accent" />
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
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.transactions')}</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">{formatAddressTxCount(analysis.txCount)}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.summary')}</p>
                      <p className="mt-1 text-sm leading-relaxed text-arc-text">{analysis.summary}</p>
                    </div>

                    {analysis.activityPartial && (
                      <p className="mt-2 text-xs text-arc-text-dim">
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
                    <Loader2 size={18} className="animate-spin text-arc-accent" />
                    <div>
                      <p className="text-sm font-medium text-arc-text">{t('gogo.summarizingSpending')}</p>
                      <p className="text-xs text-arc-text-dim">{t('gogo.countingSpendingTransfers')}</p>
                    </div>
                  </div>
                ) : spendingAnalysis && spendingStyles ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">{t('gogo.spendingSummary')}</p>
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
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.sent')}</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">
                          {formatSpendingAmount(spendingAnalysis.totalSent)} USDC
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.received')}</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">
                          {formatSpendingAmount(spendingAnalysis.totalReceived)} USDC
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.net')}</p>
                        <p className={`mt-1 text-sm font-medium ${spendingStyles.accent}`}>
                          {spendingAnalysis.net > 0 ? '+' : spendingAnalysis.net < 0 ? '-' : ''}
                          {formatSpendingAmount(Math.abs(spendingAnalysis.net))} USDC
                        </p>
                      </div>
                      <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.txCount')}</p>
                        <p className="mt-1 text-sm font-medium text-arc-text">{spendingAnalysis.txCount}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.topRecipient')}</p>
                      <p className="mt-1 text-sm leading-relaxed text-arc-text">
                        {spendingAnalysis.topRecipient
                          ? `${spendingAnalysis.topRecipient.label} (${formatSpendingAmount(spendingAnalysis.topRecipient.amount)} USDC)`
                          : t('gogo.noOutgoingTransfers')}
                      </p>
                    </div>

                    <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.summary')}</p>
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
                    ? 'border-arc-accent/30 bg-arc-accent/10 text-arc-accent hover:bg-arc-accent/10'
                    : 'border-arc-accent/20 bg-arc-accent/5 text-arc-accent hover:bg-arc-accent/10'
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
                  t('common.confirm')
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
          <Loader2 size={18} className="animate-spin text-arc-accent" />
          <span className="text-sm">{t('gogo.loading')}</span>
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
            aria-label={t('gogo.back')}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-arc-accent" />
            <div className="flex flex-col">
              <h2 className="text-base font-semibold text-arc-text">{t('gogo.title')}</h2>
              <p className="text-[11px] text-arc-text-dim">{t('gogo.subtitle')}</p>
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
          {t('gogo.clearChat')}
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!hasMessages && hasApiKey && isComposerLocked && (
          <div className="flex h-full items-center justify-center">
            <Card className="w-full max-w-md p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-accent/10">
                  <Sparkles size={22} className="text-arc-accent" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-arc-text">{t('gogo.preparingBriefTitle')}</p>
                  <p className="text-sm text-arc-text-dim">{t('gogo.preparingBriefBody')}</p>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-arc-border bg-arc-bg/50 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.2s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.1s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {!hasMessages && hasApiKey && !isComposerLocked && (
          <div className="flex h-full items-center justify-center">
            <Card className="w-full max-w-md p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-accent/10">
                  <Sparkles size={22} className="text-arc-accent" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-arc-text">{t('gogo.introTitle')}</p>
                  <p className="text-sm text-arc-text-dim">{t('gogo.introBody')}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {getQuickSuggestions().map((suggestion) => (
                  <button
                    key={suggestion.key}
                    onClick={() => handleQuickSuggestion(suggestion.label)}
                    className="rounded-full border border-arc-border bg-arc-bg/60 px-3 py-1.5 text-xs text-arc-text-dim transition-colors hover:border-arc-accent/30 hover:text-arc-text"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>

              <p className="mt-4 text-xs text-arc-text-dim">
                {t('gogo.tryAsking')}
              </p>
            </Card>
          </div>
        )}

        {!hasMessages && !hasApiKey && (
          <div className="flex min-h-full items-center justify-center">
            <Card className="w-full max-w-md p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-arc-accent/10">
                  <Sparkles size={22} className="text-arc-accent" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-arc-text">{t('gogo.noKeyTitle')}</p>
                  <p className="text-sm text-arc-text-dim">{t('gogo.noKeyBody')}</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <Input
                  placeholder={t('gogo.enterGeminiKey')}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  type="password"
                />
                <Button variant="primary" fullWidth onClick={() => void handleSaveKey()}>
                  {t('gogo.saveApiKey')}
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
                  className="inline-flex items-center gap-1.5 text-xs text-arc-accent hover:underline"
                >
                  {t('gogo.getFreeKey')}
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
              const transferResult = getActionTransferResult(action)
              const transferExplorerLink = transferResult.txHash
                ? transferResult.autonomous
                  ? transferResult.explorerUrl
                  : `${transferResult.explorerUrl}/tx/${transferResult.txHash}`
                : ''
              const draftKey = `${message.timestamp}-${index}`
              const actionKey = `${draftKey}-0`
              const analyzeAction = action && action.type === 'analyze_address' ? action : null
              const summaryAction = action && action.type === 'summarize_activity' ? action : null
              const isAnalyzeAction = Boolean(analyzeAction)
              const isSummaryAction = Boolean(summaryAction)
              const actionCompleted = Boolean(action?.completed)
              const isActionLoading = Boolean(action && analysisLoadingKey === actionKey && !action.completed && (analyzeAction || summaryAction || action.type === 'create_reminder' || action.type === 'send' || action.type === 'tip_creator' || action.type === 'gateway_tip' || action.type === 'gateway_batch_tip'))
              const draftText = draftTweet?.params.text ?? ''
              const draftLength = draftText.length
              const analysis = analyzeAction?.analysis ?? null
              const spendingAnalysis: SpendingAnalysis | null = summaryAction?.analysis ?? null
              const riskTone = analysis ? getRiskTone(analysis) : null
              const riskStyles = riskTone ? getRiskStyles(riskTone) : null
              const riskLabel = analysis ? getRiskLabel(analysis) : ''
              const spendingTone = spendingAnalysis ? getSpendingTone(spendingAnalysis.net) : null
              const spendingStyles = spendingTone ? getSpendingStyles(spendingTone) : null
              const spendingLabel = spendingTone ? getSpendingLabel(spendingTone) : ''
              const actionLoadingLabel = action ? getActionLoadingLabel(action) : t('gogo.working')
              const canSpeakMessage = !isUser && !isError && Boolean(message.content.trim())
              const isSpeakingThisMessage = speakingMessageKey === actionKey
              const speechButtonLabel = isSpeakingThisMessage && speechSynthesisSupported ? t('gogo.stopReading') : t('gogo.readAloud')

              return (
                <div key={`${message.timestamp}-${index}`} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-arc-accent text-arc-bg font-medium'
                        : isError
                          ? 'border border-arc-danger/20 bg-arc-danger/10 text-arc-danger'
                          : 'border border-arc-border bg-arc-card text-arc-text'
                    }`}
                  >
                    {renderMessageContent(message.content)}
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
                          isSpeakingThisMessage ? 'border-arc-accent/40 bg-arc-accent/10 text-arc-accent' : ''
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
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className={`h-8 text-[11px] ${
                            actionCompleted
                              ? 'border-arc-accent/30 bg-arc-accent/10 text-arc-accent hover:bg-arc-accent/10'
                              : 'border-arc-accent/20 bg-arc-accent/5 text-arc-accent hover:bg-arc-accent/10'
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
                    </div>
                  )}

                  {renderGatewayBatchTipCard(action, isUser, isActionLoading)}

                  {transferResult.txHash && (
                    <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
                      <div className="rounded-xl border border-arc-success/20 bg-arc-success/10 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                              {t('gogo.txHash')}
                            </p>
                            {transferResult.autonomous && (
                              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-success">
                                {t('gogo.sentAutonomously')}
                              </p>
                            )}
                            <p className="mt-1 break-all font-mono text-xs text-arc-text">
                              {transferResult.txHash}
                            </p>
                          </div>
                          <a
                            href={transferExplorerLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-arc-accent hover:underline"
                          >
                            ArcScan
                            <ExternalLink size={10} />
                          </a>
                        </div>
                        <p className="mt-2 text-xs text-arc-text-dim">
                          {shortenTxHash(transferResult.txHash)}
                        </p>
                      </div>
                    </div>
                  )}

                  {isAnalyzeAction && (
                    <div className={`mt-2 w-full max-w-[88%] ${isUser ? 'ml-auto' : 'mr-auto'}`}>
                      {isActionLoading ? (
                        <Card className="border border-arc-border bg-arc-card p-4 shadow-lg shadow-black/10">
                          <div className="flex items-center gap-3">
                            <Loader2 size={18} className="animate-spin text-arc-accent" />
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
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.transactions')}</p>
                            <p className="mt-1 text-sm font-medium text-arc-text">{formatAddressTxCount(analysis.txCount)}</p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.summary')}</p>
                            <p className="mt-1 text-sm leading-relaxed text-arc-text">{analysis.summary}</p>
                          </div>

                          {analysis.activityPartial && (
                            <p className="mt-2 text-xs text-arc-text-dim">
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
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-arc-accent hover:underline"
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
                            <Loader2 size={18} className="animate-spin text-arc-accent" />
                            <div>
                              <p className="text-sm font-medium text-arc-text">{t('gogo.summarizingSpending')}</p>
                              <p className="text-xs text-arc-text-dim">{t('gogo.countingSpendingTransfers')}</p>
                            </div>
                          </div>
                        </Card>
                      ) : spendingAnalysis && spendingStyles ? (
                        <Card className={`border p-4 shadow-lg shadow-black/10 ${spendingStyles.card}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">{t('gogo.spendingSummary')}</p>
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
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.sent')}</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">
                                {formatSpendingAmount(spendingAnalysis.totalSent)} USDC
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.received')}</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">
                                {formatSpendingAmount(spendingAnalysis.totalReceived)} USDC
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.net')}</p>
                              <p className={`mt-1 text-sm font-medium ${spendingStyles.accent}`}>
                                {spendingAnalysis.net > 0 ? '+' : spendingAnalysis.net < 0 ? '-' : ''}
                                {formatSpendingAmount(Math.abs(spendingAnalysis.net))} USDC
                              </p>
                            </div>
                            <div className="rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.txCount')}</p>
                              <p className="mt-1 text-sm font-medium text-arc-text">{spendingAnalysis.txCount}</p>
                            </div>
                          </div>

                          <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.topRecipient')}</p>
                            <p className="mt-1 text-sm leading-relaxed text-arc-text">
                              {spendingAnalysis.topRecipient
                                ? `${spendingAnalysis.topRecipient.label} (${formatSpendingAmount(spendingAnalysis.topRecipient.amount)} USDC)`
                                : t('gogo.noOutgoingTransfers')}
                            </p>
                          </div>

                          <div className="mt-3 rounded-xl border border-arc-border bg-arc-bg/60 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-arc-text-dim">{t('gogo.summary')}</p>
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
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.2s]" />
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent [animation-delay:-0.1s]" />
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-arc-accent" />
                  </div>
                </div>
              </div>
            )}

            {showStarterSuggestions && (
              <Card className="border border-arc-border/80 bg-arc-card/80 p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-arc-text-dim">
                  {t('gogo.quickSuggestions')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {getQuickSuggestions().map((suggestion) => (
                    <button
                      key={suggestion.key}
                      onClick={() => handleQuickSuggestion(suggestion.label)}
                      className="rounded-full border border-arc-border bg-arc-bg/60 px-3 py-1.5 text-xs text-arc-text-dim transition-colors hover:border-arc-accent/30 hover:text-arc-text"
                    >
                      {suggestion.label}
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
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-arc-accent/10">
                  <Sparkles size={18} className="text-arc-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-arc-text">{t('gogo.addGeminiKey')}</p>
                  <p className="text-xs text-arc-text-dim">{t('gogo.historyStillHere')}</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <Input
                  placeholder={t('gogo.enterGeminiKey')}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  type="password"
                />
                <Button variant="primary" fullWidth onClick={() => void handleSaveKey()}>
                  {t('gogo.saveApiKey')}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {hasApiKey && (
        <div className="border-t border-arc-border bg-arc-bg px-4 py-4">
          {voiceInputFeedback && (
            <div
              className={`mb-2 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-medium ${getVoiceFeedbackClassName(voiceInputFeedback.tone)} ${isListening ? 'animate-pulse' : ''}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {voiceInputFeedback.message}
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
                  className="rounded-lg border border-arc-border bg-arc-card p-2 text-arc-text-dim transition-all hover:border-arc-accent/30 hover:text-arc-text disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t('gogo.imageButtonTooltip')}
                  title={t('gogo.imageButtonTooltip')}
                >
                  <ImageIcon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleVoiceInput()}
                  className={`rounded-lg border p-2 transition-all ${
                    isListening
                      ? 'border-arc-danger/40 bg-arc-danger text-white shadow-lg shadow-arc-danger/20 animate-pulse'
                      : 'border-arc-accent/30 bg-arc-accent/10 text-arc-accent hover:border-arc-accent/50 hover:bg-arc-accent/20'
                  }`}
                  aria-label={voiceInputContext.isFullPage && isListening ? t('gogo.stopListening') : voiceInputTooltip}
                  title={voiceInputContext.isFullPage && isListening ? t('gogo.stopListening') : voiceInputTooltip}
                >
                  <Mic size={15} />
                </button>
              </div>

              <input
                ref={inputRef}
                type="text"
                placeholder={t('gogo.askAnything')}
                className="w-full rounded-xl border border-arc-border bg-arc-card py-3 pl-24 pr-12 text-sm text-arc-text placeholder:text-arc-text-dim transition-colors focus:border-arc-accent/50 focus:outline-none"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                onPaste={handleImagePaste}
                disabled={isComposerLocked || !address}
              />
            </div>
            <button
              type="submit"
              disabled={isComposerLocked || !userInput.trim() || !address}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-arc-accent p-2 text-arc-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('gogo.send')}
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
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-arc-accent/10">
                <Sparkles size={18} className="text-arc-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-arc-text">{t('gogo.setGeminiKey')}</p>
                <p className="text-xs text-arc-text-dim">{t('gogo.conversationSaved')}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Input
                placeholder={t('gogo.enterGeminiKey')}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                type="password"
              />
              <Button variant="primary" fullWidth onClick={() => void handleSaveKey()}>
                {t('gogo.saveApiKey')}
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
                className="inline-flex items-center gap-1.5 text-xs text-arc-accent hover:underline"
              >
                {t('gogo.getFreeKey')}
                <ExternalLink size={10} />
              </a>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
