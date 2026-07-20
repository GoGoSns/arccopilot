import { chromeStorageGet, chromeStorageRemove, chromeStorageSet } from '@/lib/external'
import { formatText, getLocaleSync, t } from '@/lib/i18n'
import { REMINDERS } from '@/lib/storageKeys'
import { formatRelativeTime } from '@/lib/utils'
import { generateTipSuggestions, type TipAdvisorResult } from '@/lib/tipAdvisor'
import { buildPortfolioIntel, type PortfolioIntelResult } from '@/lib/portfolioIntel'
import { planAutoTips, type AutoTipPlanResult } from '@/lib/autoTip'
import { discoverCreators, type CreatorDiscoveryResult } from '@/lib/creatorDiscovery'
import { fetchNews, getCachedNewsSnapshot, getNewsPulseState, type NewsItem } from '@/lib/newsPulse'

export interface PlannerReminder {
  id: string
  text: string
  dueAt?: string
  createdAt: string
  done: boolean
}

export interface TaskSuggestion {
  id: string
  title: string
  reason: string
  actionHint: string
}

export interface TaskSuggestionContext {
  tipAdvisor?: TipAdvisorResult | null
  portfolioIntel?: PortfolioIntelResult | null
  autoTipPlan?: AutoTipPlanResult | null
  creatorDiscovery?: CreatorDiscoveryResult | null
  newsItems?: NewsItem[] | null
  newsFetchedAt?: number | null
}

const PLANNER_STORAGE_KEY = REMINDERS
const REMINDER_NOTICE_PREVIEW_LIMIT = 3
const FUTURE_RELATIVE_RANGES: Array<{ limitMs: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limitMs: 60_000, unit: 'second' },
  { limitMs: 60 * 60_000, unit: 'minute' },
  { limitMs: 24 * 60 * 60_000, unit: 'hour' },
  { limitMs: 7 * 24 * 60 * 60_000, unit: 'day' },
]
const IMPORTANT_NEWS_KEYWORDS = [
  'launch',
  'launches',
  'launching',
  'announce',
  'announcement',
  'update',
  'upgrade',
  'mainnet',
  'airdrop',
  'grant',
  'hackathon',
  'partnership',
  'release',
  'beta',
  'security',
  'funding',
  'ecosystem',
]

type StoredPlannerReminder = Partial<{
  id: unknown
  text: unknown
  dueAt: unknown
  createdAt: unknown
  done: unknown
}>

type LegacyReminder = Partial<{
  id: unknown
  title: unknown
  recipient: unknown
  amount: unknown
  createdAt: unknown
  done: unknown
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createReminderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeReminderText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeReminderDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return undefined

  return new Date(timestamp).toISOString()
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return undefined

  return parsed.toISOString()
}

function normalizeReminderDone(value: unknown): boolean {
  return value === true
}

function normalizePlannerReminder(raw: unknown): PlannerReminder | null {
  if (!isRecord(raw)) return null

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createReminderId()
  const createdAt = normalizeIsoDate(raw.createdAt) ?? new Date().toISOString()
  const text = normalizeReminderText(raw.text)
  const dueAt = normalizeReminderDate(raw.dueAt)
  const done = normalizeReminderDone(raw.done)

  if (text) {
    return {
      id,
      text,
      dueAt,
      createdAt,
      done,
    }
  }

  const legacy = normalizeLegacyReminder(raw)
  if (!legacy) return null

  return legacy
}

function normalizeLegacyReminder(raw: Record<string, unknown>): PlannerReminder | null {
  const title = normalizeReminderText(raw.title)
  if (!title) return null

  const recipient = normalizeReminderText(raw.recipient)
  const amount = normalizeReminderText(raw.amount)
  const textParts = [title]

  if (recipient) {
    textParts.push(recipient)
  }

  if (amount) {
    textParts.push(`${amount} USDC`)
  }

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createReminderId(),
    text: textParts.join(' - '),
    createdAt: normalizeIsoDate(raw.createdAt) ?? new Date().toISOString(),
    done: normalizeReminderDone(raw.done),
  }
}

function compareReminderDates(left: PlannerReminder, right: PlannerReminder): number {
  const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY
  const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY

  if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt

  const leftCreatedAt = new Date(left.createdAt).getTime()
  const rightCreatedAt = new Date(right.createdAt).getTime()
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt

  return left.id.localeCompare(right.id)
}

