import { BatchEvmScheme, CHAIN_CONFIGS } from '@circle-fin/x402-batching/client'
import { formatUnits, getAddress } from 'viem'
import { fetchWithTimeout } from '@/lib/external'
import { createGatewayBatchSigner } from '@/lib/gatewayMetamask'

export const ARC_X402_NETWORK = 'eip155:5042002'
export const MAX_X402_PAYMENT_MICROS = 1_000_000n

const ARC_X402_USDC = CHAIN_CONFIGS.arcTestnet.usdc.toLowerCase()
const ARC_X402_GATEWAY_WALLET = CHAIN_CONFIGS.arcTestnet.gatewayWallet.toLowerCase()
const X402_REQUEST_TIMEOUT_MS = 20_000

export type X402PaymentRequirements = {
  scheme: string
  network: string
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra: {
    name: string
    version: string
    verifyingContract: string
  }
}

export type X402PaymentPreview = {
  url: string
  x402Version: number
  description: string
  mimeType: string
  amountAtomic: string
  amountUsdc: string
  payTo: string
  network: string
  requirements: X402PaymentRequirements
}

export type X402PaymentResult = {
  data: unknown
  status: number
  amountUsdc: string
  payTo: string
  transaction: string
  payer: string
}

type PaymentRequiredPayload = {
  x402Version?: unknown
  resource?: {
    url?: unknown
    description?: unknown
    mimeType?: unknown
  }
  accepts?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function bytesToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToText(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function decodeHeader(value: string, label: string): unknown {
  try {
    return JSON.parse(base64ToText(value))
  } catch {
    throw new Error(`${label} header is malformed.`)
  }
}

function normalizeResourceUrl(value: string): string {
  const candidate = value.trim()
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('Enter a valid x402 resource URL.')
  }

  const isLocalhost = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !isLocalhost) {
    throw new Error('x402 resources must use HTTPS (localhost is allowed for development).')
  }
  if (url.username || url.password) {
    throw new Error('x402 resource URLs cannot contain credentials.')
  }

  url.hash = ''
  return url.toString()
}

function normalizeRequirements(value: unknown): X402PaymentRequirements | null {
  if (!isRecord(value) || !isRecord(value.extra)) return null

  const scheme = typeof value.scheme === 'string' ? value.scheme : ''
  const network = typeof value.network === 'string' ? value.network : ''
  const asset = typeof value.asset === 'string' ? value.asset : ''
  const amount = typeof value.amount === 'string' ? value.amount : ''
  const payTo = typeof value.payTo === 'string' ? value.payTo : ''
  const maxTimeoutSeconds = typeof value.maxTimeoutSeconds === 'number' ? value.maxTimeoutSeconds : Number.NaN
  const name = typeof value.extra.name === 'string' ? value.extra.name : ''
  const version = typeof value.extra.version === 'string' ? value.extra.version : ''
  const verifyingContract = typeof value.extra.verifyingContract === 'string' ? value.extra.verifyingContract : ''

  if (scheme !== 'exact' || network !== ARC_X402_NETWORK) return null
  if (asset.toLowerCase() !== ARC_X402_USDC) return null
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) > MAX_X402_PAYMENT_MICROS) return null
  if (name !== 'GatewayWalletBatched' || version !== '1') return null
  if (verifyingContract.toLowerCase() !== ARC_X402_GATEWAY_WALLET) return null
  if (!Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds < 604_800 || maxTimeoutSeconds > 1_209_600) return null

  try {
    return {
      scheme,
      network,
      asset: getAddress(asset),
      amount,
      payTo: getAddress(payTo),
      maxTimeoutSeconds,
      extra: {
        name,
        version,
        verifyingContract: getAddress(verifyingContract),
      },
    }
  } catch {
    return null
  }
}

function paymentFingerprint(preview: X402PaymentPreview): string {
  const requirement = preview.requirements
  return JSON.stringify({
    url: preview.url,
    x402Version: preview.x402Version,
    scheme: requirement.scheme,
    network: requirement.network,
    asset: requirement.asset.toLowerCase(),
    amount: requirement.amount,
    payTo: requirement.payTo.toLowerCase(),
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    name: requirement.extra.name,
    version: requirement.extra.version,
    verifyingContract: requirement.extra.verifyingContract.toLowerCase(),
  })
}

