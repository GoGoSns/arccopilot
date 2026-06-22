import { fetchTweetsByQuery, type TwitterTweet } from '@/lib/twitterApi'
import { listCreators, normalizeCreatorHandle, type CreatorEntry } from '@/lib/creatorRegistry'
import { formatText, t } from '@/lib/i18n'
import { formatTipBudgetAmount, getBudgetState, type TipBudgetLogEntry } from '@/lib/tipBudget'

export interface TipSuggestion {
  handle: string
  address: string
  amount: string
  reason: string
}

export interface TipAdvisorSkippedCreator {
  handle: string
  address: string
  reason: string
}

export type TipAdvisorActivityState = 'used' | 'none' | 'unavailable'

export interface TipAdvisorResult {
  suggestions: TipSuggestion[]
  skipped: TipAdvisorSkippedCreator[]
  totalCreators: number
  availableBudgetUsdc: number
  totalSuggestedUsdc: number
  remainingBudgetUsdc: number
  summary: string
  explanation: string
  canExecute: boolean
  activityState: TipAdvisorActivityState
}

type CreatorHistory = {
  handle: string
  address: string
  tipCount: number
  totalTippedUsdc: number
  lastTippedAt: number | null
}

type CreatorActivity = {
  handle: string
  address: string
  tweetCount: number
  latestTweetAt: number | null
  totalLikes: number
  totalRetweets: number
}

type RankedCreator = {
  creator: CreatorEntry
  history: CreatorHistory
  activity: CreatorActivity | undefined
  score: number
}

const USDC_DECIMALS = 6
const USDC_MICROS = 10 ** USDC_DECIMALS
const MIN_SUGGESTION_AMOUNT_USDC = 0.01
const MAX_SUGGESTIONS = 3
const ACTIVITY_WINDOW_DAYS = 7
const HISTORY_WINDOW_DAYS = 30

function roundUsdc(value: number): number {
  return Math.round(value * USDC_MICROS) / USDC_MICROS
}

function toMicros(value: number): number {
  return Math.max(0, Math.round(value * USDC_MICROS))
}

function fromMicros(value: number): number {
  return roundUsdc(value / USDC_MICROS)
}

