import { useEffect, useState } from 'react'
import { ArrowLeft, AtSign, Bell, Book, Bot, ChevronRight, Coins, Key, LayoutDashboard, Search, Trash2, Twitter, Users, Volume2 } from 'lucide-react'
import { useRef } from 'react'
import { useStore } from '@/lib/store'
import { getApiKey, clearApiKey, setApiKey as saveGeminiKey } from '@/lib/gogoAI'
import { ARC_CHAIN_ID, ARC_RPC_URL } from '@/lib/constants'
import { debugWarn } from '@/lib/debug'
import {
  DEFAULT_TWITTER_SEARCH_QUERY,
  clearTwitterApiKey,
  getOfficialAccounts,
  getSearchQuery,
  getTwitterApiKey,
  setSearchQuery,
  setOfficialAccounts,
  setTwitterApiKey,
  DEFAULT_TWITTER_OFFICIAL_ACCOUNTS,
} from '@/lib/twitterApi'
import { listCreators, normalizeCreatorHandle, registerCreator, removeCreator, type CreatorEntry } from '@/lib/creatorRegistry'
import { discoverCreators, getUserXHandle, setUserXHandle, type CreatorDiscoveryResult } from '@/lib/creatorDiscovery'
import {
  DEFAULT_AUTO_TIP_RULE,
  calculateAutoTipPlan,
  getAutoTipRule,
  setAutoTipRule as saveAutoTipRule,
  type AutoTipRule,
  type AutoTipWeighting,
} from '@/lib/autoTip'
import {
  CREATORS,
  AGENT_BACKEND_URL,
  AGENT_TOKEN,
  AUTONOMOUS_MODE_ENABLED,
  AUTO_TIP_RULE,
  NOTIF_BALANCE_STORAGE_KEY,
  NOTIF_INCOMING_STORAGE_KEY,
  REMINDERS,
  TIP_BUDGET,
  USER_X_HANDLE,
  VOICE_RESPONSES_STORAGE_KEY,
} from '@/lib/storageKeys'
import {
  DEFAULT_AGENT_BACKEND_URL,
  agentHealth,
  clearAgentToken,
  getAgentBackendConfig,
  setAgentBackendUrl,
  setAgentToken,
  setAutonomousEnabled,
} from '@/lib/agentBackend'
import {
  getReminders,
  getReminderDetails,
  removeReminder,
  type Reminder,
} from '@/lib/reminders'
import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { formatRelativeTime, formatAddress } from '@/lib/utils'
import { formatTipBudgetAmount, getBudgetState, setDailyLimit, type TipBudgetState } from '@/lib/tipBudget'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatText, getLocalePreference, setLocale, t } from '@/lib/i18n'
import { APP_NAME, APP_VERSION } from '@/lib/appMeta'

interface SettingsProps {
  onBack: () => void
}

function readStoredBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function readStoredString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseAutoTipAmount(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  return parsed
}

function getSavedKeyLabel(key: string | null): string {
  if (!key) return t('settings.notSet')
  return formatText('settings.savedMasked', { suffix: key.slice(-4) })
}

function formatDiscoveryCandidatesMessage(candidates: CreatorDiscoveryResult['candidates']): string {
  if (candidates.length === 0) {
    return t('gogo.creatorDiscoveryNoCandidates')
  }

  return `${formatText('gogo.creatorDiscoveryFoundCount', { count: candidates.length })} ${t('gogo.creatorDiscoveryNeedAddress')}`
}