async function readResponseData(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (isRecord(data)) {
    for (const key of ['message', 'error', 'reason']) {
      const value = data[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return fallback
}

export function sanitizeX402PaymentPreview(value: unknown): X402PaymentPreview | null {
  if (!isRecord(value)) return null

  const url = typeof value.url === 'string' ? value.url : ''
  const x402Version = typeof value.x402Version === 'number' ? value.x402Version : Number.NaN
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim() : ''
  const requirements = normalizeRequirements(value.requirements)
  if (!requirements || x402Version !== 2) return null

  try {
    const normalizedUrl = normalizeResourceUrl(url)
    return {
      url: normalizedUrl,
      x402Version,
      description: description || 'Paid x402 resource',
      mimeType: mimeType || 'application/json',
      amountAtomic: requirements.amount,
      amountUsdc: formatUnits(BigInt(requirements.amount), 6),
      payTo: requirements.payTo,
      network: requirements.network,
      requirements,
    }
  } catch {
    return null
  }
}

export async function inspectX402Resource(resourceUrl: string): Promise<X402PaymentPreview> {
  const url = normalizeResourceUrl(resourceUrl)
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, X402_REQUEST_TIMEOUT_MS)

  if (response.status !== 402) {
    const data = await readResponseData(response)
    if (response.ok) {
      throw new Error('This resource is available without an x402 payment.')
    }
    throw new Error(extractErrorMessage(data, `x402 discovery failed with HTTP ${response.status}.`))
  }

  const paymentRequiredHeader = response.headers.get('Payment-Required')
  if (!paymentRequiredHeader) {
    throw new Error('The 402 response did not expose a Payment-Required header.')
  }

  const payload = decodeHeader(paymentRequiredHeader, 'Payment-Required') as PaymentRequiredPayload
  if (!isRecord(payload) || payload.x402Version !== 2 || !Array.isArray(payload.accepts)) {
    throw new Error('The server returned unsupported x402 terms.')
  }

  const requirements = payload.accepts
    .map((candidate) => normalizeRequirements(candidate))
    .find((candidate): candidate is X402PaymentRequirements => candidate !== null)

  if (!requirements) {
    throw new Error('No safe Arc Testnet Gateway payment option was found (maximum 1 USDC).')
  }

  return {
    url,
    x402Version: 2,
    description: typeof payload.resource?.description === 'string' && payload.resource.description.trim()
      ? payload.resource.description.trim()
      : 'Paid x402 resource',
    mimeType: typeof payload.resource?.mimeType === 'string' && payload.resource.mimeType.trim()
      ? payload.resource.mimeType.trim()
      : 'application/json',
    amountAtomic: requirements.amount,
    amountUsdc: formatUnits(BigInt(requirements.amount), 6),
    payTo: requirements.payTo,
    network: requirements.network,
    requirements,
  }
}

export async function payX402Resource(previewInput: X402PaymentPreview): Promise<X402PaymentResult> {
  const preview = sanitizeX402PaymentPreview(previewInput)
  if (!preview) throw new Error('The saved x402 quote is invalid. Inspect the resource again.')

  const refreshed = await inspectX402Resource(preview.url)
  if (paymentFingerprint(refreshed) !== paymentFingerprint(preview)) {
    throw new Error('The x402 payment terms changed. Review the new quote before signing.')
  }

  const amount = BigInt(refreshed.requirements.amount)
  const signer = await createGatewayBatchSigner(amount)
  const scheme = new BatchEvmScheme(signer)
  const paymentPayload = await scheme.createPaymentPayload(refreshed.x402Version, refreshed.requirements)
  const paymentHeader = bytesToBase64(JSON.stringify({
    ...paymentPayload,
    resource: {
      url: refreshed.url,
      description: refreshed.description,
      mimeType: refreshed.mimeType,
    },
    accepted: refreshed.requirements,
  }))

  const response = await fetchWithTimeout(refreshed.url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Payment-Signature': paymentHeader,
    },
  }, X402_REQUEST_TIMEOUT_MS)
  const data = await readResponseData(response)

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, `x402 payment failed with HTTP ${response.status}.`))
  }

  let transaction = ''
  let payer: string = signer.address
  const paymentResponseHeader = response.headers.get('Payment-Response')
  if (paymentResponseHeader) {
    const settlement = decodeHeader(paymentResponseHeader, 'Payment-Response')
    if (isRecord(settlement)) {
      transaction = typeof settlement.transaction === 'string' ? settlement.transaction : ''
      payer = typeof settlement.payer === 'string' ? settlement.payer : payer
    }
  }

  return {
    data,
    status: response.status,
    amountUsdc: refreshed.amountUsdc,
    payTo: refreshed.payTo,
    transaction,
    payer,
  }
}
