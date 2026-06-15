import {
  TWITTERAPI_KEY,
  TWITTER_OFFICIAL_ACCOUNTS,
  TWITTER_OFFICIAL_TWEETS_CACHE_KEY,
  TWITTER_SEARCH_QUERY,
  TWITTER_TWEETS_CACHE_KEY,
  getTwitterFeedCacheKey,
} from '@/lib/storageKeys'
import { getApiKey as getGeminiApiKey } from '@/lib/gogoAI'
import {
  GEMINI_MODEL,
  TWITTERAPI_BASE,
  TWITTER_FEED_CACHE_TTL_MS,
  TWITTER_FEED_RETRY_BACKOFF_MS,
} from '@/lib/constants'
import { debugWarn } from '@/lib/debug'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'

const LEGACY_TWITTERAPI_KEY = 'arccopilot:twitterapi-io-key'
export const DEFAULT_TWITTER_SEARCH_QUERY = '"Arc Network" OR "ArcStablecoin" OR "Arc testnet"'
export const DEFAULT_TWITTER_OFFICIAL_ACCOUNTS = 'arc, circle'
export type TweetCategory = 'news' | 'opportunity' | 'discussion'
type TwitterFeedKind = 'community' | 'official'

type TwitterFeedCacheEntry = {
  tweets: TwitterTweet[]
  fetchedAt: number
}

export type TwitterFeedFetchResult = {
  tweets: TwitterTweet[]
  fetchedAt: number
  cacheStatus: 'fresh-cache' | 'network' | 'stale-cache'
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

async function clearTweetsCache(): Promise<void> {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(TWITTER_TWEETS_CACHE_KEY)
  } catch {
    // Ignore cache cleanup failures. The next fetch will still use the current query.
  }
}

async function clearOfficialTweetsCache(): Promise<void> {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(TWITTER_OFFICIAL_TWEETS_CACHE_KEY)
  } catch {
    // Ignore cache cleanup failures. The next fetch will still use the current official account list.
  }
}

function normalizeFeedQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

function buildTwitterFeedCacheKey(kind: TwitterFeedKind, query: string): string {
  return getTwitterFeedCacheKey(kind, normalizeFeedQuery(query))
}

function isTwitterFeedCacheEntry(value: unknown): value is TwitterFeedCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const entry = value as { tweets?: unknown; fetchedAt?: unknown }
  return Array.isArray(entry.tweets) && typeof entry.fetchedAt === 'number'
}

function isFreshTwitterFeedCache(entry: TwitterFeedCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < TWITTER_FEED_CACHE_TTL_MS
}

async function readTwitterFeedCache(kind: TwitterFeedKind, query: string): Promise<TwitterFeedCacheEntry | null> {
  if (!canUseChromeStorage()) return null

  const cacheKey = buildTwitterFeedCacheKey(kind, query)
  const result = await chromeStorageGet(cacheKey)
  const cached = result[cacheKey]

  if (!isTwitterFeedCacheEntry(cached)) {
    if (typeof cached !== 'undefined') {
      await chromeStorageRemove(cacheKey)
    }
    return null
  }

  return cached
}

