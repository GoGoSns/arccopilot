import { BLOCKSCOUT_API_BASE, GEMINI_MODEL } from '@/lib/constants'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { getLocalePromptLanguage, getLocaleSync, t, type Locale } from '@/lib/i18n'
import { getCachedNewsSnapshot, type NewsItem } from '@/lib/newsPulse'
import {
  DAILY_BRIEFING_CACHE_STORAGE_KEY,
  GEMINI_API_KEY_STORAGE_KEY,
} from '@/lib/storageKeys'
import { formatRelativeTime } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { generateTipSuggestions, type TipAdvisorResult } from '@/lib/tipAdvisor'

const DAILY_BRIEFING_CACHE_TTL_MS = 60 * 60 * 1000
const DAILY_BRIEFING_MAX_NEWS_ITEMS = 3
const DAILY_BRIEFING_MAX_SUGGESTIONS = 3

export interface EcosystemStats {
  blockTime: string
  totalTx: string
  totalAddresses: string
}

export type DailyBriefingMode = 'ai' | 'fallback' | 'unavailable'

export interface DailyBriefingInputs {
  walletAddress?: string | null
  displayName?: string | null
  balance?: string | null
  balanceChange?: string | null
  recentActivityCount?: number | null
  tipAdvisor?: TipAdvisorResult | null
  newsItems?: NewsItem[] | null
  ecosystemStats?: EcosystemStats | null
  force?: boolean
}

export interface DailyBriefingAvailability {
  balance: boolean
  balanceChange: boolean
  recentActivity: boolean
  tipAdvisor: boolean
  news: boolean
  ecosystemStats: boolean
  displayName: boolean
  walletAddress: boolean
}

export interface DailyBriefingResult {
  text: string
  mode: DailyBriefingMode
  fetchedAt: number
  source: 'cache' | 'generated'
  available: DailyBriefingAvailability
}

