import { TWITTER_BEARER_TOKEN } from './storageKeys'

export type TwitterTweet = {
  id: string
  text: string
  authorName: string
  authorHandle: string
  authorAvatar: string
  createdAt: string
  likes: number
  retweets: number
  tweetUrl: string
}

export async function getTwitterToken(): Promise<string | null> {
  const res = await chrome.storage.local.get(TWITTER_BEARER_TOKEN)
  return res[TWITTER_BEARER_TOKEN] || null
}

export async function setTwitterToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TWITTER_BEARER_TOKEN]: token })
}

export async function clearTwitterToken(): Promise<void> {
  await chrome.storage.local.remove(TWITTER_BEARER_TOKEN)
}

export async function fetchArcTweets(): Promise<TwitterTweet[]> {
  const token = await getTwitterToken()
  if (!token) throw new Error("Twitter Bearer Token not set")

  const query = encodeURIComponent("(Arc Network OR ArcStablecoin OR \"Arc testnet\") -is:retweet lang:en")
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at,author_id,public_metrics&expansions=author_id&user.fields=name,username,profile_image_url`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid Twitter Token. Update in Settings.")
    if (res.status === 429) throw new Error("Twitter rate limit. Try again in 15min.")
    throw new Error(`Twitter API error ${res.status}`)
  }

  const data = await res.json()
  return parseTweets(data)
}

function parseTweets(data: any): TwitterTweet[] {
  if (!data.data) return []
  
  const users = data.includes?.users || []
  const userMap = new Map(users.map((u: any) => [u.id, u]))

  return data.data.map((t: any) => {
    const user = userMap.get(t.author_id)
    return {
      id: t.id,
      text: t.text,
      authorName: user?.name || 'Unknown',
      authorHandle: user?.username || 'unknown',
      authorAvatar: user?.profile_image_url || '',
      createdAt: t.created_at,
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0,
      tweetUrl: `https://twitter.com/${user?.username || 'i'}/status/${t.id}`
    }
  })
}
