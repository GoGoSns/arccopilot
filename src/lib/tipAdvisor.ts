import { getTwitterApiKey, type TwitterTweet } from '@/lib/twitterApi'
import { listCreators, normalizeCreatorHandle, type CreatorEntry } from '@/lib/creatorRegistry'
import { formatText, getLocaleSync, t } from '@/lib/i18n'
import { TWITTERAPI_BASE } from '@/lib/constants'
import { fetchWithTimeout } from '@/lib/external'
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
export type TipAdvisorActivityIssue = 'missing-key' | 'rate-limited' | 'invalid-key' | 'query-failed' | 'network' | 'unknown'

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
  activityIssue?: TipAdvisorActivityIssue
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

type CreatorActivityLookup = {
  status: number | null
  tweetsReturned: number
}

type TwitterApiAdvancedSearchAuthor = {
  userName?: string
  name?: string
  profilePicture?: string
  isBlueVerified?: boolean
}

type TwitterApiAdvancedSearchTweet = {
  id?: string
  text?: string
  createdAt?: string
  likeCount?: number
  retweetCount?: number
  author?: TwitterApiAdvancedSearchAuthor
}

type TwitterApiAdvancedSearchResponse = {
  tweets?: TwitterApiAdvancedSearchTweet[]
  has_next_page?: boolean
  next_cursor?: string
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
const ACTIVITY_LOOKUP_LIMIT = 5
const SUPPORT_COOLDOWN_DAYS = 14
const DAY_MS = 86_400_000

function roundUsdc(value: number): number {
  return Math.round(value * USDC_MICROS) / USDC_MICROS
}

function toMicros(value: number): number {
  return Math.max(0, Math.round(value * USDC_MICROS))
}

function fromMicros(value: number): number {
  return roundUsdc(value / USDC_MICROS)
}

function formatLocalizedCount(value: number): string {
  return new Intl.NumberFormat(getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US').format(value)
}

function uniqueSortedHandles(creators: CreatorEntry[]): string[] {
  const seen = new Set<string>()
  const handles: string[] = []

  for (const creator of creators) {
    const rawHandle = normalizeActivityQueryHandle(creator.handle)
    const dedupeKey = normalizeCreatorHandle(rawHandle)
    if (!rawHandle || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    handles.push(rawHandle)
  }

  return handles
    .sort((left, right) => left.localeCompare(right))
}

function getDaySeed(value = Date.now()): string {
  return new Date(value).toISOString().slice(0, 10)
}

function getStringHash(value: string): number {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  }
  return hash >>> 0
}

function getDailyJitter(seed: string, handle: string): number {
  return (getStringHash(`${seed}:${handle}`) % 10_000) / 10_000
}

function getAgeDays(timestamp: number | null, now: number): number | null {
  if (timestamp == null) return null
  return Math.max(0, (now - timestamp) / DAY_MS)
}

function normalizeActivityQueryHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '')
}

function getActivityQuery(handle: string): string {
  const normalizedHandle = normalizeActivityQueryHandle(handle)
  return `from:${normalizedHandle}`
}

function classifyActivityLookupStatus(status: number | null): TipAdvisorActivityIssue | null {
  if (status == null) return 'network'
  if (status === 401 || status === 403) return 'invalid-key'
  if (status === 429) return 'rate-limited'
  if (status >= 400 && status < 500) return 'query-failed'
  if (status >= 500) return 'network'
  return null
}

