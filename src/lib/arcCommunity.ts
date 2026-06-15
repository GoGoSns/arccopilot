import { debugWarn } from '@/lib/debug'
import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { ARC_COMMUNITY_CACHE_KEY } from '@/lib/storageKeys'

const ARC_COMMUNITY_LISTING_URL = 'https://community.arc.network/en/public/content'
const ARC_COMMUNITY_FALLBACK_URL = 'https://community.arc.network/en/public/blogs/welcome-to-the-arc-hub-an-introduction'
const ARC_COMMUNITY_CACHE_TTL_MS = 15 * 60_000
const ARC_COMMUNITY_MAX_ITEMS = 6
const ARC_COMMUNITY_FALLBACK_PATH = '/en/public/blogs/welcome-to-the-arc-hub-an-introduction'

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

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripOrdinalSuffixes(value: string): string {
  return value.replace(/(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
}

function isDateLine(line: string): boolean {
  if (!line) return true
  if (/^\d{1,2}:\d{2}$/.test(line)) return true
  if (/^by\s+/i.test(line)) return true
  if (line.includes('\u00b7')) return true
  if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\b/i.test(line) && /\b\d{4}\b/.test(line)) {
    return true
  }
  if (/^(Popular|Related|Read more|View more|More|Blog|Video|External|Announcement|Resource|Resources|Podcast|Podcasts|Event|Events|News)$/i.test(line)) return true
  return false
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

function inferItemType(url: URL): ArcCommunityItemType {
  const pathname = url.pathname.toLowerCase()

  if (!pathname.startsWith('/en/public/')) {
    return 'External'
  }

  if (pathname.includes('/blogs/')) {
    return 'Blog'
  }

  if (pathname.includes('/videos/')) {
    return 'Video'
  }

  if (pathname.includes('/externals/') || pathname.includes('/external/')) {
    return 'External'
  }

  return 'Announcement'
}

function isPotentialArcCommunityHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('/en/public/')
}

function extractMainLink(element: Element, baseUrl: URL): HTMLAnchorElement | null {
  const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]'))
  const publicAnchors = anchors.filter((anchor) => {
    const href = anchor.getAttribute('href')?.trim()
    if (!href) return false
    if (!isPotentialArcCommunityHref(href)) return false

    try {
      const resolved = new URL(href, baseUrl)
      return resolved.pathname.startsWith('/en/public/')
    } catch {
      return false
    }
  })

  if (publicAnchors.length > 0) {
    return publicAnchors[0]
  }

  const fallbackAnchors = anchors.filter((anchor) => {
    const href = anchor.getAttribute('href')?.trim()
    if (!href || !isPotentialArcCommunityHref(href)) return false

    try {
      const resolved = new URL(href, baseUrl)
      return resolved.protocol === 'https:'
    } catch {
      return false
    }
  })

  return fallbackAnchors[0] ?? null
}

function extractTitleFromElement(element: Element): string | null {
  const heading = element.querySelector('h1,h2,h3,h4,h5,h6')?.textContent
  if (heading) {
    const normalizedHeading = normalizeWhitespace(heading)
    if (normalizedHeading && !isDateLine(normalizedHeading)) {
      return normalizedHeading
    }
  }

  const rawText = element.textContent ?? ''
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

  for (const line of lines) {
    if (!isDateLine(line)) {
      return line
    }
  }

  return null
}

