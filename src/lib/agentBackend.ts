import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { formatText, t } from '@/lib/i18n'
import {
  AGENT_BACKEND_URL,
  AGENT_TOKEN,
  AUTONOMOUS_MODE_ENABLED,
} from '@/lib/storageKeys'

export const DEFAULT_AGENT_BACKEND_URL = 'https://web-production-66fa5.up.railway.app'
const AGENT_REQUEST_TIMEOUT_MS = 10_000

export interface AgentBackendConfig {
  enabled: boolean
  backendUrl: string | null
  token: string | null
}

export interface AgentTipResult {
  state: string
  txHash: string
  arcscanUrl: string
}

export function logAutoTipStart(path: string, enabled: boolean, recipient: string, amount: string): void {
  console.log(`[AUTO] enabled=${enabled} path=${path} recipient=${recipient} amount=${amount}`)
}

export function logAutoTipFallback(path: string): void {
  console.log(`[AUTO] autonomous ON but took non-autonomous path: ${path}`)
}

export function logAutoTipBackendCall(url: string): void {
  console.log(`[AUTO] calling backend ${url}`)
}

export function logAutoTipResult(state: string): void {
  console.log(`[AUTO] backend result ${state}`)
}

export function logAutoTipError(message: string): void {
  console.log(`[AUTO] error ${message}`)
}

function normalizeBackendUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    new URL(trimmed)
  } catch {
    return null
  }

  return trimmed.replace(/\/+$/, '')
}

function joinBackendUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function extractResponseMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    return trimmed || null
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as {
    message?: unknown
    error?: unknown
    detail?: unknown
    reason?: unknown
  }

  return readString(candidate.message)
    ?? readString(candidate.error)
    ?? readString(candidate.detail)
    ?? readString(candidate.reason)
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const raw = await response.text()
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

async function readAgentBackendConfig(): Promise<AgentBackendConfig> {
  const stored = await chromeStorageGet([AUTONOMOUS_MODE_ENABLED, AGENT_BACKEND_URL, AGENT_TOKEN])

  const enabled = stored[AUTONOMOUS_MODE_ENABLED] === true

  const hasBackendUrl = Object.prototype.hasOwnProperty.call(stored, AGENT_BACKEND_URL)
  const rawBackendUrl = hasBackendUrl ? readString(stored[AGENT_BACKEND_URL]) : null
  const backendUrl = rawBackendUrl ?? (hasBackendUrl ? null : DEFAULT_AGENT_BACKEND_URL)

  if (!hasBackendUrl) {
    await chromeStorageSet({ [AGENT_BACKEND_URL]: DEFAULT_AGENT_BACKEND_URL })
  }

  return {
    enabled,
    backendUrl,
    token: readString(stored[AGENT_TOKEN]),
  }
}

export async function getAgentBackendConfig(): Promise<AgentBackendConfig> {
  return readAgentBackendConfig()
}

export async function isAutonomousEnabled(): Promise<boolean> {
  const config = await readAgentBackendConfig()
  return config.enabled
}

export async function setAutonomousEnabled(enabled: boolean): Promise<void> {
  await chromeStorageSet({ [AUTONOMOUS_MODE_ENABLED]: enabled })
}

export async function setAgentBackendUrl(backendUrl: string): Promise<string> {
  const normalized = normalizeBackendUrl(backendUrl)
  if (!normalized) {
    throw new Error(t('settings.agentBackendUrlInvalid'))
  }

  await chromeStorageSet({ [AGENT_BACKEND_URL]: normalized })
  return normalized
}

export async function setAgentToken(token: string): Promise<string> {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error(t('settings.agentTokenRequired'))
  }

  await chromeStorageSet({ [AGENT_TOKEN]: trimmed })
  return trimmed
}

export async function clearAgentToken(): Promise<void> {
  await chromeStorageRemove(AGENT_TOKEN)
}

export async function agentHealth(backendUrlOverride?: string): Promise<{ ok: true }> {
  const config = await readAgentBackendConfig()
  const backendUrl = backendUrlOverride !== undefined
    ? normalizeBackendUrl(backendUrlOverride)
    : config.backendUrl

  if (!backendUrl) {
    throw new Error(t('settings.agentBackendUrlMissing'))
  }

  const url = joinBackendUrl(backendUrl, '/health')

  let response: Response
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      },
      AGENT_REQUEST_TIMEOUT_MS,
    )
  } catch {
    throw new Error(t('settings.agentBackendUnreachable'))
  }

  const payload = await readResponsePayload(response)
  if (!response.ok) {
    const reason = extractResponseMessage(payload) ?? `HTTP ${response.status}`
    throw new Error(formatText('settings.agentBackendHealthFailed', { reason }))
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload as { ok?: unknown }).ok !== true) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  return { ok: true }
}

// TODO(per-user tips): once the backend exposes a per-user tip endpoint,
// branch here on `await isPaired()` (from '@/lib/pairing') to call it with
// the paired session's bearer token instead of the shared operator token
// below. Do NOT wire this until that endpoint exists - it doesn't yet.
export async function agentTip(recipient: string, amount: string): Promise<AgentTipResult> {
  const normalizedRecipient = recipient.trim().toLowerCase()
  const normalizedAmount = amount.trim()

  if (!normalizedRecipient) {
    throw new Error(t('gogo.invalidAddress'))
  }

  if (!normalizedAmount) {
    throw new Error(t('gogo.invalidAmount'))
  }

  const config = await readAgentBackendConfig()
  if (!config.backendUrl) {
    throw new Error(t('settings.agentBackendUrlMissing'))
  }

  if (!config.token) {
    throw new Error(t('settings.agentTokenMissing'))
  }

  const url = joinBackendUrl(config.backendUrl, '/agent/tip')

  try {
    logAutoTipBackendCall(url)

    let response: Response
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${config.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            recipient: normalizedRecipient,
            amount: normalizedAmount,
          }),
        },
        AGENT_REQUEST_TIMEOUT_MS,
      )
    } catch {
      throw new Error(t('settings.agentBackendUnreachable'))
    }

    const payload = await readResponsePayload(response)
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(t('settings.agentTokenRejected'))
      }

      const reason = extractResponseMessage(payload) ?? `HTTP ${response.status}`
      throw new Error(formatText('settings.agentTipBlocked', { reason }))
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(t('settings.agentBackendUnexpected'))
    }

    const state = readString((payload as { state?: unknown }).state)
    const txHash = readString((payload as { txHash?: unknown }).txHash)
    const arcscanUrl = readString((payload as { arcscanUrl?: unknown }).arcscanUrl)

    if (!state || !txHash || !arcscanUrl) {
      throw new Error(t('settings.agentBackendMalformed'))
    }

    if (state.toUpperCase() !== 'COMPLETE') {
      throw new Error(formatText('settings.agentBackendIncomplete', { state }))
    }

    logAutoTipResult(state)
    return {
      state: 'COMPLETE',
      txHash,
      arcscanUrl,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.agentBackendUnreachable')
    logAutoTipError(message)
    if (error instanceof Error) {
      throw error
    }

    throw new Error(message)
  }
}
