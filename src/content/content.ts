/**
 * ArcCopilot - Universal Tip Button
 * Scans supported pages for Ethereum addresses and adds a premium hover tip card.
 */

type AdapterName = 'genericAdapter' | 'arcscanAdapter' | 'githubAdapter' | 'twitterAdapter'

type SiteAdapter = {
  name: AdapterName
  collectRoots: () => Element[]
}

type AddressHit = {
  index: number
  address: string
}

type PendingMatch = {
  node: Text
  matches: AddressHit[]
}

type ScanResult = {
  matches: number
  wrapped: number
}

type AddressMemory = {
  address: string
  label?: string
  note?: string
  tag?: 'friend' | 'work' | 'warning' | 'self' | 'other'
  createdAt: number
  lastUsedAt: number
}

type AddressBookRecord = Record<string, AddressMemory>

function main(): void {
  console.log('[ArcCopilot] content script loaded', location.href)

  // Standalone addresses only:
  // - 0x + exactly 40 hex chars => match
  // - 0x + 64 hex chars (tx hash) => no match
  // - shortened forms like 0x1234...abcd => no match
  const ADDRESS_CANDIDATE_RE = /0x[a-fA-F0-9]{40}/g
  const MARKER_ATTR = 'data-arccopilot'
  const SAVE_KEY = 'arccopilot:address_book'
  const MAX_ADDRS = 100
  const THROTTLE_MS = 200
  const HIDE_MS = 180
  const SOURCE_DOMAIN = location.hostname.replace(/^www\./i, '')

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    'CODE', 'PRE', 'KBD', 'SAMP',
  ])

  let cardEl: HTMLDivElement | null = null
  let cardAddressEl: HTMLDivElement | null = null
  let cardDomainEl: HTMLDivElement | null = null
  let tipButtonEl: HTMLButtonElement | null = null
  let saveButtonEl: HTMLButtonElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  let scanQueued = false
  let addrCount = 0
  let overCard = false
  let currentAddress = ''
  let currentAnchor: HTMLElement | null = null

  function hostMatches(domain: string): boolean {
    const host = location.hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  }

  function collectRootsBySelectors(selectors: string[]): Element[] {
    if (!document.body) return []
    return Array.from(document.querySelectorAll(selectors.join(', ')))
  }

  function dedupeRoots(roots: Element[]): Element[] {
    const unique = Array.from(new Set(roots))
    return unique.filter((root) => !unique.some((other) => other !== root && root.contains(other)))
  }

  function isHexChar(char: string | undefined): boolean {
    return Boolean(char && /[a-fA-F0-9]/.test(char))
  }

  function findStandaloneAddresses(text: string): AddressHit[] {
    const hits: AddressHit[] = []
    ADDRESS_CANDIDATE_RE.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = ADDRESS_CANDIDATE_RE.exec(text)) !== null) {
      const index = match.index ?? 0
      const address = match[0]
      const before = index > 0 ? text[index - 1] : undefined
      const after = text[index + address.length]

      if (isHexChar(before) || isHexChar(after)) continue

      hits.push({ index, address })
      if (hits.length >= MAX_ADDRS) break
    }

    return hits
  }

  function hasStandaloneAddress(text: string): boolean {
    return findStandaloneAddresses(text).length > 0
  }

  function collectGenericRoots(): Element[] {
    return document.body ? [document.body] : []
  }

  function collectArcscanRoots(): Element[] {
    const roots = new Set<Element>()
    const fieldLabelRe = /\b(?:From|To|Address)\b/i
    const candidates = collectRootsBySelectors([
      'main',
      'article',
      'section',
      'table',
      'dl',
      'tbody',
      'tr',
      'li',
    ])

    for (const element of candidates) {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text || !text.includes('0x')) continue
      if (!fieldLabelRe.test(text)) continue
      if (!hasStandaloneAddress(text)) continue

      roots.add(element)
      if (roots.size >= 40) break
    }

    return dedupeRoots(Array.from(roots))
  }

  function collectGithubRoots(): Element[] {
    return dedupeRoots(collectRootsBySelectors([
      'article.markdown-body',
      '.markdown-body',
    ]))
  }

  function collectTwitterRoots(): Element[] {
    return dedupeRoots(collectRootsBySelectors([
      '[data-testid="UserDescription"]',
      '[data-testid="tweetText"]',
    ]))
  }

  const genericAdapter: SiteAdapter = {
    name: 'genericAdapter',
    collectRoots: collectGenericRoots,
  }

  const arcscanAdapter: SiteAdapter = {
    name: 'arcscanAdapter',
    collectRoots: collectArcscanRoots,
  }

  const githubAdapter: SiteAdapter = {
    name: 'githubAdapter',
    collectRoots: collectGithubRoots,
  }

  const twitterAdapter: SiteAdapter = {
    name: 'twitterAdapter',
    collectRoots: collectTwitterRoots,
  }

  function pickAdapter(): SiteAdapter {
    if (hostMatches('arcscan.app')) return arcscanAdapter
    if (hostMatches('github.com')) return githubAdapter
    if (hostMatches('twitter.com') || hostMatches('x.com')) return twitterAdapter
    return genericAdapter
  }

  const activeAdapter = pickAdapter()
  console.log('[ArcCopilot] adapter active:', activeAdapter.name)

  function shortenAddress(address: string, chars = 4): string {
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
  }

  function clearHideTimer(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function hideTipCard(): void {
    clearHideTimer()
    overCard = false
    currentAddress = ''
    currentAnchor = null

    if (cardEl?.parentNode) {
      cardEl.parentNode.removeChild(cardEl)
    }

    cardEl = null
    cardAddressEl = null
    cardDomainEl = null
    tipButtonEl = null
    saveButtonEl = null
  }

  function scheduleHideTipCard(): void {
    if (overCard) return
    clearHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (!overCard) hideTipCard()
    }, HIDE_MS)
  }

  function setSaveButtonState(saved: boolean): void {
    if (!saveButtonEl) return
    saveButtonEl.disabled = saved
    saveButtonEl.textContent = saved ? 'Saved' : 'Save'
    saveButtonEl.style.opacity = saved ? '0.8' : '1'
    saveButtonEl.style.cursor = saved ? 'default' : 'pointer'
  }

  function sendOpenSend(address: string): void {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_SEND', recipient: address }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[ArcCopilot] sendMessage failed:', chrome.runtime.lastError.message)
        }
      })
    } catch (error) {
      console.warn('[ArcCopilot] sendMessage error:', error)
    }
  }

  function normalizeStoredBook(raw: unknown): AddressBookRecord {
    if (!raw || typeof raw !== 'object') return {}

    const next: AddressBookRecord = {}
    for (const memory of Object.values(raw as Record<string, Partial<AddressMemory>>)) {
      if (!memory?.address) continue
      const address = memory.address.toLowerCase()
      next[address] = {
        address,
        createdAt: typeof memory.createdAt === 'number' ? memory.createdAt : Date.now(),
        lastUsedAt: typeof memory.lastUsedAt === 'number' ? memory.lastUsedAt : Date.now(),
        label: memory.label,
        note: memory.note,
        tag: memory.tag,
      }
    }
    return next
  }

  function saveAddressToBook(address: string): void {
    const normalized = address.toLowerCase()
    const now = Date.now()

    try {
      chrome.storage.local.get(SAVE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('[ArcCopilot] save failed:', chrome.runtime.lastError.message)
          return
        }

        const existing = normalizeStoredBook(result[SAVE_KEY])
        const current = existing[normalized]
        const next: AddressBookRecord = {
          ...existing,
          [normalized]: {
            address: normalized,
            createdAt: current?.createdAt ?? now,
            lastUsedAt: now,
            label: current?.label,
            note: current?.note,
            tag: current?.tag ?? 'other',
          },
        }

        chrome.storage.local.set({ [SAVE_KEY]: next }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[ArcCopilot] save failed:', chrome.runtime.lastError.message)
            return
          }

          if (saveButtonEl && currentAddress.toLowerCase() === normalized) {
            setSaveButtonState(true)
          }
        })
      })
    } catch (error) {
      console.warn('[ArcCopilot] save failed:', error)
    }
  }

  function ensureTipCard(): HTMLDivElement {
    if (cardEl) return cardEl

    const container = document.createElement('div')
    container.setAttribute(MARKER_ATTR, 'tip-card')
    Object.assign(container.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'none',
      left: '0',
      top: '0',
      width: 'min(280px, calc(100vw - 24px))',
      minWidth: '240px',
      maxWidth: 'calc(100vw - 24px)',
      padding: '12px',
      borderRadius: '18px',
      border: '1px solid rgba(212, 175, 55, 0.45)',
      background: 'linear-gradient(180deg, rgba(10, 12, 18, 0.98) 0%, rgba(6, 8, 12, 0.98) 100%)',
      color: '#f7f1df',
      boxShadow: '0 18px 50px rgba(0,0,0,0.48), 0 0 0 1px rgba(212,175,55,0.08)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      fontFamily: 'system-ui, sans-serif',
      pointerEvents: 'auto',
      opacity: '0',
      transition: 'opacity 0.12s ease, transform 0.12s ease',
      transform: 'translate(-50%, -100%)',
      overflow: 'hidden',
    } as CSSStyleDeclaration)

    const shell = document.createElement('div')
    Object.assign(shell.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    } as CSSStyleDeclaration)

    const header = document.createElement('div')
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
    } as CSSStyleDeclaration)

    const brand = document.createElement('div')
    Object.assign(brand.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minWidth: '0',
    } as CSSStyleDeclaration)

    const brandDot = document.createElement('span')
    Object.assign(brandDot.style, {
      width: '8px',
      height: '8px',
      borderRadius: '999px',
      background: 'linear-gradient(180deg, #f2d77b 0%, #d4af37 100%)',
      boxShadow: '0 0 12px rgba(212, 175, 55, 0.55)',
      flexShrink: '0',
    } as CSSStyleDeclaration)

    const brandLabel = document.createElement('span')
    brandLabel.textContent = 'ArcCopilot'
    Object.assign(brandLabel.style, {
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: '#f6ddb2',
    } as CSSStyleDeclaration)

    const sourcePill = document.createElement('span')
    sourcePill.textContent = SOURCE_DOMAIN
    Object.assign(sourcePill.style, {
      display: 'inline-flex',
      alignItems: 'center',
      maxWidth: '100%',
      padding: '3px 8px',
      borderRadius: '999px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.04)',
      color: '#b9bfd2',
      fontSize: '10px',
      fontWeight: '700',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    } as CSSStyleDeclaration)

    brand.append(brandDot, brandLabel)
    header.append(brand, sourcePill)

    cardAddressEl = document.createElement('div')
    cardAddressEl.textContent = ''
    cardAddressEl.title = ''
    Object.assign(cardAddressEl.style, {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '13px',
      fontWeight: '800',
      lineHeight: '1.35',
      letterSpacing: '0.01em',
      color: '#fff5cf',
      wordBreak: 'break-all',
    } as CSSStyleDeclaration)

    cardDomainEl = document.createElement('div')
    cardDomainEl.textContent = ''
    cardDomainEl.title = ''
    Object.assign(cardDomainEl.style, {
      fontSize: '11px',
      lineHeight: '1.4',
      color: '#9aa3bf',
    } as CSSStyleDeclaration)

    const actions = document.createElement('div')
    Object.assign(actions.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px',
    } as CSSStyleDeclaration)

    tipButtonEl = document.createElement('button')
    tipButtonEl.type = 'button'
    tipButtonEl.setAttribute(MARKER_ATTR, 'tip-button')
    tipButtonEl.setAttribute('title', 'Tip with Arc')
    tipButtonEl.setAttribute('aria-label', 'Tip with Arc')
    Object.assign(tipButtonEl.style, {
      minHeight: '34px',
      border: '1px solid rgba(212, 175, 55, 0.55)',
      borderRadius: '12px',
      background: 'linear-gradient(180deg, #f2d77b 0%, #d4af37 100%)',
      color: '#111111',
      fontSize: '12px',
      fontWeight: '800',
      cursor: 'pointer',
      boxShadow: '0 10px 20px rgba(212, 175, 55, 0.18)',
      transition: 'transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease',
      appearance: 'none',
    } as CSSStyleDeclaration)
    tipButtonEl.textContent = 'Tip'

    saveButtonEl = document.createElement('button')
    saveButtonEl.type = 'button'
    saveButtonEl.setAttribute(MARKER_ATTR, 'save-button')
    saveButtonEl.setAttribute('title', 'Save to Address Book')
    saveButtonEl.setAttribute('aria-label', 'Save to Address Book')
    Object.assign(saveButtonEl.style, {
      minHeight: '34px',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      borderRadius: '12px',
      background: 'rgba(255, 255, 255, 0.05)',
      color: '#f3edd8',
      fontSize: '12px',
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: '0 10px 20px rgba(0, 0, 0, 0.16)',
      transition: 'transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease',
      appearance: 'none',
    } as CSSStyleDeclaration)
    saveButtonEl.textContent = 'Save'

    tipButtonEl.addEventListener('mouseenter', () => {
      tipButtonEl!.style.transform = 'translateY(-1px)'
      tipButtonEl!.style.boxShadow = '0 14px 24px rgba(212, 175, 55, 0.24)'
    })
    tipButtonEl.addEventListener('mouseleave', () => {
      tipButtonEl!.style.transform = 'translateY(0)'
      tipButtonEl!.style.boxShadow = '0 10px 20px rgba(212, 175, 55, 0.18)'
    })
    tipButtonEl.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      sendOpenSend(currentAddress)
      hideTipCard()
    })

    saveButtonEl.addEventListener('mouseenter', () => {
      if (saveButtonEl?.disabled) return
      saveButtonEl!.style.transform = 'translateY(-1px)'
      saveButtonEl!.style.boxShadow = '0 14px 24px rgba(0, 0, 0, 0.24)'
    })
    saveButtonEl.addEventListener('mouseleave', () => {
      saveButtonEl!.style.transform = 'translateY(0)'
      saveButtonEl!.style.boxShadow = '0 10px 20px rgba(0, 0, 0, 0.16)'
    })
    saveButtonEl.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      saveAddressToBook(currentAddress)
    })

    actions.append(tipButtonEl, saveButtonEl)
    shell.append(header, cardAddressEl, cardDomainEl, actions)
    container.appendChild(shell)

    container.addEventListener('mouseenter', () => {
      overCard = true
      clearHideTimer()
    })
    container.addEventListener('mouseleave', () => {
      overCard = false
      scheduleHideTipCard()
    })

    const mountPoint = document.body ?? document.documentElement
    mountPoint.appendChild(container)

    cardEl = container
    return container
  }

  function positionTipCard(anchor: HTMLElement): void {
    if (!cardEl) return

    const rect = anchor.getBoundingClientRect()
    const cardRect = cardEl.getBoundingClientRect()
    const cardHeight = cardRect.height || 132
    const cardWidth = cardRect.width || 280
    const placeBelow = rect.top < cardHeight + 28 && window.innerHeight - rect.bottom > cardHeight + 44
    const top = placeBelow
      ? Math.min(window.innerHeight - 8, rect.bottom + 12)
      : Math.max(8, rect.top - 12)
    const leftEdge = cardWidth / 2 + 12
    const rightEdge = window.innerWidth - cardWidth / 2 - 12
    const left = Math.min(rightEdge, Math.max(leftEdge, rect.left + rect.width / 2))

    cardEl.dataset.placement = placeBelow ? 'below' : 'above'
    cardEl.style.top = `${top}px`
    cardEl.style.left = `${left}px`
    cardEl.style.transform = placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'
  }

  function showTipCard(address: string, anchor: HTMLElement): void {
    clearHideTimer()
    currentAddress = address
    currentAnchor = anchor

    const card = ensureTipCard()
    card.dataset.address = address.toLowerCase()
    cardAddressEl!.textContent = shortenAddress(address)
    cardAddressEl!.title = address
    cardDomainEl!.textContent = `Source · ${SOURCE_DOMAIN}`
    cardDomainEl!.title = SOURCE_DOMAIN

    setSaveButtonState(false)
    try {
      chrome.storage.local.get(SAVE_KEY, (result) => {
        if (chrome.runtime.lastError) return
        const normalized = address.toLowerCase()
        const book = normalizeStoredBook(result[SAVE_KEY])
        if (currentAddress.toLowerCase() === normalized && saveButtonEl) {
          setSaveButtonState(Boolean(book[normalized]))
        }
      })
    } catch {
      // Ignore read errors; the Save button still works normally.
    }

    card.style.display = 'block'
    card.style.visibility = 'hidden'
    card.style.opacity = '0'
    positionTipCard(anchor)

    requestAnimationFrame(() => {
      if (!cardEl || currentAddress.toLowerCase() !== address.toLowerCase()) return
      card.style.visibility = 'visible'
      card.style.opacity = '1'
    })
  }

  function wrapTextNode(node: Text, matches: AddressHit[]): ScanResult {
    const text = node.textContent ?? ''
    const parent = node.parentElement
    if (!parent) return { matches: 0, wrapped: 0 }
    if (SKIP_TAGS.has(parent.tagName)) return { matches: 0, wrapped: 0 }
    if (parent.closest(`[${MARKER_ATTR}]`)) return { matches: 0, wrapped: 0 }

    const frag = document.createDocumentFragment()
    let lastIndex = 0
    let wrapped = 0

    for (const match of matches) {
      if (addrCount >= MAX_ADDRS) break

      const start = match.index
      const end = start + match.address.length
      if (start < lastIndex) continue

      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)))
      }

      const address = match.address
      const span = document.createElement('span')
      span.setAttribute(MARKER_ATTR, 'address')
      span.dataset.address = address.toLowerCase()
      span.textContent = address
      Object.assign(span.style, {
        backgroundColor: 'rgba(212, 175, 55, 0.12)',
        borderBottom: '1px dotted #d4af37',
        cursor: 'pointer',
        padding: '0 2px',
        borderRadius: '2px',
      } as CSSStyleDeclaration)

      span.addEventListener('mouseenter', () => showTipCard(address, span))
      span.addEventListener('mouseleave', () => scheduleHideTipCard())

      frag.appendChild(span)
      lastIndex = end
      addrCount += 1
      wrapped += 1
    }

    if (wrapped === 0) return { matches: 0, wrapped: 0 }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    parent.replaceChild(frag, node)
    return { matches: matches.length, wrapped }
  }

  function scanRoot(root: Node): ScanResult {
    if (addrCount >= MAX_ADDRS) return { matches: 0, wrapped: 0 }
    if (!(root instanceof Element || root instanceof Document || root instanceof DocumentFragment)) {
      return { matches: 0, wrapped: 0 }
    }

    const pending: PendingMatch[] = []
    const matches: AddressHit[] = []

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const textNode = node as Text
        const parent = textNode.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (parent.closest(`[${MARKER_ATTR}]`)) return NodeFilter.FILTER_REJECT

        const text = textNode.textContent ?? ''
        if (!text.includes('0x')) return NodeFilter.FILTER_SKIP

        const nodeMatches = findStandaloneAddresses(text)
        if (nodeMatches.length === 0) return NodeFilter.FILTER_SKIP

        pending.push({ node: textNode, matches: nodeMatches })
        matches.push(...nodeMatches)
        return NodeFilter.FILTER_SKIP
      },
    })

    while (walker.nextNode()) {
      // Work happens in acceptNode.
    }

    if (matches.length === 0) return { matches: 0, wrapped: 0 }

    let wrapped = 0
    for (const entry of pending) {
      if (addrCount >= MAX_ADDRS) break
      if (!entry.node.isConnected) continue

      try {
        wrapped += wrapTextNode(entry.node, entry.matches).wrapped
      } catch (error) {
        console.warn('[ArcCopilot] wrap failed:', error)
      }
    }

    return { matches: matches.length, wrapped }
  }

  function scanActivePage(): void {
    const roots = dedupeRoots(activeAdapter.collectRoots())
    let totalMatches = 0
    let totalWrapped = 0

    for (const root of roots) {
      if (addrCount >= MAX_ADDRS) break
      const result = scanRoot(root)
      totalMatches += result.matches
      totalWrapped += result.wrapped
    }

    if (activeAdapter.name !== 'genericAdapter' && addrCount < MAX_ADDRS) {
      const fallback = scanRoot(document.body)
      totalMatches += fallback.matches
      totalWrapped += fallback.wrapped
    }

    console.log('[ArcCopilot] address matches found', totalMatches)
    console.log('[ArcCopilot] wrapped addresses', totalWrapped)
  }

  function scheduleScan(): void {
    scanQueued = true
    if (scanTimer !== null) return

    scanTimer = setTimeout(() => {
      scanTimer = null
      if (!scanQueued) return
      scanQueued = false

      try {
        scanActivePage()
      } catch (error) {
        console.warn('[ArcCopilot] scan failed:', error)
      }

      if (scanQueued) {
        scheduleScan()
      }
    }, THROTTLE_MS)
  }

  const observer = new MutationObserver((mutations) => {
    try {
      if (addrCount >= MAX_ADDRS) {
        observer.disconnect()
        return
      }

      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          scheduleScan()
          break
        }
      }
    } catch (error) {
      console.warn('[ArcCopilot] observer failed:', error)
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  const startScan = () => {
    if (document.body) {
      scheduleScan()
    }
  }

  if (document.body) {
    startScan()
  } else {
    window.addEventListener('DOMContentLoaded', startScan, { once: true })
  }

  window.addEventListener('scroll', scheduleHideTipCard, true)
  window.addEventListener('resize', scheduleHideTipCard)
  window.setTimeout(startScan, 1000)
  window.setTimeout(startScan, 3000)
}

try {
  main()
} catch (error) {
  console.warn('[ArcCopilot] content script fatal error:', error)
}

export {}
