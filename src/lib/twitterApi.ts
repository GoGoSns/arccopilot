import { TWITTERAPI_KEY, TWITTER_SEARCH_QUERY, TWITTER_TWEETS_CACHE_KEY } from '@/lib/storageKeys'
import { getApiKey as getGeminiApiKey } from '@/lib/gogoAI'
import { GEMINI_MODEL, TWITTERAPI_BASE } from '@/lib/constants'
import { debugWarn } from '@/lib/debug'

const LEGACY_TWITTERAPI_KEY = 'arccopilot:twitterapi-io-key'
export const DEFAULT_TWITTER_SEARCH_QUERY = '"Arc Network" OR "ArcStablecoin" OR "Arc testnet"'
export type TweetCategory = 'news' | 'opportunity' | 'discussion'

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

  const res = await chrome.storage.local.get([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY]) as Record<string, string | undefined>
  const key = typeof res[TWITTERAPI_KEY] === 'string' && res[TWITTERAPI_KEY].trim()
    ? res[TWITTERAPI_KEY]
    : typeof res[LEGACY_TWITTERAPI_KEY] === 'string' && res[LEGACY_TWITTERAPI_KEY].trim()
      ? res[LEGACY_TWITTERAPI_KEY]
      : null

  if (!key) {
    await chrome.storage.local.remove([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY])
    return null
  }

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
    const res = await fetch(url, {
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

  const res = await chrome.storage.local.get([TWITTER_SEARCH_QUERY]) as Record<string, string | undefined>
  const stored = typeof res[TWITTER_SEARCH_QUERY] === 'string' ? res[TWITTER_SEARCH_QUERY]!.trim() : ''

  if (!stored) {
    await chrome.storage.local.remove(TWITTER_SEARCH_QUERY)
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
  const searchUrl = new URL('/twitter/tweet/advanced_search', TWITTERAPI_BASE)
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