async function writeTwitterFeedCache(kind: TwitterFeedKind, query: string, entry: TwitterFeedCacheEntry): Promise<void> {
  if (!canUseChromeStorage()) return

  const cacheKey = buildTwitterFeedCacheKey(kind, query)
  await chromeStorageSet({ [cacheKey]: entry })
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function normalizeTwitterHandle(handle: string): string {
  return handle
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
}

function parseTwitterHandleList(value: string): string[] {
  const seen = new Set<string>()
  const handles: string[] = []

  for (const part of value.split(/[,\n;]+/)) {
    const normalized = normalizeTwitterHandle(part)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    handles.push(normalized)
  }

  return handles
}

function formatTwitterHandleList(handles: string[]): string {
  return handles.join(', ')
}

function buildOfficialTweetsQuery(handles: string[]): string {
  const normalized = handles.length > 0 ? handles : parseTwitterHandleList(DEFAULT_TWITTER_OFFICIAL_ACCOUNTS)
  return normalized.map((handle) => `from:${handle}`).join(' OR ')
}

function mapTwitterApiTweet(tweet: TwitterApiTweet): TwitterTweet {
  const authorHandle = typeof tweet.author?.userName === 'string' && tweet.author.userName.trim()
    ? normalizeTwitterHandle(tweet.author.userName)
    : 'unknown'
  const id = typeof tweet.id === 'string' && tweet.id.trim() ? tweet.id.trim() : String(Math.random())
  const authorName = typeof tweet.author?.name === 'string' && tweet.author.name.trim()
    ? tweet.author.name.trim()
    : 'Unknown'

  return {
    id,
    text: typeof tweet.text === 'string' ? tweet.text : '',
    authorName,
    authorHandle: authorHandle || 'unknown',
    authorAvatar: typeof tweet.author?.profilePicture === 'string' ? tweet.author.profilePicture : '',
    createdAt: typeof tweet.createdAt === 'string' ? tweet.createdAt : '',
    likes: typeof tweet.likeCount === 'number' ? tweet.likeCount : 0,
    retweets: typeof tweet.retweetCount === 'number' ? tweet.retweetCount : 0,
    verified: Boolean(tweet.author?.isBlueVerified),
    tweetUrl: typeof tweet.url === 'string' && tweet.url
      ? tweet.url
      : `https://twitter.com/${authorHandle || 'unknown'}/status/${id}`,
  }
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function normalizeTweetCategory(value: unknown): TweetCategory | null {
  if (typeof value !== 'string') return null

  switch (value.trim().toLowerCase()) {
    case 'news':
      return 'news'
    case 'opportunity':
      return 'opportunity'
    case 'discussion':
      return 'discussion'
    default:
      return null
  }
}

function buildCategorizationPrompt(tweets: TwitterTweet[]): string {
  const numberedTweets = tweets
    .map((tweet, index) => {
      const text = tweet.text.trim().replace(/\s+/g, ' ')
      return `${index + 1}. ${text || '[empty tweet]'}`
    })
    .join('\n')

  return `Categorize each tweet into one of: news (announcements, updates, launches), opportunity (airdrops, faucets, tasks, rewards, earning), discussion (opinions, questions, general talk). Return ONLY a JSON array of categories in the same order, e.g. ["news","opportunity","discussion"].

Tweets:
${numberedTweets}`
}

function normalizeCategorizationResponse(raw: unknown, tweetCount: number): TweetCategory[] | null {
  if (!Array.isArray(raw) || raw.length !== tweetCount) return null

  const categories = raw.map((item) => normalizeTweetCategory(item))
  if (categories.some((category) => category == null)) return null

  return categories as TweetCategory[]
}

function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type TwitterApiAuthor = {
  userName?: string
  name?: string
  profilePicture?: string
  isBlueVerified?: boolean
}

type TwitterApiTweet = {
  id?: string
  url?: string
  text?: string
  createdAt?: string
  likeCount?: number
  retweetCount?: number
  author?: TwitterApiAuthor
}

type TwitterApiResponse = {
  tweets?: TwitterApiTweet[]
  has_next_page?: boolean
  next_cursor?: string
}

export type TwitterTweet = {
  id: string
  text: string
  authorName: string
  authorHandle: string
  authorAvatar: string
  createdAt: string
  likes: number
  retweets: number
  verified: boolean
  tweetUrl: string
  category?: TweetCategory
}

export async function getTwitterApiKey(): Promise<string | null> {
  if (!canUseChromeStorage()) return null

  const res = await chromeStorageGet([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY])
  const hasPrimary = Object.prototype.hasOwnProperty.call(res, TWITTERAPI_KEY)
  const hasLegacy = Object.prototype.hasOwnProperty.call(res, LEGACY_TWITTERAPI_KEY)
  const key = typeof res[TWITTERAPI_KEY] === 'string' && res[TWITTERAPI_KEY].trim()
    ? res[TWITTERAPI_KEY]
    : typeof res[LEGACY_TWITTERAPI_KEY] === 'string' && res[LEGACY_TWITTERAPI_KEY].trim()
      ? res[LEGACY_TWITTERAPI_KEY]
      : null

  if (!key && (hasPrimary || hasLegacy)) {
    await chromeStorageRemove([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY])
    return null
  }

  if (key && !res[TWITTERAPI_KEY]) {
    await chromeStorageSet({ [TWITTERAPI_KEY]: key })
    await chromeStorageRemove(LEGACY_TWITTERAPI_KEY)
  }

  return key
}

export async function setTwitterApiKey(key: string): Promise<void> {
  if (!canUseChromeStorage()) return

  await chromeStorageSet({ [TWITTERAPI_KEY]: key })
  await chromeStorageRemove(LEGACY_TWITTERAPI_KEY)
}

export async function clearTwitterApiKey(): Promise<void> {
  if (!canUseChromeStorage()) return

  await chromeStorageRemove([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY])
}

export async function getOfficialAccounts(): Promise<string> {
  if (!canUseChromeStorage()) return DEFAULT_TWITTER_OFFICIAL_ACCOUNTS

  const res = await chromeStorageGet([TWITTER_OFFICIAL_ACCOUNTS])
  const hasStoredValue = Object.prototype.hasOwnProperty.call(res, TWITTER_OFFICIAL_ACCOUNTS)
  const stored = typeof res[TWITTER_OFFICIAL_ACCOUNTS] === 'string'
    ? res[TWITTER_OFFICIAL_ACCOUNTS]!.trim()
    : ''
  const handles = parseTwitterHandleList(stored)

  if (handles.length === 0) {
    if (stored && hasStoredValue) {
      await chromeStorageRemove(TWITTER_OFFICIAL_ACCOUNTS)
    }
    return DEFAULT_TWITTER_OFFICIAL_ACCOUNTS
  }

  const normalized = formatTwitterHandleList(handles)
  if (normalized !== stored) {
    await chromeStorageSet({ [TWITTER_OFFICIAL_ACCOUNTS]: normalized })
  }

  return normalized
}

export async function setOfficialAccounts(accounts: string): Promise<string> {
  const handles = parseTwitterHandleList(accounts)
  const normalized = handles.length > 0
    ? formatTwitterHandleList(handles)
    : DEFAULT_TWITTER_OFFICIAL_ACCOUNTS

  await clearOfficialTweetsCache()
  if (canUseChromeStorage()) {
    await chromeStorageSet({ [TWITTER_OFFICIAL_ACCOUNTS]: normalized })
  }

  return normalized
}

export async function categorizeTweets(tweets: TwitterTweet[]): Promise<TwitterTweet[]> {
  if (tweets.length === 0) return tweets

  const apiKey = await getGeminiApiKey()
  if (!apiKey) return tweets

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
  const body = {
    systemInstruction: {
      parts: [{
        text: 'You categorize Arc tweets. Return only a JSON array of categories.',
      }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildCategorizationPrompt(tweets) }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      topP: 0.95,
    },
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return tweets

    const data = await res.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>
        }
      }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return tweets

    const payload = extractJsonPayload(text)
    const categories = normalizeCategorizationResponse(safeParseJson(payload), tweets.length)
    if (!categories) return tweets

    return tweets.map((tweet, index) => ({
      ...tweet,
      category: categories[index],
    }))
  } catch (error) {
    debugWarn('[TwitterAPI] categorizeTweets failed:', error)
    return tweets
  }
}

