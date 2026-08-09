import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { X402_PAYMENT_HISTORY_STORAGE_KEY } from '@/lib/storageKeys'
import { isValidAddress } from '@/lib/validation'

export type X402PaymentHistoryStatus = 'quoted' | 'paid' | 'failed'

export type X402PaymentHistoryEntry = {
  id: string
  url: string
  description: string
  amountUsdc: string
  payTo: string
  network: string
  status: X402PaymentHistoryStatus
  createdAt: number
  updatedAt: number
  paidAt?: number
  failedAt?: number
  payer?: string
  paymentId?: string
  transaction?: string
  txHash?: string
  nonce?: string
  repeatCount?: number
  error?: string
}

const MAX_X402_HISTORY = 40

function normalizeEntry(value: unknown): X402PaymentHistoryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<X402PaymentHistoryEntry>
  if (!candidate.id || !candidate.url || !candidate.description || !candidate.amountUsdc || !candidate.payTo || !candidate.network) return null
  if (!['quoted', 'paid', 'failed'].includes(String(candidate.status))) return null
  if (!isValidAddress(candidate.payTo)) return null
  const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now()
  const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : createdAt
  return {
    id: candidate.id,
    url: candidate.url,
    description: candidate.description,
    amountUsdc: candidate.amountUsdc,
    payTo: candidate.payTo.toLowerCase(),
    network: candidate.network,
    status: candidate.status as X402PaymentHistoryStatus,
    createdAt,
    updatedAt,
    paidAt: typeof candidate.paidAt === 'number' ? candidate.paidAt : undefined,
    failedAt: typeof candidate.failedAt === 'number' ? candidate.failedAt : undefined,
    payer: typeof candidate.payer === 'string' ? candidate.payer : undefined,
    paymentId: typeof candidate.paymentId === 'string' ? candidate.paymentId : undefined,
    transaction: typeof candidate.transaction === 'string' ? candidate.transaction : undefined,
    txHash: typeof candidate.txHash === 'string' ? candidate.txHash : undefined,
    nonce: typeof candidate.nonce === 'string' ? candidate.nonce : undefined,
    repeatCount: typeof candidate.repeatCount === 'number' ? candidate.repeatCount : undefined,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
  }
}

function fingerprint(input: Pick<X402PaymentHistoryEntry, 'url' | 'amountUsdc' | 'payTo' | 'network'>): string {
  return [
    input.url.trim().toLowerCase(),
    input.amountUsdc.trim(),
    input.payTo.trim().toLowerCase(),
    input.network.trim().toLowerCase(),
  ].join('|')
}

export async function listX402PaymentHistory(): Promise<X402PaymentHistoryEntry[]> {
  const stored: Record<string, unknown> = await chromeStorageGet(X402_PAYMENT_HISTORY_STORAGE_KEY).catch(() => ({}))
  const raw = stored[X402_PAYMENT_HISTORY_STORAGE_KEY]
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeEntry)
    .filter((entry): entry is X402PaymentHistoryEntry => Boolean(entry))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_X402_HISTORY)
}

export async function saveX402PaymentHistory(entries: X402PaymentHistoryEntry[]): Promise<void> {
  const normalized = entries
    .map(normalizeEntry)
    .filter((entry): entry is X402PaymentHistoryEntry => Boolean(entry))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_X402_HISTORY)
  await chromeStorageSet({ [X402_PAYMENT_HISTORY_STORAGE_KEY]: normalized })
}

export async function upsertX402PaymentHistory(entry: Omit<X402PaymentHistoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'repeatCount'> & Partial<Pick<X402PaymentHistoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'repeatCount'>>): Promise<X402PaymentHistoryEntry> {
  const now = Date.now()
  const current = await listX402PaymentHistory()
  const key = fingerprint(entry)
  const existing = current.find((item) => item.id === entry.id || fingerprint(item) === key)
  const paidRepeats = current.filter((item) => fingerprint(item) === key && item.status === 'paid').length
  const next: X402PaymentHistoryEntry = {
    ...(existing ?? {}),
    ...entry,
    id: entry.id ?? existing?.id ?? `x402-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: entry.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now,
    repeatCount: entry.status === 'paid' ? Math.max(paidRepeats, existing?.repeatCount ?? 0) + (existing?.status === 'paid' ? 0 : 1) : existing?.repeatCount ?? entry.repeatCount,
  }
  await saveX402PaymentHistory([next, ...current.filter((item) => item.id !== next.id)])
  return next
}
