import { formatAddress } from '@/lib/utils'
import { REMINDERS } from '@/lib/storageKeys'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet } from '@/lib/external'

export type Reminder = {
  id: string
  title: string
  recipient?: string
  amount?: string
  frequency: 'daily' | 'weekly' | 'monthly'
  dayOfWeek?: number
  dayOfMonth?: number
  lastTriggered?: string
  createdAt: string
}

const REMINDER_NOTIFIED_PREFIX = 'arccopilot:reminders:last-notified:'

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function chromeGet(keys: string | string[]): Promise<Record<string, unknown>> {
  return chromeStorageGet(keys)
}

function chromeSet(items: Record<string, unknown>): Promise<void> {
  return chromeStorageSet(items)
}

function chromeRemove(keys: string | string[]): Promise<void> {
  return chromeStorageRemove(keys)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.floor(parsed)
  }

  return null
}

function createReminderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeReminder(raw: unknown): Reminder | null {
  if (!isRecord(raw)) return null

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Reminder'
  const frequencyRaw = typeof raw.frequency === 'string' ? raw.frequency.trim().toLowerCase() : 'daily'
  const frequency: Reminder['frequency'] =
    frequencyRaw === 'weekly' || frequencyRaw === 'monthly' ? frequencyRaw : 'daily'
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : new Date().toISOString()

  const dayOfWeek = toFiniteNumber(raw.dayOfWeek)
  const dayOfMonth = toFiniteNumber(raw.dayOfMonth)
  const normalizedDayOfWeek = dayOfWeek != null && dayOfWeek >= 0 && dayOfWeek <= 6 ? dayOfWeek : undefined
  const normalizedDayOfMonth = dayOfMonth != null && dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : undefined
  const fallbackId = `reminder-${createdAt}-${title}-${frequency}`.replace(/\s+/g, '-')

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId,
    title,
    recipient: typeof raw.recipient === 'string' && raw.recipient.trim() ? raw.recipient.trim() : undefined,
    amount: typeof raw.amount === 'string' && raw.amount.trim() ? raw.amount.trim() : undefined,
    frequency,
    dayOfWeek: frequency === 'weekly' ? normalizedDayOfWeek : undefined,
    dayOfMonth: frequency === 'monthly' ? normalizedDayOfMonth : undefined,
    lastTriggered: typeof raw.lastTriggered === 'string' && raw.lastTriggered.trim() ? raw.lastTriggered.trim() : undefined,
    createdAt,
  }
}

function isDueToday(reminder: Reminder, todayKey: string, todayWeekday: number, todayDayOfMonth: number): boolean {
  if (reminder.lastTriggered && getLocalDateKey(new Date(reminder.lastTriggered)) === todayKey) {
    return false
  }

  switch (reminder.frequency) {
    case 'daily':
      return true
    case 'weekly':
      return reminder.dayOfWeek === todayWeekday
    case 'monthly':
      return reminder.dayOfMonth === todayDayOfMonth
    default:
      return false
  }
}

function formatRecipient(recipient?: string): string | null {
  const trimmed = recipient?.trim()
  if (!trimmed) return null
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(trimmed)
  return isAddress ? formatAddress(trimmed, 4) : trimmed
}

function getReminderNotifiedKey(id: string): string {
  return `${REMINDER_NOTIFIED_PREFIX}${id}`
}

async function saveReminders(reminders: Reminder[]): Promise<void> {
  if (!canUseChromeStorage()) return
  await chromeSet({
    [REMINDERS]: reminders,
  })
}

export async function getReminders(): Promise<Reminder[]> {
  const stored = await chromeGet(REMINDERS)
  const raw = stored[REMINDERS]

  if (!Array.isArray(raw)) {
    if (Object.prototype.hasOwnProperty.call(stored, REMINDERS)) {
      await chromeRemove(REMINDERS)
    }
    return []
  }

  const reminders = raw
    .map((item) => normalizeReminder(item))
    .filter((item): item is Reminder => Boolean(item))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  if (reminders.length !== raw.length) {
    await saveReminders(reminders)
  }

  return reminders
}

