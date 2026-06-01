/**
 * ArcCopilot - Universal Tip Button
 * Scans web pages for Ethereum addresses and adds a hover tip button.
 */

function main(): void {
  console.log('[ArcCopilot] content script loaded', location.href)

  // Standalone addresses only:
  // - 0x + 40 hex chars => match
  // - 0x + 64 hex chars (tx hash) => no match
  // - shortened forms like 0x1234...abcd => no match
  const ADDRESS_RE = /(?:^|[^a-fA-F0-9])(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/g
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

  let tipEl: HTMLButtonElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let scanTimer: ReturnType<typeof setTimeout> | null = null
  let scanQueued = false
  let addrCount = 0
  let overBtn = false

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

  function wrapTextNode(node: Text, matches: RegExpMatchArray[]): number {
    const text = node.textContent ?? ''
    const parent = node.parentElement
    if (!parent) return 0
    if (SKIP_TAGS.has(parent.tagName)) return 0
    if (parent.closest(`[${MARKER_ATTR}]`)) return 0

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

    if (wrapped === 0) return 0

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    parent.replaceChild(frag, node)
    return wrapped
  }

  function scanDocumentBody(): void {
    const body = document.body
    if (!body || addrCount >= MAX_ADDRS) return

    const pending: PendingMatch[] = []
    const matches: RegExpMatchArray[] = []

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
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
      // The work is done in the acceptNode callback.
    }

    console.log('[ArcCopilot] address matches found', matches.length)
    if (matches.length === 0) return

    let wrapped = 0
    for (const entry of pending) {
      if (addrCount >= MAX_ADDRS) break
      if (!entry.node.isConnected) continue

      try {
        wrapped += wrapTextNode(entry.node, entry.matches)
      } catch (err) {
        console.warn('[ArcCopilot] wrap failed:', err)
      }
    }

    if (wrapped > 0) {
      console.log('[ArcCopilot] wrapped addresses', wrapped)
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
        scanDocumentBody()
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
