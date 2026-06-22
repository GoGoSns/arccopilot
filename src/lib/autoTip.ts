import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { formatRelativeTime } from '@/lib/utils'
import { formatText, t } from '@/lib/i18n'
import { AUTO_TIP_RULE } from '@/lib/storageKeys'
import { listCreators, type CreatorEntry, normalizeCreatorHandle } from '@/lib/creatorRegistry'
import { formatTipBudgetAmount, getBudgetState, type TipBudgetLogEntry, type TipBudgetState } from '@/lib/tipBudget'

export type AutoTipWeighting = 'equal' | 'engagement' | 'recency'

export interface AutoTipRule {
  enabled: boolean
  periodBudgetUsdc: number
  weighting: AutoTipWeighting
  perCreatorMin: number
  perCreatorMax: number
}

export interface AutoTipPlanRecipient {
  handle: string
  address: string
  amount: string
  reason: string
  tipCount: number
  totalTippedUsdc: number
  lastTippedAt: number | null
}

export interface AutoTipSkippedCreator {
  handle: string
  address: string
  reason: string
}

export interface AutoTipPlanResult {
  enabled: boolean
  rule: AutoTipRule
  totalCreators: number
  plannedCreators: number
  availableBudgetUsdc: number
  dailyRemainingUsdc: number
  periodBudgetUsdc: number
  remainingAfterPlanUsdc: number
  totalPlannedUsdc: number
  recipients: AutoTipPlanRecipient[]
  skipped: AutoTipSkippedCreator[]
  summary: string
  explanation: string
  canExecute: boolean
}

type StoredAutoTipRule = Partial<{
  enabled: unknown
  periodBudgetUsdc: unknown
  weighting: unknown
  perCreatorMin: unknown
  perCreatorMax: unknown
}>

type CreatorHistory = {
  handle: string
  address: string
  tipCount: number
  totalTippedUsdc: number
  lastTippedAt: number | null
}

const USDC_DECIMALS = 6
const USDC_MICROS = 10 ** USDC_DECIMALS

export const DEFAULT_AUTO_TIP_RULE: AutoTipRule = {
  enabled: false,
  periodBudgetUsdc: 1,
  weighting: 'equal',
  perCreatorMin: 0.05,
  perCreatorMax: 1,
}

function roundUsdc(value: number): number {
  return Math.round(value * USDC_MICROS) / USDC_MICROS
}

function toMicros(value: number): number {
  return Math.max(0, Math.round(value * USDC_MICROS))
}

function fromMicros(value: number): number {
  return roundUsdc(value / USDC_MICROS)
}

