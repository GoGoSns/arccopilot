/**
 * ArcCopilot - Universal Tip Button
 * Scans supported pages for Ethereum addresses and adds a hover tip button.
 */

type SiteAdapter = {
  name: 'genericAdapter' | 'arcscanAdapter' | 'githubAdapter' | 'twitterAdapter'
  collectRoots: () => Element[]
}

function main(): void {
  console.log('[ArcCopilot] content script loaded', location.href)

  // Standalone addresses only:
  // - 0x + 40 hex chars => match
  // - 0x + 64 hex chars (tx hash) => no match
  // - shortened forms like 0x1234...abcd => no match
  const ADDRESS_RE = /(?:^|[^a-fA-F0-9])(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/g
  const ADDRESS_TEST_RE = /(?:^|[^a-fA-F0-9])(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/
  const MARKER_ATTR = 'data-arccopilot'
  const MAX_ADDRS = 100
  const THROTTLE_MS = 200
  const HIDE_MS = 200

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    'CODE', 'PRE', 'KBD', 'SAMP',
  ])

  type PendingMatch = {
    node: Text
    matches: RegExpMatchArray[]
  }

  type ScanResult = {
    matches: number
    wrapped: number
  }

  let tipEl: HTMLButtonElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  let scanQueued = false
  let addrCount = 0
  let overBtn = false

  function hostMatches(domain: string): boolean {
    const host = location.hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  }

  function hasStandaloneAddress(text: string): boolean {
    return ADDRESS_TEST_RE.test(text)
  }

  function collectRootsBySelectors(selectors: string[]): Element[] {
    if (!document.body) return []
    return Array.from(document.querySelectorAll(selectors.join(', ')))
  }

  function dedupeRoots(roots: Element[]): Element[] {
    const unique = Array.from(new Set(roots))
    return unique.filter((root) => !unique.some((other) => other !== root && root.contains(other)))
  }

  function collectGenericRoots(): Element[] {
    return document.body ? [document.body] : []
  }

  function collectArcscanRoots(): Element[] {
    const roots = new Set<Element>()
    const fieldLabelRe = /\b(?:From|To|Address)\b/i
    const candidates = collectRootsBySelectors([
      'main *',
      'article *',
      'section *',
      'table *',
      'dl *',
      'tbody *',
      'tr *',
      'li *',
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

  function applyTipTransform(scale = 1): void {
    if (!tipEl) return

    const placement = tipEl.dataset.placement === 'below'
      ? 'translate(-50%, 0)'
      : 'translate(-50%, -100%)'
    tipEl.style.transform = scale === 1 ? placement : `${placement} scale(${scale})`
  }

  function getTip(): HTMLButtonElement {
    if (tipEl) return tipEl

    tipEl = document.createElement('button')
    tipEl.type = 'button'
    tipEl.setAttribute(MARKER_ATTR, 'tip-button')
    tipEl.setAttribute('title', 'Tip with Arc')
    tipEl.setAttribute('aria-label', 'Tip with Arc')
    tipEl.setAttribute('role', 'button')
    tipEl.dataset.placement = 'above'
    Object.assign(tipEl.style, {
      position: 'fixed',
      zIndex: '2147483647',
      minWidth: '48px',
      height: '28px',
      padding: '0 10px',
      background: 'linear-gradient(180deg, #f2d77b 0%, #d4af37 100%)',
      color: '#111111',
      borderRadius: '999px',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      fontSize: '12px',
      fontWeight: '700',
      fontFamily: 'system-ui, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      transition: 'transform 0.13s ease, box-shadow 0.13s ease',
      userSelect: 'none',
      border: '1px solid rgba(255,255,255,0.35)',
      lineHeight: '1',
      whiteSpace: 'nowrap',
      pointerEvents: 'auto',
      transform: 'translate(-50%, -100%)',
      appearance: 'none',
    } as CSSStyleDeclaration)

    tipEl.textContent = ' Tip'

    tipEl.addEventListener('mouseenter', () => {
      overBtn = true
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      applyTipTransform(1.04)
    })
    tipEl.addEventListener('mouseleave', () => {
      overBtn = false
      applyTipTransform()
      scheduleHide()
    })
    tipEl.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()

      const addr = tipEl!.dataset.target
      if (!addr) return

      try {
        chrome.runtime.sendMessage({ type: 'OPEN_SEND', recipient: addr }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[ArcCopilot] sendMessage failed:', chrome.runtime.lastError.message)
          }
        })
      } catch (err) {
        console.warn('[ArcCopilot] sendMessage error:', err)
      }

      doHide()
    })

    const mountPoint = document.body ?? document.documentElement
    mountPoint.appendChild(tipEl)
    return tipEl
  }

  function showTip(address: string, anchor: HTMLElement): void {
    const btn = getTip()
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    const r = anchor.getBoundingClientRect()
    const placeBelow = r.top < 44 && window.innerHeight - r.bottom > 48
    const top = placeBelow
      ? Math.min(window.innerHeight - 8, r.bottom + 10)
      : Math.max(8, r.top - 10)
    const left = Math.min(window.innerWidth - 8, Math.max(8, r.left + r.width / 2))

    btn.dataset.target = address
    btn.dataset.placement = placeBelow ? 'below' : 'above'
    btn.style.display = 'inline-flex'
    btn.style.top = `${top}px`
    btn.style.left = `${left}px`
    applyTipTransform()
  }

  function doHide(): void {
    if (!tipEl) return
    tipEl.style.display = 'none'
    delete tipEl.dataset.target
  }

  function scheduleHide(): void {
    if (overBtn) return
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (!overBtn) doHide()
    }, HIDE_MS)
  }

  function wrapTextNode(node: Text, matches: RegExpMatchArray[]): ScanResult {
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

      const matchText = match[1]
      if (!matchText) continue

      const prefixLength = match[0].length - matchText.length
      const matchIndex = match.index ?? text.indexOf(matchText, lastIndex)
      const addressIndex = matchIndex + prefixLength
      if (addressIndex < lastIndex) continue

      if (addressIndex > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, addressIndex)))
      }

      const addr = matchText.toLowerCase()
      const span = document.createElement('span')
      span.setAttribute(MARKER_ATTR, 'address')
      span.dataset.address = addr
      span.textContent = matchText
      Object.assign(span.style, {
        backgroundColor: 'rgba(212, 175, 55, 0.12)',
        borderBottom: '1px dotted #d4af37',
        cursor: 'pointer',
        padding: '0 2px',
        borderRadius: '2px',
      } as CSSStyleDeclaration)

      const addressSpan = span
      addressSpan.addEventListener('mouseenter', () => showTip(addr, addressSpan))
      addressSpan.addEventListener('mouseleave', () => scheduleHide())

      frag.appendChild(span)
      lastIndex = addressIndex + matchText.length
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
    const matches: RegExpMatchArray[] = []

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const textNode = node as Text
        const parent = textNode.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (parent.closest(`[${MARKER_ATTR}]`)) return NodeFilter.FILTER_REJECT

        const text = textNode.textContent ?? ''
        if (!text.includes('0x')) return NodeFilter.FILTER_SKIP

        ADDRESS_RE.lastIndex = 0
        const nodeMatches = Array.from(text.matchAll(ADDRESS_RE))
        if (nodeMatches.length === 0) return NodeFilter.FILTER_SKIP

        pending.push({ node: textNode, matches: nodeMatches })
        matches.push(...nodeMatches)
        return NodeFilter.FILTER_SKIP
      },
    })

    while (walker.nextNode()) {
      // Work is done in the acceptNode callback.
    }

    if (matches.length === 0) return { matches: 0, wrapped: 0 }

    let wrapped = 0
    for (const entry of pending) {
      if (addrCount >= MAX_ADDRS) break
      if (!entry.node.isConnected) continue

      try {
        wrapped += wrapTextNode(entry.node, entry.matches).wrapped
      } catch (err) {
        console.warn('[ArcCopilot] wrap failed:', err)
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
    if (totalWrapped > 0) {
      console.log('[ArcCopilot] wrapped addresses', totalWrapped)
    }
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
      } catch (err) {
        console.warn('[ArcCopilot] scan failed:', err)
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
    } catch (err) {
      console.warn('[ArcCopilot] observer failed:', err)
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

  window.setTimeout(startScan, 1000)
  window.setTimeout(startScan, 3000)
}

try {
  main()
} catch (error) {
  console.warn('[ArcCopilot] content script fatal error:', error)
}

export {}