function sortReminders(reminders: PlannerReminder[]): PlannerReminder[] {
  const now = Date.now()

  return [...reminders].sort((left, right) => {
    if (left.done !== right.done) {
      return left.done ? 1 : -1
    }

    const leftHasDue = Boolean(left.dueAt)
    const rightHasDue = Boolean(right.dueAt)
    const leftDuePast = leftHasDue && new Date(left.dueAt as string).getTime() <= now
    const rightDuePast = rightHasDue && new Date(right.dueAt as string).getTime() <= now

    if (leftDuePast !== rightDuePast) {
      return leftDuePast ? -1 : 1
    }

    if (leftHasDue !== rightHasDue) {
      return leftHasDue ? -1 : 1
    }

    return compareReminderDates(left, right)
  })
}

function saveReminders(reminders: PlannerReminder[]): Promise<void> {
  return chromeStorageSet({
    [PLANNER_STORAGE_KEY]: reminders,
  })
}

async function readStoredReminders(): Promise<{ reminders: PlannerReminder[]; changed: boolean }> {
  const stored = await chromeStorageGet(PLANNER_STORAGE_KEY)
  const hasKey = Object.prototype.hasOwnProperty.call(stored, PLANNER_STORAGE_KEY)

  if (!hasKey) {
    return {
      reminders: [],
      changed: false,
    }
  }

  const raw = stored[PLANNER_STORAGE_KEY]
  if (!Array.isArray(raw)) {
    await chromeStorageRemove(PLANNER_STORAGE_KEY)
    return {
      reminders: [],
      changed: true,
    }
  }

  let changed = false
  const reminders = raw
    .map((item) => {
      const reminder = normalizePlannerReminder(item)
      if (!reminder) {
        changed = true
      }
      return reminder
    })
    .filter((item): item is PlannerReminder => Boolean(item))

  if (reminders.length !== raw.length) {
    changed = true
  }

  return {
    reminders: sortReminders(reminders),
    changed,
  }
}

function countReminderStates(reminders: PlannerReminder[]): {
  total: number
  pending: number
  due: number
  upcoming: number
  done: number
} {
  const now = Date.now()
  let due = 0
  let upcoming = 0
  let done = 0

  for (const reminder of reminders) {
    if (reminder.done) {
      done += 1
      continue
    }

    if (!reminder.dueAt) {
      upcoming += 1
      continue
    }

    const dueAt = new Date(reminder.dueAt).getTime()
    if (Number.isFinite(dueAt) && dueAt <= now) {
      due += 1
    } else {
      upcoming += 1
    }
  }

  return {
    total: reminders.length,
    pending: reminders.length - done,
    due,
    upcoming,
    done,
  }
}

function getFutureRelativeLabel(dueAt: string): string {
  const locale = getLocaleSync() === 'tr' ? 'tr' : 'en'
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = new Date(dueAt).getTime() - Date.now()
  const abs = Math.abs(diff)
  const bucket = FUTURE_RELATIVE_RANGES.find((entry) => abs < entry.limitMs) ?? FUTURE_RELATIVE_RANGES[FUTURE_RELATIVE_RANGES.length - 1]

  switch (bucket.unit) {
    case 'second':
      return rtf.format(Math.max(1, Math.round(diff / 1000)), 'second')
    case 'minute':
      return rtf.format(Math.max(1, Math.round(diff / 60_000)), 'minute')
    case 'hour':
      return rtf.format(Math.max(1, Math.round(diff / 3_600_000)), 'hour')
    case 'day':
    default:
      return rtf.format(Math.max(1, Math.round(diff / 86_400_000)), 'day')
  }
}

function getReminderDueState(reminder: PlannerReminder, now = Date.now()): 'done' | 'overdue' | 'due' | 'upcoming' | 'unscheduled' {
  if (reminder.done) return 'done'
  if (!reminder.dueAt) return 'unscheduled'

  const dueAt = new Date(reminder.dueAt).getTime()
  if (!Number.isFinite(dueAt)) return 'unscheduled'
  if (dueAt < now - 5 * 60_000) return 'overdue'
  if (dueAt <= now + 5 * 60_000) return 'due'
  return 'upcoming'
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function isImportantNewsItem(item: NewsItem): boolean {
  const normalizedTitle = item.title.trim().toLowerCase()
  return IMPORTANT_NEWS_KEYWORDS.some((keyword) => normalizedTitle.includes(keyword))
}

function formatSuggestionNumber(value: string | number | null | undefined): string {
  if (value == null) return '0'
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(parsed)) return String(value)
  return parsed.toLocaleString(getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US', {
    maximumFractionDigits: 6,
  })
}

