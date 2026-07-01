import { BLOCKSCOUT_API_BASE, GEMINI_MODEL, USDC_CONTRACT } from '@/lib/constants'
import { debugWarn } from '@/lib/debug'
import { chromeStorageGet, fetchWithTimeout } from '@/lib/external'
import { fetchUsdcBalance } from '@/lib/hooks/useUSDCBalance'
import { gatewayBalance, type GatewayBalanceSnapshot } from '@/lib/gatewayMetamask'
import { listCreators, normalizeCreatorHandle } from '@/lib/creatorRegistry'
import { getLocalePromptLanguage, getLocaleSync, t } from '@/lib/i18n'
import { GEMINI_API_KEY_STORAGE_KEY, TIP_BUDGET } from '@/lib/storageKeys'
import { useStore } from '@/lib/store'
import { formatAddress } from '@/lib/utils'

const USDC_DECIMALS = 6
const PORTFOLIO_TRANSFER_LIMIT = 5

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

type StoredTipBudgetState = {
  log?: unknown
}

type StoredTipBudgetEntry = {
  handle?: unknown
  amount?: unknown
  timestamp?: unknown
}

export type PortfolioIntelRecipient = {
  handle: string | null
  address: string | null
  total: string | null
}

export type PortfolioIntelAvailability = {
  walletUsdc: boolean
  gateway: boolean
  tipHistory: boolean
  txHistory: boolean
}

export type PortfolioIntelSources = {
  walletUsdc: 'rpc' | 'gateway' | 'missing'
  gateway: 'gateway' | 'missing'
  tipHistory: 'chrome.storage.local' | 'missing'
  txHistory: 'blockscout' | 'missing'
}

export type PortfolioIntelMode = 'ai' | 'fallback' | 'unavailable'

export type PortfolioIntelResult = {
  walletUsdc: string | null
  gatewayAvailable: string | null
  gatewayTotal: string | null
  spendableUsdc: string | null
  recentTipTotal: string | null
  topRecipients: PortfolioIntelRecipient[]
  txCount: number | null
  read: string
  mode: PortfolioIntelMode
  fetchedAt: number
  available: PortfolioIntelAvailability
  sources: PortfolioIntelSources
}

type PortfolioIntelPromptRecipient = {
  handle: string | null
  address: string | null
  total: string | null
}

type PortfolioIntelPromptData = {
  walletUsdc: string | null
  gatewayAvailable: string | null
  gatewayTotal: string | null
  spendableUsdc: string | null
  recentTipTotal: string | null
  topRecipients: PortfolioIntelPromptRecipient[]
  txCount: number | null
}

type TipHistoryAggregate = {
  available: boolean
  entryCount: number
  totalMicros: bigint | null
  recipients: PortfolioIntelRecipient[]
}

function normalizeAddress(address: string | null | undefined): string {
  return (address ?? '').trim().toLowerCase()
}

function normalizeUsdcAmountText(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const withoutCurrency = trimmed.replace(/\s*USDC$/i, '').trim()
  return withoutCurrency.replace(/,/g, '.')
}

function parseUsdcToMicros(value: string | number | bigint | null | undefined): bigint | null {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : null
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    return BigInt(Math.round(value * 10 ** USDC_DECIMALS))
  }

  if (typeof value !== 'string') return null

  const normalized = normalizeUsdcAmountText(value)
  if (!normalized) return null
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null

  const [wholePart, fractionPart = ''] = normalized.split('.')
  try {
    const whole = BigInt(wholePart)
    const fraction = fractionPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)
    return (whole * 10n ** BigInt(USDC_DECIMALS)) + BigInt(fraction || '0')
  } catch {
    return null
  }
}

