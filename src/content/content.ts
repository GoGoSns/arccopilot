/**
 * ArcCopilot — Universal Tip Button
 * Scans web pages for Ethereum addresses, adds a hover tip button.
 */

const ADDRESS_RE  = /\b(0x[a-fA-F0-9]{40})\b/g
const MARKER_ATTR = 'data-arccopilot'
const MAX_ADDRS   = 100
const THROTTLE_MS = 200
const HIDE_MS     = 200

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME',
  'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
  'CODE', 'PRE', 'KBD', 'SAMP',
])

// ─── state ──────────────────────────────────────────────────────────────────
let tipEl: HTMLElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let scanTimer: ReturnType<typeof setTimeout> | null = null
let addrCount = 0
let overBtn   = false

// ─── tip button ─────────────────────────────────────────────────────────────
function getTip(): HTMLElement {
  if (tipEl) return tipEl

  tipEl = document.createElement('div')
  Object.assign(tipEl.style, {
    position: 'absolute',
    zIndex:   '2147483647',
    width: '26px', height: '26px',
    background: '#d4af37',
    color: '#0a0a0f',
    borderRadius: '50%',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '13px', fontWeight: 'bold',
    fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
    transition: 'transform 0.13s ease',
    userSelect: 'none',
    border: '2px solid rgba(255,255,255,0.25)',
    lineHeight: '1',
  } as CSSStyleDeclaration)

  tipEl.textContent = 'A'
  tipEl.setAttribute('title', 'Tip with Arc')
  tipEl.setAttribute('role', 'button')
  tipEl.setAttribute('aria-label', 'Send USDC tip via ArcCopilot')

  tipEl.addEventListener('mouseenter', () => {
    overBtn = true
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    tipEl!.style.transform = 'scale(1.15)'
  })
  tipEl.addEventListener('mouseleave', () => {
    overBtn = false
    tipEl!.style.transform = 'scale(1)'
    scheduleHide()
  })
  tipEl.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const addr = tipEl!.dataset.target
    if (addr) {
      chrome.runtime.sendMessage({ type: 'OPEN_SEND', recipient: addr })
      doHide()
    }
  })

  document.documentElement.appendChild(tipEl)
  return tipEl
}

function showTip(address: string, anchor: HTMLElement): void {
  const btn = getTip()
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }

  const r = anchor.getBoundingClientRect()
  const sx = window.scrollX, sy = window.scrollY

  btn.dataset.target = address
  btn.style.display  = 'flex'
  btn.style.top  = `${sy + r.top - 32}px`
  btn.style.left = `${sx + r.left + r.width / 2 - 13}px`
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

// ─── wrapping ───────────────────────────────────────────────────────────────
function wrapTextNode(node: Text): void {
  const text = node.textContent ?? ''
  ADDRESS_RE.lastIndex = 0
  if (!ADDRESS_RE.test(text)) return
  ADDRESS_RE.lastIndex = 0

  const parent = node.parentElement
  if (!parent) return
  if (SKIP_TAGS.has(parent.tagName)) return
  if (parent.closest(`[${MARKER_ATTR}]`)) return

  const frag = document.createDocumentFragment()
  let last = 0
  let match: RegExpExecArray | null

  while ((match = ADDRESS_RE.exec(text)) !== null) {
    if (addrCount >= MAX_ADDRS) break

    // prefix text
    if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)))

    const addr = match[1].toLowerCase()
    const span = document.createElement('span')
    span.setAttribute(MARKER_ATTR, '1')
    span.dataset.address = addr
    span.textContent = match[1]
    Object.assign(span.style, {
      borderBottom: '1px dotted #d4af37',
      cursor: 'pointer',
      padding: '0 2px',
      borderRadius: '2px',
    } as CSSStyleDeclaration)

    const s = span        // close over local ref
    const a = addr
    s.addEventListener('mouseenter', () => showTip(a, s))
    s.addEventListener('mouseleave', () => scheduleHide())

    frag.appendChild(span)
    last = match.index + match[1].length
    addrCount++
  }

  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))

  if (last > 0) parent.replaceChild(frag, node)
}

function scanRoot(root: Node): void {
  if (addrCount >= MAX_ADDRS) return
  if (!(root instanceof Element || root instanceof Document)) return

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = (node as Text).parentElement
      if (!p) return NodeFilter.FILTER_REJECT
      if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT
      if (p.closest(`[${MARKER_ATTR}]`)) return NodeFilter.FILTER_REJECT
      const t = node.textContent ?? ''
      if (!t.includes('0x')) return NodeFilter.FILTER_SKIP
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes: Text[] = []
  let cur: Node | null
  while ((cur = walker.nextNode())) nodes.push(cur as Text)

  // Iterate forwards — replaceChild shifts siblings, so we collected all first
  for (const n of nodes) {
    if (addrCount >= MAX_ADDRS) break
    if (!n.isConnected) continue
    try { wrapTextNode(n) } catch { /* node removed mid-flight */ }
  }
}

function scheduleScan(target: Node = document.body): void {
  if (scanTimer !== null) return
  scanTimer = setTimeout(() => {
    scanTimer = null
    scanRoot(target)
  }, THROTTLE_MS)
}

// ─── boot ────────────────────────────────────────────────────────────────────
scheduleScan()

const observer = new MutationObserver((muts) => {
  if (addrCount >= MAX_ADDRS) { observer.disconnect(); return }
  for (const m of muts) {
    if (m.type !== 'childList') continue
    for (const n of m.addedNodes) {
      if (n.nodeType === Node.ELEMENT_NODE) scheduleScan(n)
    }
  }
})

observer.observe(document.body, { childList: true, subtree: true })

export {}