export async function listReminders(): Promise<PlannerReminder[]> {
  const { reminders, changed } = await readStoredReminders()
  const state = countReminderStates(reminders)

  if (changed) {
    await saveReminders(reminders)
  }

  console.log('[PLANNER]', {
    status: 'reminders',
    count: state.total,
    pending: state.pending,
    due: state.due,
    upcoming: state.upcoming,
    done: state.done,
  })

  return reminders
}

export async function addReminder(text: string, dueAt?: string): Promise<PlannerReminder> {
  const reminder: PlannerReminder = {
    id: createReminderId(),
    text: normalizeReminderText(text) || t('planner.reminderFallback'),
    dueAt: normalizeReminderDate(dueAt),
    createdAt: new Date().toISOString(),
    done: false,
  }

  const current = await listReminders()
  const next = sortReminders([...current, reminder])
  await saveReminders(next)

  const state = countReminderStates(next)
  console.log('[PLANNER]', {
    status: 'reminder-added',
    reminderId: reminder.id,
    count: state.total,
    pending: state.pending,
    due: state.due,
  })

  return reminder
}

export async function completeReminder(id: string): Promise<boolean> {
  const normalizedId = id.trim()
  if (!normalizedId) return false

  const current = await listReminders()
  let changed = false

  const next = current.map((reminder) => {
    if (reminder.id !== normalizedId) return reminder
    if (reminder.done) return reminder
    changed = true
    return {
      ...reminder,
      done: true,
    }
  })

  if (!changed) {
    console.log('[PLANNER]', {
      status: 'reminder-complete-miss',
      reminderId: normalizedId,
      count: current.length,
    })
    return false
  }

  await saveReminders(sortReminders(next))
  const state = countReminderStates(next)
  console.log('[PLANNER]', {
    status: 'reminder-completed',
    reminderId: normalizedId,
    count: state.total,
    pending: state.pending,
    done: state.done,
  })

  return true
}

export async function snoozeReminder(id: string, durationMs = 24 * 60 * 60 * 1000): Promise<PlannerReminder | null> {
  const normalizedId = id.trim()
  if (!normalizedId || !Number.isFinite(durationMs) || durationMs <= 0) return null

  const current = await listReminders()
  const target = current.find((reminder) => reminder.id === normalizedId)
  if (!target) return null

  const currentDueAt = target.dueAt ? new Date(target.dueAt).getTime() : Number.NaN
  const baseTime = Number.isFinite(currentDueAt) && currentDueAt > Date.now()
    ? currentDueAt
    : Date.now()
  const updated: PlannerReminder = {
    ...target,
    dueAt: new Date(baseTime + durationMs).toISOString(),
    done: false,
  }
  const next = current.map((reminder) => reminder.id === normalizedId ? updated : reminder)

  await saveReminders(sortReminders(next))
  console.log('[PLANNER]', {
    status: 'reminder-snoozed',
    reminderId: normalizedId,
    dueAt: updated.dueAt,
  })

  return updated
}

export async function deleteReminder(id: string): Promise<boolean> {
  const normalizedId = id.trim()
  if (!normalizedId) return false

  const current = await listReminders()
  const next = current.filter((reminder) => reminder.id !== normalizedId)

  if (next.length === current.length) {
    console.log('[PLANNER]', {
      status: 'reminder-delete-miss',
      reminderId: normalizedId,
      count: current.length,
    })
    return false
  }

  await saveReminders(next)
  const state = countReminderStates(next)
  console.log('[PLANNER]', {
    status: 'reminder-deleted',
    reminderId: normalizedId,
    count: state.total,
    pending: state.pending,
  })

  return true
}

export async function getDueReminders(): Promise<PlannerReminder[]> {
  const reminders = await listReminders()
  const now = Date.now()
  const dueReminders = reminders.filter((reminder) => {
    if (reminder.done || !reminder.dueAt) return false
    const dueAt = new Date(reminder.dueAt).getTime()
    return Number.isFinite(dueAt) && dueAt <= now
  })

  return dueReminders
}

