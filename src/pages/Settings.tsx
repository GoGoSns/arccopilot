import { useEffect, useState } from 'react'
import { ArrowLeft, AtSign, Bell, Book, ChevronRight, Key, Search, Trash2, Twitter, Volume2 } from 'lucide-react'
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
import {
  NOTIF_BALANCE_STORAGE_KEY,
  NOTIF_INCOMING_STORAGE_KEY,
  REMINDERS,
  VOICE_RESPONSES_STORAGE_KEY,
} from '@/lib/storageKeys'
import {
  getReminders,
  getReminderDetails,
  removeReminder,
  type Reminder,
} from '@/lib/reminders'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatText, getLocalePreference, setLocale, t } from '@/lib/i18n'
import { APP_NAME, APP_VERSION } from '@/lib/appMeta'

interface SettingsProps {
  onBack: () => void
}

function readStoredBoolean(key: string, value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  void chrome.storage.local.remove(key)
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
  const geminiKeyLabel = getSavedKeyLabel(geminiApiKey)
  const twitterKeyLabel = getSavedKeyLabel(twitterApiKey)

  useEffect(() => {
    void Promise.all([getApiKey(), getTwitterApiKey(), getSearchQuery(), getOfficialAccounts()]).then(([geminiKey, twitterKey, searchQuery, officialList]) => {
      setGeminiApiKey(geminiKey)
      setTwitterApiKeyState(twitterKey)
      setTwitterSearchQueryState(searchQuery)
      setOfficialAccountsState(officialList)
    })

    chrome.storage.local.get([NOTIF_INCOMING_STORAGE_KEY, NOTIF_BALANCE_STORAGE_KEY], (result) => {
      setIncomingAlerts(readStoredBoolean(NOTIF_INCOMING_STORAGE_KEY, result[NOTIF_INCOMING_STORAGE_KEY], true))
      setBalanceAlerts(readStoredBoolean(NOTIF_BALANCE_STORAGE_KEY, result[NOTIF_BALANCE_STORAGE_KEY], true))
    })

    chrome.storage.local.get([VOICE_RESPONSES_STORAGE_KEY], (result) => {
      setVoiceResponsesEnabled(readStoredBoolean(VOICE_RESPONSES_STORAGE_KEY, result[VOICE_RESPONSES_STORAGE_KEY], false))
    })
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

  const handleToggleIncomingAlerts = async () => {
    const nextValue = !incomingAlerts
    setIncomingAlerts(nextValue)
    await chrome.storage.local.set({ [NOTIF_INCOMING_STORAGE_KEY]: nextValue })
  }

  const handleToggleBalanceAlerts = async () => {
    const nextValue = !balanceAlerts
    setBalanceAlerts(nextValue)
    await chrome.storage.local.set({ [NOTIF_BALANCE_STORAGE_KEY]: nextValue })
  }

  const handleToggleVoiceResponses = async () => {
    const nextValue = !voiceResponsesEnabled
    setVoiceResponsesEnabled(nextValue)
    await chrome.storage.local.set({ [VOICE_RESPONSES_STORAGE_KEY]: nextValue })
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

  const handleResetOfficialAccounts = async () => {
    const normalized = await setOfficialAccounts(DEFAULT_TWITTER_OFFICIAL_ACCOUNTS)
    setOfficialAccountsState(normalized)
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
            <div className="p-2 rounded-xl bg-arc-gold/10 text-arc-gold group-hover:bg-arc-gold/20 transition-colors">
              <Book size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-arc-text">{t('settings.addressBook')}</p>
              <p className="text-[10px] text-arc-text-dim">{t('settings.manageAddresses')}</p>
            </div>
          </div>
          <ChevronRight size={16} className="text-arc-text-dim group-hover:text-arc-gold transition-colors" />
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
                <div className="p-2 rounded-xl bg-arc-gold/10 text-arc-gold group-hover:bg-arc-gold/20 transition-colors">
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
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text focus:outline-none focus:border-arc-gold"
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveGemini()}
                />
                <button
                  onClick={handleSaveGemini}
                  className="bg-arc-gold text-arc-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
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
                <div className="p-2 rounded-xl bg-[#d4af37]/10 text-[#d4af37] group-hover:bg-[#d4af37]/20 transition-colors">
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
                      className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-[#d4af37] hover:bg-[#d4af37]/10 transition-colors"
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
                  className="flex-1 bg-arc-bg border border-arc-border rounded-lg px-3 py-1.5 text-xs text-arc-text focus:outline-none focus:border-[#d4af37]"
                  value={twitterTempKey}
                  onChange={(e) => setTwitterTempKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTwitterKey()}
                />
                <button
                  onClick={handleSaveTwitterKey}
                  className="bg-[#d4af37] text-arc-bg px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  {twitterApiKey ? t('settings.update') : t('settings.save')}
                </button>
              </div>
            </div>
          )}
          <div className="border-t border-arc-border/50 bg-arc-card/20 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-[#d4af37]/10 text-[#d4af37]">
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
                    className="shrink-0 text-[10px] font-semibold text-[#d4af37] underline-offset-2 hover:underline"
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
              <div className="p-2 rounded-xl bg-[#d4af37]/10 text-[#d4af37]">
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
                    className="shrink-0 text-[10px] font-semibold text-[#d4af37] underline-offset-2 hover:underline"
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
                <div className="p-2 rounded-xl bg-[#d4af37]/10 text-[#d4af37] group-hover:bg-[#d4af37]/20 transition-colors">
                  <Bell size={20} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-arc-text">{item.label}</p>
                  <p className="text-[10px] text-arc-text-dim">{item.description}</p>
                </div>
              </div>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                  item.enabled ? 'border-[#d4af37]/50 bg-[#d4af37]' : 'border-arc-border bg-arc-border/60'
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
                  <div className="p-2 rounded-xl bg-arc-gold/10 text-arc-gold group-hover:bg-arc-gold/20 transition-colors">
                    <Icon size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-arc-text">{item.label}</p>
                    <p className="text-[10px] text-arc-text-dim">{item.description}</p>
                  </div>
                </div>
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                    item.enabled ? 'border-[#d4af37]/50 bg-[#d4af37]' : 'border-arc-border bg-arc-border/60'
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
                                ? 'border-arc-gold bg-arc-gold/10 text-arc-gold'
                                : 'border-arc-border text-arc-text-dim hover:border-arc-gold/30 hover:text-arc-text'
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
                <p className="mt-1 text-sm font-semibold text-arc-gold">v{APP_VERSION}</p>
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