function extractDateFromElement(element: Element, url: URL): string | null {
  const timeElement = element.querySelector('time[datetime], [datetime]')
  const datetime = timeElement?.getAttribute('datetime')
  if (datetime) {
    const parsed = new Date(datetime)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  const rawText = element.textContent ?? ''
  const fromText = parseIsoDateFromText(rawText)
  if (fromText) {
    return fromText
  }

  return parseIsoDateFromUrl(url)
}

function parseItemElement(element: Element, baseUrl: URL, order: number): ParsedArcCommunityItem | null {
  const link = extractMainLink(element, baseUrl)
  if (!link) return null

  const href = link.getAttribute('href')?.trim()
  if (!href) return null

  let resolvedUrl: URL
  try {
    resolvedUrl = new URL(href, baseUrl)
  } catch {
    return null
  }

  if (resolvedUrl.protocol !== 'https:') return null

  const title = extractTitleFromElement(element)
  const date = extractDateFromElement(element, resolvedUrl)
  if (!title || !date) return null

  return {
    title,
    url: resolvedUrl.toString(),
    type: inferItemType(resolvedUrl),
    date,
    order,
    dateMs: new Date(date).getTime(),
  }
}

function dedupeAndSortItems(items: ParsedArcCommunityItem[]): ArcCommunityItem[] {
  const seen = new Set<string>()

  return items
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false
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

async function fetchArcCommunityPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return {
    html: await response.text(),
    finalUrl: response.url || url,
  }
}

function parseArcCommunityHtml(html: string, baseUrl: string, excludePathnames: string[] = []): ArcCommunityItem[] {
  const pathExcludes = new Set(excludePathnames)

  const parseWithDom = (): ArcCommunityItem[] => {
    if (typeof DOMParser === 'undefined') return []

    const document = new DOMParser().parseFromString(html, 'text/html')
    const itemElements = Array.from(document.querySelectorAll('[data-content-item="true"]'))
    const parsed = itemElements
      .map((element, index) => parseItemElement(element, new URL(baseUrl), index))
      .filter((item): item is ParsedArcCommunityItem => Boolean(item))
      .filter((item) => !pathExcludes.has(new URL(item.url).pathname))

    return dedupeAndSortItems(parsed)
  }

  const domItems = parseWithDom()
  if (domItems.length > 0) {
    return domItems
  }

  const blockPattern = /<([a-z0-9-]+)[^>]*data-content-item="true"[^>]*>([\s\S]*?)<\/\1>/gi
  const blocks: ParsedArcCommunityItem[] = []
  let match: RegExpExecArray | null = null

  while ((match = blockPattern.exec(html))) {
    const block = match[0]
    const hrefMatch = block.match(/href=(["'])([^"']+)\1/i)
    if (!hrefMatch) continue

    let resolvedUrl: URL
    try {
      resolvedUrl = new URL(hrefMatch[2], baseUrl)
    } catch {
      continue
    }

    if (!resolvedUrl.toString().startsWith('https://')) continue
    if (pathExcludes.has(resolvedUrl.pathname)) continue

    const textOnly = block
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')

    const title = textOnly
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .find((line) => !isDateLine(line))

    const date = parseIsoDateFromText(block) ?? parseIsoDateFromUrl(resolvedUrl)
    if (!title || !date) continue

    blocks.push({
      title,
      url: resolvedUrl.toString(),
      type: inferItemType(resolvedUrl),
      date,
      order: blocks.length,
      dateMs: new Date(date).getTime(),
    })
  }

  return dedupeAndSortItems(blocks)
}

function buildFreshResult(items: ArcCommunityItem[]): ArcCommunityFeedResult {
  const fetchedAt = Date.now()

  return {
    items,
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

function buildErrorResult(error: unknown, fallbackMessage = 'Could not load Arc community.'): ArcCommunityFeedResult {
  return {
    items: [],
    fetchedAt: Date.now(),
    cacheStatus: 'error',
    error: error instanceof Error && error.message ? error.message : fallbackMessage,
  }
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
    const listing = await fetchArcCommunityPage(ARC_COMMUNITY_LISTING_URL)
    const listingItems = parseArcCommunityHtml(listing.html, listing.finalUrl)

    if (listingItems.length > 0) {
      const result = buildFreshResult(listingItems)
      await writeArcCommunityCache({
        items: result.items,
        fetchedAt: result.fetchedAt,
      })
      return result
    }

    const fallback = await fetchArcCommunityPage(ARC_COMMUNITY_FALLBACK_URL)
    const fallbackItems = parseArcCommunityHtml(fallback.html, fallback.finalUrl, [ARC_COMMUNITY_FALLBACK_PATH])

    if (fallbackItems.length > 0) {
      const result = buildFreshResult(fallbackItems)
      await writeArcCommunityCache({
        items: result.items,
        fetchedAt: result.fetchedAt,
      })
      return result
    }

    if (cached) {
      return buildStaleResult(cached)
    }

    return buildErrorResult(new Error('No Arc community items found in the server-rendered HTML.'), 'Could not load Arc community.')
  } catch (error) {
    debugWarn('[ArcCommunity] fetch failed:', error)

    if (cached) {
      return buildStaleResult(cached)
    }

    return buildErrorResult(error)
  }
}
