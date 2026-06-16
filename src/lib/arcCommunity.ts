import { debugLog, debugWarn } from '@/lib/debug'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { ARC_COMMUNITY_CACHE_KEY } from '@/lib/storageKeys'

const ARC_COMMUNITY_SITEMAP_URL = 'https://community.arc.network/sitemap/content/sitemap.xml'
const ARC_COMMUNITY_ROOT_SITEMAP_URL = 'https://community.arc.network/sitemap.xml'
const ARC_COMMUNITY_LISTING_URL = 'https://community.arc.network/en/public/content'
const ARC_COMMUNITY_ARTICLE_FALLBACK_URL = 'https://community.arc.network/en/public/blogs/welcome-to-the-arc-hub-an-introduction'
const ARC_COMMUNITY_CACHE_TTL_MS = 15 * 60_000
const ARC_COMMUNITY_MAX_ITEMS = 6

export type ArcCommunityItemType = 'Blog' | 'External' | 'Video' | 'Announcement'

export interface ArcCommunityItem {
  title: string
  url: string
  type: ArcCommunityItemType
  date: string
}

type ArcCommunityCacheEntry = {
  items: ArcCommunityItem[]
  fetchedAt: number
}

export type ArcCommunityCacheStatus = 'fresh-cache' | 'network' | 'stale-cache' | 'error'

export interface ArcCommunityFeedResult {
  items: ArcCommunityItem[]
  fetchedAt: number
  cacheStatus: ArcCommunityCacheStatus
  error?: string
}

type ParsedArcCommunityItem = ArcCommunityItem & {
  order: number
  dateMs: number
}

type FetchedText = {
  status: number
  body: string
  finalUrl: string
}

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'over',
  'the',
  'to',
  'via',
  'with',
])

const ACRONYM_MAP: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  arc: 'Arc',
  cctp: 'CCTP',
  crcl: 'CRCL',
  dao: 'DAO',
  defi: 'DeFi',
  eurc: 'EURC',
  evm: 'EVM',
  fi: 'Fi',
  l1: 'L1',
  l2: 'L2',
  lifi: 'LI.FI',
  nft: 'NFT',
  nfts: 'NFTs',
  qcad: 'QCAD',
  rpc: 'RPC',
  sdk: 'SDK',
  tradfi: 'TradFi',
  usdc: 'USDC',
  usdt: 'USDT',
  web3: 'Web3',
  x: 'X',
}

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

