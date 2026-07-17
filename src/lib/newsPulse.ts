import { generateText, getActiveAIProviderKey } from '@/lib/aiProvider'
import { getLocalePromptLanguage, getLocaleSync, t } from '@/lib/i18n'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import {
  NEWS_CACHE_STORAGE_KEY,
  NEWS_FEEDS_STORAGE_KEY,
} from '@/lib/storageKeys'
import { formatRelativeTime } from '@/lib/utils'

export type NewsItem = {
  title: string
  link: string
  source: string
  publishedAt: string
}

export type NewsFetchStatus = 'idle' | 'cached' | 'fetched' | 'empty' | 'no-feeds' | 'error'
export type NewsSummaryMode = 'idle' | 'ai' | 'fallback' | 'unavailable'

export interface NewsPulseState {
  fetchStatus: NewsFetchStatus
  error: string | null
  fetchedAt: number | null
  itemCount: number
  summaryMode: NewsSummaryMode
  summaryAt: number | null
  summarySourceCount: number
}

type StoredNewsCache = {
  items?: NewsItem[]
  ts?: number
  ttl?: number
}

type NewsFeedSource = {
  url: string
  label: string
}

const NEWS_CACHE_TTL_MS = 60 * 60 * 1000
const NEWS_FEED_TIMEOUT_MS = 4_500
const MAX_NEWS_ITEMS = 10
const MAX_FALLBACK_HEADLINES = 5
const MAX_SUMMARY_BULLETS = 5

export const DEFAULT_NEWS_FEED_TEXT = [
  '# Circle blog RSS placeholder - replace with a valid feed URL if Circle publishes one',
  'https://www.coindesk.com/arc/outboundfeeds/rss',
  'https://www.theblock.co/rss.xml',
  'https://blog.ethereum.org/en/feed.xml',
].join('\n')

const DEFAULT_FEED_LABELS: Array<{ host: string; label: string }> = [
  { host: 'www.coindesk.com', label: 'CoinDesk' },
  { host: 'www.theblock.co', label: 'The Block' },
  { host: 'blog.ethereum.org', label: 'Ethereum Foundation' },
  { host: 'www.circle.com', label: 'Circle' },
  { host: 'circle.com', label: 'Circle' },
]

let currentState: NewsPulseState = {
  fetchStatus: 'idle',
  error: null,
  fetchedAt: null,
  itemCount: 0,
  summaryMode: 'idle',
  summaryAt: null,
  summarySourceCount: 0,
}

let inFlightFetch: Promise<NewsItem[]> | null = null
let summaryCache: {
  digest: string
  language: string
  text: string
  mode: Exclude<NewsSummaryMode, 'idle'>
  at: number
} | null = null

function setState(partial: Partial<NewsPulseState>): void {
  currentState = {
    ...currentState,
    ...partial,
  }
}

function normalizeNewsFeedText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function coerceStoredNewsFeedText(value: unknown): string {
  if (typeof value === 'string') return normalizeNewsFeedText(value)
  if (Array.isArray(value)) {
    return normalizeNewsFeedText(
      value
        .filter((item): item is string => typeof item === 'string')
        .join('\n'),
    )
  }
  return normalizeNewsFeedText(DEFAULT_NEWS_FEED_TEXT)
}

function parseNewsFeedUrls(text: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (const rawLine of normalizeNewsFeedText(text).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue

    try {
      const parsed = new URL(line)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
      const normalized = parsed.toString()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(normalized)
    } catch {
      continue
    }
  }

  return urls
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) {
        parsed.searchParams.delete(key)
      }
    }

    const search = parsed.searchParams.toString()
    const pathname = parsed.pathname !== '/' && parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname

    return `${parsed.origin}${pathname}${search ? `?${search}` : ''}`
  } catch {
    return url.trim().toLowerCase()
  }
}

function normalizeHeadlineText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildNewsDigest(items: NewsItem[]): string {
  return items
    .map((item) => `${normalizeHeadlineText(item.source)}|${normalizeHeadlineText(item.title)}|${canonicalizeUrl(item.link)}`)
    .join('\n')
}

function resolveFeedLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const match = DEFAULT_FEED_LABELS.find((entry) => host === entry.host || host.endsWith(`.${entry.host}`))
    if (match) return match.label
    return host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function getTextContent(parent: Element, tagName: string): string {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? ''
}