export function getReminderDueLabel(reminder: PlannerReminder, now = Date.now()): string {
  const state = getReminderDueState(reminder, now)

  switch (state) {
    case 'done':
      return t('planner.done')
    case 'overdue':
      return `${t('planner.overdue')} - ${formatRelativeTime(reminder.dueAt as string)}`
    case 'due':
      return t('planner.dueNow')
    case 'upcoming':
      return getFutureRelativeLabel(reminder.dueAt as string)
    case 'unscheduled':
    default:
      return t('planner.noDueDate')
  }
}

export function getReminderStatusLabel(reminder: PlannerReminder, now = Date.now()): string {
  const state = getReminderDueState(reminder, now)

  switch (state) {
    case 'done':
      return t('planner.done')
    case 'overdue':
      return t('planner.overdue')
    case 'due':
      return t('planner.dueNow')
    case 'upcoming':
      return t('planner.upcoming')
    case 'unscheduled':
    default:
      return t('planner.noDueDate')
  }
}

export function getReminderPreview(reminder: PlannerReminder, now = Date.now()): string {
  const dueLabel = getReminderDueLabel(reminder, now)

  if (!reminder.dueAt) {
    return reminder.text
  }

  return `${reminder.text} - ${dueLabel}`
}

export function findReminderMatches(reminders: PlannerReminder[], query: string): PlannerReminder[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return []

  const byId = reminders.filter((reminder) => reminder.id.toLowerCase().startsWith(normalizedQuery))
  if (byId.length > 0) {
    return byId
  }

  return reminders.filter((reminder) => normalizeQuery(reminder.text).includes(normalizedQuery))
}

function buildTaskSuggestionId(kind: string, hint: string): string {
  return `${kind}:${hint}`.toLowerCase().replace(/[^a-z0-9:]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function addSuggestion(
  suggestions: TaskSuggestion[],
  firedPreconditions: string[],
  suggestion: TaskSuggestion,
  precondition: string,
): void {
  if (suggestions.some((item) => item.id === suggestion.id)) return
  suggestions.push(suggestion)
  firedPreconditions.push(precondition)
}

function isLateInWeek(date = new Date()): boolean {
  return date.getDay() >= 4
}

function toPlainNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(parsed)) return null
  return parsed
}

