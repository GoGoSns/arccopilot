export const PENDING_SEND_STORAGE_KEY = 'arccopilot:pending-send'
export const PENDING_VIEW_STORAGE_KEY = 'arccopilot:pending_view'
export const ONBOARDING_SEEN = 'arccopilot:onboarding-seen'
export const ADDRESS_BOOK_STORAGE_KEY = 'arccopilot:address_book'
export const DISMISSED_PATTERNS_KEY = 'arccopilot:patterns:dismissed'
export const GEMINI_API_KEY_STORAGE_KEY = 'arccopilot:gemini-api-key'
export const TWITTERAPI_KEY = 'arccopilot:twitterapi-key'
export const TWITTER_SEARCH_QUERY = 'arccopilot:twitter-search-query'
export const TWITTER_OFFICIAL_ACCOUNTS = 'arccopilot:twitter-official-accounts'
export const TWITTER_TWEETS_CACHE_KEY = 'arccopilot:tweets:arc'
export const TWITTER_OFFICIAL_TWEETS_CACHE_KEY = 'arccopilot:tweets:official'
export const ARC_COMMUNITY_CACHE_KEY = 'arccopilot:arc-community'
export type TwitterFeedCacheScope = 'community' | 'official'
const TWITTER_FEED_CACHE_PREFIX = 'arccopilot:tweets:feed'

function normalizeTwitterFeedCacheQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

export function getTwitterFeedCacheKey(scope: TwitterFeedCacheScope, query: string): string {
  const normalizedQuery = normalizeTwitterFeedCacheQuery(query)
  const encodedQuery = normalizedQuery ? encodeURIComponent(normalizedQuery) : 'default'
  return `${TWITTER_FEED_CACHE_PREFIX}:${scope}:${encodedQuery}`
}
export const REMINDERS = 'arccopilot:reminders'
export const GOGO_HISTORY = 'arccopilot:gogo-history'
export const GOGO_HISTORY_STORAGE_KEY = GOGO_HISTORY
export const WALLET_ADDRESS_STORAGE_KEY = 'arccopilot:wallet-address'
export const LAST_KNOWN_BALANCE_KEY = 'arccopilot:last-known-balance'
export const LAST_SEEN_INCOMING_KEY = 'arccopilot:last-seen-incoming'
export const NOTIF_INCOMING_STORAGE_KEY = 'arccopilot:notif-incoming'
export const NOTIF_BALANCE_STORAGE_KEY = 'arccopilot:notif-balance'
export const VOICE_RESPONSES_STORAGE_KEY = 'arccopilot:voice-responses'
