import { TWITTERAPI_KEY } from '@/lib/storageKeys'

const LEGACY_TWITTERAPI_KEY = 'arccopilot:twitterapi-io-key'
const TWITTER_SEARCH_QUERY = encodeURIComponent('"Arc Network" OR "ArcStablecoin" OR "Arc testnet"')
const TWITTER_SEARCH_URL = `https://api.twitterapi.io/twitter/tweet/advanced_search?query=${TWITTER_SEARCH_QUERY}&queryType=Latest`

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
  const res = await chrome.storage.local.get([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY]) as Record<string, string | undefined>
  const key = res[TWITTERAPI_KEY] || res[LEGACY_TWITTERAPI_KEY] || null

  if (key && !res[TWITTERAPI_KEY]) {
    await chrome.storage.local.set({ [TWITTERAPI_KEY]: key })
    await chrome.storage.local.remove(LEGACY_TWITTERAPI_KEY)
  }

  return key
}

export async function setTwitterApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [TWITTERAPI_KEY]: key })
  await chrome.storage.local.remove(LEGACY_TWITTERAPI_KEY)
}

export async function clearTwitterApiKey(): Promise<void> {
  await chrome.storage.local.remove([TWITTERAPI_KEY, LEGACY_TWITTERAPI_KEY])
}

export async function fetchArcTweets(): Promise<TwitterTweet[]> {
  const apiKey = await getTwitterApiKey()
  if (!apiKey) throw new Error('TwitterAPI key not set. Add it in Settings.')

  const res = await fetch(TWITTER_SEARCH_URL, {
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
