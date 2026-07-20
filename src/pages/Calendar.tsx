import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { getLocaleSync, t } from '@/lib/i18n'
import {
  addReminder,
  completeReminder,
  deleteReminder,
  getPlannerStorageKey,
  listReminders,
  snoozeReminder,
  type PlannerReminder,
} from '@/lib/planner'
import { getSchedules, isPaired, type UserAgentSchedule } from '@/lib/pairing'
import { useStore } from '@/lib/store'
import { formatAddress } from '@/lib/utils'

interface CalendarProps {
  onBack: () => void
}

interface ScheduleOccurrence {
  id: string
  at: Date
  schedule: UserAgentSchedule
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toLocalDateTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${localDateKey(date)}T${hours}:${minutes}`
}

function defaultReminderTime(day: Date): Date {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0)
  if (localDateKey(day) === localDateKey(new Date()) && next.getTime() <= Date.now()) {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    now.setHours(now.getHours() + 1)
    return now
  }
  return next
}

function getMonthCells(month: Date): Date[] {
  const first = startOfMonth(month)
  const mondayOffset = (first.getDay() + 6) % 7
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset)

  return Array.from({ length: 42 }, (_, index) => (
    new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
  ))
}

function getScheduleOccurrences(schedules: UserAgentSchedule[], month: Date): ScheduleOccurrence[] {
  const monthStart = startOfMonth(month).getTime()
  const monthEnd = endOfMonth(month).getTime()
  const occurrences: ScheduleOccurrence[] = []

  for (const schedule of schedules) {
    if (!schedule.enabled) continue
    const firstRun = new Date(schedule.nextRunAt).getTime()
    const intervalMs = schedule.intervalHours * 60 * 60 * 1000
    if (!Number.isFinite(firstRun) || !Number.isFinite(intervalMs) || intervalMs <= 0) continue

    const skipped = firstRun < monthStart ? Math.ceil((monthStart - firstRun) / intervalMs) : 0
    let runAt = firstRun + skipped * intervalMs
    let generated = 0

    while (runAt <= monthEnd && generated < 1024) {
      occurrences.push({
        id: `${schedule.id}:${runAt}`,
        at: new Date(runAt),
        schedule,
      })
      runAt += intervalMs
      generated += 1
    }
  }

  return occurrences.sort((left, right) => left.at.getTime() - right.at.getTime())
}

function formatDay(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

function formatTime(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function Calendar({ onBack }: CalendarProps) {
  const setCurrentView = useStore((state) => state.setCurrentView)
  const locale = getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US'
  const today = useMemo(() => new Date(), [])
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDay, setSelectedDay] = useState(() => new Date())
  const [reminders, setReminders] = useState<PlannerReminder[]>([])
  const [schedules, setSchedules] = useState<UserAgentSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [scheduleError, setScheduleError] = useState(false)
  const [reminderText, setReminderText] = useState('')
  const [dueAtInput, setDueAtInput] = useState(() => toLocalDateTimeInput(defaultReminderTime(new Date())))
  const [formError, setFormError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadReminders = async () => {
    try {
      setReminders(await listReminders())
    } finally {
      setLoading(false)
    }
  }

  const loadSchedules = async () => {
    setScheduleError(false)
    try {
      if (!(await isPaired())) {
        setSchedules([])
        return
      }
      setSchedules(await getSchedules())
    } catch {
      setSchedules([])
      setScheduleError(true)
    }
  }

  useEffect(() => {
    void loadReminders()
    void loadSchedules()

    const reminderStorageKey = getPlannerStorageKey()
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && changes[reminderStorageKey]) {
        void loadReminders()
      }
    }
    chrome.storage.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.onChanged.removeListener(onStorageChanged)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const monthCells = useMemo(() => getMonthCells(visibleMonth), [visibleMonth])
  const scheduleOccurrences = useMemo(
    () => getScheduleOccurrences(schedules, visibleMonth),
    [schedules, visibleMonth],
  )
  const weekdayLabels = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const monday = new Date(2024, 0, 1 + index)
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(monday)
  }), [locale])

  const remindersByDay = useMemo(() => {
    const map = new Map<string, PlannerReminder[]>()
    for (const reminder of reminders) {
      if (!reminder.dueAt) continue
      const parsed = new Date(reminder.dueAt)
      if (Number.isNaN(parsed.getTime())) continue
      const key = localDateKey(parsed)
      map.set(key, [...(map.get(key) ?? []), reminder])
    }
    return map
  }, [reminders])

  const schedulesByDay = useMemo(() => {
    const map = new Map<string, ScheduleOccurrence[]>()
    for (const occurrence of scheduleOccurrences) {
      const key = localDateKey(occurrence.at)
      map.set(key, [...(map.get(key) ?? []), occurrence])
    }
    return map
  }, [scheduleOccurrences])

  const selectedKey = localDateKey(selectedDay)
  const selectedReminders = remindersByDay.get(selectedKey) ?? []
  const selectedSchedules = schedulesByDay.get(selectedKey) ?? []
  const unscheduledReminders = reminders.filter((reminder) => !reminder.dueAt && !reminder.done)

  const selectDay = (day: Date) => {
    setSelectedDay(day)
    setDueAtInput(toLocalDateTimeInput(defaultReminderTime(day)))
    if (day.getMonth() !== visibleMonth.getMonth() || day.getFullYear() !== visibleMonth.getFullYear()) {
      setVisibleMonth(startOfMonth(day))
    }
  }

  const changeMonth = (offset: number) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1)
    setVisibleMonth(next)
    setSelectedDay(next)
    setDueAtInput(toLocalDateTimeInput(defaultReminderTime(next)))
  }

  const goToday = () => selectDay(new Date())

  const handleAddReminder = async (event: FormEvent) => {
    event.preventDefault()
    const text = reminderText.trim()
    const dueAt = new Date(dueAtInput)
    if (!text || !dueAtInput || Number.isNaN(dueAt.getTime())) {
      setFormError(t('calendar.invalidReminder'))
      return
    }

    setFormError('')
    setBusyId('create')
    try {
      await addReminder(text, dueAt.toISOString())
      setReminderText('')
      selectDay(dueAt)
      await loadReminders()
    } finally {
      setBusyId(null)
    }
  }

  const runReminderAction = async (id: string, action: 'complete' | 'snooze' | 'delete') => {
    setBusyId(`${action}:${id}`)
    try {
      if (action === 'complete') await completeReminder(id)
      if (action === 'snooze') await snoozeReminder(id, DAY_MS)
      if (action === 'delete') await deleteReminder(id)
      await loadReminders()
    } finally {
      setBusyId(null)
    }
  }

  const renderReminder = (reminder: PlannerReminder, compact = false) => {
    const dueAt = reminder.dueAt ? new Date(reminder.dueAt) : null
    const isOverdue = Boolean(dueAt && !reminder.done && dueAt.getTime() < Date.now())
    return (
      <div key={reminder.id} className="rounded-xl border border-arc-border/70 bg-arc-card/70 p-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
            reminder.done
              ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
              : isOverdue
                ? 'border-arc-accent/30 bg-arc-accent/10 text-arc-accent'
                : 'border-arc-border bg-arc-elevated text-arc-text-dim'
          }`}>
            {reminder.done ? <Check size={14} /> : <Bell size={14} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm leading-relaxed ${reminder.done ? 'text-arc-text-dim line-through' : 'text-arc-text'}`}>
              {reminder.text}
            </p>
            <p className={`mt-1 text-[10px] uppercase tracking-widest ${isOverdue ? 'text-arc-accent' : 'text-arc-text-dim'}`}>
              {dueAt ? `${isOverdue ? `${t('planner.overdue')} · ` : ''}${formatTime(dueAt, locale)}` : t('planner.noDueDate')}
            </p>
            {!reminder.done && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runReminderAction(reminder.id, 'complete')}
                  disabled={Boolean(busyId)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-arc-border px-2 text-[10px] text-arc-text-dim transition-colors hover:text-arc-text disabled:opacity-40"
                >
                  <Check size={12} /> {t('planner.complete')}
                </button>
                {!compact && (
                  <button
                    type="button"
                    onClick={() => void runReminderAction(reminder.id, 'snooze')}
                    disabled={Boolean(busyId)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-arc-border px-2 text-[10px] text-arc-text-dim transition-colors hover:text-arc-text disabled:opacity-40"
                  >
                    <RotateCcw size={12} /> {t('calendar.snoozeTomorrow')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void runReminderAction(reminder.id, 'delete')}
                  disabled={Boolean(busyId)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-arc-border px-2 text-[10px] text-arc-text-dim transition-colors hover:text-arc-danger disabled:opacity-40"
                >
                  <Trash2 size={12} /> {t('planner.delete')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-arc-bg">
      <header className="flex shrink-0 items-center justify-between border-b border-arc-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-lg p-1.5 text-arc-text-dim transition-colors hover:text-arc-text" aria-label={t('gogo.back')}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-base font-semibold text-arc-text">{t('calendar.title')}</h2>
            <p className="text-[10px] text-arc-text-dim">{t('calendar.subtitle')}</p>
          </div>
        </div>
        <CalendarDays size={19} className="text-arc-accent" />
      </header>

      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="overflow-hidden rounded-2xl border border-arc-border bg-arc-card/50">
          <div className="flex items-center justify-between border-b border-arc-border/70 px-3 py-3">
            <button type="button" onClick={() => changeMonth(-1)} className="rounded-lg p-2 text-arc-text-dim hover:bg-arc-elevated hover:text-arc-text" aria-label={t('calendar.previousMonth')}>
              <ChevronLeft size={17} />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-arc-text">
                {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(visibleMonth)}
              </p>
              <button type="button" onClick={goToday} className="mt-0.5 text-[10px] uppercase tracking-widest text-arc-accent hover:text-arc-text">
                {t('calendar.today')}
              </button>
            </div>
            <button type="button" onClick={() => changeMonth(1)} className="rounded-lg p-2 text-arc-text-dim hover:bg-arc-elevated hover:text-arc-text" aria-label={t('calendar.nextMonth')}>
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-arc-border/70 px-2 py-2">
            {weekdayLabels.map((label) => (
              <span key={label} className="text-center text-[9px] font-medium uppercase tracking-wider text-arc-text-dim">{label}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 p-2">
            {monthCells.map((day) => {
              const key = localDateKey(day)
              const dayReminders = remindersByDay.get(key) ?? []
              const daySchedules = schedulesByDay.get(key) ?? []
              const isSelected = key === selectedKey
              const isToday = key === localDateKey(today)
              const isCurrentMonth = day.getMonth() === visibleMonth.getMonth()
              const hasPending = dayReminders.some((reminder) => !reminder.done)
              const hasCompleted = dayReminders.some((reminder) => reminder.done)

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`relative flex h-10 flex-col items-center justify-center rounded-xl border text-xs transition-colors ${
                    isSelected
                      ? 'border-white/60 bg-white text-black'
                      : isToday
                        ? 'border-arc-accent/40 bg-arc-accent/10 text-arc-text'
                        : 'border-transparent text-arc-text hover:border-arc-border hover:bg-arc-elevated'
                  } ${isCurrentMonth ? '' : 'opacity-35'}`}
                >
                  <span>{day.getDate()}</span>
                  <span className="mt-1 flex h-1 items-center gap-0.5">
                    {hasPending && <span className={`h-1 w-1 rounded-full ${isSelected ? 'bg-black' : 'bg-arc-accent'}`} />}
                    {daySchedules.length > 0 && <span className={`h-1 w-1 rounded-full ${isSelected ? 'bg-black/60' : 'bg-sky-300'}`} />}
                    {hasCompleted && !hasPending && <span className={`h-1 w-1 rounded-full ${isSelected ? 'bg-black/40' : 'bg-emerald-300'}`} />}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-arc-accent/20 bg-gradient-to-br from-arc-accent/10 via-arc-card to-arc-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-accent">{t('calendar.selectedDay')}</p>
              <p className="mt-1 text-sm font-semibold capitalize text-arc-text">{formatDay(selectedDay, locale)}</p>
            </div>
            <span className="rounded-full border border-arc-border bg-arc-bg/70 px-2.5 py-1 text-[10px] text-arc-text-dim">
              {selectedReminders.length + selectedSchedules.length}
            </span>
          </div>

          {loading ? (
            <div className="h-20 animate-pulse rounded-xl bg-arc-elevated" />
          ) : selectedReminders.length === 0 && selectedSchedules.length === 0 ? (
            <div className="rounded-xl border border-arc-border/70 bg-arc-bg/60 p-3 text-xs text-arc-text-dim">
              {t('calendar.noItems')}
            </div>
          ) : (
            <div className="space-y-2">
              {selectedReminders.map((reminder) => renderReminder(reminder))}
              {selectedSchedules.map((occurrence) => (
                <div key={occurrence.id} className="rounded-xl border border-sky-300/20 bg-sky-300/5 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-300/25 bg-sky-300/10 text-sky-300">
                      <Coins size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-arc-text">
                        {occurrence.schedule.label || t('calendar.scheduledPayment')}
                      </p>
                      <p className="mt-1 text-xs text-arc-text-dim">
                        {occurrence.schedule.amount} USDC · {formatAddress(occurrence.schedule.recipient)}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-sky-300">
                        <Clock3 size={11} /> {formatTime(occurrence.at, locale)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {scheduleError && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-arc-border/70 bg-arc-bg/60 p-3">
              <p className="text-xs text-arc-text-dim">{t('calendar.scheduleLoadFailed')}</p>
              <button type="button" onClick={() => void loadSchedules()} className="text-[10px] uppercase tracking-widest text-arc-accent">
                {t('common.retry')}
              </button>
            </div>
          )}

          {schedules.length > 0 && (
            <button type="button" onClick={() => setCurrentView('settings')} className="text-[10px] uppercase tracking-widest text-arc-text-dim hover:text-arc-text">
              {t('calendar.manageSchedules')} →
            </button>
          )}
        </section>

        <form onSubmit={handleAddReminder} className="space-y-3 rounded-2xl border border-arc-border bg-arc-card/50 p-4">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-arc-accent" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('calendar.quickAdd')}</p>
          </div>
          <Input
            value={reminderText}
            onChange={(event) => setReminderText(event.target.value)}
            placeholder={t('calendar.reminderPlaceholder')}
            maxLength={180}
          />
          <Input
            type="datetime-local"
            value={dueAtInput}
            onChange={(event) => setDueAtInput(event.target.value)}
            label={t('calendar.dateTime')}
          />
          {formError && <p className="text-xs text-arc-danger">{formError}</p>}
          <Button type="submit" size="sm" fullWidth disabled={busyId === 'create'}>
            {busyId === 'create' ? t('common.loading') : t('calendar.addReminder')}
          </Button>
        </form>

        {unscheduledReminders.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-arc-border bg-arc-card/50 p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-arc-text-dim">{t('calendar.unscheduled')}</p>
              <span className="text-[10px] text-arc-text-dim">{unscheduledReminders.length}</span>
            </div>
            <div className="space-y-2">
              {unscheduledReminders.map((reminder) => renderReminder(reminder, true))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
