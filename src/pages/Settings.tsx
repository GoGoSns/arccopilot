import { useEffect, useState } from 'react'
import { ArrowLeft, AtSign, Bell, Book, ChevronRight, Coins, Key, LayoutDashboard, Search, Trash2, Twitter, Users, Volume2 } from 'lucide-react'
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
import { listCreators, registerCreator, removeCreator, type CreatorEntry } from '@/lib/creatorRegistry'
import {
  CREATORS,
  NOTIF_BALANCE_STORAGE_KEY,
  NOTIF_INCOMING_STORAGE_KEY,
  REMINDERS,
  TIP_BUDGET,
  VOICE_RESPONSES_STORAGE_KEY,
} from '@/lib/storageKeys'
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

function getSavedKeyLabel(key: string | null): string {
  if (!key) return t('settings.notSet')
  return formatText('settings.savedMasked', { suffix: key.slice(-4) })
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
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [remindersLoading, setRemindersLoading] = useState(true)
  const [creators, setCreators] = useState<CreatorEntry[]>([])
  const [tipBudget, setTipBudget] = useState<TipBudgetState | null>(null)
  const [tipBudgetLimitInput, setTipBudgetLimitInput] = useState('')
  const [tipBudgetError, setTipBudgetError] = useState('')
  const [isSavingTipBudget, setIsSavingTipBudget] = useState(false)
  const [creatorHandle, setCreatorHandle] = useState('')
  const [creatorAddress, setCreatorAddress] = useState('')
  const [creatorError, setCreatorError] = useState('')
  const [isSavingCreator, setIsSavingCreator] = useState(false)
  const geminiKeyLabel = getSavedKeyLabel(geminiApiKey)
  const twitterKeyLabel = getSavedKeyLabel(twitterApiKey)
  const tipBudgetRemaining = tipBudget ? Math.max(0, tipBudget.dailyLimitUsdc - tipBudget.spentTodayUsdc) : 0
  const recentTipEntries = tipBudget ? [...tipBudget.log].slice(-5).reverse() : []

  useEffect(() => {
    let active = true

    void Promise.all([getApiKey(), getTwitterApiKey(), getSearchQuery(), getOfficialAccounts()]).then(([geminiKey, twitterKey, searchQuery, officialList]) => {
      if (!active) return
      setGeminiApiKey(geminiKey)
      setTwitterApiKeyState(twitterKey)
      setTwitterSearchQueryState(searchQuery)
      setOfficialAccountsState(officialList)
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
    } catch (error) {
      debugWarn('[Settings] creator remove failed:', error)
    }
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
                    className="p-2 rounded-lg text-arc-text-dim hover:text-arc-danger transition-colors"
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
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text focus:outline-none focus:border-arc-accent"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveGemini()}
                />
                <button
                  onClick={handleSaveGemini}
                  className="bg-arc-accent text-arc-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
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
                <div className="p-2 rounded-xl bg-[#ffffff]/10 text-[#ffffff] group-hover:bg-[#ffffff]/20 transition-colors">
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
                      className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[#ffffff] hover:bg-[#ffffff]/10 transition-colors"
                    >
                      {t('settings.update')}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleClearTwitterKey() }}
                      className="p-2 rounded-lg text-arc-text-dim hover:text-arc-danger transition-colors"
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
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text focus:outline-none focus:border-[#ffffff]"
                  value={twitterTempKey}
                  onChange={(e) => setTwitterTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTwitterKey()}
                />
                <button
                  onClick={handleSaveTwitterKey}
                  className="bg-[#ffffff] text-arc-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  {twitterApiKey ? t('settings.update') : t('settings.save')}
                </button>
              </div>
            </div>
          )}
          <div className="border-t border-arc-border/50 bg-arc-card/20 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-[#ffffff]/10 text-[#ffffff]">
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
                    className="shrink-0 text-[10px] font-semibold text-[#ffffff] underline-offset-2 hover:underline"
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
              <div className="p-2 rounded-xl bg-[#ffffff]/10 text-[#ffffff]">
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
                    className="shrink-0 text-[10px] font-semibold text-[#ffffff] underline-offset-2 hover:underline"
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

        <p className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#9a9a9a] bg-[#141414] border-y border-[#2a2a2a]">
          {t('settings.creators')}
        </p>
        <div className="border-b border-[#2a2a2a] bg-[#141414] px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-[#ffffff]/10 text-[#ffffff]">
              <Coins size={20} />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#ffffff]">{t('settings.tipBudgetTitle')}</p>
                  <p className="text-[10px] text-[#9a9a9a]">{t('settings.tipBudgetDescription')}</p>
                </div>
                <span className="rounded-full border border-[#ffffff]/25 bg-[#ffffff]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffffff]">
                  {tipBudget ? `${formatTipBudgetAmount(tipBudgetRemaining)} ${t('common.usdc')}` : t('state.loading')}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">{t('settings.tipBudgetDailyLimit')}</p>
                  <p className="mt-2 text-sm font-semibold text-[#ffffff]">
                    {tipBudget ? `${formatTipBudgetAmount(tipBudget.dailyLimitUsdc)} ${t('common.usdc')}` : '—'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">{t('settings.tipBudgetSpentToday')}</p>
                  <p className="mt-2 text-sm font-semibold text-[#ffffff]">
                    {tipBudget ? `${formatTipBudgetAmount(tipBudget.spentTodayUsdc)} ${t('common.usdc')}` : '—'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">{t('settings.tipBudgetRemaining')}</p>
                  <p className="mt-2 text-sm font-semibold text-[#ffffff]">
                    {tipBudget ? `${formatTipBudgetAmount(tipBudgetRemaining)} ${t('common.usdc')}` : '—'}
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
                  className="bg-[#0a0a0a] border-[#2a2a2a] text-[#ffffff] placeholder:text-[#6b6b6b] focus:border-[#ffffff] font-mono text-xs"
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffffff]">{t('settings.tipBudgetRecentTips')}</p>
                {recentTipEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0a0a0a] px-4 py-4 text-xs text-[#9a9a9a]">
                    {t('settings.tipBudgetNoTipsYet')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentTipEntries.map((entry) => (
                      <div key={`${entry.handle}-${entry.timestamp}`} className="flex items-center justify-between gap-3 rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#ffffff]">@{entry.handle}</p>
                          <p className="text-[10px] text-[#9a9a9a]">{formatRelativeTime(new Date(entry.timestamp).toISOString())}</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-[#ffffff]">
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
        <div className="border-b border-[#2a2a2a] bg-[#141414]">
          <div className="border-b border-[#2a2a2a] bg-[#141414] px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-[#ffffff]/10 text-[#ffffff]">
                <Users size={20} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#ffffff]">{t('settings.creatorsTitle')}</p>
                    <p className="text-[10px] text-[#9a9a9a]">{t('settings.creatorsDescription')}</p>
                  </div>
                  <span className="rounded-full border border-[#ffffff]/25 bg-[#ffffff]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffffff]">
                    {creators.length}
                  </span>
                </div>

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
                    className="bg-[#0a0a0a] border-[#2a2a2a] text-[#ffffff] placeholder:text-[#6b6b6b] focus:border-[#ffffff] font-mono text-xs"
                  />
                  <Input
                    label={t('settings.creatorWalletAddress')}
                    value={creatorAddress}
                    onChange={(e) => {
                      setCreatorAddress(e.target.value)
                      setCreatorError('')
                    }}
                    placeholder={t('settings.creatorAddressPlaceholder')}
                    aria-label={t('settings.creatorWalletAddress')}
                    className="bg-[#0a0a0a] border-[#2a2a2a] text-[#ffffff] placeholder:text-[#6b6b6b] focus:border-[#ffffff] font-mono text-xs"
                  />
                </div>

                {creatorError && (
                  <p className="text-xs text-arc-danger">{creatorError}</p>
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

          <div className="space-y-2 px-4 py-4">
            {creators.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0a0a0a] px-4 py-4 text-sm text-[#9a9a9a]">
                {t('settings.noCreatorsYet')}
              </div>
            ) : (
              creators.map((creator) => (
                <div key={creator.handle} className="flex items-start justify-between gap-3 rounded-2xl border border-[#2a2a2a] bg-[#141414] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#ffffff]">@{creator.handle}</p>
                    <p className="mt-1 text-[10px] font-mono text-[#9a9a9a]">
                      {formatAddress(creator.address, 4)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveCreator(creator.handle)}
                    className="shrink-0 rounded-lg p-2 text-[#9a9a9a] transition-colors hover:text-[#ffffff]"
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
                <div className="p-2 rounded-xl bg-[#ffffff]/10 text-[#ffffff] group-hover:bg-[#ffffff]/20 transition-colors">
                  <Bell size={20} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-arc-text">{item.label}</p>
                  <p className="text-[10px] text-arc-text-dim">{item.description}</p>
                </div>
              </div>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                  item.enabled ? 'border-[#ffffff]/50 bg-[#ffffff]' : 'border-arc-border bg-arc-border/60'
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
                    item.enabled ? 'border-[#ffffff]/50 bg-[#ffffff]' : 'border-arc-border bg-arc-border/60'
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