function formatMicrosToUsdc(value: bigint): string {
  const whole = value / 10n ** BigInt(USDC_DECIMALS)
  const fraction = value % 10n ** BigInt(USDC_DECIMALS)
  if (fraction === 0n) return whole.toString()

  const fractionText = fraction.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fractionText}`
}

function sumUsdcValues(values: Array<string | number | bigint | null | undefined>): bigint | null {
  let total = 0n
  let hasValue = false

  for (const value of values) {
    const micros = parseUsdcToMicros(value)
    if (micros == null) continue
    total += micros
    hasValue = true
  }

  return hasValue ? total : null
}

function canUseTipHistory(raw: unknown): raw is StoredTipBudgetState {
  return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw)
}

async function getGeminiApiKey(): Promise<string | null> {
  try {
    const result = await chromeStorageGet(GEMINI_API_KEY_STORAGE_KEY)
    const raw = result[GEMINI_API_KEY_STORAGE_KEY]
    const key = typeof raw === 'string' ? raw.trim() : ''
    return key || null
  } catch {
    return null
  }
}

async function readTipHistory(): Promise<TipHistoryAggregate> {
  try {
    const stored = await chromeStorageGet(TIP_BUDGET)
    const hasKey = Object.prototype.hasOwnProperty.call(stored, TIP_BUDGET)
    if (!hasKey) {
      return {
        available: false,
        entryCount: 0,
        totalMicros: null,
        recipients: [],
      }
    }

    const raw = stored[TIP_BUDGET]
    if (!canUseTipHistory(raw)) {
      return {
        available: false,
        entryCount: 0,
        totalMicros: null,
        recipients: [],
      }
    }

    if (!Array.isArray(raw.log)) {
      return {
        available: false,
        entryCount: 0,
        totalMicros: null,
        recipients: [],
      }
    }

    const entries = raw.log
      .map((entry): { handle: string; amountMicros: bigint } | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
        const typed = entry as StoredTipBudgetEntry
        const handle = typeof typed.handle === 'string' ? normalizeCreatorHandle(typed.handle) : ''
        const amountMicros =
          typeof typed.amount === 'string' || typeof typed.amount === 'number' || typeof typed.amount === 'bigint'
            ? parseUsdcToMicros(typed.amount)
            : null
        if (!handle || amountMicros == null) return null
        return { handle, amountMicros }
      })
      .filter((entry): entry is { handle: string; amountMicros: bigint } => Boolean(entry))

    if (entries.length === 0) {
      return {
        available: true,
        entryCount: 0,
        totalMicros: 0n,
        recipients: [],
      }
    }

    const creatorWallets = new Map<string, string>()
    try {
      const creators = await listCreators()
      for (const creator of creators) {
        creatorWallets.set(normalizeCreatorHandle(creator.handle), creator.address.toLowerCase())
      }
    } catch (error) {
      debugWarn('[PORTFOLIO] creator registry lookup failed:', error)
    }

    const totals = new Map<string, { totalMicros: bigint; count: number }>()
    for (const entry of entries) {
      const current = totals.get(entry.handle) ?? { totalMicros: 0n, count: 0 }
      totals.set(entry.handle, {
        totalMicros: current.totalMicros + entry.amountMicros,
        count: current.count + 1,
      })
    }

    const recipients = Array.from(totals.entries())
      .map(([handle, value]) => ({
        handle,
        address: creatorWallets.get(handle) ?? null,
        totalMicros: value.totalMicros,
        count: value.count,
      }))
      .sort((left, right) => {
        if (left.totalMicros === right.totalMicros) return left.handle.localeCompare(right.handle)
        return left.totalMicros > right.totalMicros ? -1 : 1
      })
      .slice(0, 5)
      .map(({ handle, address, totalMicros }) => ({
        handle,
        address,
        total: formatMicrosToUsdc(totalMicros),
      }))

    const totalMicros = entries.reduce((acc, entry) => acc + entry.amountMicros, 0n)

    return {
      available: true,
      entryCount: entries.length,
      totalMicros,
      recipients,
    }
  } catch (error) {
    debugWarn('[PORTFOLIO] tip history read failed:', error)
    return {
      available: false,
      entryCount: 0,
      totalMicros: null,
      recipients: [],
    }
  }
}

async function fetchRecentOnChainTransferCount(address: string): Promise<number | null> {
  const normalized = normalizeAddress(address)
  if (!normalized) return null

  try {
    const response = await fetchWithTimeout(`${BLOCKSCOUT_API_BASE}/addresses/${normalized}/token-transfers?type=ERC-20&token=${USDC_CONTRACT}`, {
      headers: { accept: 'application/json' },
    })

    if (!response.ok) {
      debugWarn('[PORTFOLIO] on-chain transfer fetch failed:', response.status)
      return null
    }

    const json = await response.json() as { items?: unknown[] }
    const items = Array.isArray(json.items) ? json.items : []
    return items.slice(0, PORTFOLIO_TRANSFER_LIMIT).length
  } catch (error) {
    debugWarn('[PORTFOLIO] on-chain transfer read failed:', error)
    return null
  }
}

function buildPromptPayload(data: PortfolioIntelResult): PortfolioIntelPromptData {
  return {
    walletUsdc: data.walletUsdc,
    gatewayAvailable: data.gatewayAvailable,
    gatewayTotal: data.gatewayTotal,
    spendableUsdc: data.spendableUsdc,
    recentTipTotal: data.recentTipTotal,
    topRecipients: data.topRecipients.map((recipient) => ({
      handle: recipient.handle,
      address: recipient.address,
      total: recipient.total,
    })),
    txCount: data.txCount,
  }
}

function pickTopRecipientName(recipient: PortfolioIntelRecipient): string {
  if (recipient.handle) return `@${recipient.handle}`
  if (recipient.address) return formatAddress(recipient.address, 4)
  return t('common.unknown')
}

function formatRecipientList(recipients: PortfolioIntelRecipient[]): string {
  if (recipients.length === 0) return ''
  if (recipients.length === 1) {
    return `${pickTopRecipientName(recipients[0])} (${recipients[0].total ?? t('common.unknown')} USDC)`
  }

  return recipients
    .slice(0, 3)
    .map((recipient) => `${pickTopRecipientName(recipient)} (${recipient.total ?? t('common.unknown')} USDC)`)
    .join(', ')
}

function buildFallbackPortfolioRead(data: PortfolioIntelResult): string {
  const locale = getLocaleSync()
  const isTurkish = locale === 'tr'
  const wallet = data.walletUsdc
  const gatewayAvailable = data.gatewayAvailable
  const gatewayTotal = data.gatewayTotal
  const spendable = data.spendableUsdc
  const recentTipTotal = data.recentTipTotal
  const topRecipients = data.topRecipients
  const txCount = data.txCount

  const sentences: string[] = []

  if (wallet && gatewayAvailable && gatewayTotal && spendable) {
    sentences.push(isTurkish
      ? `Cüzdanında ${wallet} USDC var ve Gateway’de ${gatewayAvailable} USDC kullanıma hazır (${gatewayTotal} USDC toplam). Bu da elindeki gerçek harcanabilir pozisyonun ${spendable} USDC olduğu anlamına geliyor.`
      : `You have ${wallet} USDC in your wallet and ${gatewayAvailable} USDC available in Gateway (${gatewayTotal} USDC total there). That gives you ${spendable} USDC in real spendable balance.`
    )
  } else if (wallet && gatewayAvailable && gatewayTotal) {
    sentences.push(isTurkish
      ? `Cüzdanında ${wallet} USDC var ve Gateway’de ${gatewayAvailable} USDC kullanıma hazır (${gatewayTotal} USDC toplam).`
      : `You have ${wallet} USDC in your wallet and ${gatewayAvailable} USDC available in Gateway (${gatewayTotal} USDC total there).`
    )
  } else if (wallet) {
    sentences.push(isTurkish
      ? `Cüzdan bakiyen ${wallet} USDC.`
      : `Your wallet balance is ${wallet} USDC.`
    )
  } else if (gatewayAvailable && gatewayTotal) {
    sentences.push(isTurkish
      ? `Gateway’de ${gatewayAvailable} USDC kullanıma hazır ve toplam Gateway bakiyesi ${gatewayTotal} USDC.`
      : `Gateway has ${gatewayAvailable} USDC available out of ${gatewayTotal} USDC total.`
    )
  } else {
    sentences.push(isTurkish
      ? 'Canlı cüzdan veya Gateway bakiyesini şu anda okuyamadım.'
      : 'I could not read your live wallet or Gateway balances right now.'
    )
  }

  if (data.recentTipTotal == null) {
    sentences.push(isTurkish
      ? 'Kaydedilmiş tip geçmişine şu anda erişemiyorum, bu yüzden kime ne kadar destek verdiğini tahmin etmiyorum.'
      : 'I cannot access your saved tip history right now, so I will not guess who you support most.'
    )
  } else if (topRecipients.length === 0) {
    sentences.push(isTurkish
      ? `Kaydedilmiş tip toplamın ${recentTipTotal} USDC ama henüz öne çıkan bir alıcı yok.`
      : `Your saved tip total is ${recentTipTotal} USDC, but there is no clear top recipient yet.`
    )
  } else {
    sentences.push(isTurkish
      ? `Kaydedilmiş tip logun toplam ${recentTipTotal} USDC; en çok desteklediğin kişi ${formatRecipientList(topRecipients)}.`
      : `Your saved tip log totals ${recentTipTotal} USDC, led by ${formatRecipientList(topRecipients)}.`
    )
  }

  const topRecipient = topRecipients[0] ?? null
  const topTotalMicros = topRecipient?.total ? parseUsdcToMicros(topRecipient.total) : null
  const recentTipMicros = recentTipTotal ? parseUsdcToMicros(recentTipTotal) : null

  const observation = (() => {
    if (data.recentTipTotal != null && recentTipMicros != null && topTotalMicros != null && recentTipMicros > 0n) {
      const share = Number(topTotalMicros) / Number(recentTipMicros)
      if (share >= 0.5) {
        return isTurkish
          ? `Dikkat çekici olan, tiplerinin çoğu ${pickTopRecipientName(topRecipient)} üzerinde yoğunlaşmış görünüyor.`
          : `The notable pattern is that most of your tips are concentrated on ${pickTopRecipientName(topRecipient)}.`
      }

      return isTurkish
        ? 'Tiplerin birkaç alıcıya yayılmış görünüyor; destek tek bir yere sıkışmış değil.'
        : 'Your tips are spread across multiple recipients, so your support is not concentrated in one place.'
    }

    if (gatewayAvailable && data.recentTipTotal != null && recentTipMicros != null) {
      const gatewayMicros = parseUsdcToMicros(gatewayAvailable)
      if (gatewayMicros != null && gatewayMicros < recentTipMicros) {
        return isTurkish
          ? 'Gateway kullanılabilir bakiyesi, kaydedilmiş tip toplamının altında kaldığı için mevcut tempo sıkı görünüyor.'
          : 'Your available Gateway balance is below your recorded tip total, so the current pace looks tight.'
      }

      return isTurkish
        ? 'Gateway bakiyesi, kaydedilmiş tip ritmini şimdilik taşıyabilecek durumda görünüyor.'
        : 'Your Gateway balance looks able to carry your recorded tip pace for now.'
    }

    if (txCount != null) {
      return isTurkish
        ? `On-chain tarafta son ${txCount} USDC transferini doğruladım, ama tip geçmişi olmadan daha fazlasını çıkarım yapmıyorum.`
        : `I confirmed ${txCount} recent on-chain USDC transfers, but I am not inferring more without tip history.`
    }

    return isTurkish
      ? 'On-chain transfer verisi de şu anda erişilebilir değil.'
      : 'Recent on-chain transfer data is also unavailable right now.'
  })()

  sentences.push(observation)

  return sentences.slice(0, 4).join(' ')
}

async function callGeminiPortfolioRead(data: PortfolioIntelResult): Promise<string | null> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return null

  const language = getLocalePromptLanguage(getLocaleSync())
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  const body = {
    systemInstruction: {
      parts: [{
        text: [
          'You write short portfolio reads for ArcCopilot.',
          'Use only the supplied real data.',
          'Do not invent balances, totals, recipients, transaction counts, or time windows.',
          'If a value is null or unavailable, say that plainly instead of guessing.',
          'Write 2-4 short sentences in plain text only.',
          'No bullets, markdown, headings, or emojis.',
          `Write in ${language}.`,
        ].join(' '),
      }],
    },
    contents: [{
      role: 'user',
      parts: [{
        text: [
          'Portfolio data:',
          JSON.stringify(buildPromptPayload(data)),
        ].join('\n'),
      }],
    }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.95,
    },
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      debugWarn('[PORTFOLIO] AI request failed:', response.status)
      return null
    }

    const result = await response.json() as GeminiResponse
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    if (!text) return null
    return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } catch (error) {
    debugWarn('[PORTFOLIO] AI request failed:', error)
    return null
  }
}

function buildEmptyPortfolioRead(): string {
  return t('portfolio.intelNoData')
}

export async function buildPortfolioIntel(): Promise<PortfolioIntelResult> {
  const state = useStore.getState()
  const walletAddress = normalizeAddress(state.walletAddress)
  const now = Date.now()

  const [walletRpc, gatewaySnapshot, tipHistory, txCount] = await Promise.all([
    walletAddress
      ? fetchUsdcBalance(walletAddress).catch((error) => {
          debugWarn('[PORTFOLIO] wallet balance fetch failed:', error)
          return null
        })
      : Promise.resolve<string | null>(null),
    walletAddress
      ? gatewayBalance().catch((error) => {
          debugWarn('[PORTFOLIO] gateway balance fetch failed:', error)
          return null
        })
      : Promise.resolve<GatewayBalanceSnapshot | null>(null),
    readTipHistory(),
    walletAddress
      ? fetchRecentOnChainTransferCount(walletAddress)
      : Promise.resolve<number | null>(null),
  ])

  const walletUsdc = walletRpc ?? gatewaySnapshot?.wallet.formattedBalance ?? null
  const gatewayAvailable = gatewaySnapshot?.gateway.formattedAvailable ?? null
  const gatewayTotal = gatewaySnapshot?.gateway.formattedTotal ?? null
  const spendableUsdc = sumUsdcValues([walletUsdc, gatewayAvailable])

  const data: PortfolioIntelResult = {
    walletUsdc,
    gatewayAvailable,
    gatewayTotal,
    spendableUsdc: spendableUsdc != null ? formatMicrosToUsdc(spendableUsdc) : null,
    recentTipTotal: tipHistory.totalMicros != null ? formatMicrosToUsdc(tipHistory.totalMicros) : null,
    topRecipients: tipHistory.recipients,
    txCount,
    read: '',
    mode: 'unavailable',
    fetchedAt: now,
    available: {
      walletUsdc: Boolean(walletUsdc),
      gateway: Boolean(gatewayAvailable && gatewayTotal),
      tipHistory: tipHistory.available,
      txHistory: txCount != null,
    },
    sources: {
      walletUsdc: walletRpc != null ? 'rpc' : gatewaySnapshot != null ? 'gateway' : 'missing',
      gateway: gatewaySnapshot != null ? 'gateway' : 'missing',
      tipHistory: tipHistory.available ? 'chrome.storage.local' : 'missing',
      txHistory: txCount != null ? 'blockscout' : 'missing',
    },
  }

  console.log('[PORTFOLIO]', {
    status: 'data',
    available: data.available,
    sources: data.sources,
    counts: {
      tipHistoryEntries: tipHistory.entryCount,
      txCount,
    },
  })

  if (!data.available.walletUsdc && !data.available.gateway && !data.available.tipHistory && !data.available.txHistory) {
    data.read = buildEmptyPortfolioRead()
    data.mode = 'unavailable'
    console.log('[PORTFOLIO]', { status: 'unavailable', available: data.available, sources: data.sources })
    return data
  }

  const aiText = await callGeminiPortfolioRead(data)
  data.mode = aiText ? 'ai' : 'fallback'
  data.read = aiText ?? buildFallbackPortfolioRead(data)

  console.log('[PORTFOLIO]', {
    status: 'generated',
    mode: data.mode,
    available: data.available,
    sources: data.sources,
  })

  return data
}