export async function getSearchQuery(): Promise<string> {
  if (!canUseChromeStorage()) return DEFAULT_TWITTER_SEARCH_QUERY

  const res = await chromeStorageGet([TWITTER_SEARCH_QUERY])
  const hasStoredValue = Object.prototype.hasOwnProperty.call(res, TWITTER_SEARCH_QUERY)
  const stored = typeof res[TWITTER_SEARCH_QUERY] === 'string' ? res[TWITTER_SEARCH_QUERY]!.trim() : ''

  if (!stored) {
    if (hasStoredValue) {
      await chromeStorageRemove(TWITTER_SEARCH_QUERY)
    }
    return DEFAULT_TWITTER_SEARCH_QUERY
  }

  return stored || DEFAULT_TWITTER_SEARCH_QUERY
}

export async function setSearchQuery(query: string): Promise<void> {
  const normalized = query.trim()

  try {
    await clearTweetsCache()
    if (canUseChromeStorage()) {
      if (normalized) {
        await chromeStorageSet({ [TWITTER_SEARCH_QUERY]: normalized })
      } else {
        await chromeStorageRemove(TWITTER_SEARCH_QUERY)
      }
    }
  } finally {
    await clearTweetsCache()
  }
}

async function fetchTweetsByQueryWithCache(
  query: string,
  apiKey: string | null,
  limit: number,
  kind: TwitterFeedKind,
): Promise<TwitterFeedFetchResult> {
  const normalizedQuery = normalizeFeedQuery(query)
  const cached = await readTwitterFeedCache(kind, normalizedQuery)
  if (cached && isFreshTwitterFeedCache(cached)) {
    return {
      tweets: cached.tweets.slice(0, limit),
      fetchedAt: cached.fetchedAt,
      cacheStatus: 'fresh-cache',
    }
  }

  if (!apiKey) {
    throw new Error('TwitterAPI key not set. Add it in Settings.')
  }

  const searchUrl = new URL('/twitter/tweet/advanced_search', TWITTERAPI_BASE)
  searchUrl.searchParams.set('query', normalizedQuery)
  searchUrl.searchParams.set('queryType', 'Latest')

  const executeFetch = async (): Promise<Response> => fetchWithTimeout(searchUrl.toString(), {
    headers: { 'X-API-Key': apiKey },
  })

  const staleCacheResult = (): TwitterFeedFetchResult | null => {
    if (!cached) return null
    return {
      tweets: cached.tweets.slice(0, limit),
      fetchedAt: cached.fetchedAt,
      cacheStatus: 'stale-cache',
    }
  }

  let res: Response
  try {
    res = await executeFetch()
  } catch (error) {
    const fallback = staleCacheResult()
    if (fallback) return fallback
    throw error instanceof Error ? error : new Error(String(error))
  }

  if (res.status === 429) {
    debugWarn('[TwitterAPI] rate limited, retrying once:', { kind, query: normalizedQuery })
    await delay(TWITTER_FEED_RETRY_BACKOFF_MS)

    try {
      res = await executeFetch()
    } catch (error) {
      const fallback = staleCacheResult()
      if (fallback) return fallback
      throw error instanceof Error ? error : new Error(String(error))
    }

    if (res.status === 429) {
      const fallback = staleCacheResult()
      if (fallback) return fallback
      throw new Error('Rate limit. Try again later.')
    }
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Invalid TwitterAPI key. Update in Settings.')
    throw new Error(`TwitterAPI error ${res.status}`)
  }

  const data = await res.json() as TwitterApiResponse
  const tweets = Array.isArray(data.tweets) ? data.tweets : []
  const mapped = tweets.slice(0, limit).map(mapTwitterApiTweet)
  const fetchedAt = Date.now()

  await writeTwitterFeedCache(kind, normalizedQuery, {
    tweets: mapped,
    fetchedAt,
  })

  return {
    tweets: mapped,
    fetchedAt,
    cacheStatus: 'network',
  }
}

export async function fetchArcTweetFeed(): Promise<TwitterFeedFetchResult> {
  const apiKey = await getTwitterApiKey()
  const query = await getSearchQuery()
  return fetchTweetsByQueryWithCache(query, apiKey, 5, 'community')
}

export async function fetchArcTweets(): Promise<TwitterTweet[]> {
  const result = await fetchArcTweetFeed()
  return result.tweets
}

export async function fetchOfficialTweetFeed(): Promise<TwitterFeedFetchResult | null> {
  const apiKey = await getTwitterApiKey()

  try {
    const officialAccounts = await getOfficialAccounts()
    const handles = parseTwitterHandleList(officialAccounts)
    const query = buildOfficialTweetsQuery(handles)
    return await fetchTweetsByQueryWithCache(query, apiKey, 3, 'official')
  } catch (error) {
    debugWarn('[TwitterAPI] fetchOfficialTweetFeed failed:', error)
    return null
  }
}

export async function fetchOfficialTweets(): Promise<TwitterTweet[]> {
  const result = await fetchOfficialTweetFeed()
  return result?.tweets ?? []
}
