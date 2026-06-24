import { chromeStorageGet, chromeStorageRemove, chromeStorageSet } from '@/lib/external'
import { fetchTweetsByQuery, type TwitterTweet } from '@/lib/twitterApi'
import { listCreators, normalizeCreatorHandle } from '@/lib/creatorRegistry'
import { formatText, t } from '@/lib/i18n'
import { USER_X_HANDLE } from '@/lib/storageKeys'

const DISCOVERY_CACHE_PREFIX = 'arccopilot:creator-discovery:'
const DISCOVERY_CACHE_TTL_MS = 30 * 60_000
const DISCOVERY_TWEET_LIMIT = 20
const DISCOVERY_RECENCY_WINDOW_MS = 30 * 24 * 60 * 60_000
const DISCOVERY_MAX_CANDIDATES = 5

type DiscoveryStatus =
  | 'success'
  | 'missing-handle'
  | 'missing-key'
  | 'invalid-key'
  | 'rate-limited'
  | 'no-candidates'
  | 'unavailable'

export type CreatorDiscoveryCandidate = {
  handle: string
  reason: string
}

export type CreatorDiscoveryResult = {
  candidates: CreatorDiscoveryCandidate[]
  message: string
  status: DiscoveryStatus
  cacheHit: boolean
  tweetsReturned: number
  userHandle: string | null
}

type DiscoveryCacheEntry = {
  candidates: CreatorDiscoveryCandidate[]
  message: string
  status: DiscoveryStatus
  fetchedAt: number
  tweetsReturned: number
}

type MentionBucket = {
  count: number
  lastSeenAt: number
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function normalizeStoredXHandle(value: string): string {
  return value
    .trim()
    .replace(/^@+/, '')
    .replace(/['’].*$/, '')
    .replace(/[.,!?]+$/, '')
}

function normalizeCacheHandle(value: string): string {
  return normalizeCreatorHandle(value)
}

function buildDiscoveryCacheKey(handle: string): string {
  return `${DISCOVERY_CACHE_PREFIX}${normalizeCacheHandle(handle)}`
}

function isFreshDiscoveryCache(entry: DiscoveryCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < DISCOVERY_CACHE_TTL_MS
}

function isDiscoveryCacheEntry(value: unknown): value is DiscoveryCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const entry = value as Partial<DiscoveryCacheEntry>
  return Array.isArray(entry.candidates)
    && typeof entry.message === 'string'
    && typeof entry.status === 'string'
    && typeof entry.fetchedAt === 'number'
    && typeof entry.tweetsReturned === 'number'
}

function toDiscoveryResult(entry: DiscoveryCacheEntry, cacheHit: boolean, userHandle: string | null): CreatorDiscoveryResult {
  return {
    candidates: entry.candidates,
    message: entry.message,
    status: entry.status,
    cacheHit,
    tweetsReturned: entry.tweetsReturned,
    userHandle,
  }
}

async function readDiscoveryCache(handle: string): Promise<DiscoveryCacheEntry | null> {
  if (!canUseChromeStorage()) return null

  const cacheKey = buildDiscoveryCacheKey(handle)
  const result = await chromeStorageGet(cacheKey)
  const cached = result[cacheKey]

  if (!isDiscoveryCacheEntry(cached)) {
    if (typeof cached !== 'undefined') {
      await chromeStorageRemove(cacheKey)
    }
    return null
  }

  if (!isFreshDiscoveryCache(cached)) {
    await chromeStorageRemove(cacheKey)
    return null
  }

  return cached
}

async function writeDiscoveryCache(handle: string, entry: DiscoveryCacheEntry): Promise<void> {
  if (!canUseChromeStorage()) return

  const cacheKey = buildDiscoveryCacheKey(handle)
  await chromeStorageSet({ [cacheKey]: entry })
}

async function getStoredUserXHandle(): Promise<string | null> {
  if (!canUseChromeStorage()) return null

  const result = await chromeStorageGet(USER_X_HANDLE)
  const raw = typeof result[USER_X_HANDLE] === 'string' ? result[USER_X_HANDLE] : ''
  const normalized = normalizeStoredXHandle(raw)
  return normalized || null
}

function extractMentionHandles(tweetText: string): string[] {
  const handles: string[] = []
  const pattern = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,15})\b/g

  for (const match of tweetText.matchAll(pattern)) {
    const handle = match[1]
    if (!handle) continue
    const normalized = normalizeCreatorHandle(handle)
    if (!normalized) continue
    handles.push(normalized)
  }

  return handles
}

function parseCreatedAtMs(tweet: TwitterTweet): number | null {
  const timestamp = Date.parse(tweet.createdAt)
  return Number.isFinite(timestamp) ? timestamp : null
}