export async function addReminder(reminder: Reminder): Promise<void> {
  const nextReminder = normalizeReminder(reminder)
  if (!nextReminder) return

  const current = await getReminders()
  const index = current.findIndex((item) => item.id === nextReminder.id)
  const next = index >= 0
    ? current.map((item, itemIndex) => (itemIndex === index ? nextReminder : item))
    : [...current, nextReminder]

  await saveReminders(next)
}

export async function removeReminder(id: string): Promise<void> {
  const current = await getReminders()
  const next = current.filter((item) => item.id !== id)
  await saveReminders(next)
  await chromeRemove(getReminderNotifiedKey(id))
}

export async function markReminderTriggered(id: string, triggeredAt: string = new Date().toISOString()): Promise<void> {
  const current = await getReminders()
  const next = current.map((item) => (item.id === id ? { ...item, lastTriggered: triggeredAt } : item))
  await saveReminders(next)
}

export async function getDueReminders(): Promise<Reminder[]> {
  const reminders = await getReminders()
  const now = new Date()
  const todayKey = getLocalDateKey(now)
  const todayWeekday = now.getDay()
  const todayDayOfMonth = now.getDate()

  return reminders.filter((reminder) => isDueToday(reminder, todayKey, todayWeekday, todayDayOfMonth))
}

export function getReminderScheduleLabel(reminder: Reminder): string {
  switch (reminder.frequency) {
    case 'daily':
      return 'Every day'
    case 'weekly':
      return typeof reminder.dayOfWeek === 'number'
        ? `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][reminder.dayOfWeek] ?? 'week'}`
        : 'Every week'
    case 'monthly':
      return typeof reminder.dayOfMonth === 'number'
        ? `Every month on ${reminder.dayOfMonth}`
        : 'Every month'
    default:
      return 'Reminder'
  }
}

export function getReminderDetails(reminder: Reminder): string {
  const parts = [getReminderScheduleLabel(reminder)]
  const recipient = formatRecipient(reminder.recipient)
  const amount = reminder.amount?.trim() ? `${reminder.amount.trim()} USDC` : null

  if (recipient || amount) {
    const prefillBits = [recipient, amount].filter(Boolean).join(' · ')
    parts.push(`Prefills Send${prefillBits ? `: ${prefillBits}` : ''}`)
  }

  return parts.join(' · ')
}

export function getReminderNotificationMessage(reminder: Reminder): string {
  const recipient = formatRecipient(reminder.recipient)
  const amount = reminder.amount?.trim() ? `${reminder.amount.trim()} USDC` : null

  if (recipient && amount) {
    return `${reminder.title} - ${recipient}, ${amount}`
  }

  if (recipient) {
    return `${reminder.title} - ${recipient}`
  }

  if (amount) {
    return `${reminder.title} - ${amount}`
  }

  return reminder.title
}

export function buildReminderFromAction(input: {
  title: string
  recipient?: string
  amount?: string
  frequency: Reminder['frequency']
  dayOfWeek?: number
  dayOfMonth?: number
}): Reminder {
  const normalizedFrequency = input.frequency === 'weekly' || input.frequency === 'monthly' ? input.frequency : 'daily'
  return {
    id: createReminderId(),
    title: input.title.trim() || 'Reminder',
    recipient: input.recipient?.trim() || undefined,
    amount: input.amount?.trim() || undefined,
    frequency: normalizedFrequency,
    dayOfWeek:
      normalizedFrequency === 'weekly' && typeof input.dayOfWeek === 'number' && input.dayOfWeek >= 0 && input.dayOfWeek <= 6
        ? input.dayOfWeek
        : undefined,
    dayOfMonth:
      normalizedFrequency === 'monthly' && typeof input.dayOfMonth === 'number' && input.dayOfMonth >= 1 && input.dayOfMonth <= 31
        ? input.dayOfMonth
        : undefined,
    createdAt: new Date().toISOString(),
  }
}