function uniqueSortedHandles(creators: CreatorEntry[]): string[] {
  return [...new Set(creators.map((creator) => normalizeCreatorHandle(creator.handle)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
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
    const current = history.get(normalizeCreatorHandle(entry.handle))
    if (!current) continue

    current.tipCount += 1
    current.totalTippedUsdc = roundUsdc(current.totalTippedUsdc + entry.amount)
    current.lastTippedAt = current.lastTippedAt == null
      ? entry.timestamp
      : Math.max(current.lastTippedAt, entry.timestamp)
  }

  return history
}

function buildHistoryRankMap(historyMap: Map<string, CreatorHistory>): Map<string, number> {
  const ranked = [...historyMap.values()]
    .filter((entry) => entry.tipCount > 0)
    .sort((left, right) => {
      if (right.tipCount !== left.tipCount) return right.tipCount - left.tipCount
      if (right.totalTippedUsdc !== left.totalTippedUsdc) return right.totalTippedUsdc - left.totalTippedUsdc
      if ((right.lastTippedAt ?? 0) !== (left.lastTippedAt ?? 0)) return (right.lastTippedAt ?? 0) - (left.lastTippedAt ?? 0)
      return left.handle.localeCompare(right.handle)
    })

  const rankMap = new Map<string, number>()
  ranked.forEach((entry, index) => {
    if (!rankMap.has(entry.handle)) {
      rankMap.set(entry.handle, index + 1)
    }
  })

  return rankMap
}

function getHistoryScore(history: CreatorHistory, now: number): number {
  let score = 0

  if (history.tipCount > 0) {
    score += Math.log1p(history.tipCount) * 1.5
  }

  if (history.totalTippedUsdc > 0) {
    score += Math.log1p(history.totalTippedUsdc) * 0.75
  }

  if (history.lastTippedAt != null) {
    const ageDays = Math.max(0, (now - history.lastTippedAt) / 86_400_000)
    score += Math.max(0, 1 - Math.min(ageDays, HISTORY_WINDOW_DAYS) / HISTORY_WINDOW_DAYS)
  }

  return score
}

function getActivityScore(activity: CreatorActivity | undefined, now: number): number {
  if (!activity || activity.tweetCount <= 0) return 0

  let score = Math.log1p(activity.tweetCount) * 1.5
  score += Math.log1p(activity.totalLikes + activity.totalRetweets) * 0.25

  if (activity.latestTweetAt != null) {
    const ageDays = Math.max(0, (now - activity.latestTweetAt) / 86_400_000)
    score += Math.max(0, 1 - Math.min(ageDays, ACTIVITY_WINDOW_DAYS) / ACTIVITY_WINDOW_DAYS) * 2
  }

  return score
}

function buildActivityMap(creators: CreatorEntry[], tweets: TwitterTweet[]): Map<string, CreatorActivity> {
  const activity = new Map<string, CreatorActivity>()
  const creatorLookup = new Map(creators.map((creator) => [creator.handle, creator.address] as const))

  for (const tweet of tweets) {
    const handle = normalizeCreatorHandle(tweet.authorHandle)
    const address = creatorLookup.get(handle)
    if (!handle || !address) continue

    const current = activity.get(handle) ?? {
      handle,
      address,
      tweetCount: 0,
      latestTweetAt: null,
      totalLikes: 0,
      totalRetweets: 0,
    }

    const tweetAt = Date.parse(tweet.createdAt)
    current.tweetCount += 1
    current.latestTweetAt = Number.isFinite(tweetAt)
      ? (current.latestTweetAt == null ? tweetAt : Math.max(current.latestTweetAt, tweetAt))
      : current.latestTweetAt
    current.totalLikes += Number.isFinite(tweet.likes) ? tweet.likes : 0
    current.totalRetweets += Number.isFinite(tweet.retweets) ? tweet.retweets : 0

    activity.set(handle, current)
  }

  return activity
}

async function fetchCreatorActivity(creators: CreatorEntry[]): Promise<{
  activityMap: Map<string, CreatorActivity>
  activityState: TipAdvisorActivityState
}> {
  const handles = uniqueSortedHandles(creators)
  if (handles.length === 0) {
    return {
      activityMap: new Map(),
      activityState: 'none',
    }
  }

  const query = handles.map((handle) => `from:${handle}`).join(' OR ')
  if (!query.trim()) {
    return {
      activityMap: new Map(),
      activityState: 'none',
    }
  }

  try {
    const result = await fetchTweetsByQuery(query, Math.min(20, Math.max(5, handles.length * 2)))
    const activityMap = buildActivityMap(creators, result.tweets)
    return {
      activityMap,
      activityState: activityMap.size > 0 ? 'used' : 'none',
    }
  } catch {
    return {
      activityMap: new Map(),
      activityState: 'unavailable',
    }
  }
}

function buildSuggestionReason(
  history: CreatorHistory,
  activity: CreatorActivity | undefined,
  historyRank: number | null,
): string {
  const reasonParts: string[] = []

  if (activity && activity.tweetCount > 0) {
    reasonParts.push(t('gogo.tipAdvisorReasonActivity'))
  }

  if (history.tipCount > 0) {
    reasonParts.push(
      historyRank === 1
        ? t('gogo.tipAdvisorReasonTopHistory')
        : t('gogo.tipAdvisorReasonHistory'),
    )
  }

  if (reasonParts.length === 0) {
    reasonParts.push(t('gogo.tipAdvisorReasonEven'))
  }

  return reasonParts.join(' | ')
}

function buildSkippedReason(selectedCount: number): string {
  return formatText('gogo.tipAdvisorSkippedReason', {
    selected: selectedCount,
  })
}

function getActivityStateNote(activityState: TipAdvisorActivityState): string {
  switch (activityState) {
    case 'used':
      return ''
    case 'unavailable':
      return t('gogo.tipAdvisorNoActivityUnavailable')
    case 'none':
    default:
      return t('gogo.tipAdvisorNoActivity')
  }
}

function allocateMicros(totalBudgetMicros: number, weights: number[]): number[] {
  const count = weights.length
  if (count === 0) return []

  const baseMicros = toMicros(MIN_SUGGESTION_AMOUNT_USDC)
  const allocations = Array.from({ length: count }, () => baseMicros)
  let remainingMicros = totalBudgetMicros - (baseMicros * count)
  if (remainingMicros <= 0) {
    return allocations
  }

  const normalizedWeights = weights.map((weight) => Math.max(0, weight))
  const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0)

  if (totalWeight <= 0) {
    const perCreator = Math.floor(remainingMicros / count)
    const remainder = remainingMicros % count
    for (let index = 0; index < count; index += 1) {
      allocations[index] += perCreator + (index < remainder ? 1 : 0)
    }
    return allocations
  }

  const remainders = normalizedWeights.map((weight, index) => {
    const rawShare = (remainingMicros * weight) / totalWeight
    const share = Math.floor(rawShare)
    allocations[index] += share
    return {
      index,
      remainder: rawShare - share,
      weight,
    }
  })

  let distributed = allocations.reduce((sum, amount) => sum + amount, 0)
  let leftover = totalBudgetMicros - distributed

  remainders
    .sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder
      if (right.weight !== left.weight) return right.weight - left.weight
      return left.index - right.index
    })
    .forEach(({ index }) => {
      if (leftover <= 0) return
      allocations[index] += 1
      leftover -= 1
    })

  if (leftover > 0) {
    for (let index = 0; index < count && leftover > 0; index += 1) {
      allocations[index] += 1
      leftover -= 1
    }
  }

  distributed = allocations.reduce((sum, amount) => sum + amount, 0)
  const correction = totalBudgetMicros - distributed
  if (correction !== 0 && allocations.length > 0) {
    allocations[0] = Math.max(0, allocations[0] + correction)
  }

  return allocations
}