function getActivityIssueNote(issue: TipAdvisorActivityIssue | undefined): string {
  switch (issue) {
    case 'missing-key':
      return t('gogo.tipAdvisorNoActivityMissingKey')
    case 'rate-limited':
      return t('gogo.tipAdvisorNoActivityRateLimited')
    case 'invalid-key':
      return t('gogo.tipAdvisorNoActivityInvalidKey')
    case 'query-failed':
      return t('gogo.tipAdvisorNoActivityQueryFailed')
    case 'network':
    case 'unknown':
      return t('gogo.tipAdvisorNoActivityUnavailable')
    case undefined:
    default:
      return ''
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
    const ageDays = Math.max(0, (now - activity.latestTweetAt) / DAY_MS)
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

function buildSuggestionReason(
  entry: RankedCreator,
  historyRank: number | null,
  now: number,
  activityLookup: CreatorActivityLookup | undefined,
): string {
  const reasonParts: string[] = []
  const handleLabel = `@${entry.creator.handle}`
  const tweetsReturned = activityLookup?.tweetsReturned ?? null

  if (tweetsReturned != null) {
    if (tweetsReturned > 0) {
      reasonParts.push(formatText('gogo.tipAdvisorReasonActivityCount', {
        count: formatLocalizedCount(tweetsReturned),
      }))
    } else if (activityLookup?.status === 200) {
      reasonParts.push(formatText('gogo.tipAdvisorReasonNoRecentActivityForHandle', {
        handle: handleLabel,
      }))
    } else {
      reasonParts.push(formatText('gogo.tipAdvisorReasonActivityUnavailableForHandle', {
        handle: handleLabel,
      }))
    }
  }

  const supportAgeDays = getAgeDays(entry.history.lastTippedAt, now)
  if (entry.history.tipCount === 0 || supportAgeDays == null) {
    reasonParts.push(t('gogo.tipAdvisorReasonEven'))
  } else if (supportAgeDays < SUPPORT_COOLDOWN_DAYS) {
    reasonParts.push(t('gogo.tipAdvisorReasonCoolingOff'))
  } else if (historyRank === 1) {
    reasonParts.push(t('gogo.tipAdvisorReasonTopHistory'))
  } else {
    reasonParts.push(t('gogo.tipAdvisorReasonCooldown'))
  }

  if (reasonParts.length === 0) {
    reasonParts.push(t('gogo.tipAdvisorReasonEven'))
  }

  const deduped = [...new Set(reasonParts)].filter(Boolean)
  return deduped.slice(0, 2).join(' | ')
}

async function fetchCreatorActivity(creators: CreatorEntry[]): Promise<{
  activityMap: Map<string, CreatorActivity>
  activityLookupMap: Map<string, CreatorActivityLookup>
  activityState: TipAdvisorActivityState
  activityIssue?: TipAdvisorActivityIssue
}> {
  const handles = uniqueSortedHandles(creators)
  if (handles.length === 0) {
    return {
      activityMap: new Map(),
      activityLookupMap: new Map(),
      activityState: 'none',
    }
  }

  const apiKey = await getTwitterApiKey()
  if (!apiKey) {
    return {
      activityMap: new Map(),
      activityLookupMap: new Map(),
      activityState: 'unavailable',
      activityIssue: 'missing-key',
    }
  }

  const activityMap = new Map<string, CreatorActivity>()
  const activityLookupMap = new Map<string, CreatorActivityLookup>()
  let firstIssue: TipAdvisorActivityIssue | null = null

  for (const handle of handles) {
    const query = getActivityQuery(handle)
    let status: number | null = null
    let tweetsReturned = 0

    try {
      const searchUrl = new URL('/twitter/tweet/advanced_search', TWITTERAPI_BASE)
      searchUrl.searchParams.set('query', query)
      searchUrl.searchParams.set('queryType', 'Latest')

      const response = await fetchWithTimeout(searchUrl.toString(), {
        headers: {
          'X-API-Key': apiKey,
        },
      })

      status = response.status

      if (response.ok) {
        const data = await response.json() as TwitterApiAdvancedSearchResponse
        const rawTweets = Array.isArray(data.tweets) ? data.tweets : []
        tweetsReturned = rawTweets.length

        const mappedTweets = rawTweets
          .map((tweet) => {
            const authorHandle = normalizeCreatorHandle(tweet.author?.userName ?? '')
            if (!authorHandle) return null

            const id = typeof tweet.id === 'string' && tweet.id.trim()
              ? tweet.id.trim()
              : `${authorHandle}:${typeof tweet.createdAt === 'string' ? tweet.createdAt : ''}`
            const authorName = typeof tweet.author?.name === 'string' && tweet.author.name.trim()
              ? tweet.author.name.trim()
              : authorHandle

            return {
              id,
              text: typeof tweet.text === 'string' ? tweet.text : '',
              authorName,
              authorHandle,
              authorAvatar: typeof tweet.author?.profilePicture === 'string' ? tweet.author.profilePicture : '',
              createdAt: typeof tweet.createdAt === 'string' ? tweet.createdAt : '',
              likes: typeof tweet.likeCount === 'number' ? tweet.likeCount : 0,
              retweets: typeof tweet.retweetCount === 'number' ? tweet.retweetCount : 0,
              verified: Boolean(tweet.author?.isBlueVerified),
              tweetUrl: `https://twitter.com/${authorHandle}/status/${id}`,
            } satisfies TwitterTweet
          })
          .filter((tweet): tweet is TwitterTweet => Boolean(tweet))

        const creator = creators.find((item) => normalizeCreatorHandle(item.handle) === handle)
        if (creator && mappedTweets.length > 0) {
          const creatorActivity = buildActivityMap([creator], mappedTweets).get(handle)
          if (creatorActivity) {
            const current = activityMap.get(handle)
            activityMap.set(handle, current == null
              ? creatorActivity
              : {
                  ...current,
                  tweetCount: current.tweetCount + creatorActivity.tweetCount,
                  latestTweetAt: current.latestTweetAt == null
                    ? creatorActivity.latestTweetAt
                    : creatorActivity.latestTweetAt == null
                      ? current.latestTweetAt
                      : Math.max(current.latestTweetAt, creatorActivity.latestTweetAt),
                  totalLikes: current.totalLikes + creatorActivity.totalLikes,
                  totalRetweets: current.totalRetweets + creatorActivity.totalRetweets,
                })
          }
        }

        console.info(`[ADVISOR-X] handle=${handle} status=${status} tweetsReturned=${tweetsReturned}`)
      } else {
        const issue = classifyActivityLookupStatus(status)
        if (issue) firstIssue = firstIssue ?? issue
        console.info(`[ADVISOR-X] handle=${handle} status=${status} tweetsReturned=${tweetsReturned}`)
      }
    } catch (error) {
      const issue = status == null
        ? 'network'
        : classifyActivityLookupStatus(status) ?? 'unknown'
      firstIssue = firstIssue ?? issue
      console.info(`[ADVISOR-X] handle=${handle} status=${status ?? 0} tweetsReturned=${tweetsReturned}`)
      console.warn('[TipAdvisor] X activity lookup failed', {
        handle,
        query,
        issue,
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      activityLookupMap.set(handle, {
        status,
        tweetsReturned,
      })
    }
  }

  if (activityMap.size > 0) {
    return {
      activityMap,
      activityLookupMap,
      activityState: 'used',
    }
  }

  if (firstIssue) {
    return {
      activityMap: new Map(),
      activityLookupMap,
      activityState: 'unavailable',
      activityIssue: firstIssue,
    }
  }

  return {
    activityMap: new Map(),
    activityLookupMap,
    activityState: 'none',
  }
}

function buildSkippedReason(selectedCount: number): string {
  return formatText('gogo.tipAdvisorSkippedReason', {
    selected: selectedCount,
  })
}

function getActivityStateNote(activityState: TipAdvisorActivityState, activityIssue?: TipAdvisorActivityIssue): string {
  if (activityIssue) {
    const issueNote = getActivityIssueNote(activityIssue)
    if (issueNote) return issueNote
  }

  switch (activityState) {
    case 'used':
      return t('gogo.tipAdvisorActivityUsed')
    case 'unavailable':
      return t('gogo.tipAdvisorNoActivityUnavailable')
    case 'none':
    default:
      return t('gogo.tipAdvisorNoActivity')
  }
}

function getShareCap(entry: RankedCreator, index: number, count: number, now: number): number {
  if (count <= 1) return 1

  const baseCap = count === 2 ? 0.58 : 0.5
  const rankPenalty = index * (count === 2 ? 0.12 : 0.08)
  const activityBoost = entry.activity ? Math.min(0.12, getActivityScore(entry.activity, now) / 20) : 0
  return Math.max(0.34, Math.min(0.7, baseCap - rankPenalty + activityBoost))
}

function allocateBalancedMicros(totalBudgetMicros: number, rankedCreators: RankedCreator[], now: number): number[] {
  const count = rankedCreators.length
  if (count === 0) return []

  const baseMicros = toMicros(MIN_SUGGESTION_AMOUNT_USDC)
  const allocations = Array.from({ length: count }, () => baseMicros)
  let remainingMicros = totalBudgetMicros - (baseMicros * count)
  if (remainingMicros <= 0) {
    return allocations
  }

  const weights = rankedCreators.map((entry) => {
    const rawScore = Math.max(0, entry.score)
    const flattenedScore = Math.pow(rawScore + 1, 0.82)
    return Math.max(0.25, flattenedScore)
  })

  const caps = rankedCreators.map((entry, index) => {
    const capShare = getShareCap(entry, index, count, now)
    return Math.max(baseMicros, Math.floor(totalBudgetMicros * capShare))
  })

  const eligible = new Set<number>(rankedCreators.map((_, index) => index))

  while (remainingMicros > 0 && eligible.size > 0) {
    const eligibleEntries = [...eligible]
      .map((index) => ({
        index,
        remainingCapacity: caps[index] - allocations[index],
        weight: weights[index],
      }))
      .filter((entry) => entry.remainingCapacity > 0)

    if (eligibleEntries.length === 0) break

    const totalWeight = eligibleEntries.reduce((sum, entry) => sum + entry.weight, 0)
    let distributed = 0

    for (const entry of eligibleEntries) {
      if (remainingMicros <= 0) break

      const maxShare = entry.remainingCapacity
      const idealShare = totalWeight > 0
        ? Math.floor((remainingMicros * entry.weight) / totalWeight)
        : Math.floor(remainingMicros / eligibleEntries.length)
      const share = Math.max(0, Math.min(maxShare, idealShare))

      if (share > 0) {
        allocations[entry.index] += share
        remainingMicros -= share
        distributed += share
      }
    }

    if (distributed === 0) {
      const nextIndex = eligibleEntries
        .sort((left, right) => {
          if (right.remainingCapacity !== left.remainingCapacity) return right.remainingCapacity - left.remainingCapacity
          if (right.weight !== left.weight) return right.weight - left.weight
          return left.index - right.index
        })[0]?.index

      if (nextIndex == null) break
      allocations[nextIndex] += 1
      remainingMicros -= 1
    }

    for (const entry of eligibleEntries) {
      if (allocations[entry.index] >= caps[entry.index]) {
        eligible.delete(entry.index)
      }
    }
  }

  if (remainingMicros > 0) {
    const fallbackOrder = rankedCreators
      .map((entry, index) => ({
        index,
        remainingCapacity: caps[index] - allocations[index],
        weight: weights[index],
        jitter: getDailyJitter(getDaySeed(now), entry.creator.handle),
      }))
      .filter((entry) => entry.remainingCapacity > 0)
      .sort((left, right) => {
        if (right.remainingCapacity !== left.remainingCapacity) return right.remainingCapacity - left.remainingCapacity
        if (right.weight !== left.weight) return right.weight - left.weight
        if (right.jitter !== left.jitter) return right.jitter - left.jitter
        return left.index - right.index
      })

    for (const entry of fallbackOrder) {
      if (remainingMicros <= 0) break
      const share = Math.min(remainingMicros, caps[entry.index] - allocations[entry.index])
      if (share <= 0) continue
      allocations[entry.index] += share
      remainingMicros -= share
    }
  }

  const totalAllocated = allocations.reduce((sum, amount) => sum + amount, 0)
  const correction = totalBudgetMicros - totalAllocated
  if (correction !== 0 && allocations.length > 0) {
    allocations[0] = Math.max(baseMicros, allocations[0] + correction)
  }

  return allocations
}

function buildExplanation(result: TipAdvisorResult): string {
  if (!result.canExecute) {
    return result.summary
  }

  const explanationParts = [result.summary]
  const activityNote = getActivityStateNote(result.activityState, result.activityIssue)
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

  const { activityMap, activityLookupMap, activityState, activityIssue } = await fetchCreatorActivity(creators)
  const historyMap = buildHistoryMap(creators, budgetState.log)
  const historyRankMap = buildHistoryRankMap(historyMap)
  const now = Date.now()
  const dailySeed = budgetState.lastResetDate || getDaySeed(now)

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
      const score = (getActivityScore(activity, now) * 1.35) + (getHistoryScore(history, now) * 0.9) + getDailyJitter(dailySeed, creator.handle) * 0.05

      return {
        creator,
        history,
        activity,
        score,
      }
    })
    .sort((left, right) => {
      if (Math.abs(right.score - left.score) > 0.08) return right.score - left.score

      const leftActivityAt = left.activity?.latestTweetAt ?? 0
      const rightActivityAt = right.activity?.latestTweetAt ?? 0
      if (rightActivityAt !== leftActivityAt) return rightActivityAt - leftActivityAt

      const leftHistoryAt = left.history.lastTippedAt ?? 0
      const rightHistoryAt = right.history.lastTippedAt ?? 0
      if (rightHistoryAt !== leftHistoryAt) return rightHistoryAt - leftHistoryAt

      const leftJitter = getDailyJitter(dailySeed, left.creator.handle)
      const rightJitter = getDailyJitter(dailySeed, right.creator.handle)
      if (rightJitter !== leftJitter) return rightJitter - leftJitter

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
  const allocations = allocateBalancedMicros(availableBudgetMicros, selected, now)

  const suggestions: TipSuggestion[] = selected.map((entry, index) => ({
    handle: entry.creator.handle,
    address: entry.creator.address,
    amount: formatTipBudgetAmount(fromMicros(allocations[index] ?? minMicros)),
    reason: buildSuggestionReason(entry, historyRankMap.get(entry.creator.handle) ?? null, now, activityLookupMap.get(entry.creator.handle)),
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
    activityIssue,
  }

  result.explanation = buildExplanation(result)
  return result
}