function filterRecentTweets(tweets: TwitterTweet[]): TwitterTweet[] {
  const cutoff = Date.now() - DISCOVERY_RECENCY_WINDOW_MS
  return tweets.filter((tweet) => {
    const timestamp = parseCreatedAtMs(tweet)
    return timestamp != null && timestamp >= cutoff
  })
}

function buildReason(count: number): string {
  if (count > 1) {
    return formatText('gogo.creatorDiscoveryReasonMentionCount', { count })
  }

  return t('gogo.creatorDiscoveryReasonMentionOnce')
}

function buildNoCandidatesResult(userHandle: string | null, tweetsReturned: number, cacheHit: boolean, status: DiscoveryStatus = 'no-candidates'): CreatorDiscoveryResult {
  return {
    candidates: [],
    message: tweetsReturned > 0
      ? t('gogo.creatorDiscoveryNoCandidates')
      : t('gogo.creatorDiscoveryNoActivity'),
    status,
    cacheHit,
    tweetsReturned,
    userHandle,
  }
}

function buildRateLimitedResult(userHandle: string | null, tweetsReturned: number, cacheHit: boolean): CreatorDiscoveryResult {
  return {
    candidates: [],
    message: t('gogo.creatorDiscoveryRateLimited'),
    status: 'rate-limited',
    cacheHit,
    tweetsReturned,
    userHandle,
  }
}

function buildHandleMissingResult(): CreatorDiscoveryResult {
  return {
    candidates: [],
    message: t('gogo.creatorDiscoveryNoHandle'),
    status: 'missing-handle',
    cacheHit: false,
    tweetsReturned: 0,
    userHandle: null,
  }
}

function buildMissingKeyResult(userHandle: string | null, cacheHit: boolean, messageKey: 'gogo.creatorDiscoveryMissingKey' | 'gogo.creatorDiscoveryInvalidKey'): CreatorDiscoveryResult {
  return {
    candidates: [],
    message: t(messageKey),
    status: messageKey === 'gogo.creatorDiscoveryMissingKey' ? 'missing-key' : 'invalid-key',
    cacheHit,
    tweetsReturned: 0,
    userHandle,
  }
}

function buildUnavailableResult(userHandle: string | null, cacheHit: boolean): CreatorDiscoveryResult {
  return {
    candidates: [],
    message: t('gogo.creatorDiscoveryUnavailable'),
    status: 'unavailable',
    cacheHit,
    tweetsReturned: 0,
    userHandle,
  }
}

function rankCandidates(buckets: Map<string, MentionBucket>): Array<{ handle: string; stats: MentionBucket }> {
  return [...buckets.entries()]
    .sort((a, b) => {
      const [handleA, statsA] = a
      const [handleB, statsB] = b
      if (statsA.count !== statsB.count) return statsB.count - statsA.count
      if (statsA.lastSeenAt !== statsB.lastSeenAt) return statsB.lastSeenAt - statsA.lastSeenAt
      return handleA.localeCompare(handleB)
    })
    .slice(0, DISCOVERY_MAX_CANDIDATES)
    .map(([handle, stats]) => ({ handle, stats }))
}

function buildDiscoveryMessage(candidates: CreatorDiscoveryCandidate[]): string {
  if (candidates.length === 0) {
    return t('gogo.creatorDiscoveryNoCandidates')
  }

  return `${formatText('gogo.creatorDiscoveryFoundCount', { count: candidates.length })} ${t('gogo.creatorDiscoveryNeedAddress')}`
}

function getRegistrySet(handles: Array<{ handle: string }>): Set<string> {
  return new Set(handles.map((entry) => normalizeCacheHandle(entry.handle)))
}