function getFirstTextContent(parent: Element, tagNames: string[]): string {
  for (const tagName of tagNames) {
    const value = getTextContent(parent, tagName)
    if (value) return value
  }
  return ''
}

function parseDateCandidate(value: string): string | null {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function resolveRssLink(item: Element, feedUrl: string): string {
  const linkText = getTextContent(item, 'link')
  if (linkText) {
    try {
      return new URL(linkText, feedUrl).toString()
    } catch {
      return linkText
    }
  }

  const guidElement = item.getElementsByTagName('guid')[0] ?? null
  const guidText = guidElement?.textContent?.trim() ?? ''
  const guidPermalink = guidElement?.getAttribute('isPermaLink')
  if (guidText && (guidPermalink === 'true' || /^https?:\/\//i.test(guidText))) {
    try {
      return new URL(guidText, feedUrl).toString()
    } catch {
      return guidText
    }
  }

  return ''
}

function resolveAtomLink(entry: Element, feedUrl: string): string {
  const links = Array.from(entry.getElementsByTagName('link'))
  for (const link of links) {
    const href = link.getAttribute('href')?.trim() ?? link.textContent?.trim() ?? ''
    if (!href) continue
    const rel = link.getAttribute('rel')?.trim().toLowerCase()
    if (rel && rel !== 'alternate') continue
    try {
      return new URL(href, feedUrl).toString()
    } catch {
      return href
    }
  }

  return ''
}

function parseRssItems(xml: Document, feedUrl: string, source: string): NewsItem[] {
  const items = Array.from(xml.getElementsByTagName('item'))
  const parsed: NewsItem[] = []

  for (const item of items) {
    const title = getFirstTextContent(item, ['title']).trim()
    const link = resolveRssLink(item, feedUrl)
    const publishedAt = parseDateCandidate(getFirstTextContent(item, ['pubDate', 'published', 'updated', 'date', 'dc:date']))

    if (!title || !link || !publishedAt) continue

    parsed.push({
      title,
      link,
      source,
      publishedAt,
    })
  }

  return parsed
}

function parseAtomItems(xml: Document, feedUrl: string, source: string): NewsItem[] {
  const entries = Array.from(xml.getElementsByTagName('entry'))
  const parsed: NewsItem[] = []

  for (const entry of entries) {
    const title = getFirstTextContent(entry, ['title']).trim()
    const link = resolveAtomLink(entry, feedUrl)
    const publishedAt = parseDateCandidate(getFirstTextContent(entry, ['published', 'updated']))

    if (!title || !link || !publishedAt) continue

    parsed.push({
      title,
      link,
      source,
      publishedAt,
    })
  }

  return parsed
}

function parseFeedXml(xmlText: string, feedUrl: string, source: string): NewsItem[] {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML')
  }

  const rootName = xml.documentElement?.localName?.toLowerCase() ?? ''
  if (rootName === 'feed') {
    return parseAtomItems(xml, feedUrl, source)
  }

  if (rootName === 'rss' || rootName === 'rdf' || rootName === 'rdf:rdf') {
    return parseRssItems(xml, feedUrl, source)
  }

  if (xml.getElementsByTagName('entry').length > 0) {
    return parseAtomItems(xml, feedUrl, source)
  }

  if (xml.getElementsByTagName('item').length > 0) {
    return parseRssItems(xml, feedUrl, source)
  }

  throw new Error(`Unsupported feed format: ${rootName || 'unknown'}`)
}

function dedupeAndSortNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>()
  const unique: NewsItem[] = []

  for (const item of items) {
    const key = `${normalizeHeadlineText(item.title)}|${canonicalizeUrl(item.link)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  return unique.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
}

async function readCachedNews(): Promise<{ items: NewsItem[]; ts: number } | null> {
  try {
    const result = await chromeStorageGet(NEWS_CACHE_STORAGE_KEY)
    const raw = result[NEWS_CACHE_STORAGE_KEY] as StoredNewsCache | undefined
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    if (typeof raw.ts !== 'number' || typeof raw.ttl !== 'number' || !Array.isArray(raw.items)) return null
    if (Date.now() - raw.ts > raw.ttl) {
      await chromeStorageRemove(NEWS_CACHE_STORAGE_KEY)
      return null
    }

    const items = raw.items.filter((item): item is NewsItem => (
      Boolean(item)
      && typeof item === 'object'
      && typeof item.title === 'string'
      && typeof item.link === 'string'
      && typeof item.source === 'string'
      && typeof item.publishedAt === 'string'
    ))

    return { items, ts: raw.ts }
  } catch {
    return null
  }
}

export async function getCachedNewsSnapshot(): Promise<{ items: NewsItem[]; fetchedAt: number } | null> {
  const cached = await readCachedNews()
  if (!cached) return null
  return {
    items: cached.items,
    fetchedAt: cached.ts,
  }
}

async function writeCachedNews(items: NewsItem[]): Promise<void> {
  const envelope: StoredNewsCache = {
    items,
    ts: Date.now(),
    ttl: NEWS_CACHE_TTL_MS,
  }
  await chromeStorageSet({ [NEWS_CACHE_STORAGE_KEY]: envelope })
}

async function loadConfiguredFeedText(): Promise<string> {
  try {
    const result = await chromeStorageGet(NEWS_FEEDS_STORAGE_KEY)
    if (Object.prototype.hasOwnProperty.call(result, NEWS_FEEDS_STORAGE_KEY)) {
      return coerceStoredNewsFeedText(result[NEWS_FEEDS_STORAGE_KEY])
    }
  } catch {
    // Fall back to code defaults.
  }

  return normalizeNewsFeedText(DEFAULT_NEWS_FEED_TEXT)
}

function normalizeSummaryText(text: string): string {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/```(?:text)?/gi, '')
    .trim()

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_SUMMARY_BULLETS)

  return lines.map((line) => {
    if (/^[-*]/.test(line) || /^\d+\./.test(line)) return line
    return `- ${line}`
  }).join('\n')
}