type StoredDailyBriefing = {
  digest?: string
  ts?: number
  ttl?: number
  text?: string
  mode?: DailyBriefingMode
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

type CollectedDailyBriefingData = {
  walletAddress: string | null
  displayName: string | null
  balance: string | null
  balanceChange: string | null
  recentActivityCount: number | null
  tipAdvisor: TipAdvisorResult | null
  newsItems: NewsItem[]
  ecosystemStats: EcosystemStats | null
  locale: Locale
}

function canUseApiKey(): Promise<string | null> {
  return (async () => {
    try {
      const result = await chromeStorageGet(GEMINI_API_KEY_STORAGE_KEY)
      const raw = result[GEMINI_API_KEY_STORAGE_KEY]
      const key = typeof raw === 'string' ? raw.trim() : ''
      if (!key && Object.prototype.hasOwnProperty.call(result, GEMINI_API_KEY_STORAGE_KEY)) {
        await chromeStorageRemove(GEMINI_API_KEY_STORAGE_KEY)
      }
      return key || null
    } catch {
      return null
    }
  })()
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function getGreeting(locale: Locale): string {
  const hour = new Date().getHours()
  if (locale === 'tr') {
    if (hour < 12) return 'Günaydın'
    if (hour < 18) return 'Tünaydın'
    return 'İyi akşamlar'
  }

  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(getLocaleSync() === 'tr' ? 'tr-TR' : 'en-US').format(value)
}

function formatCompactNumber(value: string | number | undefined): string {
  const parsed = typeof value === 'number'
    ? value
    : value != null && value !== ''
      ? Number.parseInt(String(value), 10)
      : Number.NaN

  if (!Number.isFinite(parsed)) return '-'
  if (parsed >= 1_000_000_000) return `${(parsed / 1_000_000_000).toFixed(1)}B`
  if (parsed >= 1_000_000) return `${(parsed / 1_000_000).toFixed(1)}M`
  if (parsed >= 1_000) return `${(parsed / 1_000).toFixed(1)}K`
  return String(parsed)
}

function buildNewsDigest(items: NewsItem[]): string {
  return items
    .slice(0, DAILY_BRIEFING_MAX_NEWS_ITEMS)
    .map((item) => `${item.source}|${item.title}|${item.link}|${item.publishedAt}`)
    .join('\n')
}

function buildSuggestionDigest(tipAdvisor: TipAdvisorResult | null): string {
  if (!tipAdvisor) return ''

  return [
    tipAdvisor.summary,
    tipAdvisor.explanation,
    ...tipAdvisor.suggestions.slice(0, DAILY_BRIEFING_MAX_SUGGESTIONS).map((suggestion) => (
      `${suggestion.handle}|${suggestion.address}|${suggestion.amount}|${suggestion.reason}`
    )),
  ].filter(Boolean).join('\n')
}

function buildDigest(data: CollectedDailyBriefingData): string {
  return JSON.stringify({
    walletAddress: data.walletAddress,
    displayName: data.displayName,
    balance: data.balance,
    balanceChange: data.balanceChange,
    recentActivityCount: data.recentActivityCount,
    tipAdvisor: buildSuggestionDigest(data.tipAdvisor),
    news: buildNewsDigest(data.newsItems),
    ecosystemStats: data.ecosystemStats,
    locale: data.locale,
  })
}

function getCachedBriefingDigest(digest: string): Promise<{ text: string; mode: DailyBriefingMode; ts: number } | null> {
  return (async () => {
    try {
      const result = await chromeStorageGet(DAILY_BRIEFING_CACHE_STORAGE_KEY)
      const raw = result[DAILY_BRIEFING_CACHE_STORAGE_KEY] as StoredDailyBriefing | undefined
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      if (typeof raw.digest !== 'string' || typeof raw.ts !== 'number' || typeof raw.ttl !== 'number' || typeof raw.text !== 'string' || typeof raw.mode !== 'string') {
        return null
      }

      if (Date.now() - raw.ts > raw.ttl) {
        await chromeStorageRemove(DAILY_BRIEFING_CACHE_STORAGE_KEY)
        return null
      }

      if (raw.digest !== digest) return null

      return {
        text: raw.text,
        mode: raw.mode,
        ts: raw.ts,
      }
    } catch {
      return null
    }
  })()
}

async function writeCachedBriefing(digest: string, text: string, mode: DailyBriefingMode): Promise<number> {
  const ts = Date.now()
  const envelope: StoredDailyBriefing = {
    digest,
    ts,
    ttl: DAILY_BRIEFING_CACHE_TTL_MS,
    text,
    mode,
  }

  await chromeStorageSet({ [DAILY_BRIEFING_CACHE_STORAGE_KEY]: envelope })
  return ts
}

async function fetchEcosystemStats(): Promise<EcosystemStats | null> {
  try {
    const response = await fetchWithTimeout(`${BLOCKSCOUT_API_BASE}/stats`, {
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return null

    const data = await response.json() as {
      average_block_time?: number
      total_transactions?: string
      total_addresses?: string
    }

    return {
      blockTime: data.average_block_time != null ? `${Math.round(data.average_block_time)}ms` : '-',
      totalTx: formatCompactNumber(data.total_transactions),
      totalAddresses: formatCompactNumber(data.total_addresses),
    }
  } catch {
    return null
  }
}

function formatHeadlinesForPrompt(items: NewsItem[]): string {
  if (items.length === 0) return 'none'

  return items.slice(0, DAILY_BRIEFING_MAX_NEWS_ITEMS).map((item, index) => {
    const age = formatRelativeTime(item.publishedAt)
    return `${index + 1}. [${item.source}] ${item.title} (${age})`
  }).join('\n')
}

function formatSuggestionsForPrompt(tipAdvisor: TipAdvisorResult | null): string {
  if (!tipAdvisor || tipAdvisor.suggestions.length === 0) return 'none'

  return tipAdvisor.suggestions.slice(0, DAILY_BRIEFING_MAX_SUGGESTIONS).map((suggestion, index) => (
    `${index + 1}. @${suggestion.handle} - ${suggestion.amount} USDC - ${suggestion.reason}`
  )).join('\n')
}

function buildPrompt(data: CollectedDailyBriefingData): string {
  const language = getLocalePromptLanguage(data.locale)
  return [
    'You are ArcCopilot acting as the user\'s chief-of-staff.',
    'Write a warm, concise daily briefing in plain text only.',
    'Use only the data provided below.',
    'Do not invent facts, numbers, news, or suggestions.',
    'Omit any missing data gracefully.',
    'Address the user directly and include at most one practical next step.',
    `Write in ${language}.`,
    '',
    `User: ${data.displayName ?? 'unknown'}`,
    `Wallet address: ${data.walletAddress ?? 'missing'}`,
    `Balance: ${data.balance ?? 'missing'}`,
    `Recent activity count: ${data.recentActivityCount != null ? formatCount(data.recentActivityCount) : 'missing'}`,
    `24h balance change: ${data.balanceChange ?? 'missing'}`,
    `Tip advisor summary: ${data.tipAdvisor?.summary ?? 'missing'}`,
    `Tip advisor explanation: ${data.tipAdvisor?.explanation ?? 'missing'}`,
    `Top tip suggestions:\n${formatSuggestionsForPrompt(data.tipAdvisor)}`,
    `Cached news headlines:\n${formatHeadlinesForPrompt(data.newsItems)}`,
    `Ecosystem stats: ${data.ecosystemStats ? `${data.ecosystemStats.blockTime} block time, ${data.ecosystemStats.totalTx} total tx, ${data.ecosystemStats.totalAddresses} wallets` : 'missing'}`,
  ].join('\n')
}

function toSentence(value: string): string {
  const trimmed = normalizeWhitespace(value)
  if (!trimmed) return ''
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function joinHeadlines(items: NewsItem[], locale: Locale): string {
  const slice = items.slice(0, DAILY_BRIEFING_MAX_NEWS_ITEMS)
  if (slice.length === 0) return ''

  const formatted = slice.map((item) => {
    return locale === 'tr'
      ? `${item.source}: ${item.title}`
      : `${item.source}: ${item.title}`
  })

  if (items.length > slice.length) {
    const remaining = items.length - slice.length
    formatted.push(locale === 'tr'
      ? `ve ${remaining} başlık daha`
      : `and ${remaining} more`)
  }

  return formatted.join(locale === 'tr' ? '; ' : '; ')
}

function buildFallbackBriefing(data: CollectedDailyBriefingData): string {
  const locale = data.locale
  const name = data.displayName?.trim() || null
  const greeting = locale === 'tr'
    ? `${getGreeting(locale)}${name ? `, ${name}` : ''}.`
    : `${getGreeting(locale)}${name ? `, ${name}` : ''}.`

  const sentences: string[] = [greeting]

  if (data.balance || data.balanceChange || (data.recentActivityCount ?? 0) > 0) {
    if (locale === 'tr') {
      const parts: string[] = []
      if (data.balance) parts.push(`Bakiyen ${data.balance} USDC`)
      if (data.balanceChange && (data.recentActivityCount ?? 0) > 0) {
        parts.push(`son 24 saatte ${data.recentActivityCount} işlemle ${data.balanceChange} USDC hareket etti`)
      } else if (data.balanceChange) {
        parts.push(`son 24 saatte ${data.balanceChange} USDC değişti`)
      } else if ((data.recentActivityCount ?? 0) > 0) {
        parts.push(`son 24 saatte ${formatCount(data.recentActivityCount ?? 0)} işlem gördüm`)
      }
      sentences.push(toSentence(parts.join(', ')))
    } else {
      const parts: string[] = []
      if (data.balance) parts.push(`Your balance is ${data.balance} USDC`)
      if (data.balanceChange && (data.recentActivityCount ?? 0) > 0) {
        parts.push(`the last 24 hours moved ${data.balanceChange} USDC across ${formatCount(data.recentActivityCount ?? 0)} transfers`)
      } else if (data.balanceChange) {
        parts.push(`the last 24 hours moved ${data.balanceChange} USDC`)
      } else if ((data.recentActivityCount ?? 0) > 0) {
        parts.push(`I saw ${formatCount(data.recentActivityCount ?? 0)} transfers in the last 24 hours`)
      }
      sentences.push(toSentence(parts.join(', ')))
    }
  }

  const topSuggestion = data.tipAdvisor?.suggestions[0]
  if (topSuggestion) {
    sentences.push(locale === 'tr'
      ? toSentence(`En güçlü öneri @${topSuggestion.handle} için ${topSuggestion.amount} USDC; nedeni ${topSuggestion.reason}`)
      : toSentence(`Top suggestion: @${topSuggestion.handle} for ${topSuggestion.amount} USDC because ${topSuggestion.reason}`))
  } else if (data.tipAdvisor?.summary) {
    sentences.push(toSentence(data.tipAdvisor.summary))
  }

  if (data.newsItems.length > 0) {
    const headlines = joinHeadlines(data.newsItems, locale)
    sentences.push(locale === 'tr'
      ? toSentence(`Son başlıklar: ${headlines}`)
      : toSentence(`Latest headlines: ${headlines}`))
  }

  if (data.ecosystemStats) {
    sentences.push(locale === 'tr'
      ? toSentence(`Arc ekosistemi şu anda ${data.ecosystemStats.blockTime} blok süresi, ${data.ecosystemStats.totalTx} toplam işlem ve ${data.ecosystemStats.totalAddresses} cüzdan seviyesinde`)
      : toSentence(`Arc is at ${data.ecosystemStats.blockTime} block time with ${data.ecosystemStats.totalTx} total tx and ${data.ecosystemStats.totalAddresses} wallets`))
  }

  if (sentences.length === 1) {
    sentences.push(t('dailyBrief.briefingNoData'))
  } else if (sentences.length < 3) {
    const nextStep = data.tipAdvisor?.suggestions[0]
      ? (locale === 'tr'
          ? 'Sonraki adım: tip önerisini gözden geçir.'
          : 'Next step: review the tip suggestion.')
      : data.newsItems.length > 0
        ? (locale === 'tr'
            ? 'Sonraki adım: en güncel başlığı aç.'
            : 'Next step: open the freshest headline.')
        : data.ecosystemStats
          ? (locale === 'tr'
              ? 'Sonraki adım: ekosistem özetine bak.'
              : 'Next step: review the ecosystem snapshot.')
          : (locale === 'tr'
              ? 'Sonraki adım: daha fazla sinyal yüklendiğinde tekrar dene.'
              : 'Next step: try again after more signals load.')
    sentences.push(nextStep)
  }

  return normalizeWhitespace(sentences.slice(0, 5).join(' '))
}

async function callGeminiBriefing(data: CollectedDailyBriefingData): Promise<string | null> {
  const apiKey = await canUseApiKey()
  if (!apiKey) return null

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
  const body = {
    systemInstruction: {
      parts: [{
        text: [
          'You write short, warm daily briefings for a chief-of-staff assistant.',
          'Use only the provided data and omit missing parts gracefully.',
          'Do not invent numbers, facts, headlines, or recommendations.',
          'Keep the response to 3-5 sentences in plain text only.',
          'No bullets, no markdown, no quotes.',
        ].join(' '),
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: buildPrompt(data),
      }],
    }],
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
    },
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.log('[BRIEF]', { status: 'ai-error', httpStatus: response.status })
      return null
    }

    const result = await response.json() as GeminiResponse
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    if (!text) {
      console.log('[BRIEF]', { status: 'ai-empty' })
      return null
    }

    return normalizeWhitespace(
      text
        .replace(/^[\s\-*•]+/gm, '')
        .replace(/\n{2,}/g, ' ')
        .trim(),
    )
  } catch (error) {
    console.log('[BRIEF]', {
      status: 'ai-failed',
      error: error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

async function collectBriefingData(input: DailyBriefingInputs): Promise<CollectedDailyBriefingData> {
  const store = useStore.getState()
  const locale = getLocaleSync()

  const balance = typeof input.balance !== 'undefined'
    ? input.balance
    : (store.usdcBalance ?? null)

  const displayName = typeof input.displayName !== 'undefined'
    ? (input.displayName?.trim() || null)
    : (store.profile.displayName?.trim() || null)

  const walletAddress = typeof input.walletAddress !== 'undefined'
    ? (input.walletAddress?.trim() || null)
    : (store.walletAddress ?? null)

  const tipAdvisor = typeof input.tipAdvisor !== 'undefined'
    ? input.tipAdvisor
    : await (async () => {
        try {
          return await generateTipSuggestions()
        } catch (error) {
          console.log('[BRIEF]', {
            status: 'advisor-failed',
            error: error instanceof Error ? error.message : 'unknown',
          })
          return null
        }
      })()

  const newsItems = typeof input.newsItems !== 'undefined'
    ? (input.newsItems ?? [])
    : (await getCachedNewsSnapshot())?.items ?? []

  const ecosystemStats = typeof input.ecosystemStats !== 'undefined'
    ? input.ecosystemStats
    : await fetchEcosystemStats()

  const recentActivityCount = typeof input.recentActivityCount !== 'undefined'
    ? input.recentActivityCount
    : null

  const balanceChange = typeof input.balanceChange !== 'undefined'
    ? input.balanceChange
    : null

  const available: DailyBriefingAvailability = {
    balance: Boolean(balance),
    balanceChange: Boolean(balanceChange),
    recentActivity: typeof recentActivityCount === 'number' && recentActivityCount > 0,
    tipAdvisor: Boolean(tipAdvisor?.summary || tipAdvisor?.explanation || (tipAdvisor?.suggestions?.length ?? 0) > 0),
    news: newsItems.length > 0,
    ecosystemStats: Boolean(ecosystemStats),
    displayName: Boolean(displayName),
    walletAddress: Boolean(walletAddress),
  }

  console.log('[BRIEF]', {
    status: 'data',
    available,
    counts: {
      newsItems: newsItems.length,
      suggestions: tipAdvisor?.suggestions.length ?? 0,
      recentActivityCount: recentActivityCount ?? 0,
    },
  })

  return {
    walletAddress,
    displayName,
    balance,
    balanceChange,
    recentActivityCount,
    tipAdvisor,
    newsItems,
    ecosystemStats,
    locale,
  }
}

function hasUsefulData(data: CollectedDailyBriefingData): boolean {
  return Boolean(
    data.balance
    || data.balanceChange
    || (data.recentActivityCount ?? 0) > 0
    || data.tipAdvisor?.summary
    || data.tipAdvisor?.explanation
    || (data.tipAdvisor?.suggestions?.length ?? 0) > 0
    || data.newsItems.length > 0
    || data.ecosystemStats
  )
}

export async function buildDailyBriefing(input: DailyBriefingInputs = {}): Promise<DailyBriefingResult> {
  const force = input.force === true
  const data = await collectBriefingData(input)
  const digest = buildDigest(data)

  if (!force) {
    const cached = await getCachedBriefingDigest(digest)
    if (cached) {
      const apiKey = await canUseApiKey()
      if (cached.mode === 'ai' || !apiKey) {
        console.log('[BRIEF]', {
          status: 'cache-hit',
          mode: cached.mode,
          available: {
            balance: Boolean(data.balance),
            balanceChange: Boolean(data.balanceChange),
            recentActivity: typeof data.recentActivityCount === 'number' && data.recentActivityCount > 0,
            tipAdvisor: Boolean(data.tipAdvisor?.summary || data.tipAdvisor?.explanation || (data.tipAdvisor?.suggestions?.length ?? 0) > 0),
            news: data.newsItems.length > 0,
            ecosystemStats: Boolean(data.ecosystemStats),
            displayName: Boolean(data.displayName),
            walletAddress: Boolean(data.walletAddress),
          },
        })

        return {
          text: cached.text,
          mode: cached.mode,
          fetchedAt: cached.ts,
          source: 'cache',
          available: {
            balance: Boolean(data.balance),
            balanceChange: Boolean(data.balanceChange),
            recentActivity: typeof data.recentActivityCount === 'number' && data.recentActivityCount > 0,
            tipAdvisor: Boolean(data.tipAdvisor?.summary || data.tipAdvisor?.explanation || (data.tipAdvisor?.suggestions?.length ?? 0) > 0),
            news: data.newsItems.length > 0,
            ecosystemStats: Boolean(data.ecosystemStats),
            displayName: Boolean(data.displayName),
            walletAddress: Boolean(data.walletAddress),
          },
        }
      }
    }
  }

  if (!hasUsefulData(data)) {
    const text = t('dailyBrief.briefingNoData')

    const fetchedAt = await writeCachedBriefing(digest, text, 'unavailable')
    console.log('[BRIEF]', {
      status: 'unavailable',
      mode: 'unavailable',
      available: {
        balance: Boolean(data.balance),
        balanceChange: Boolean(data.balanceChange),
        recentActivity: typeof data.recentActivityCount === 'number' && data.recentActivityCount > 0,
        tipAdvisor: Boolean(data.tipAdvisor?.summary || data.tipAdvisor?.explanation || (data.tipAdvisor?.suggestions?.length ?? 0) > 0),
        news: data.newsItems.length > 0,
        ecosystemStats: Boolean(data.ecosystemStats),
        displayName: Boolean(data.displayName),
        walletAddress: Boolean(data.walletAddress),
      },
    })

    return {
      text,
      mode: 'unavailable',
      fetchedAt,
      source: 'generated',
      available: {
        balance: Boolean(data.balance),
        balanceChange: Boolean(data.balanceChange),
        recentActivity: typeof data.recentActivityCount === 'number' && data.recentActivityCount > 0,
        tipAdvisor: Boolean(data.tipAdvisor?.summary || data.tipAdvisor?.explanation || (data.tipAdvisor?.suggestions?.length ?? 0) > 0),
        news: data.newsItems.length > 0,
        ecosystemStats: Boolean(data.ecosystemStats),
        displayName: Boolean(data.displayName),
        walletAddress: Boolean(data.walletAddress),
      },
    }
  }

  const aiText = await callGeminiBriefing(data)
  const mode: DailyBriefingMode = aiText ? 'ai' : 'fallback'
  const text = aiText ?? buildFallbackBriefing(data)
  const fetchedAt = await writeCachedBriefing(digest, text, mode)

  console.log('[BRIEF]', {
    status: 'generated',
    mode,
    available: {
      balance: Boolean(data.balance),
      balanceChange: Boolean(data.balanceChange),
      recentActivity: typeof data.recentActivityCount === 'number' && data.recentActivityCount > 0,
      tipAdvisor: Boolean(data.tipAdvisor?.summary || data.tipAdvisor?.explanation || (data.tipAdvisor?.suggestions?.length ?? 0) > 0),
      news: data.newsItems.length > 0,
      ecosystemStats: Boolean(data.ecosystemStats),
      displayName: Boolean(data.displayName),
      walletAddress: Boolean(data.walletAddress),
    },
  })

  return {
    text,
    mode,
    fetchedAt,
    source: 'generated',
    available: {
      balance: Boolean(data.balance),
      balanceChange: Boolean(data.balanceChange),
      recentActivity: typeof data.recentActivityCount === 'number' && data.recentActivityCount > 0,
      tipAdvisor: Boolean(data.tipAdvisor?.summary || data.tipAdvisor?.explanation || (data.tipAdvisor?.suggestions?.length ?? 0) > 0),
      news: data.newsItems.length > 0,
      ecosystemStats: Boolean(data.ecosystemStats),
      displayName: Boolean(data.displayName),
      walletAddress: Boolean(data.walletAddress),
    },
  }
}