async function discoverFromNetwork(userHandle: string): Promise<CreatorDiscoveryResult> {
  const normalizedCacheHandle = normalizeCacheHandle(userHandle)
  const creators = await listCreators()
  const registryHandles = getRegistrySet(creators)
  const query = `from:${normalizeStoredXHandle(userHandle)}`

  try {
    const result = await fetchTweetsByQuery(query, DISCOVERY_TWEET_LIMIT)
    const tweetsReturned = Array.isArray(result.tweets) ? result.tweets.length : 0
    const recentTweets = filterRecentTweets(result.tweets)
    const buckets = new Map<string, MentionBucket>()

    for (const tweet of recentTweets) {
      const timestamp = parseCreatedAtMs(tweet)
      if (timestamp == null) continue

      for (const mention of extractMentionHandles(tweet.text)) {
        if (mention === normalizedCacheHandle) continue
        if (registryHandles.has(mention)) continue

        const current = buckets.get(mention) ?? { count: 0, lastSeenAt: 0 }
        current.count += 1
        current.lastSeenAt = Math.max(current.lastSeenAt, timestamp)
        buckets.set(mention, current)
      }
    }

    const ranked = rankCandidates(buckets)
    const candidates = ranked.map(({ handle, stats }) => ({
      handle,
      reason: buildReason(stats.count),
    }))
    const status: DiscoveryStatus = candidates.length > 0 ? 'success' : 'no-candidates'
    const message = candidates.length > 0
      ? buildDiscoveryMessage(candidates)
      : buildNoCandidatesResult(userHandle, tweetsReturned, false).message

    const cacheEntry: DiscoveryCacheEntry = {
      candidates,
      message,
      status,
      fetchedAt: Date.now(),
      tweetsReturned,
    }

    await writeDiscoveryCache(userHandle, cacheEntry)

    return {
      candidates,
      message,
      status,
      cacheHit: false,
      tweetsReturned,
      userHandle,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not set/i.test(message)) {
      return buildMissingKeyResult(userHandle, false, 'gogo.creatorDiscoveryMissingKey')
    }
    if (/invalid TwitterAPI key/i.test(message)) {
      return buildMissingKeyResult(userHandle, false, 'gogo.creatorDiscoveryInvalidKey')
    }
    if (/rate limit/i.test(message)) {
      return buildRateLimitedResult(userHandle, 0, false)
    }

    return buildUnavailableResult(userHandle, false)
  }
}

function maybeRewriteCachedCandidatesForRegistry(cacheEntry: DiscoveryCacheEntry, registryHandles: Set<string>): DiscoveryCacheEntry {
  const filteredCandidates = cacheEntry.candidates.filter((candidate) => !registryHandles.has(normalizeCacheHandle(candidate.handle)))
  if (filteredCandidates.length === cacheEntry.candidates.length) return cacheEntry

  const message = filteredCandidates.length > 0
    ? buildDiscoveryMessage(filteredCandidates)
    : t('gogo.creatorDiscoveryNoCandidates')

  return {
    ...cacheEntry,
    candidates: filteredCandidates,
    message,
    status: filteredCandidates.length > 0 ? 'success' : 'no-candidates',
  }
}

export async function getUserXHandle(): Promise<string | null> {
  return getStoredUserXHandle()
}

export async function setUserXHandle(handle: string): Promise<string | null> {
  if (!canUseChromeStorage()) return null

  const normalized = normalizeStoredXHandle(handle)
  if (!normalized) {
    await chromeStorageRemove(USER_X_HANDLE)
    return null
  }

  await chromeStorageSet({ [USER_X_HANDLE]: normalized })
  return normalized
}

export async function clearUserXHandle(): Promise<void> {
  if (!canUseChromeStorage()) return
  await chromeStorageRemove(USER_X_HANDLE)
}

export async function discoverCreators(): Promise<CreatorDiscoveryResult> {
  const userHandle = await getStoredUserXHandle()
  if (!userHandle) {
    const result = buildHandleMissingResult()
    console.log('[DISCOVERY] userHandle=<unset> status=missing-handle tweetsReturned=0 candidates=0 cacheHit=false')
    return result
  }

  const normalizedHandle = normalizeCacheHandle(userHandle)
  const cached = await readDiscoveryCache(normalizedHandle)
  const creators = await listCreators()
  const registryHandles = getRegistrySet(creators)

  if (cached) {
    const rewritten = maybeRewriteCachedCandidatesForRegistry(cached, registryHandles)
    console.log(`[DISCOVERY] userHandle=${userHandle} status=${rewritten.status} tweetsReturned=${rewritten.tweetsReturned} candidates=${rewritten.candidates.length} cacheHit=true`)
    return toDiscoveryResult(rewritten, true, userHandle)
  }

  const result = await discoverFromNetwork(userHandle)
  const filteredCandidates = result.candidates.filter((candidate) => !registryHandles.has(normalizeCacheHandle(candidate.handle)))
  const finalResult: CreatorDiscoveryResult = filteredCandidates.length === result.candidates.length
    ? result
    : {
        ...result,
        candidates: filteredCandidates,
        message: filteredCandidates.length > 0
          ? buildDiscoveryMessage(filteredCandidates)
          : t('gogo.creatorDiscoveryNoCandidates'),
        status: filteredCandidates.length > 0 ? 'success' : 'no-candidates',
      }

  console.log(`[DISCOVERY] userHandle=${userHandle} status=${finalResult.status} tweetsReturned=${finalResult.tweetsReturned} candidates=${finalResult.candidates.length} cacheHit=${finalResult.cacheHit}`)
  return finalResult
}