function formatHeadlineLines(items: NewsItem[], limit = MAX_FALLBACK_HEADLINES): string {
  return items.slice(0, limit).map((item) => {
    const published = formatRelativeTime(item.publishedAt)
    return `- ${item.title} | ${item.source} | ${published}`
  }).join('\n')
}

export function formatNewsHeadlineLinks(items: NewsItem[], limit = 3): string {
  return items.slice(0, limit).map((item) => {
    const published = formatRelativeTime(item.publishedAt)
    return `- [${item.title}](${item.link}) | ${item.source} | ${published}`
  }).join('\n')
}

export function getNewsPulseState(): NewsPulseState {
  return currentState
}

export function getDefaultNewsFeedText(): string {
  return normalizeNewsFeedText(DEFAULT_NEWS_FEED_TEXT)
}

export async function getNewsFeedText(): Promise<string> {
  return loadConfiguredFeedText()
}

export async function saveNewsFeeds(text: string): Promise<string> {
  const normalized = normalizeNewsFeedText(text)
  await chromeStorageSet({ [NEWS_FEEDS_STORAGE_KEY]: normalized })
  await chromeStorageRemove(NEWS_CACHE_STORAGE_KEY)
  return normalized
}

export async function resetNewsFeeds(): Promise<string> {
  const normalized = getDefaultNewsFeedText()
  await chromeStorageSet({ [NEWS_FEEDS_STORAGE_KEY]: normalized })
  await chromeStorageRemove(NEWS_CACHE_STORAGE_KEY)
  return normalized
}