function buildExplanation(result: TipAdvisorResult): string {
  if (!result.canExecute) {
    return result.summary
  }

  const explanationParts = [result.summary]
  const activityNote = getActivityStateNote(result.activityState)
  if (activityNote) explanationParts.push(activityNote)

  const leadSuggestions = result.suggestions.slice(0, 3).map((suggestion) => `@${suggestion.handle} ${suggestion.amount} USDC: ${suggestion.reason}`)
  if (leadSuggestions.length > 0) {
    explanationParts.push(leadSuggestions.join(' | '))
  }

  if (result.skipped.length > 0) {
    explanationParts.push(formatText('gogo.tipAdvisorSkippedSummary', {
      count: result.skipped.length,
      selected: result.suggestions.length,
    }))
  }

  explanationParts.push(t('gogo.tipAdvisorGatewayReady'))
  return explanationParts.filter(Boolean).join(' ')
}

export async function generateTipSuggestions(): Promise<TipAdvisorResult> {
  const [creators, budgetState] = await Promise.all([
    listCreators(),
    getBudgetState(),
  ])

  const totalCreators = creators.length
  const dailyRemainingUsdc = Math.max(0, roundUsdc(budgetState.dailyLimitUsdc - budgetState.spentTodayUsdc))

  if (totalCreators === 0) {
    const summary = t('gogo.tipAdvisorNoCreators')
    return {
      suggestions: [],
      skipped: [],
      totalCreators,
      availableBudgetUsdc: dailyRemainingUsdc,
      totalSuggestedUsdc: 0,
      remainingBudgetUsdc: dailyRemainingUsdc,
      summary,
      explanation: summary,
      canExecute: false,
      activityState: 'none',
    }
  }

  const minMicros = toMicros(MIN_SUGGESTION_AMOUNT_USDC)
  const availableBudgetMicros = toMicros(dailyRemainingUsdc)

  if (availableBudgetMicros < minMicros) {
    const summary = formatText('gogo.tipAdvisorNoBudget', {
      remaining: formatTipBudgetAmount(dailyRemainingUsdc),
      min: formatTipBudgetAmount(MIN_SUGGESTION_AMOUNT_USDC),
    })
    return {
      suggestions: [],
      skipped: [],
      totalCreators,
      availableBudgetUsdc: dailyRemainingUsdc,
      totalSuggestedUsdc: 0,
      remainingBudgetUsdc: dailyRemainingUsdc,
      summary,
      explanation: summary,
      canExecute: false,
      activityState: 'none',
    }
  }

  const { activityMap, activityState } = await fetchCreatorActivity(creators)
  const historyMap = buildHistoryMap(creators, budgetState.log)
  const historyRankMap = buildHistoryRankMap(historyMap)
  const now = Date.now()

  const rankedCreators: RankedCreator[] = creators
    .map((creator) => {
      const history = historyMap.get(creator.handle) ?? {
        handle: creator.handle,
        address: creator.address,
        tipCount: 0,
        totalTippedUsdc: 0,
        lastTippedAt: null,
      }
      const activity = activityMap.get(creator.handle)
      const score = (getActivityScore(activity, now) * 1.25) + getHistoryScore(history, now)

      return {
        creator,
        history,
        activity,
        score,
      }
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score

      const leftActivityAt = left.activity?.latestTweetAt ?? 0
      const rightActivityAt = right.activity?.latestTweetAt ?? 0
      if (rightActivityAt !== leftActivityAt) return rightActivityAt - leftActivityAt

      const leftHistoryAt = left.history.lastTippedAt ?? 0
      const rightHistoryAt = right.history.lastTippedAt ?? 0
      if (rightHistoryAt !== leftHistoryAt) return rightHistoryAt - leftHistoryAt

      return left.creator.handle.localeCompare(right.creator.handle)
    })

  const selectedCount = Math.min(
    MAX_SUGGESTIONS,
    rankedCreators.length,
    Math.floor(availableBudgetMicros / minMicros),
  )

  if (selectedCount <= 0) {
    const summary = formatText('gogo.tipAdvisorNoBudget', {
      remaining: formatTipBudgetAmount(dailyRemainingUsdc),
      min: formatTipBudgetAmount(MIN_SUGGESTION_AMOUNT_USDC),
    })
    return {
      suggestions: [],
      skipped: [],
      totalCreators,
      availableBudgetUsdc: dailyRemainingUsdc,
      totalSuggestedUsdc: 0,
      remainingBudgetUsdc: dailyRemainingUsdc,
      summary,
      explanation: summary,
      canExecute: false,
      activityState,
    }
  }

  const selected = rankedCreators.slice(0, selectedCount)
  const allocations = allocateMicros(availableBudgetMicros, selected.map((entry) => Math.max(0, entry.score)))

  const suggestions: TipSuggestion[] = selected.map((entry, index) => ({
    handle: entry.creator.handle,
    address: entry.creator.address,
    amount: formatTipBudgetAmount(fromMicros(allocations[index] ?? minMicros)),
    reason: buildSuggestionReason(entry.history, entry.activity, historyRankMap.get(entry.creator.handle) ?? null),
  }))

  const skipped = rankedCreators.slice(selectedCount).map((entry) => ({
    handle: entry.creator.handle,
    address: entry.creator.address,
    reason: buildSkippedReason(selectedCount),
  }))

  const totalSuggestedMicros = allocations.reduce((sum, amount) => sum + amount, 0)
  const totalSuggestedUsdc = fromMicros(totalSuggestedMicros)
  const remainingBudgetUsdc = roundUsdc(Math.max(0, dailyRemainingUsdc - totalSuggestedUsdc))

  const summary = formatText('gogo.tipAdvisorSummary', {
    count: suggestions.length,
    total: formatTipBudgetAmount(totalSuggestedUsdc),
  })

  const result: TipAdvisorResult = {
    suggestions,
    skipped,
    totalCreators,
    availableBudgetUsdc: dailyRemainingUsdc,
    totalSuggestedUsdc,
    remainingBudgetUsdc,
    summary,
    explanation: '',
    canExecute: suggestions.length > 0,
    activityState,
  }

  result.explanation = buildExplanation(result)
  return result
}