export async function generateTaskSuggestions(context: TaskSuggestionContext = {}): Promise<TaskSuggestion[]> {
  const now = Date.now()
  const suggestions: TaskSuggestion[] = []
  const firedPreconditions: string[] = []

  const tipAdvisorPromise = context.tipAdvisor
    ? Promise.resolve(context.tipAdvisor)
    : generateTipSuggestions().catch((error) => {
        console.log('[PLANNER]', {
          status: 'tip-advisor-failed',
          error: error instanceof Error ? error.message : 'unknown',
        })
        return null
      })

  const portfolioPromise = context.portfolioIntel
    ? Promise.resolve(context.portfolioIntel)
    : buildPortfolioIntel().catch((error) => {
        console.log('[PLANNER]', {
          status: 'portfolio-intel-failed',
          error: error instanceof Error ? error.message : 'unknown',
        })
        return null
      })

  const autoTipPromise = context.autoTipPlan
    ? Promise.resolve(context.autoTipPlan)
    : planAutoTips().catch((error) => {
        console.log('[PLANNER]', {
          status: 'auto-tip-plan-failed',
          error: error instanceof Error ? error.message : 'unknown',
        })
        return null
      })

  const discoveryPromise = context.creatorDiscovery
    ? Promise.resolve(context.creatorDiscovery)
    : discoverCreators().catch((error) => {
        console.log('[PLANNER]', {
          status: 'creator-discovery-failed',
          error: error instanceof Error ? error.message : 'unknown',
        })
        return null
      })

  const newsPromise = context.newsItems
    ? Promise.resolve({
        items: context.newsItems,
        fetchedAt: context.newsFetchedAt ?? null,
      })
    : (async () => {
        const items = await fetchNews().catch((error) => {
          console.log('[PLANNER]', {
            status: 'news-fetch-failed',
            error: error instanceof Error ? error.message : 'unknown',
          })
          return []
        })
        const cached = await getCachedNewsSnapshot().catch(() => null)
        const state = getNewsPulseState()
        return {
          items,
          fetchedAt: cached?.fetchedAt ?? state.fetchedAt,
        }
      })()

  const [tipAdvisor, portfolioIntel, autoTipPlan, creatorDiscovery, newsSnapshot] = await Promise.all([
    tipAdvisorPromise,
    portfolioPromise,
    autoTipPromise,
    discoveryPromise,
    newsPromise,
  ])

  const strongestTip = tipAdvisor?.suggestions?.[0]
  if (strongestTip && strongestTip.handle && strongestTip.amount) {
    addSuggestion(
      suggestions,
      firedPreconditions,
      {
        id: buildTaskSuggestionId('tip', strongestTip.handle),
        title: formatText('planner.tipTitle', {
          handle: `@${strongestTip.handle}`,
          amount: formatSuggestionNumber(strongestTip.amount),
        }),
        reason: strongestTip.reason,
        actionHint: t('planner.tipActionHint'),
      },
      'tipAdvisor:strong',
    )
  }

  const gatewayAvailable = toPlainNumber(portfolioIntel?.gatewayAvailable ?? null)
  const recentTipTotal = toPlainNumber(portfolioIntel?.recentTipTotal ?? null)
  if (gatewayAvailable != null && recentTipTotal != null && recentTipTotal > 0 && gatewayAvailable < recentTipTotal) {
    addSuggestion(
      suggestions,
      firedPreconditions,
      {
        id: buildTaskSuggestionId('gateway-top-up', `${gatewayAvailable}:${recentTipTotal}`),
        title: t('planner.gatewayTopUpTitle'),
        reason: formatText('planner.gatewayTopUpReason', {
          available: formatSuggestionNumber(gatewayAvailable),
          recentTipTotal: formatSuggestionNumber(recentTipTotal),
        }),
        actionHint: t('planner.gatewayTopUpHint'),
      },
      'portfolio:gateway-low',
    )
  }

  if (autoTipPlan?.enabled && autoTipPlan.availableBudgetUsdc > 0 && autoTipPlan.periodBudgetUsdc > 0) {
    const remainingShare = autoTipPlan.remainingAfterPlanUsdc / autoTipPlan.periodBudgetUsdc
    if (isLateInWeek(new Date(now)) && remainingShare >= 0.5) {
      addSuggestion(
        suggestions,
        firedPreconditions,
        {
          id: buildTaskSuggestionId('auto-budget', String(autoTipPlan.remainingAfterPlanUsdc)),
          title: formatText('planner.autoBudgetTitle', {
            remaining: formatSuggestionNumber(autoTipPlan.remainingAfterPlanUsdc),
          }),
          reason: formatText('planner.autoBudgetReason', {
            remaining: formatSuggestionNumber(autoTipPlan.remainingAfterPlanUsdc),
            budget: formatSuggestionNumber(autoTipPlan.periodBudgetUsdc),
          }),
          actionHint: t('planner.autoBudgetHint'),
        },
        'autoTip:unused-late-week',
      )
    }
  }

  const discoveredCandidates = creatorDiscovery?.candidates ?? []
  const discoveredCandidate = discoveredCandidates[0]
  if (discoveredCandidate?.handle) {
    addSuggestion(
      suggestions,
      firedPreconditions,
      {
        id: buildTaskSuggestionId('creator-address', discoveredCandidate.handle),
        title: formatText('planner.creatorAddressTitle', {
          handle: `@${discoveredCandidate.handle}`,
        }),
        reason: formatText('planner.creatorAddressReason', {
          handle: `@${discoveredCandidate.handle}`,
          count: discoveredCandidates.length,
        }),
        actionHint: t('planner.creatorAddressHint'),
      },
      'discovery:missing-address',
    )
  }

  const newsItems = newsSnapshot.items ?? []
  const fetchedAt = newsSnapshot.fetchedAt ?? null
  const isFresh = typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && now - fetchedAt < 24 * 60 * 60_000
  const importantNews = newsItems.filter((item) => isImportantNewsItem(item))

  if (isFresh && importantNews.length > 0) {
    const leadItem = importantNews[0]
    addSuggestion(
      suggestions,
      firedPreconditions,
      {
        id: buildTaskSuggestionId('news', leadItem.title),
        title: t('planner.newsTitle'),
        reason: formatText('planner.newsReason', {
          count: importantNews.length,
          headline: leadItem.title,
        }),
        actionHint: t('planner.newsHint'),
      },
      'news:fresh-important',
    )
  }

  console.log('[PLANNER]', {
    status: 'suggestions',
    count: suggestions.length,
    triggers: firedPreconditions,
  })

  return suggestions
}

export function getPlannerStorageKey(): string {
  return PLANNER_STORAGE_KEY
}