function formatMicros(value: number): string {
  const normalized = Math.max(0, Math.floor(value))
  const whole = Math.floor(normalized / USDC_MICROS)
  const fraction = String(normalized % USDC_MICROS).padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function parseAmount(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const raw = typeof value === 'number' ? String(value) : value.trim().replace(',', '.')
  if (!raw) return null
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  return roundUsdc(parsed)
}

function normalizeWeighting(value: unknown): AutoTipWeighting {
  return value === 'engagement' || value === 'recency' || value === 'equal'
    ? value
    : DEFAULT_AUTO_TIP_RULE.weighting
}

function normalizeRule(raw: StoredAutoTipRule | null | undefined): AutoTipRule {
  const enabled = typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_AUTO_TIP_RULE.enabled
  const periodBudgetUsdc = parseAmount(raw?.periodBudgetUsdc) ?? DEFAULT_AUTO_TIP_RULE.periodBudgetUsdc
  const weighting = normalizeWeighting(raw?.weighting)
  const perCreatorMin = parseAmount(raw?.perCreatorMin) ?? DEFAULT_AUTO_TIP_RULE.perCreatorMin
  const perCreatorMaxRaw = parseAmount(raw?.perCreatorMax) ?? DEFAULT_AUTO_TIP_RULE.perCreatorMax
  const perCreatorMax = Math.max(perCreatorMin, perCreatorMaxRaw)

  return {
    enabled,
    periodBudgetUsdc: roundUsdc(periodBudgetUsdc),
    weighting,
    perCreatorMin: roundUsdc(perCreatorMin),
    perCreatorMax: roundUsdc(perCreatorMax),
  }
}

function serializeRule(rule: AutoTipRule): AutoTipRule {
  return {
    enabled: Boolean(rule.enabled),
    periodBudgetUsdc: roundUsdc(rule.periodBudgetUsdc),
    weighting: normalizeWeighting(rule.weighting),
    perCreatorMin: roundUsdc(Math.max(0, rule.perCreatorMin)),
    perCreatorMax: roundUsdc(Math.max(rule.perCreatorMin, rule.perCreatorMax)),
  }
}

function buildHistoryMap(creators: CreatorEntry[], log: TipBudgetLogEntry[]): Map<string, CreatorHistory> {
  const history = new Map<string, CreatorHistory>()

  for (const creator of creators) {
    history.set(creator.handle, {
      handle: creator.handle,
      address: creator.address,
      tipCount: 0,
      totalTippedUsdc: 0,
      lastTippedAt: null,
    })
  }

  for (const entry of log) {
    const normalizedHandle = normalizeCreatorHandle(entry.handle)
    const current = history.get(normalizedHandle)
    if (!current) continue

    current.tipCount += 1
    current.totalTippedUsdc = roundUsdc(current.totalTippedUsdc + entry.amount)
    current.lastTippedAt = current.lastTippedAt == null
      ? entry.timestamp
      : Math.max(current.lastTippedAt, entry.timestamp)
  }

  return history
}

function compareCreatorsForSelection(left: CreatorHistory, right: CreatorHistory, weighting: AutoTipWeighting): number {
  if (weighting === 'engagement') {
    if (right.tipCount !== left.tipCount) return right.tipCount - left.tipCount
    if (right.totalTippedUsdc !== left.totalTippedUsdc) return right.totalTippedUsdc - left.totalTippedUsdc
    if ((right.lastTippedAt ?? 0) !== (left.lastTippedAt ?? 0)) return (right.lastTippedAt ?? 0) - (left.lastTippedAt ?? 0)
    return left.handle.localeCompare(right.handle)
  }

  if (weighting === 'recency') {
    if ((right.lastTippedAt ?? 0) !== (left.lastTippedAt ?? 0)) return (right.lastTippedAt ?? 0) - (left.lastTippedAt ?? 0)
    if (right.tipCount !== left.tipCount) return right.tipCount - left.tipCount
    if (right.totalTippedUsdc !== left.totalTippedUsdc) return right.totalTippedUsdc - left.totalTippedUsdc
    return left.handle.localeCompare(right.handle)
  }

  if (left.tipCount !== right.tipCount) return left.tipCount - right.tipCount
  if ((left.lastTippedAt ?? 0) !== (right.lastTippedAt ?? 0)) return (left.lastTippedAt ?? 0) - (right.lastTippedAt ?? 0)
  if (left.totalTippedUsdc !== right.totalTippedUsdc) return left.totalTippedUsdc - right.totalTippedUsdc
  return left.handle.localeCompare(right.handle)
}

function getWeight(history: CreatorHistory, weighting: AutoTipWeighting, now: number): number {
  if (weighting === 'engagement') {
    return 1 + history.tipCount
  }

  if (weighting === 'recency') {
    if (history.lastTippedAt == null) return 1
    const ageHours = Math.max(0, (now - history.lastTippedAt) / 3_600_000)
    const recencyBoost = Math.max(0, 1 - Math.min(ageHours, 720) / 720)
    return 1 + recencyBoost
  }

  return 1
}

function buildRecipientReason(history: CreatorHistory, weighting: AutoTipWeighting, amountMicros: number, minMicros: number): string {
  const amount = formatTipBudgetAmount(fromMicros(amountMicros))
  const minAmount = formatTipBudgetAmount(fromMicros(minMicros))
  const handleLabel = `@${history.handle}`

  if (weighting === 'engagement') {
    if (history.tipCount <= 0) {
      return formatText('gogo.autoTipRecipientBaseReason', {
        handle: handleLabel,
        amount,
        min: minAmount,
        weighting: getAutoTipWeightingLabel(weighting),
      })
    }

    return formatText('gogo.autoTipEngagementReason', {
      handle: handleLabel,
      count: history.tipCount,
      total: formatTipBudgetAmount(history.totalTippedUsdc),
      amount,
    })
  }

  if (weighting === 'recency') {
    if (history.lastTippedAt == null) {
      return formatText('gogo.autoTipRecipientBaseReason', {
        handle: handleLabel,
        amount,
        min: minAmount,
        weighting: getAutoTipWeightingLabel(weighting),
      })
    }

    return formatText('gogo.autoTipRecencyReason', {
      handle: handleLabel,
      when: formatRelativeTime(new Date(history.lastTippedAt).toISOString()),
      amount,
    })
  }

  return formatText('gogo.autoTipEqualReason', {
    amount,
    min: minAmount,
  })
}

function buildSkippedReason(weighting: AutoTipWeighting, selectedCount: number, totalCreators: number, minAmount: number): string {
  return formatText('gogo.autoTipSkippedReason', {
    selected: selectedCount,
    total: totalCreators,
    min: formatTipBudgetAmount(minAmount),
    weighting: getAutoTipWeightingLabel(weighting),
  })
}

export function getAutoTipWeightingLabel(weighting: AutoTipWeighting): string {
  switch (weighting) {
    case 'engagement':
      return t('settings.autoTipWeightingEngagement')
    case 'recency':
      return t('settings.autoTipWeightingRecency')
    case 'equal':
    default:
      return t('settings.autoTipWeightingEqual')
  }
}

export async function getAutoTipRule(): Promise<AutoTipRule> {
  const stored = await chromeStorageGet(AUTO_TIP_RULE)
  const hasKey = Object.prototype.hasOwnProperty.call(stored, AUTO_TIP_RULE)

  if (!hasKey) {
    const initial = serializeRule(DEFAULT_AUTO_TIP_RULE)
    await chromeStorageSet({ [AUTO_TIP_RULE]: initial })
    return initial
  }

  const normalized = serializeRule(normalizeRule(stored[AUTO_TIP_RULE] as StoredAutoTipRule | null | undefined))
  if (JSON.stringify(stored[AUTO_TIP_RULE]) !== JSON.stringify(normalized)) {
    await chromeStorageSet({ [AUTO_TIP_RULE]: normalized })
  }

  return normalized
}

export async function setAutoTipRule(rule: AutoTipRule): Promise<AutoTipRule> {
  const normalized = serializeRule(normalizeRule(rule as StoredAutoTipRule))
  await chromeStorageSet({ [AUTO_TIP_RULE]: normalized })
  return normalized
}

export function calculateAutoTipPlan(
  rule: AutoTipRule,
  creators: CreatorEntry[],
  budgetState: TipBudgetState,
  now = Date.now(),
): AutoTipPlanResult {
  const normalizedRule = serializeRule(normalizeRule(rule as StoredAutoTipRule))
  const totalCreators = creators.length
  const dailyRemainingUsdc = roundUsdc(Math.max(0, budgetState.dailyLimitUsdc - budgetState.spentTodayUsdc))
  const availableBudgetUsdc = roundUsdc(Math.min(normalizedRule.periodBudgetUsdc, dailyRemainingUsdc))
  const totalBudgetMicros = toMicros(availableBudgetUsdc)
  const minMicros = toMicros(normalizedRule.perCreatorMin)
  const maxMicros = toMicros(normalizedRule.perCreatorMax)
  const historyMap = buildHistoryMap(creators, budgetState.log)
  const weightingLabel = getAutoTipWeightingLabel(normalizedRule.weighting)

  if (!normalizedRule.enabled) {
    return {
      enabled: false,
      rule: normalizedRule,
      totalCreators,
      plannedCreators: 0,
      availableBudgetUsdc,
      dailyRemainingUsdc,
      periodBudgetUsdc: normalizedRule.periodBudgetUsdc,
      remainingAfterPlanUsdc: availableBudgetUsdc,
      totalPlannedUsdc: 0,
      recipients: [],
      skipped: [],
      summary: t('settings.autoTipPreviewOff'),
      explanation: formatText('gogo.autoTipDisabled', {
        budget: formatTipBudgetAmount(normalizedRule.periodBudgetUsdc),
        weighting: weightingLabel,
        min: formatTipBudgetAmount(normalizedRule.perCreatorMin),
        max: formatTipBudgetAmount(normalizedRule.perCreatorMax),
      }),
      canExecute: false,
    }
  }

  if (totalCreators === 0) {
    return {
      enabled: true,
      rule: normalizedRule,
      totalCreators,
      plannedCreators: 0,
      availableBudgetUsdc,
      dailyRemainingUsdc,
      periodBudgetUsdc: normalizedRule.periodBudgetUsdc,
      remainingAfterPlanUsdc: availableBudgetUsdc,
      totalPlannedUsdc: 0,
      recipients: [],
      skipped: [],
      summary: t('gogo.autoTipNoCreators'),
      explanation: t('gogo.autoTipNoCreators'),
      canExecute: false,
    }
  }

  if (totalBudgetMicros < minMicros) {
    return {
      enabled: true,
      rule: normalizedRule,
      totalCreators,
      plannedCreators: 0,
      availableBudgetUsdc,
      dailyRemainingUsdc,
      periodBudgetUsdc: normalizedRule.periodBudgetUsdc,
      remainingAfterPlanUsdc: availableBudgetUsdc,
      totalPlannedUsdc: 0,
      recipients: [],
      skipped: [],
      summary: formatText('settings.autoTipPreviewNoBudget', {
        min: formatTipBudgetAmount(normalizedRule.perCreatorMin),
      }),
      explanation: formatText('gogo.autoTipNoBudget', {
        min: formatTipBudgetAmount(normalizedRule.perCreatorMin),
        budget: formatTipBudgetAmount(availableBudgetUsdc),
      }),
      canExecute: false,
    }
  }

  const rankedCreators = creators
    .map((creator) => {
      const history = historyMap.get(creator.handle) ?? {
        handle: creator.handle,
        address: creator.address,
        tipCount: 0,
        totalTippedUsdc: 0,
        lastTippedAt: null,
      }

      return {
        ...history,
        weight: getWeight(history, normalizedRule.weighting, now),
      }
    })
    .sort((left, right) => compareCreatorsForSelection(left, right, normalizedRule.weighting))

  const maxRecipientsByBudget = Math.floor(totalBudgetMicros / minMicros)
  const selectedCount = Math.min(totalCreators, maxRecipientsByBudget)
  if (selectedCount <= 0) {
    return {
      enabled: true,
      rule: normalizedRule,
      totalCreators,
      plannedCreators: 0,
      availableBudgetUsdc,
      dailyRemainingUsdc,
      periodBudgetUsdc: normalizedRule.periodBudgetUsdc,
      remainingAfterPlanUsdc: availableBudgetUsdc,
      totalPlannedUsdc: 0,
      recipients: [],
      skipped: [],
      summary: formatText('settings.autoTipPreviewNoBudget', {
        min: formatTipBudgetAmount(normalizedRule.perCreatorMin),
      }),
      explanation: formatText('gogo.autoTipNoBudget', {
        min: formatTipBudgetAmount(normalizedRule.perCreatorMin),
        budget: formatTipBudgetAmount(availableBudgetUsdc),
      }),
      canExecute: false,
    }
  }

  const selected = rankedCreators.slice(0, selectedCount)
  const skipped = rankedCreators.slice(selectedCount).map((creator) => ({
    handle: creator.handle,
    address: creator.address,
    reason: buildSkippedReason(
      normalizedRule.weighting,
      selectedCount,
      totalCreators,
      normalizedRule.perCreatorMin,
    ),
  }))

  const allocations = selected.map((creator) => ({
    creator,
    amountMicros: minMicros,
  }))

  let remainingMicros = totalBudgetMicros - minMicros * allocations.length
  const headroomMicros = Math.max(0, maxMicros - minMicros)

  while (remainingMicros > 0 && headroomMicros > 0) {
    const adjustable = allocations.filter((allocation) => allocation.amountMicros < maxMicros)
    if (adjustable.length === 0) break

    const totalWeight = adjustable.reduce((sum, allocation) => sum + allocation.creator.weight, 0)
    if (totalWeight <= 0) break

    let allocatedThisRound = 0

    for (const allocation of adjustable) {
      const currentHeadroom = Math.max(0, maxMicros - allocation.amountMicros)
      if (currentHeadroom <= 0) continue

      const proportionalShare = Math.floor((remainingMicros * allocation.creator.weight) / totalWeight)
      const additional = Math.min(currentHeadroom, Math.max(0, proportionalShare))
      if (additional <= 0) continue

      allocation.amountMicros += additional
      allocatedThisRound += additional
    }

    if (allocatedThisRound > 0) {
      remainingMicros -= allocatedThisRound
      continue
    }

    const sortedByWeight = [...adjustable].sort((left, right) => {
      if (right.creator.weight !== left.creator.weight) return right.creator.weight - left.creator.weight
      if (right.creator.tipCount !== left.creator.tipCount) return right.creator.tipCount - left.creator.tipCount
      if ((right.creator.lastTippedAt ?? 0) !== (left.creator.lastTippedAt ?? 0)) {
        return (right.creator.lastTippedAt ?? 0) - (left.creator.lastTippedAt ?? 0)
      }
      return left.creator.handle.localeCompare(right.creator.handle)
    })

    let fallbackAllocated = 0
    for (const allocation of sortedByWeight) {
      if (remainingMicros <= 0) break
      if (allocation.amountMicros >= maxMicros) continue
      allocation.amountMicros += 1
      remainingMicros -= 1
      fallbackAllocated += 1
    }

    if (fallbackAllocated === 0) break
  }

  const recipients = allocations.map((allocation) => ({
    handle: allocation.creator.handle,
    address: allocation.creator.address,
    amount: formatMicros(allocation.amountMicros),
    reason: buildRecipientReason(
      allocation.creator,
      normalizedRule.weighting,
      allocation.amountMicros,
      minMicros,
    ),
    tipCount: allocation.creator.tipCount,
    totalTippedUsdc: allocation.creator.totalTippedUsdc,
    lastTippedAt: allocation.creator.lastTippedAt,
  }))

  const totalPlannedMicros = allocations.reduce((sum, allocation) => sum + allocation.amountMicros, 0)
  const totalPlannedUsdc = fromMicros(totalPlannedMicros)
  const remainingAfterPlanUsdc = roundUsdc(Math.max(0, availableBudgetUsdc - totalPlannedUsdc))
  const plannedCreators = recipients.length
  const summary = formatText('settings.autoTipPreviewNext', {
    count: plannedCreators,
    total: formatTipBudgetAmount(totalPlannedUsdc),
  })

  const explanationParts: string[] = [
    formatText('gogo.autoTipRuleSummary', {
      budget: formatTipBudgetAmount(normalizedRule.periodBudgetUsdc),
      weighting: weightingLabel,
      min: formatTipBudgetAmount(normalizedRule.perCreatorMin),
      max: formatTipBudgetAmount(normalizedRule.perCreatorMax),
    }),
  ]

  if (plannedCreators < totalCreators) {
    explanationParts.push(formatText('gogo.autoTipSkippedCount', {
      count: totalCreators - plannedCreators,
      selected: plannedCreators,
      weighting: weightingLabel,
    }))
  } else {
    explanationParts.push(formatText('gogo.autoTipSelectionSummary', {
      count: plannedCreators,
      total: formatTipBudgetAmount(totalPlannedUsdc),
    }))
  }

  if (normalizedRule.weighting === 'equal') {
    explanationParts.push(t('gogo.autoTipEqualReason'))
  } else if (plannedCreators > 0) {
    const leadRecipient = recipients[0]
    if (leadRecipient) {
      explanationParts.push(leadRecipient.reason)
    }
  }

  if (availableBudgetUsdc < normalizedRule.periodBudgetUsdc) {
    explanationParts.push(formatText('gogo.autoTipBudgetCapped', {
      remaining: formatTipBudgetAmount(availableBudgetUsdc),
    }))
  }

  if (remainingAfterPlanUsdc > 0) {
    explanationParts.push(formatText('gogo.autoTipUnusedBudget', {
      remaining: formatTipBudgetAmount(remainingAfterPlanUsdc),
      max: formatTipBudgetAmount(normalizedRule.perCreatorMax),
    }))
  }

  explanationParts.push(t('gogo.autoTipGatewayReady'))

  return {
    enabled: true,
    rule: normalizedRule,
    totalCreators,
    plannedCreators,
    availableBudgetUsdc,
    dailyRemainingUsdc,
    periodBudgetUsdc: normalizedRule.periodBudgetUsdc,
    remainingAfterPlanUsdc,
    totalPlannedUsdc,
    recipients,
    skipped,
    summary,
    explanation: explanationParts.join(' '),
    canExecute: recipients.length > 0,
  }
}

export async function planAutoTips(): Promise<AutoTipPlanResult> {
  const [rule, creators, budgetState] = await Promise.all([
    getAutoTipRule(),
    listCreators(),
    getBudgetState(),
  ])

  return calculateAutoTipPlan(rule, creators, budgetState)
}
