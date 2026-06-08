import { TWITTERAPI_KEY, TWITTER_SEARCH_QUERY, TWITTER_TWEETS_CACHE_KEY } from '@/lib/storageKeys'

const LEGACY_TWITTERAPI_KEY = 'arccopilot:twitterapi-io-key'
export const DEFAULT_TWITTER_SEARCH_QUERY = '"Arc Network" OR "ArcStablecoin" OR "Arc testnet"'

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
}

export async function getTwitterApiKey(): Promise<string | null> {
  if (!canUseChromeStorage()) return null

  const res = await chrome.storage.local.get([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY]) as Record<string, string | undefined>
  const key = res[TWITTERAPI_KEY] || res[LEGACY_TWITTERAPI_KEY] || null

  if (key && !res[TWITTERAPI_KEY]) {
    await chrome.storage.local.set({ [TWITTERAPI_KEY]: key })
    await chrome.storage.local.remove(LEGACY_TWITTERAPI_KEY)
  }

  return key
}

export async function setTwitterApiKey(key: string): Promise<void> {
  if (!canUseChromeStorage()) return

  await chrome.storage.local.set({ [TWITTERAPI_KEY]: key })
  await chrome.storage.local.remove(LEGACY_TWITTERAPI_KEY)
}

export async function clearTwitterApiKey(): Promise<void> {
  if (!canUseChromeStorage()) return

  await chrome.storage.local.remove([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY])
}

export async function getSearchQuery(): Promise<string> {
  if (!canUseChromeStorage()) return DEFAULT_TWITTER_SEARCH_QUERY

  const res = await chrome.storage.local.get([TWITTER_SEARCH_QUERY]) as Record<string, string | undefined>
  const stored = typeof res[TWITTER_SEARCH_QUERY] === 'string' ? res[TWITTER_SEARCH_QUERY]!.trim() : ''

  return stored || DEFAULT_TWITTER_SEARCH_QUERY
}

export async function setSearchQuery(query: string): Promise<void> {
  const normalized = query.trim()

  try {
    await clearTweetsCache()
    if (canUseChromeStorage()) {
      if (normalized) {
        await chrome.storage.local.set({ [TWITTER_SEARCH_QUERY]: normalized })
      } else {
        await chrome.storage.local.remove(TWITTER_SEARCH_QUERY)
      }
    }
  } finally {
    await clearTweetsCache()
  }
}

export async function fetchArcTweets(): Promise<TwitterTweet[]> {
  const apiKey = await getTwitterApiKey()
  if (!apiKey) throw new Error('TwitterAPI key not set. Add it in Settings.')

  const query = await getSearchQuery()
  const searchUrl = new URL('https://api.twitterapi.io/twitter/tweet/advanced_search')
  searchUrl.searchParams.set('query', query)
  searchUrl.searchParams.set('queryType', 'Latest')

  const res = await fetch(searchUrl.toString(), {
    headers: { 'X-API-Key': apiKey },
  })

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Invalid TwitterAPI key. Update in Settings.')
    if (res.status === 429) throw new Error('Rate limit. Try again later.')
    throw new Error(`TwitterAPI error ${res.status}`)
  }

  const data = await res.json() as TwitterApiResponse
  const tweets = Array.isArray(data.tweets) ? data.tweets : []

  return tweets.slice(0, 5).map((t: any) => ({
    id: t.id || String(Math.random()),
    text: t.text || '',
    authorName: t.author?.name || t.author?.userName || 'Unknown',
    authorHandle: t.author?.userName || 'unknown',
    authorAvatar: t.author?.profilePicture || '',
    createdAt: t.createdAt || '',
    likes: t.likeCount || 0,
    retweets: t.retweetCount || 0,
    verified: t.author?.isBlueVerified || false,
    tweetUrl: t.url || `https://twitter.com/${t.author?.userName}/status/${t.id}`,
  }))
}