export function Settings({ onBack }: SettingsProps) {
  const setCurrentView = useStore((s) => s.setCurrentView)
  const localePreference = getLocalePreference()
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null)
  const [twitterApiKey, setTwitterApiKeyState] = useState<string | null>(null)
  const [isAddingGemini, setIsAddingGemini] = useState(false)
  const [isAddingTwitter, setIsAddingTwitter] = useState(false)
  const [incomingAlerts, setIncomingAlerts] = useState(true)
  const [balanceAlerts, setBalanceAlerts] = useState(true)
  const [voiceResponsesEnabled, setVoiceResponsesEnabled] = useState(false)
  const [tempKey, setTempKey] = useState('')
  const [twitterTempKey, setTwitterTempKey] = useState('')
  const [twitterSearchQuery, setTwitterSearchQueryState] = useState(DEFAULT_TWITTER_SEARCH_QUERY)
  const [officialAccounts, setOfficialAccountsState] = useState(DEFAULT_TWITTER_OFFICIAL_ACCOUNTS)
  const [userXHandle, setUserXHandleState] = useState('')
  const [isSavingUserXHandle, setIsSavingUserXHandle] = useState(false)
  const [userXHandleError, setUserXHandleError] = useState('')
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [remindersLoading, setRemindersLoading] = useState(true)
  const [creators, setCreators] = useState<CreatorEntry[]>([])
  const [creatorDiscovery, setCreatorDiscovery] = useState<CreatorDiscoveryResult | null>(null)
  const [isDiscoveringCreators, setIsDiscoveringCreators] = useState(false)
  const [creatorPrompt, setCreatorPrompt] = useState('')
  const [tipBudget, setTipBudget] = useState<TipBudgetState | null>(null)
  const [tipBudgetLimitInput, setTipBudgetLimitInput] = useState('')
  const [tipBudgetError, setTipBudgetError] = useState('')
  const [isSavingTipBudget, setIsSavingTipBudget] = useState(false)
  const [autoTipRule, setAutoTipRuleState] = useState<AutoTipRule | null>(null)
  const [autoTipEnabled, setAutoTipEnabled] = useState(DEFAULT_AUTO_TIP_RULE.enabled)
  const [autoTipPeriodBudgetInput, setAutoTipPeriodBudgetInput] = useState('')
  const [autoTipWeighting, setAutoTipWeightingState] = useState<AutoTipWeighting>(DEFAULT_AUTO_TIP_RULE.weighting)
  const [autoTipPerCreatorMinInput, setAutoTipPerCreatorMinInput] = useState('')
  const [autoTipPerCreatorMaxInput, setAutoTipPerCreatorMaxInput] = useState('')
  const [autoTipError, setAutoTipError] = useState('')
  const [isSavingAutoTip, setIsSavingAutoTip] = useState(false)
  const [autonomousModeEnabled, setAutonomousModeEnabledState] = useState(false)
  const [agentBackendUrlInput, setAgentBackendUrlInput] = useState(DEFAULT_AGENT_BACKEND_URL)
  const [agentTokenInput, setAgentTokenInputState] = useState('')
  const [agentBackendUrlError, setAgentBackendUrlError] = useState('')
  const [agentConnectionMessage, setAgentConnectionMessage] = useState<string | null>(null)
  const [agentConnectionTone, setAgentConnectionTone] = useState<'success' | 'error' | null>(null)
  const [isSavingAgentBackendUrl, setIsSavingAgentBackendUrl] = useState(false)
  const [isSavingAgentToken, setIsSavingAgentToken] = useState(false)
  const [isTestingAgentConnection, setIsTestingAgentConnection] = useState(false)
  const [creatorHandle, setCreatorHandle] = useState('')
  const [creatorAddress, setCreatorAddress] = useState('')
  const [creatorError, setCreatorError] = useState('')
  const [isSavingCreator, setIsSavingCreator] = useState(false)
  const creatorAddressInputRef = useRef<HTMLInputElement>(null)
  const geminiKeyLabel = getSavedKeyLabel(geminiApiKey)
  const twitterKeyLabel = getSavedKeyLabel(twitterApiKey)
  const tipBudgetRemaining = tipBudget ? Math.max(0, tipBudget.dailyLimitUsdc - tipBudget.spentTodayUsdc) : 0
  const recentTipEntries = tipBudget ? [...tipBudget.log].slice(-5).reverse() : []
  const autoTipPreview = autoTipRule && tipBudget ? calculateAutoTipPlan(autoTipRule, creators, tipBudget) : null
  const autoTipPreviewReady = Boolean(autoTipRule && tipBudget)
  const autoTipPreviewRecipients = autoTipPreview?.recipients.slice(0, 3) ?? []
  const autoTipPreviewHasMore = Boolean(autoTipPreview && autoTipPreview.recipients.length > autoTipPreviewRecipients.length)

  useEffect(() => {
    let active = true

    void Promise.all([getApiKey(), getTwitterApiKey(), getSearchQuery(), getOfficialAccounts(), getUserXHandle()]).then(([geminiKey, twitterKey, searchQuery, officialList, userHandle]) => {
      if (!active) return
      setGeminiApiKey(geminiKey)
      setTwitterApiKeyState(twitterKey)
      setTwitterSearchQueryState(searchQuery)
      setOfficialAccountsState(officialList)
      setUserXHandleState(userHandle ?? '')
    })

    void chromeStorageGet([NOTIF_INCOMING_STORAGE_KEY, NOTIF_BALANCE_STORAGE_KEY, VOICE_RESPONSES_STORAGE_KEY]).then((result) => {
      if (!active) return
      setIncomingAlerts(readStoredBoolean(result[NOTIF_INCOMING_STORAGE_KEY], true))
      setBalanceAlerts(readStoredBoolean(result[NOTIF_BALANCE_STORAGE_KEY], true))
      setVoiceResponsesEnabled(readStoredBoolean(result[VOICE_RESPONSES_STORAGE_KEY], false))
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadReminders = async () => {
      setRemindersLoading(true)
      try {
        const items = await getReminders()
        if (active) {
          setReminders(items)
        }
      } catch (error) {
        debugWarn('[Settings] reminders load failed:', error)
        if (active) {
          setReminders([])
        }
      } finally {
        if (active) {
          setRemindersLoading(false)
        }
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[REMINDERS]) {
        void loadReminders()
      }
    }

    void loadReminders()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadCreators = async () => {
      try {
        const items = await listCreators()
        if (active) {
          setCreators(items)
        }
      } catch (error) {
        debugWarn('[Settings] creators load failed:', error)
        if (active) {
          setCreators([])
        }
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[CREATORS]) {
        void loadCreators()
      }
    }

    void loadCreators()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadUserXHandle = async () => {
      try {
        const value = await getUserXHandle()
        if (active) {
          setUserXHandleState(value ?? '')
        }
      } catch (error) {
        debugWarn('[Settings] user X handle load failed:', error)
        if (active) {
          setUserXHandleState('')
        }
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[USER_X_HANDLE]) {
        void loadUserXHandle()
      }
    }

    void loadUserXHandle()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadTipBudget = async () => {
      try {
        const state = await getBudgetState()
        if (active) {
          setTipBudget(state)
          setTipBudgetLimitInput(formatTipBudgetAmount(state.dailyLimitUsdc))
        }
      } catch (error) {
        debugWarn('[Settings] tip budget load failed:', error)
        if (active) {
          setTipBudget(null)
          setTipBudgetLimitInput('')
        }
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[TIP_BUDGET]) {
        void loadTipBudget()
      }
    }

    void loadTipBudget()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
    chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadAutoTipRule = async () => {
      try {
        const rule = await getAutoTipRule()
        if (!active) return

        setAutoTipRuleState(rule)
        setAutoTipEnabled(rule.enabled)
        setAutoTipPeriodBudgetInput(formatTipBudgetAmount(rule.periodBudgetUsdc))
        setAutoTipWeightingState(rule.weighting)
        setAutoTipPerCreatorMinInput(formatTipBudgetAmount(rule.perCreatorMin))
        setAutoTipPerCreatorMaxInput(formatTipBudgetAmount(rule.perCreatorMax))
      } catch (error) {
        debugWarn('[Settings] auto tip rule load failed:', error)
        if (!active) return

        setAutoTipRuleState(DEFAULT_AUTO_TIP_RULE)
        setAutoTipEnabled(DEFAULT_AUTO_TIP_RULE.enabled)
        setAutoTipPeriodBudgetInput(formatTipBudgetAmount(DEFAULT_AUTO_TIP_RULE.periodBudgetUsdc))
        setAutoTipWeightingState(DEFAULT_AUTO_TIP_RULE.weighting)
        setAutoTipPerCreatorMinInput(formatTipBudgetAmount(DEFAULT_AUTO_TIP_RULE.perCreatorMin))
        setAutoTipPerCreatorMaxInput(formatTipBudgetAmount(DEFAULT_AUTO_TIP_RULE.perCreatorMax))
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[AUTO_TIP_RULE]) {
        void loadAutoTipRule()
      }
    }

    void loadAutoTipRule()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadAgentBackendConfig = async () => {
      try {
        const config = await getAgentBackendConfig()
        if (!active) return

        setAutonomousModeEnabledState(config.enabled)
        setAgentBackendUrlInput(config.backendUrl ?? DEFAULT_AGENT_BACKEND_URL)
        setAgentTokenInputState(config.token ?? '')
      } catch (error) {
        debugWarn('[Settings] agent backend config load failed:', error)
        if (!active) return

        setAutonomousModeEnabledState(false)
        setAgentBackendUrlInput(DEFAULT_AGENT_BACKEND_URL)
        setAgentTokenInputState('')
      }
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      if (changes[AUTONOMOUS_MODE_ENABLED] || changes[AGENT_BACKEND_URL] || changes[AGENT_TOKEN]) {
        void loadAgentBackendConfig()
      }
    }

    void loadAgentBackendConfig()
    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      active = false
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  const handleToggleIncomingAlerts = async () => {
    const nextValue = !incomingAlerts
    setIncomingAlerts(nextValue)
    await chromeStorageSet({ [NOTIF_INCOMING_STORAGE_KEY]: nextValue })
  }

  const handleToggleBalanceAlerts = async () => {
    const nextValue = !balanceAlerts
    setBalanceAlerts(nextValue)
    await chromeStorageSet({ [NOTIF_BALANCE_STORAGE_KEY]: nextValue })
  }

  const handleToggleVoiceResponses = async () => {
    const nextValue = !voiceResponsesEnabled
    setVoiceResponsesEnabled(nextValue)
    await chromeStorageSet({ [VOICE_RESPONSES_STORAGE_KEY]: nextValue })
  }

  const handleToggleAutonomousMode = async () => {
    const nextValue = !autonomousModeEnabled
    setAutonomousModeEnabledState(nextValue)
    await setAutonomousEnabled(nextValue)
  }

  const handleSaveAgentBackendUrl = async () => {
    const nextUrl = agentBackendUrlInput.trim()
    setAgentBackendUrlError('')
    setAgentConnectionMessage(null)
    setAgentConnectionTone(null)

    if (!nextUrl) {
      setAgentBackendUrlError(t('settings.agentBackendUrlInvalid'))
      return
    }

    setIsSavingAgentBackendUrl(true)

    try {
      const saved = await setAgentBackendUrl(nextUrl)
      setAgentBackendUrlInput(saved)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setAgentBackendUrlError(message)
    } finally {
      setIsSavingAgentBackendUrl(false)
    }
  }

  const handleSaveAgentToken = async () => {
    const nextToken = agentTokenInput.trim()
    setAgentConnectionMessage(null)
    setAgentConnectionTone(null)

    if (!nextToken) {
      setAgentTokenInputState('')
      await clearAgentToken()
      return
    }

    setIsSavingAgentToken(true)

    try {
      const saved = await setAgentToken(nextToken)
      setAgentTokenInputState(saved)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setAgentConnectionMessage(message)
      setAgentConnectionTone('error')
    } finally {
      setIsSavingAgentToken(false)
    }
  }

  const handleClearAgentToken = async () => {
    setAgentConnectionMessage(null)
    setAgentConnectionTone(null)
    setAgentTokenInputState('')
    await clearAgentToken()
  }

  const handleTestAgentConnection = async () => {
    const nextUrl = agentBackendUrlInput.trim()
    setIsTestingAgentConnection(true)
    setAgentConnectionMessage(null)
    setAgentConnectionTone(null)

    try {
      await agentHealth(nextUrl)
      setAgentConnectionMessage(t('common.ok'))
      setAgentConnectionTone('success')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setAgentConnectionMessage(message)
      setAgentConnectionTone('error')
    } finally {
      setIsTestingAgentConnection(false)
    }
  }

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

  const handleSaveTwitterSearchQuery = async () => {
    const nextQuery = twitterSearchQuery.trim() || DEFAULT_TWITTER_SEARCH_QUERY
    await setSearchQuery(nextQuery === DEFAULT_TWITTER_SEARCH_QUERY ? '' : nextQuery)
    setTwitterSearchQueryState(nextQuery)
  }

  const handleResetTwitterSearchQuery = async () => {
    await setSearchQuery('')
    setTwitterSearchQueryState(DEFAULT_TWITTER_SEARCH_QUERY)
  }

  const handleSaveOfficialAccounts = async () => {
    const nextAccounts = officialAccounts.trim() || DEFAULT_TWITTER_OFFICIAL_ACCOUNTS
    const normalized = await setOfficialAccounts(nextAccounts)
    setOfficialAccountsState(normalized)
  }

  const refreshCreators = async (): Promise<void> => {
    const items = await listCreators()
    setCreators(items)
  }

  const refreshTipBudget = async (): Promise<void> => {
    const state = await getBudgetState()
    setTipBudget(state)
    setTipBudgetLimitInput(formatTipBudgetAmount(state.dailyLimitUsdc))
  }

  const refreshAutoTipRule = async (): Promise<void> => {
    const rule = await getAutoTipRule()
    setAutoTipRuleState(rule)
    setAutoTipEnabled(rule.enabled)
    setAutoTipPeriodBudgetInput(formatTipBudgetAmount(rule.periodBudgetUsdc))
    setAutoTipWeightingState(rule.weighting)
    setAutoTipPerCreatorMinInput(formatTipBudgetAmount(rule.perCreatorMin))
    setAutoTipPerCreatorMaxInput(formatTipBudgetAmount(rule.perCreatorMax))
  }

  const handleSaveTipBudget = async () => {
    const nextLimit = tipBudgetLimitInput.trim()
    if (!nextLimit) {
      setTipBudgetError(t('settings.tipBudgetInvalidLimit'))
      return
    }

    setIsSavingTipBudget(true)
    setTipBudgetError('')

    try {
      await setDailyLimit(nextLimit)
      await refreshTipBudget()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setTipBudgetError(message)
    } finally {
      setIsSavingTipBudget(false)
    }
  }

  const handleSaveAutoTipRule = async () => {
    const periodBudget = parseAutoTipAmount(autoTipPeriodBudgetInput)
    const minAmount = parseAutoTipAmount(autoTipPerCreatorMinInput)
    const maxAmount = parseAutoTipAmount(autoTipPerCreatorMaxInput)

    if (periodBudget == null) {
      setAutoTipError(t('settings.autoTipInvalidBudget'))
      return
    }

    if (minAmount == null || maxAmount == null) {
      setAutoTipError(t('settings.autoTipInvalidRange'))
      return
    }

    if (minAmount > maxAmount) {
      setAutoTipError(t('settings.autoTipInvalidRange'))
      return
    }

    const nextRule: AutoTipRule = {
      enabled: autoTipEnabled,
      periodBudgetUsdc: periodBudget,
      weighting: autoTipWeighting,
      perCreatorMin: minAmount,
      perCreatorMax: maxAmount,
    }

    setIsSavingAutoTip(true)
    setAutoTipError('')

    try {
      await saveAutoTipRule(nextRule)
      await refreshAutoTipRule()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setAutoTipError(message)
    } finally {
      setIsSavingAutoTip(false)
    }
  }

  const handleSaveUserXHandle = async () => {
    const normalized = userXHandle.trim().replace(/^@+/, '').replace(/['’].*$/, '').replace(/[.,!?]+$/, '')

    setIsSavingUserXHandle(true)
    setUserXHandleError('')

    try {
      const saved = await setUserXHandle(normalized)
      setUserXHandleState(saved ?? '')
      setCreatorDiscovery(null)
      setCreatorPrompt('')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setUserXHandleError(message)
    } finally {
      setIsSavingUserXHandle(false)
    }
  }

  const handleSaveCreator = async () => {
    const handle = creatorHandle.trim()
    const address = creatorAddress.trim()

    if (!handle || !address) {
      setCreatorError(t('settings.creatorRequired'))
      return
    }

    setIsSavingCreator(true)
    setCreatorError('')

    try {
      await registerCreator(handle, address)
      await refreshCreators()
      setCreatorHandle('')
      setCreatorAddress('')
      setCreatorPrompt('')
      setCreatorDiscovery((current) => {
        if (!current) return current

        const remaining = current.candidates.filter((candidate) => candidate.handle !== normalizeCreatorHandle(handle))
        if (remaining.length === current.candidates.length) return current

        return {
          ...current,
          candidates: remaining,
          message: formatDiscoveryCandidatesMessage(remaining),
          status: remaining.length > 0 ? 'success' : 'no-candidates',
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('state.error')
      setCreatorError(message)
    } finally {
      setIsSavingCreator(false)
    }
  }

  const handleResetOfficialAccounts = async () => {
    const normalized = await setOfficialAccounts(DEFAULT_TWITTER_OFFICIAL_ACCOUNTS)
    setOfficialAccountsState(normalized)
  }

  const handleRemoveCreator = async (handle: string) => {
    try {
      await removeCreator(handle)
      await refreshCreators()
      setCreatorDiscovery((current) => {
        if (!current) return current

        const normalizedHandle = normalizeCreatorHandle(handle)
        const remaining = current.candidates.filter((candidate) => candidate.handle !== normalizedHandle)
        if (remaining.length === current.candidates.length) return current

        return {
          ...current,
          candidates: remaining,
          message: formatDiscoveryCandidatesMessage(remaining),
          status: remaining.length > 0 ? 'success' : 'no-candidates',
        }
      })
    } catch (error) {
      debugWarn('[Settings] creator remove failed:', error)
    }
  }

  const handleDiscoverCreators = async () => {
    setIsDiscoveringCreators(true)
    setCreatorPrompt('')

    try {
      const result = await discoverCreators()
      setCreatorDiscovery(result)
    } catch (error) {
      debugWarn('[Settings] discover creators failed:', error)
      setCreatorDiscovery({
        candidates: [],
        message: error instanceof Error ? error.message : t('gogo.creatorDiscoveryUnavailable'),
        status: 'unavailable',
        cacheHit: false,
        tweetsReturned: 0,
        userHandle: userXHandle.trim() || null,
      })
    } finally {
      setIsDiscoveringCreators(false)
    }
  }

  const handleSelectDiscoveryCandidate = (handle: string) => {
    const normalizedHandle = normalizeCreatorHandle(handle)
    setCreatorHandle(normalizedHandle)
    setCreatorAddress('')
    setCreatorError('')
    setCreatorPrompt(formatText('settings.discoveryNeedsAddress', { handle: `@${normalizedHandle}` }))
    setTimeout(() => {
      creatorAddressInputRef.current?.focus()
    }, 0)
  }

  const handleRemoveReminder = async (id: string) => {
    try {
      await removeReminder(id)
      setReminders((current) => current.filter((reminder) => reminder.id !== id))
    } catch (error) {
      debugWarn('[Settings] reminder remove failed:', error)
    }
  }

  return (
    <div className="flex flex-col h-full bg-arc-bg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-arc-border">
        <button onClick={onBack} className="p-1.5 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-arc-text">{t('settings.title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors cursor-pointer group"
          onClick={() => setCurrentView('address-book')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent group-hover:bg-arc-accent/20 transition-colors">
              <Book size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-arc-text">{t('settings.addressBook')}</p>
              <p className="text-[10px] text-arc-text-dim">{t('settings.manageAddresses')}</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-arc-text-dim group-hover:text-arc-accent transition-colors" />
        </div>
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors cursor-pointer group"
          onClick={() => setCurrentView('discover')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent group-hover:bg-arc-accent/20 transition-colors">
              <LayoutDashboard size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-arc-text">{t('bottom.openDashboard')}</p>
              <p className="text-[10px] text-arc-text-dim">{t('discover.ecosystemPulse')}</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-arc-text-dim group-hover:text-arc-accent transition-colors" />
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
          {t('settings.aiFeatures')}
        </p>
        <div className="border-b border-arc-border/50">
          <div
            className="px-4 py-3 hover:bg-arc-card/30 transition-colors cursor-pointer group"
            onClick={() => geminiApiKey ? setCurrentView('gogo-ai') : setIsAddingGemini(!isAddingGemini)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent group-hover:bg-arc-accent/20 transition-colors">
                  <Key size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-arc-text">{t('settings.geminiApiKey')}</p>
                  <p className={`text-[10px] ${geminiApiKey ? 'text-arc-success' : 'text-arc-text-dim'}`}>
                    {geminiKeyLabel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {geminiApiKey && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClearGeminiKey() }}
                    className="p-2 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors"
                    title={t('settings.clearApiKey')}
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
                  placeholder={t('settings.pasteGeminiKey')}
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text placeholder:text-arc-hint focus:outline-none focus:border-arc-accent"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveGemini()}
                />
                <button
                  onClick={handleSaveGemini}
                  className="bg-white text-black px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  {t('settings.save')}
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
                <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent group-hover:bg-arc-accent/20 transition-colors">
                  <Twitter size={20} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-arc-text">{t('settings.twitterApiKey')}</p>
                  <p className={`text-[10px] ${twitterApiKey ? 'text-arc-success' : 'text-arc-text-dim'}`}>
                    {twitterKeyLabel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {twitterApiKey ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setTwitterTempKey('')
                        setIsAddingTwitter(true)
                      }}
                      className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-arc-accent hover:bg-arc-accent/10 transition-colors"
                    >
                      {t('settings.update')}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleClearTwitterKey() }}
                      className="p-2 rounded-lg text-arc-text-dim hover:text-arc-text transition-colors"
                      title={t('settings.clearTwitterKey')}
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
                  placeholder={t('settings.twitterKey')}
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text placeholder:text-arc-hint focus:outline-none focus:border-arc-accent"
                  value={twitterTempKey}
                  onChange={(e) => setTwitterTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTwitterKey()}
                />
                <button
                  onClick={handleSaveTwitterKey}
                  className="bg-white text-black px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  {twitterApiKey ? t('settings.update') : t('settings.save')}
                </button>
              </div>
            </div>
          )}
          <div className="border-t border-arc-border/50 bg-arc-card/20 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent">
                <Search size={20} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-arc-text">{t('settings.tweetSearchTopics')}</p>
                    <p className="text-[10px] text-arc-text-dim">{t('settings.tweetSearchTopicsDescription')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetTwitterSearchQuery}
                    className="shrink-0 text-[10px] font-semibold text-arc-accent underline-offset-2 hover:underline"
                  >
                    {t('settings.resetToDefault')}
                  </button>
                </div>
                <Input
                  value={twitterSearchQuery}
                  onChange={(e) => setTwitterSearchQueryState(e.target.value)}
                  placeholder={DEFAULT_TWITTER_SEARCH_QUERY}
                  aria-label={t('settings.tweetSearchTopics')}
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveTwitterSearchQuery}
                    className="min-w-24"
                  >
                    {t('settings.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-arc-border/50 bg-arc-card/20 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent">
                <AtSign size={20} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-arc-text">{t('settings.officialAccounts')}</p>
                    <p className="text-[10px] text-arc-text-dim">{t('settings.officialAccountsDescription')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetOfficialAccounts}
                    className="shrink-0 text-[10px] font-semibold text-arc-accent underline-offset-2 hover:underline"
                  >
                    {t('settings.resetToDefault')}
                  </button>
                </div>
                <Input
                  value={officialAccounts}
                  onChange={(e) => setOfficialAccountsState(e.target.value)}
                  placeholder={t('settings.officialAccountsPlaceholder')}
                  aria-label={t('settings.officialAccounts')}
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveOfficialAccounts}
                    className="min-w-24"
                  >
                    {t('settings.save')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
          {t('settings.autonomousModeTitle')}
        </p>
        <div className="border-b border-arc-border/50 bg-arc-card/20 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-arc-accent/10 p-2 text-arc-accent">
              <Bot size={20} />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-arc-text">{t('settings.autonomousModeToggle')}</p>
                  <p className="text-[10px] text-arc-text-dim">{t('settings.autonomousModeDescription')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleAutonomousMode()}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-arc-border bg-arc-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:border-white/30"
                >
                  <span className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border transition-colors ${autonomousModeEnabled ? 'border-white/40 bg-white' : 'border-arc-border bg-arc-border/60'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-arc-bg shadow transition-transform ${autonomousModeEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </span>
                  <span>{autonomousModeEnabled ? t('settings.autoTipStateOn') : t('settings.autoTipStateOff')}</span>
                </button>
              </div>

              <div className="space-y-4">
                <Input
                  label={t('settings.agentBackendUrl')}
                  value={agentBackendUrlInput}
                  onChange={(e) => {
                    setAgentBackendUrlInput(e.target.value)
                    setAgentBackendUrlError('')
                    setAgentConnectionMessage(null)
                    setAgentConnectionTone(null)
                  }}
                  placeholder={t('settings.agentBackendUrlPlaceholder')}
                  aria-label={t('settings.agentBackendUrl')}
                  type="url"
                  error={agentBackendUrlError}
                  className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTestAgentConnection()}
                    disabled={isTestingAgentConnection}
                    className="min-w-28"
                  >
                    {isTestingAgentConnection ? t('settings.testingConnection') : t('settings.testConnection')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveAgentBackendUrl()}
                    disabled={isSavingAgentBackendUrl}
                    className="min-w-24"
                  >
                    {isSavingAgentBackendUrl ? t('common.loading') : t('settings.update')}
                  </Button>
                </div>

                <Input
                  label={t('settings.agentToken')}
                  value={agentTokenInput}
                  onChange={(e) => {
                    setAgentTokenInputState(e.target.value)
                    setAgentConnectionMessage(null)
                    setAgentConnectionTone(null)
                  }}
                  placeholder={t('settings.agentTokenPlaceholder')}
                  aria-label={t('settings.agentToken')}
                  type="password"
                  className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] text-arc-text-dim">
                    {agentTokenInput.trim() ? getSavedKeyLabel(agentTokenInput.trim()) : t('settings.notSet')}
                  </p>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {agentTokenInput.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleClearAgentToken()}
                        className="min-w-20"
                      >
                        {t('common.clear')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleSaveAgentToken()}
                      disabled={isSavingAgentToken}
                      className="min-w-24"
                    >
                      {isSavingAgentToken ? t('common.loading') : t('settings.save')}
                    </Button>
                  </div>
                </div>

                <p className="text-[10px] leading-relaxed text-arc-text-dim">
                  {t('settings.autonomousModeDescription')}
                </p>

                {agentConnectionMessage && (
                  <p className={`text-xs ${agentConnectionTone === 'success' ? 'text-arc-success' : 'text-arc-danger'}`}>
                    {agentConnectionMessage}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-arc-border/50 bg-arc-card/20 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent">
              <AtSign size={20} />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-arc-text">{t('settings.yourXHandle')}</p>
                  <p className="text-[10px] text-arc-text-dim">{t('settings.yourXHandleDescription')}</p>
                </div>
              </div>
              <Input
                value={userXHandle}
                onChange={(e) => {
                  setUserXHandleState(e.target.value)
                  setUserXHandleError('')
                }}
                placeholder={t('settings.yourXHandlePlaceholder')}
                aria-label={t('settings.yourXHandle')}
                className="font-mono text-xs"
              />
              {userXHandleError && <p className="text-xs text-arc-danger">{userXHandleError}</p>}
              <div className="flex items-center justify-end gap-2">
                {userXHandle.trim() && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setUserXHandleState('')
                      setUserXHandleError('')
                      setCreatorDiscovery(null)
                      setCreatorPrompt('')
                      void setUserXHandle('')
                    }}
                    className="min-w-24"
                  >
                    {t('settings.clearXHandle')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSaveUserXHandle()}
                  disabled={isSavingUserXHandle}
                  className="min-w-24"
                >
                  {isSavingUserXHandle ? t('common.loading') : t('settings.saveXHandle')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card border-y border-arc-border">
          {t('settings.creators')}
        </p>
          <div className="border-b border-arc-border bg-arc-card px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent">
                <Coins size={20} />
              </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{t('settings.tipBudgetTitle')}</p>
                  <p className="text-[10px] text-arc-text-dim">{t('settings.tipBudgetDescription')}</p>
                </div>
                <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                  {tipBudget ? `${formatTipBudgetAmount(tipBudgetRemaining)} ${t('common.usdc')}` : t('state.loading')}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-arc-border bg-arc-bg px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('settings.tipBudgetDailyLimit')}</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {tipBudget ? `${formatTipBudgetAmount(tipBudget.dailyLimitUsdc)} ${t('common.usdc')}` : 'â€”'}
                  </p>
                </div>
                <div className="rounded-2xl border border-arc-border bg-arc-bg px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('settings.tipBudgetSpentToday')}</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {tipBudget ? `${formatTipBudgetAmount(tipBudget.spentTodayUsdc)} ${t('common.usdc')}` : 'â€”'}
                  </p>
                </div>
                <div className="rounded-2xl border border-arc-border bg-arc-bg px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('settings.tipBudgetRemaining')}</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {tipBudget ? `${formatTipBudgetAmount(tipBudgetRemaining)} ${t('common.usdc')}` : 'â€”'}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  label={t('settings.tipBudgetDailyLimit')}
                  value={tipBudgetLimitInput}
                  onChange={(e) => {
                    setTipBudgetLimitInput(e.target.value)
                    setTipBudgetError('')
                  }}
                  placeholder={t('settings.tipBudgetLimitPlaceholder')}
                  aria-label={t('settings.tipBudgetDailyLimit')}
                  className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSaveTipBudget()}
                  disabled={isSavingTipBudget}
                  className="min-w-28 self-end"
                >
                  {isSavingTipBudget ? t('common.loading') : t('settings.tipBudgetSaveLimit')}
                </Button>
              </div>

              {tipBudgetError && <p className="text-xs text-arc-danger">{tipBudgetError}</p>}

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white">{t('settings.tipBudgetRecentTips')}</p>
                {recentTipEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-arc-border bg-arc-bg px-4 py-4 text-xs text-arc-text-dim">
                    {t('settings.tipBudgetNoTipsYet')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentTipEntries.map((entry) => (
                      <div key={`${entry.handle}-${entry.timestamp}`} className="flex items-center justify-between gap-3 rounded-2xl border border-arc-border bg-arc-bg px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">@{entry.handle}</p>
                          <p className="text-[10px] text-arc-text-dim">{formatRelativeTime(new Date(entry.timestamp).toISOString())}</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-white">
                          {formatTipBudgetAmount(entry.amount)} {t('common.usdc')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="border-b border-arc-border bg-arc-card px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-arc-border bg-arc-bg text-[11px] font-semibold tracking-[0.18em] text-white">
              AT
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{t('settings.autoTipTitle')}</p>
                  <p className="text-[10px] text-arc-text-dim">{t('settings.autoTipDescription')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAutoTipEnabled((current) => !current)
                    setAutoTipError('')
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-arc-border bg-arc-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:border-white/30"
                >
                  <span className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border transition-colors ${autoTipEnabled ? 'border-white/40 bg-white' : 'border-arc-border bg-arc-border/60'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-arc-bg shadow transition-transform ${autoTipEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </span>
                  <span>{autoTipEnabled ? t('settings.autoTipStateOn') : t('settings.autoTipStateOff')}</span>
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label={t('settings.autoTipPeriodBudget')}
                  value={autoTipPeriodBudgetInput}
                  onChange={(e) => {
                    setAutoTipPeriodBudgetInput(e.target.value)
                    setAutoTipError('')
                  }}
                  placeholder={formatTipBudgetAmount(DEFAULT_AUTO_TIP_RULE.periodBudgetUsdc)}
                  aria-label={t('settings.autoTipPeriodBudget')}
                  className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                />

                <div className="space-y-2">
                  <label className="block text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">
                    {t('settings.autoTipWeighting')}
                  </label>
                  <select
                    value={autoTipWeighting}
                    onChange={(e) => {
                      setAutoTipWeightingState(e.target.value as AutoTipWeighting)
                      setAutoTipError('')
                    }}
                    className="w-full rounded-lg border border-arc-border bg-arc-bg px-3 py-2 text-xs font-medium text-white outline-none transition-colors focus:border-arc-accent"
                  >
                    <option value="equal">{t('settings.autoTipWeightingEqual')}</option>
                    <option value="engagement">{t('settings.autoTipWeightingEngagement')}</option>
                    <option value="recency">{t('settings.autoTipWeightingRecency')}</option>
                  </select>
                </div>

                <Input
                  label={t('settings.autoTipPerCreatorMin')}
                  value={autoTipPerCreatorMinInput}
                  onChange={(e) => {
                    setAutoTipPerCreatorMinInput(e.target.value)
                    setAutoTipError('')
                  }}
                  placeholder="0.05"
                  aria-label={t('settings.autoTipPerCreatorMin')}
                  className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                />
                <Input
                  label={t('settings.autoTipPerCreatorMax')}
                  value={autoTipPerCreatorMaxInput}
                  onChange={(e) => {
                    setAutoTipPerCreatorMaxInput(e.target.value)
                    setAutoTipError('')
                  }}
                  placeholder="1.00"
                  aria-label={t('settings.autoTipPerCreatorMax')}
                  className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                />
              </div>

              {autoTipError && <p className="text-xs text-arc-danger">{autoTipError}</p>}

              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSaveAutoTipRule()}
                  disabled={isSavingAutoTip}
                  className="min-w-28"
                >
                  {isSavingAutoTip ? t('common.loading') : t('settings.autoTipSaveRule')}
                </Button>
              </div>

              <div className="rounded-2xl border border-arc-border bg-arc-bg px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('settings.autoTipPreviewTitle')}</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {autoTipPreview ? autoTipPreview.summary : (autoTipPreviewReady ? t('settings.autoTipPreviewOff') : t('state.loading'))}
                    </p>
                  </div>
                  <span className="rounded-full border border-arc-border bg-arc-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-text-dim">
                    {autoTipEnabled ? t('settings.autoTipStateOn') : t('settings.autoTipStateOff')}
                  </span>
                </div>

                {autoTipPreview ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs leading-5 text-arc-text-dim">{autoTipPreview.explanation}</p>
                    {autoTipPreview.canExecute ? (
                      <div className="space-y-2">
                        {autoTipPreviewRecipients.map((recipient) => (
                          <div key={`${recipient.handle}-${recipient.address}`} className="rounded-xl border border-arc-border bg-arc-card px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">@{recipient.handle}</p>
                                <p className="text-[10px] text-arc-text-dim">{formatAddress(recipient.address, 4)}</p>
                              </div>
                              <p className="shrink-0 text-sm font-semibold text-white">
                                {formatTipBudgetAmount(Number(recipient.amount))} {t('common.usdc')}
                              </p>
                            </div>
                            <p className="mt-2 text-[10px] leading-4 text-arc-text-dim">{recipient.reason}</p>
                          </div>
                        ))}
                        {autoTipPreviewHasMore && (
                          <p className="text-[10px] text-arc-text-dim">
                            +{autoTipPreview ? autoTipPreview.recipients.length - autoTipPreviewRecipients.length : 0} more
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-arc-text-dim">{autoTipPreviewReady ? t('settings.autoTipPreviewOff') : t('state.loading')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="border-b border-arc-border bg-arc-card">
          <div className="border-b border-arc-border bg-arc-card px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent">
                <Users size={20} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{t('settings.creatorsTitle')}</p>
                    <p className="text-[10px] text-arc-text-dim">{t('settings.creatorsDescription')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDiscoverCreators()}
                      disabled={isDiscoveringCreators}
                      className="h-8 px-3 text-[10px] font-semibold uppercase tracking-[0.18em]"
                    >
                      {isDiscoveringCreators ? t('settings.discoverCreatorsLoading') : t('settings.discoverCreators')}
                    </Button>
                    <span className="rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                      {creators.length}
                    </span>
                  </div>
                </div>

                <p className="text-[10px] text-arc-text-dim">{t('settings.discoverCreatorsDescription')}</p>

                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    label={t('settings.creatorHandle')}
                    value={creatorHandle}
                    onChange={(e) => {
                      setCreatorHandle(e.target.value)
                      setCreatorError('')
                    }}
                    placeholder={t('settings.creatorHandlePlaceholder')}
                    aria-label={t('settings.creatorHandle')}
                    className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                  />
                  <Input
                    ref={creatorAddressInputRef}
                    label={t('settings.creatorWalletAddress')}
                    value={creatorAddress}
                    onChange={(e) => {
                      setCreatorAddress(e.target.value)
                      setCreatorError('')
                    }}
                    placeholder={t('settings.creatorAddressPlaceholder')}
                    aria-label={t('settings.creatorWalletAddress')}
                    className="bg-arc-bg border-arc-border text-white placeholder:text-arc-hint focus:border-arc-accent font-mono text-xs"
                  />
                </div>

                {creatorError && (
                  <p className="text-xs text-arc-danger">{creatorError}</p>
                )}

                {creatorPrompt && (
                  <p className="text-xs text-arc-text-dim">{creatorPrompt}</p>
                )}

                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveCreator()}
                    disabled={isSavingCreator}
                    className="min-w-28"
                  >
                    {isSavingCreator ? t('common.loading') : t('settings.addCreator')}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {creatorDiscovery && (
            <div className="border-t border-arc-border/50 bg-arc-card/20 px-4 py-4">
              <div className="space-y-3 rounded-2xl border border-arc-border bg-arc-bg px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-arc-text-dim">
                      {t('settings.discoverCreators')}
                    </p>
                    <p className="mt-1 text-sm text-white">
                      {creatorDiscovery.message}
                    </p>
                  </div>
                </div>

                {creatorDiscovery.candidates.length > 0 && (
                  <div className="space-y-2">
                    {creatorDiscovery.candidates.map((candidate) => (
                      <div key={candidate.handle} className="flex items-start justify-between gap-3 rounded-xl border border-arc-border bg-arc-card px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">@{candidate.handle}</p>
                          <p className="mt-1 text-[10px] text-arc-text-dim">{candidate.reason}</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleSelectDiscoveryCandidate(candidate.handle)}
                          className="shrink-0 h-8 px-3 text-[10px]"
                        >
                          {t('common.add')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2 px-4 py-4">
            {creators.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-arc-border bg-arc-bg px-4 py-4 text-sm text-arc-text-dim">
                {t('settings.noCreatorsYet')}
              </div>
            ) : (
              creators.map((creator) => (
                <div key={creator.handle} className="flex items-start justify-between gap-3 rounded-2xl border border-arc-border bg-arc-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">@{creator.handle}</p>
                    <p className="mt-1 text-[10px] font-mono text-arc-text-dim">
                      {formatAddress(creator.address, 4)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveCreator(creator.handle)}
                    className="shrink-0 rounded-lg p-2 text-arc-text-dim transition-colors hover:text-white"
                    title={t('common.remove')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
          {t('settings.reminders')}
        </p>
        <div className="border-b border-arc-border/50">
          {remindersLoading ? (
            <div className="space-y-3 px-4 py-4">
              <div className="h-4 w-24 animate-pulse rounded bg-arc-border/70" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-arc-border/70" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-arc-border/70" />
            </div>
          ) : reminders.length === 0 ? (
            <div className="px-4 py-4 text-sm text-arc-text-dim">
              {t('settings.noRemindersYet')}
            </div>
          ) : (
            reminders.map((reminder, index) => (
              <div key={reminder.id} className={`flex items-start justify-between gap-3 px-4 py-3 hover:bg-arc-card/30 transition-colors ${index > 0 ? 'border-t border-arc-border/50' : ''}`}>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-arc-text">{reminder.title}</p>
                  <p className="text-[10px] text-arc-text-dim">{getReminderDetails(reminder)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveReminder(reminder.id)}
                  className="shrink-0 rounded-lg p-2 text-arc-text-dim hover:text-arc-danger transition-colors"
                  title={t('common.remove')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
          {t('settings.notifications')}
        </p>
        <div className="border-b border-arc-border/50">
          {[
            {
              label: t('settings.incomingAlerts'),
              description: t('settings.incomingAlertsDescription'),
              enabled: incomingAlerts,
              onToggle: handleToggleIncomingAlerts,
            },
            {
              label: t('settings.balanceAlerts'),
              description: t('settings.balanceAlertsDescription'),
              enabled: balanceAlerts,
              onToggle: handleToggleBalanceAlerts,
            },
          ].map((item, index) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onToggle}
              className={`flex w-full items-center justify-between px-4 py-3 hover:bg-arc-card/30 transition-colors cursor-pointer group ${index > 0 ? 'border-t border-arc-border/50' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent group-hover:bg-arc-accent/20 transition-colors">
                  <Bell size={20} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-arc-text">{item.label}</p>
                  <p className="text-[10px] text-arc-text-dim">{item.description}</p>
                </div>
              </div>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                  item.enabled ? 'border-white/50 bg-white' : 'border-arc-border bg-arc-border/60'
                }`}
                aria-hidden="true"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-arc-bg shadow transition-transform ${
                    item.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          ))}
        </div>

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
          {t('settings.voice')}
        </p>
        <div className="border-b border-arc-border/50">
          {[{
            label: t('settings.voiceResponses'),
            description: t('settings.voiceResponsesDescription'),
            enabled: voiceResponsesEnabled,
            onToggle: handleToggleVoiceResponses,
            icon: Volume2,
          }].map((item, index) => {
            const Icon = item.icon

            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onToggle}
                className={`flex w-full items-center justify-between px-4 py-3 hover:bg-arc-card/30 transition-colors cursor-pointer group ${index > 0 ? 'border-t border-arc-border/50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-arc-accent/10 text-arc-accent group-hover:bg-arc-accent/20 transition-colors">
                    <Icon size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-arc-text">{item.label}</p>
                    <p className="text-[10px] text-arc-text-dim">{item.description}</p>
                  </div>
                </div>
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                    item.enabled ? 'border-white/50 bg-white' : 'border-arc-border bg-arc-border/60'
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-arc-bg shadow transition-transform ${
                      item.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </span>
              </button>
            )
          })}
        </div>

        {[
          { section: t('common.network'), items: [{ label: t('settings.currentNetwork'), value: 'Arc Testnet' }, { label: t('settings.rpcUrl'), value: ARC_RPC_URL.replace(/^https?:\/\//, '') }] },
          { section: t('common.security'), items: [{ label: t('settings.lockExtension'), value: '' }, { label: t('settings.exportPrivateKey'), value: '' }] },
          { section: t('common.preferences'), items: [{ label: t('common.theme'), value: t('common.dark') }, { label: t('common.currency'), value: t('common.usd') }, { label: t('settings.language'), value: '' }] },
        ].map(({ section, items }) => (
          <div key={section}>
            <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-arc-text-dim bg-arc-card/30 border-y border-arc-border">
              {section}
            </p>
            {items.map(({ label, value }) => {
              if (label === t('settings.language')) {
                return (
                  <div key={label} className="flex flex-col gap-3 px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-arc-text">{label}</span>
                      <span className="text-xs text-arc-text-dim">{localePreference === 'auto' ? t('settings.auto') : localePreference === 'en' ? t('settings.english') : t('settings.turkish')}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 'auto' as const, label: t('settings.auto') },
                        { value: 'en' as const, label: t('settings.english') },
                        { value: 'tr' as const, label: t('settings.turkish') },
                      ].map((option) => {
                        const selected = localePreference === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => void setLocale(option.value)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              selected
                                ? 'border-arc-accent bg-arc-accent/10 text-arc-accent'
                                : 'border-arc-border text-arc-text-dim hover:border-arc-accent/30 hover:text-arc-text'
                            }`}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              }

              return (
                <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-arc-border/50 hover:bg-arc-card/30 transition-colors cursor-pointer">
                  <span className="text-sm text-arc-text">{label}</span>
                  {value && <span className="text-xs text-arc-text-dim">{value}</span>}
                </div>
              )
            })}
          </div>
        ))}

        <div className="border-t border-arc-border/50 bg-arc-card/20 px-4 py-4">
          <div className="rounded-2xl border border-arc-border bg-arc-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">
              {t('common.about')}
            </p>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-arc-text">{APP_NAME}</p>
                <p className="mt-1 text-xs leading-relaxed text-arc-text-dim">{t('settings.aboutTagline')}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] uppercase tracking-[0.18em] text-arc-text-dim">{t('common.version')}</p>
                <p className="mt-1 text-sm font-semibold text-arc-accent">v{APP_VERSION}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-arc-border/70 pt-3 text-xs text-arc-text-dim">
              <span>{t('settings.chainId')}</span>
              <span>{ARC_CHAIN_ID}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