export async function fetchNews(force = false): Promise<NewsItem[]> {
  if (inFlightFetch) return inFlightFetch

  inFlightFetch = (async () => {
    if (!force) {
      const cached = await readCachedNews()
      if (cached) {
        setState({
          fetchStatus: 'cached',
          error: null,
          fetchedAt: cached.ts,
          itemCount: cached.items.length,
        })
        console.log('[NEWS]', { feed: 'cache', status: 'hit', itemsParsed: cached.items.length })
        return cached.items
      }
    }

    const feedText = await loadConfiguredFeedText()
    const feedUrls = parseNewsFeedUrls(feedText)

    if (feedUrls.length === 0) {
      const error = t('dailyBrief.newsNoFeedsConfigured')
      setState({
        fetchStatus: 'no-feeds',
        error,
        fetchedAt: null,
        itemCount: 0,
      })
      console.log('[NEWS]', { feed: 'config', status: 'no-feeds', itemsParsed: 0 })
      return []
    }

    const gathered: NewsItem[] = []

    for (const feedUrl of feedUrls) {
      const label = resolveFeedLabel(feedUrl)
      try {
        const response = await fetchWithTimeout(feedUrl, {
          headers: {
            accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
          },
        }, NEWS_FEED_TIMEOUT_MS)

        if (!response.ok) {
          console.log('[NEWS]', { feed: label, url: feedUrl, status: response.status, itemsParsed: 0 })
          continue
        }

        const xmlText = await response.text()
        const items = parseFeedXml(xmlText, feedUrl, label)
        console.log('[NEWS]', { feed: label, url: feedUrl, status: response.status, itemsParsed: items.length })
        gathered.push(...items)
      } catch (error) {
        const status = error instanceof Error ? error.message : 'error'
        console.log('[NEWS]', { feed: label, url: feedUrl, status, itemsParsed: 0 })
      }
    }

    const deduped = dedupeAndSortNews(gathered).slice(0, MAX_NEWS_ITEMS)
    if (deduped.length === 0) {
      const error = t('dailyBrief.newsCouldNotLoad')
      setState({
        fetchStatus: 'error',
        error,
        fetchedAt: null,
        itemCount: 0,
      })
      return []
    }

    await writeCachedNews(deduped)
    setState({
      fetchStatus: 'fetched',
      error: null,
      fetchedAt: Date.now(),
      itemCount: deduped.length,
    })
    return deduped
  })().finally(() => {
    inFlightFetch = null
  })

  return inFlightFetch
}

async function callAISummary(items: NewsItem[], language: 'English' | 'Turkish'): Promise<string> {
  const apiKey = await getActiveAIProviderKey()
  if (!apiKey) throw new Error('NO_API_KEY')

  const numberedItems = items.map((item, index) => `${index + 1}. [${item.source}] ${item.title}`).join('\n')
  const systemPrompt = [
    'You summarize RSS/Atom headlines for a short ecosystem brief.',
    'Use only the provided headlines and source names.',
    'Do not invent facts, dates, numbers, partnerships, or outcomes that are not already present.',
    'Write 3-5 short bullet points in plain text, each line starting with "- ".',
    `Write in ${language}.`,
  ].join(' ')
  const prompt = [
    'Headlines:',
    numberedItems,
  ].join('\n')

  const text = await generateText(prompt, {
    systemPrompt,
    temperature: 0.2,
    topP: 0.95,
  })
  if (!text) throw new Error('PARSE_ERROR')

  return normalizeSummaryText(text)
}

export async function summarizeNews(items: NewsItem[]): Promise<string> {
  if (items.length === 0) {
    setState({
      summaryMode: 'unavailable',
      summaryAt: Date.now(),
      summarySourceCount: 0,
    })
    return ''
  }

  const language = getLocalePromptLanguage(getLocaleSync())
  const digest = buildNewsDigest(items)
  const apiKey = await getActiveAIProviderKey()

  if (summaryCache && summaryCache.digest === digest && summaryCache.language === language) {
    if (summaryCache.mode === 'ai' || !apiKey) {
      setState({
        summaryMode: summaryCache.mode,
        summaryAt: summaryCache.at,
        summarySourceCount: items.length,
      })
      return summaryCache.text
    }
  }

  if (!apiKey) {
    const fallback = formatHeadlineLines(items)
    summaryCache = {
      digest,
      language,
      text: fallback,
      mode: 'unavailable',
      at: Date.now(),
    }
    setState({
      summaryMode: 'unavailable',
      summaryAt: summaryCache.at,
      summarySourceCount: items.length,
    })
    return fallback
  }

  try {
    const summary = await callAISummary(items, language)
    const text = summary || formatHeadlineLines(items)
    const mode: Exclude<NewsSummaryMode, 'idle'> = summary ? 'ai' : 'fallback'
    summaryCache = {
      digest,
      language,
      text,
      mode,
      at: Date.now(),
    }
    setState({
      summaryMode: mode,
      summaryAt: summaryCache.at,
      summarySourceCount: items.length,
    })
    return text
  } catch {
    const fallback = formatHeadlineLines(items)
    summaryCache = {
      digest,
      language,
      text: fallback,
      mode: 'fallback',
      at: Date.now(),
    }
    setState({
      summaryMode: 'fallback',
      summaryAt: summaryCache.at,
      summarySourceCount: items.length,
    })
    return fallback
  }
}