function stripOrdinalSuffixes(value: string): string {
  return value.replace(/(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
}

function parseIsoDateFromText(value: string): string | null {
  const normalized = stripOrdinalSuffixes(normalizeWhitespace(value))
  const candidate = normalized.match(
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+\d{4})\b/i,
  )?.[1]

  if (!candidate) return null

  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseIsoDateFromUrl(url: URL): string | null {
  const match = url.pathname.match(/-(\d{4}-\d{2}-\d{2})(?:[/?#]|$)/)
  if (!match) return null

  const parsed = new Date(`${match[1]}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseIsoDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function getPublicPathSegments(url: URL): string[] {
  const normalizedPath = url.pathname.replace(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?public\//i, '')
  return normalizedPath.split('/').filter(Boolean)
}

function inferItemType(url: URL): ArcCommunityItemType | null {
  const [section] = getPublicPathSegments(url)

  switch ((section ?? '').toLowerCase()) {
    case 'blogs':
      return 'Blog'
    case 'externals':
      return 'External'
    case 'videos':
      return 'Video'
    case 'resources':
      return 'Announcement'
    default:
      return null
  }
}

function isArcCommunityItemUrl(url: URL): boolean {
  return inferItemType(url) != null
}

function buildTitleFromSlug(slug: string): string {
  const cleanedSlug = decodeURIComponent(slug.replace(/-\d{4}-\d{2}-\d{2}$/, ''))
  const words = cleanedSlug
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) return ''

  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      const mapped = ACRONYM_MAP[lower]
      if (mapped) return mapped
      if (index > 0 && index < words.length - 1 && SMALL_WORDS.has(lower)) {
        return lower
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

function extractTitleFromHtml(innerHtml: string): string | null {
  const headingMatch = innerHtml.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (headingMatch) {
    const heading = normalizeWhitespace(stripHtml(headingMatch[1]))
    if (heading) return heading
  }

  const strongMatch = innerHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)
  if (strongMatch) {
    const strong = normalizeWhitespace(stripHtml(strongMatch[1]))
    if (strong) return strong
  }

  const text = normalizeWhitespace(stripHtml(innerHtml))
  if (!text) return null

  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

  for (const line of lines) {
    if (!isMetadataLine(line)) {
      return line
    }
  }

  return null
}

function isMetadataLine(line: string): boolean {
  if (!line) return true
  if (/^\d{1,2}:\d{2}$/.test(line)) return true
  if (/^\d+(?:\.\d+)?[kKmM]?$/.test(line)) return true
  if (/^by\s+/i.test(line)) return true
  if (line.includes('\u00b7')) return true
  if (/^(Popular|Related|Read more|View more|More|Blog|Video|External|Announcement|Resource|Resources|Podcast|Podcasts|Event|Events|News)$/i.test(line)) return true
  return false
}

function extractDateFromHtml(innerHtml: string, url: URL): string | null {
  const datetimeMatch = innerHtml.match(/datetime=(["'])([^"']+)\1/i)
  const datetime = parseIsoDate(datetimeMatch?.[2])
  if (datetime) return datetime

  const text = normalizeWhitespace(stripHtml(innerHtml))
  const fromText = parseIsoDateFromText(text)
  if (fromText) return fromText

  return parseIsoDateFromUrl(url)
}

function parsePublicItemUrl(rawUrl: string, baseUrl: URL): URL | null {
  try {
    const resolved = new URL(rawUrl, baseUrl)
    if (!isArcCommunityItemUrl(resolved)) return null
    return resolved
  } catch {
    return null
  }
}

function parsePublicLinksFromHtml(html: string, baseUrl: URL): ArcCommunityItem[] {
  const items: ParsedArcCommunityItem[] = []
  const seen = new Set<string>()
  const anchorPattern = /<a\b[^>]*href=(["'])([^"']*(?:\/(?:en\/)?public\/(?:blogs|externals|videos|resources)\/[^"']+))\1[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null = null

  while ((match = anchorPattern.exec(html))) {
    const resolved = parsePublicItemUrl(match[2], baseUrl)
    if (!resolved) continue
    const url = resolved.toString()
    if (seen.has(url)) continue

    const title = extractTitleFromHtml(match[3]) ?? buildTitleFromSlug(getPublicPathSegments(resolved).slice(1).join('-'))
    const date = extractDateFromHtml(match[3], resolved)
    const type = inferItemType(resolved)

    if (!title || !date || !type) continue

    seen.add(url)
    items.push({
      title,
      url,
      type,
      date,
      order: items.length,
      dateMs: new Date(date).getTime(),
    })
  }

  return dedupeAndSortItems(items)
}

function dedupeAndSortItems(items: ParsedArcCommunityItem[]): ArcCommunityItem[] {
  const seen = new Set<string>()

  return items
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .sort((a, b) => {
      const delta = b.dateMs - a.dateMs
      return delta !== 0 ? delta : a.order - b.order
    })
    .slice(0, ARC_COMMUNITY_MAX_ITEMS)
    .map(({ order: _order, dateMs: _dateMs, ...item }) => item)
}

function parseSitemapEntries(xml: string): ArcCommunityItem[] {
  const items: ParsedArcCommunityItem[] = []
  const urlBlockPattern = /<url>([\s\S]*?)<\/url>/gi
  let match: RegExpExecArray | null = null

  while ((match = urlBlockPattern.exec(xml))) {
    const block = match[1]
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/i)
    const lastmodMatch = block.match(/<lastmod>([^<]+)<\/lastmod>/i)
    if (!locMatch || !lastmodMatch) continue

    let resolved: URL
    try {
      resolved = new URL(locMatch[1].trim())
    } catch {
      continue
    }

    const type = inferItemType(resolved)
    if (!type) continue

    const slug = getPublicPathSegments(resolved).slice(1).join('-')
    const title = buildTitleFromSlug(slug)
    const date = parseIsoDate(lastmodMatch[1].trim())
    if (!title || !date) continue

    items.push({
      title,
      url: resolved.toString(),
      type,
      date,
      order: items.length,
      dateMs: new Date(date).getTime(),
    })
  }

  return dedupeAndSortItems(items)
}

function isArcCommunityCacheEntry(value: unknown): value is ArcCommunityCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const entry = value as { items?: unknown; fetchedAt?: unknown }
  return Array.isArray(entry.items) && typeof entry.fetchedAt === 'number'
}

function isFreshArcCommunityCache(entry: ArcCommunityCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < ARC_COMMUNITY_CACHE_TTL_MS
}

async function readArcCommunityCache(): Promise<ArcCommunityCacheEntry | null> {
  if (!canUseChromeStorage()) return null

  const result = await chromeStorageGet(ARC_COMMUNITY_CACHE_KEY)
  const cached = result[ARC_COMMUNITY_CACHE_KEY]

  if (!isArcCommunityCacheEntry(cached)) {
    if (typeof cached !== 'undefined') {
      await chromeStorageRemove(ARC_COMMUNITY_CACHE_KEY)
    }
    return null
  }

  return cached
}

async function writeArcCommunityCache(entry: ArcCommunityCacheEntry): Promise<void> {
  if (!canUseChromeStorage()) return

  await chromeStorageSet({ [ARC_COMMUNITY_CACHE_KEY]: entry })
}

async function fetchText(url: string): Promise<FetchedText> {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'application/xml,text/xml,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    },
  })

  const body = await response.text()
  debugLog('[ArcCommunity] fetch', {
    sourceUrl: url,
    resolvedUrl: response.url || url,
    status: response.status,
    bodyLength: body.length,
  })

  return {
    status: response.status,
    body,
    finalUrl: response.url || url,
  }
}

async function fetchSitemapItems(sourceUrl: string): Promise<ArcCommunityItem[]> {
  const { body, finalUrl } = await fetchText(sourceUrl)
  const items = parseSitemapEntries(body)

  debugLog('[ArcCommunity] parsed sitemap', {
    sourceUrl,
    finalUrl,
    parsedCount: items.length,
  })

  return items
}

async function fetchFallbackPageItems(sourceUrl: string): Promise<ArcCommunityItem[]> {
  const { body, finalUrl } = await fetchText(sourceUrl)
  const baseUrl = new URL(finalUrl)
  const items = parsePublicLinksFromHtml(body, baseUrl)

  debugLog('[ArcCommunity] parsed fallback page', {
    sourceUrl,
    finalUrl,
    parsedCount: items.length,
  })

  return items
}

function buildNetworkResult(items: ArcCommunityItem[], fetchedAt = Date.now()): ArcCommunityFeedResult {
  return {
    items: items.slice(0, ARC_COMMUNITY_MAX_ITEMS),
    fetchedAt,
    cacheStatus: 'network',
  }
}

function buildStaleResult(cached: ArcCommunityCacheEntry): ArcCommunityFeedResult {
  return {
    items: cached.items.slice(0, ARC_COMMUNITY_MAX_ITEMS),
    fetchedAt: cached.fetchedAt,
    cacheStatus: 'stale-cache',
  }
}

function buildErrorResult(message: string): ArcCommunityFeedResult {
  return {
    items: [],
    fetchedAt: Date.now(),
    cacheStatus: 'error',
    error: message,
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Could not load Arc community.'
}

async function fetchArcCommunityNetwork(): Promise<ArcCommunityFeedResult> {
  const sitemapItems = await fetchSitemapItems(ARC_COMMUNITY_SITEMAP_URL)
  if (sitemapItems.length > 0) {
    const fetchedAt = Date.now()
    await writeArcCommunityCache({ items: sitemapItems.slice(0, ARC_COMMUNITY_MAX_ITEMS), fetchedAt })
    return buildNetworkResult(sitemapItems, fetchedAt)
  }

  // The root sitemap points at the content sitemap; fetch it if the direct content sitemap response is empty.
  const rootText = await fetchText(ARC_COMMUNITY_ROOT_SITEMAP_URL)
  const rootLocs = Array.from(rootText.body.matchAll(/<loc>([^<]+)<\/loc>/gi))
    .map((match) => match[1].trim())
    .filter((loc) => loc.includes('/sitemap/content/'))

  debugLog('[ArcCommunity] parsed root sitemap', {
    sourceUrl: ARC_COMMUNITY_ROOT_SITEMAP_URL,
    finalUrl: rootText.finalUrl,
    parsedCount: rootLocs.length,
  })

  for (const loc of rootLocs) {
    const items = await fetchSitemapItems(loc)
    if (items.length > 0) {
      const fetchedAt = Date.now()
      await writeArcCommunityCache({ items: items.slice(0, ARC_COMMUNITY_MAX_ITEMS), fetchedAt })
      return buildNetworkResult(items, fetchedAt)
    }
  }

  const fallbackPages = [ARC_COMMUNITY_LISTING_URL, ARC_COMMUNITY_ARTICLE_FALLBACK_URL]
  for (const fallbackUrl of fallbackPages) {
    const items = await fetchFallbackPageItems(fallbackUrl)
    if (items.length > 0) {
      const fetchedAt = Date.now()
      await writeArcCommunityCache({ items: items.slice(0, ARC_COMMUNITY_MAX_ITEMS), fetchedAt })
      return buildNetworkResult(items, fetchedAt)
    }
  }

  return buildErrorResult('No Arc community items found in the sitemap or fallback HTML.')
}

export async function fetchArcCommunity(): Promise<ArcCommunityFeedResult> {
  const cached = await readArcCommunityCache()
  if (cached && isFreshArcCommunityCache(cached)) {
    return {
      items: cached.items.slice(0, ARC_COMMUNITY_MAX_ITEMS),
      fetchedAt: cached.fetchedAt,
      cacheStatus: 'fresh-cache',
    }
  }

  try {
    const result = await fetchArcCommunityNetwork()
    if (result.items.length > 0) {
      return result
    }

    if (cached) {
      return buildStaleResult(cached)
    }

    return result
  } catch (error) {
    debugWarn('[ArcCommunity] fetch failed:', error)

    if (cached) {
      return buildStaleResult(cached)
    }

    return buildErrorResult(formatErrorMessage(error))
  }
}
