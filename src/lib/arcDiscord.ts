import { debugWarn } from '@/lib/debug'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet } from '@/lib/external'
import { ARC_DISCORD_CACHE_KEY } from '@/lib/storageKeys'

export const ARC_DISCORD_INVITE_URL = 'https://discord.gg/buildonarc'
const ARC_DISCORD_CACHE_TTL_MS = 10 * 60_000

export type ArcDiscordCacheStatus = 'fresh-cache' | 'network' | 'stale-cache' | 'error'

export interface ArcDiscordCacheEntry {
  memberCount: number | null
  onlineCount: number | null
  inviteUrl: string
  fetchedAt: number
}

export interface ArcDiscordResult extends ArcDiscordCacheEntry {
  cacheStatus: ArcDiscordCacheStatus
  error?: string
}

interface ArcDiscordWorkerResponse {
  memberCount: number | null
  onlineCount: number | null
  error?: string
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function canUseChromeRuntime(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

function isArcDiscordCacheEntry(value: unknown): value is ArcDiscordCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const entry = value as Partial<ArcDiscordCacheEntry>
  return typeof entry.fetchedAt === 'number'
    && (typeof entry.memberCount === 'number' || entry.memberCount === null || typeof entry.memberCount === 'undefined')
    && (typeof entry.onlineCount === 'number' || entry.onlineCount === null || typeof entry.onlineCount === 'undefined')
    && (typeof entry.inviteUrl === 'string' || typeof entry.inviteUrl === 'undefined')
}

function isFreshArcDiscordCache(entry: ArcDiscordCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < ARC_DISCORD_CACHE_TTL_MS
}

async function readArcDiscordCache(): Promise<ArcDiscordCacheEntry | null> {
  if (!canUseChromeStorage()) return null

  const result = await chromeStorageGet(ARC_DISCORD_CACHE_KEY)
  const cached = result[ARC_DISCORD_CACHE_KEY]

  if (!isArcDiscordCacheEntry(cached)) {
    if (typeof cached !== 'undefined') {
      await chromeStorageRemove(ARC_DISCORD_CACHE_KEY)
    }
    return null
  }

  const normalized: ArcDiscordCacheEntry = {
    memberCount: typeof cached.memberCount === 'number' ? cached.memberCount : null,
    onlineCount: typeof cached.onlineCount === 'number' ? cached.onlineCount : null,
    inviteUrl: typeof cached.inviteUrl === 'string' && cached.inviteUrl.trim() ? cached.inviteUrl.trim() : ARC_DISCORD_INVITE_URL,
    fetchedAt: cached.fetchedAt,
  }

  const needsRewrite = cached.inviteUrl !== normalized.inviteUrl
    || cached.memberCount !== normalized.memberCount
    || cached.onlineCount !== normalized.onlineCount

  if (needsRewrite) {
    await chromeStorageSet({ [ARC_DISCORD_CACHE_KEY]: normalized })
  }

  return normalized
}

async function writeArcDiscordCache(entry: ArcDiscordCacheEntry): Promise<void> {
  if (!canUseChromeStorage()) return
  await chromeStorageSet({ [ARC_DISCORD_CACHE_KEY]: entry })
}

function isArcDiscordWorkerResponse(value: unknown): value is ArcDiscordWorkerResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const response = value as Partial<ArcDiscordWorkerResponse>
  return (typeof response.memberCount === 'number' || response.memberCount === null)
    && (typeof response.onlineCount === 'number' || response.onlineCount === null)
    && (typeof response.error === 'string' || typeof response.error === 'undefined')
}

async function fetchArcDiscordFromWorker(): Promise<ArcDiscordCacheEntry> {
  if (!canUseChromeRuntime()) {
    throw new Error('ARC_DISCORD_RUNTIME_UNAVAILABLE')
  }

  const response = await new Promise<ArcDiscordWorkerResponse>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'FETCH_ARC_DISCORD' }, (result) => {
        const lastError = chrome.runtime?.lastError
        if (lastError) {
          reject(new Error(lastError.message || 'ARC_DISCORD_MESSAGE_FAILED'))
          return
        }

        if (!isArcDiscordWorkerResponse(result)) {
          reject(new Error('ARC_DISCORD_MESSAGE_INVALID'))
          return
        }

        resolve(result)
      })
    } catch (error) {
      reject(error)
    }
  })

  const memberCount = typeof response.memberCount === 'number' ? response.memberCount : null
  const onlineCount = typeof response.onlineCount === 'number' ? response.onlineCount : null

  if (memberCount == null && onlineCount == null) {
    throw new Error(response.error ?? 'ARC_DISCORD_COUNTS_UNAVAILABLE')
  }

  return {
    memberCount,
    onlineCount,
    inviteUrl: ARC_DISCORD_INVITE_URL,
    fetchedAt: Date.now(),
  }
}

export async function fetchArcDiscord(): Promise<ArcDiscordResult> {
  const cached = await readArcDiscordCache()
  if (cached && isFreshArcDiscordCache(cached)) {
    return {
      ...cached,
      cacheStatus: 'fresh-cache',
    }
  }

  try {
    const network = await fetchArcDiscordFromWorker()
    await writeArcDiscordCache(network)
    return {
      ...network,
      cacheStatus: 'network',
    }
  } catch (error) {
    debugWarn('[arcDiscord] fetch failed:', error)

    if (cached) {
      return {
        ...cached,
        cacheStatus: 'stale-cache',
      }
    }

    return {
      memberCount: null,
      onlineCount: null,
      inviteUrl: ARC_DISCORD_INVITE_URL,
      fetchedAt: Date.now(),
      cacheStatus: 'error',
      error: error instanceof Error ? error.message : 'ARC_DISCORD_FETCH_FAILED',
    }
  }
}
