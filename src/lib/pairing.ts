import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { formatText, t } from '@/lib/i18n'
import { DEFAULT_AGENT_BACKEND_URL, getAgentBackendConfig } from '@/lib/agentBackend'
import {
  PAIRING_ACCESS_TOKEN,
  PAIRING_POLICY_AUTONOMOUS_ENABLED,
  PAIRING_REFRESH_TOKEN,
  PAIRING_USER_ID,
} from '@/lib/storageKeys'
import {
  getMetaMaskFriendlyError,
  type MetaMaskErrorInfo,
  requestMetaMaskAccounts,
} from '@/lib/metamask'

const PAIRING_REQUEST_TIMEOUT_MS = 10_000

export interface PairingPolicy {
  weeklyBudget: number
  perTipCap: number
  autonomousEnabled: boolean
}

export interface UserAgentAllowlistEntry {
  recipient: string
  label: string | null
}

export interface UserAgentPolicy extends PairingPolicy {
  allowlist: UserAgentAllowlistEntry[]
  spentThisWeek: number
  remainingWeekly: number
  maxSuggestable: number
}

export interface UserAgentTipResult {
  state: 'COMPLETE'
  txHash: string
  arcscanUrl: string
}

export interface UserAgentLedgerEntry {
  recipient: string
  amount: string
  txHash: string | null
  status: string
  createdAt: string
}

export interface UserAgentSchedule {
  id: string
  recipient: string
  amount: string
  label: string | null
  intervalHours: number
  nextRunAt: string
  enabled: boolean
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface UserAgentScheduleInput {
  recipient: string
  amount: string
  label?: string
  intervalHours: number
  firstRunAt: string
  enabled?: boolean
}

export class PairingApiError extends Error {
  readonly status: number
  readonly backendMessage: string | null
  readonly action: 'finish-setup' | 'enable-autonomous' | 'fund-agent' | null
  readonly agentAddress: string | null

  constructor(
    message: string,
    options: {
      status: number
      backendMessage?: string | null
      action?: 'finish-setup' | 'enable-autonomous' | 'fund-agent' | null
      agentAddress?: string | null
    },
  ) {
    super(message)
    this.name = 'PairingApiError'
    this.status = options.status
    this.backendMessage = options.backendMessage ?? null
    this.action = options.action ?? null
    this.agentAddress = options.agentAddress ?? null
  }
}

export interface PairingProfile {
  userId: string
  walletAddress: string
  agentAddress: string | null
  agentWalletReady: boolean
  policy: PairingPolicy | null
}

interface PairingSession {
  accessToken: string
  refreshToken: string
  userId: string
}

type MetaMaskRequestResult<T> =
  | { result: T }
  | { error: MetaMaskErrorInfo }

function joinBackendUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return null
}

function readAddress(value: unknown): string | null {
  const raw = readString(value)
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    return null
  }

  return raw.toLowerCase()
}

function extractResponseMessage(payload: unknown, depth = 0): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    return trimmed || null
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || depth > 3) {
    return null
  }

  const candidate = payload as {
    message?: unknown
    error?: unknown
    detail?: unknown
    errorDetails?: unknown
    reason?: unknown
    data?: unknown
  }

  return readString(candidate.message)
    ?? readString(candidate.detail)
    ?? readString(candidate.errorDetails)
    ?? readString(candidate.reason)
    ?? readString(candidate.error)
    ?? extractResponseMessage(candidate.error, depth + 1)
    ?? extractResponseMessage(candidate.data, depth + 1)
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

function formatBackendError(payload: unknown, fallbackKey: 'settings.pairingBackendError' | 'settings.agentBackendUnexpected' = 'settings.pairingBackendError'): string {
  const reason = extractResponseMessage(payload)
  if (!reason) {
    return t(fallbackKey)
  }

  return formatText('settings.pairingBackendErrorWithReason', { reason })
}

function parsePolicy(value: unknown): PairingPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as {
    weeklyBudget?: unknown
    perTipCap?: unknown
    autonomousEnabled?: unknown
  }

  const weeklyBudget = readNumber(candidate.weeklyBudget)
  const perTipCap = readNumber(candidate.perTipCap)
  const autonomousEnabled = readBoolean(candidate.autonomousEnabled)

  if (weeklyBudget == null || perTipCap == null || autonomousEnabled == null) {
    return null
  }

  return {
    weeklyBudget,
    perTipCap,
    autonomousEnabled,
  }
}

function parseAllowlist(value: unknown): UserAgentAllowlistEntry[] | null {
  if (!Array.isArray(value)) return null

  const entries: UserAgentAllowlistEntry[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      const recipient = readAddress(item)
      if (!recipient) return null
      entries.push({ recipient, label: null })
      continue
    }

    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const candidate = item as { recipient?: unknown; address?: unknown; label?: unknown }
    const recipient = readAddress(candidate.recipient) ?? readAddress(candidate.address)
    if (!recipient) return null

    entries.push({
      recipient,
      label: candidate.label == null ? null : readString(candidate.label),
    })
  }

  return entries
}

function parseUserAgentPolicy(value: unknown): UserAgentPolicy {
  const policy = parsePolicy(value)
  if (!policy || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  const candidate = value as {
    allowlist?: unknown
    spentThisWeek?: unknown
    remainingWeekly?: unknown
    maxSuggestable?: unknown
  }
  const allowlist = parseAllowlist(candidate.allowlist)
  const spentThisWeek = readNumber(candidate.spentThisWeek)
  const remainingWeekly = readNumber(candidate.remainingWeekly)
  const maxSuggestable = readNumber(candidate.maxSuggestable)

  if (
    !allowlist
    || spentThisWeek == null
    || remainingWeekly == null
    || maxSuggestable == null
    || spentThisWeek < 0
    || remainingWeekly < 0
    || maxSuggestable < 0
    || maxSuggestable > policy.perTipCap
    || maxSuggestable > remainingWeekly
  ) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  return {
    ...policy,
    allowlist,
    spentThisWeek,
    remainingWeekly,
    maxSuggestable,
  }
}

function parseUserAgentTipResult(payload: unknown): UserAgentTipResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  const candidate = payload as { state?: unknown; txHash?: unknown; arcscanUrl?: unknown }
  const state = readString(candidate.state)
  const txHash = readString(candidate.txHash)
  const arcscanUrl = readString(candidate.arcscanUrl)

  if (!state || !txHash || !arcscanUrl) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  if (state.toUpperCase() !== 'COMPLETE') {
    throw new Error(formatText('settings.agentBackendIncomplete', { state }))
  }

  return { state: 'COMPLETE', txHash, arcscanUrl }
}

function parseLedger(payload: unknown): UserAgentLedgerEntry[] {
  const rawEntries = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && !Array.isArray(payload)
      ? ((payload as { ledger?: unknown; tips?: unknown }).ledger ?? (payload as { tips?: unknown }).tips)
      : null

  if (!Array.isArray(rawEntries)) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  return rawEntries.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(t('settings.agentBackendMalformed'))
    }

    const candidate = item as {
      recipient?: unknown
      amount?: unknown
      txHash?: unknown
      status?: unknown
      createdAt?: unknown
    }
    const recipient = readAddress(candidate.recipient)
    const amount = readString(candidate.amount) ?? (readNumber(candidate.amount)?.toString() ?? null)
    const txHash = candidate.txHash == null ? null : readString(candidate.txHash)
    const status = readString(candidate.status)
    const createdAt = readString(candidate.createdAt)

    if (!recipient || !amount || !status || !createdAt) {
      throw new Error(t('settings.agentBackendMalformed'))
    }

    return { recipient, amount, txHash, status, createdAt }
  })
}

function parseSchedule(value: unknown): UserAgentSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  const candidate = value as {
    id?: unknown
    recipient?: unknown
    amount?: unknown
    label?: unknown
    intervalHours?: unknown
    nextRunAt?: unknown
    enabled?: unknown
    lastRunAt?: unknown
    lastStatus?: unknown
    lastError?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }
  const id = readString(candidate.id)
  const recipient = readAddress(candidate.recipient)
  const amount = readString(candidate.amount) ?? (readNumber(candidate.amount)?.toString() ?? null)
  const intervalHours = readNumber(candidate.intervalHours)
  const nextRunAt = readString(candidate.nextRunAt)
  const enabled = readBoolean(candidate.enabled)
  const createdAt = readString(candidate.createdAt)
  const updatedAt = readString(candidate.updatedAt)

  if (
    !id
    || !recipient
    || !amount
    || !Number.isFinite(Number(amount))
    || Number(amount) <= 0
    || intervalHours == null
    || !Number.isInteger(intervalHours)
    || intervalHours < 1
    || !nextRunAt
    || enabled == null
    || !createdAt
    || !updatedAt
  ) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  return {
    id,
    recipient,
    amount,
    label: candidate.label == null ? null : readString(candidate.label),
    intervalHours,
    nextRunAt,
    enabled,
    lastRunAt: candidate.lastRunAt == null ? null : readString(candidate.lastRunAt),
    lastStatus: candidate.lastStatus == null ? null : readString(candidate.lastStatus),
    lastError: candidate.lastError == null ? null : readString(candidate.lastError),
    createdAt,
    updatedAt,
  }
}

function parseSchedules(payload: unknown): UserAgentSchedule[] {
  const raw = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { schedules?: unknown }).schedules
    : null
  if (!Array.isArray(raw)) {
    throw new Error(t('settings.agentBackendMalformed'))
  }
  return raw.map(parseSchedule)
}

function parseSchedulePayload(payload: unknown): UserAgentSchedule {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(t('settings.agentBackendMalformed'))
  }
  return parseSchedule((payload as { schedule?: unknown }).schedule)
}

function isInsufficientFundsError(payload: unknown, message: string | null): boolean {
  let serializedPayload = ''
  try {
    serializedPayload = JSON.stringify(payload)
  } catch {
    // Parsed response payloads should be serializable; the message still covers the fallback.
  }

  const signal = `${message ?? ''} ${serializedPayload}`
  return /\b(?:155201|155204|155205)\b|INSUFFICIENT_(?:TOKEN_BALANCE|NATIVE_TOKEN)|insufficient\s+(?:available\s+)?(?:funds?|balance|token)|not enough funds|balance.*(?:low|short)|transfer amount exceeds balance|total cost.*higher than.*balance|due to insufficient token/i.test(signal)
}

async function createUserAgentError(status: number, payload: unknown, tipContext = false): Promise<PairingApiError> {
  const backendMessage = extractResponseMessage(payload)

  if (tipContext && isInsufficientFundsError(payload, backendMessage)) {
    let agentAddress: string | null = null
    try {
      agentAddress = (await getMe()).agentAddress
    } catch {
      // The original Circle error remains the primary error if profile lookup fails.
    }

    return new PairingApiError(
      agentAddress
        ? formatText('settings.userAgentInsufficientFundsWithAddress', { address: agentAddress })
        : t('settings.userAgentInsufficientFunds'),
      {
        status,
        backendMessage,
        action: 'fund-agent',
        agentAddress,
      },
    )
  }

  if (tipContext && status === 409) {
    return new PairingApiError(t('settings.userAgentFinishSetupError'), {
      status,
      backendMessage,
      action: 'finish-setup',
    })
  }

  if (tipContext && status === 403) {
    return new PairingApiError(t('settings.userAgentEnableAutonomousError'), {
      status,
      backendMessage,
      action: 'enable-autonomous',
    })
  }

  return new PairingApiError(backendMessage ?? `HTTP ${status}`, {
    status,
    backendMessage,
  })
}

function parseProfile(payload: unknown): PairingProfile {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  const candidate = payload as {
    userId?: unknown
    walletAddress?: unknown
    agentAddress?: unknown
    agentWalletReady?: unknown
    policy?: unknown
  }

  const userId = readString(candidate.userId)
  const walletAddress = readAddress(candidate.walletAddress)
  const agentAddress = candidate.agentAddress == null ? null : readAddress(candidate.agentAddress)
  const agentWalletReady = readBoolean(candidate.agentWalletReady)

  if (!userId || !walletAddress || agentWalletReady == null) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  const policy = candidate.policy == null ? null : parsePolicy(candidate.policy)
  if (candidate.policy != null && policy == null) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  if (agentWalletReady && !agentAddress) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  return {
    userId,
    walletAddress,
    agentAddress,
    agentWalletReady,
    policy,
  }
}

async function getPairingBackendUrl(): Promise<string> {
  const config = await getAgentBackendConfig()
  return config.backendUrl ?? DEFAULT_AGENT_BACKEND_URL
}

async function readPairingSession(): Promise<PairingSession | null> {
  const stored = await chromeStorageGet([
    PAIRING_ACCESS_TOKEN,
    PAIRING_REFRESH_TOKEN,
    PAIRING_USER_ID,
  ])

  const accessToken = readString(stored[PAIRING_ACCESS_TOKEN])
  const refreshToken = readString(stored[PAIRING_REFRESH_TOKEN])
  const userId = readString(stored[PAIRING_USER_ID])

  if (!accessToken || !refreshToken || !userId) {
    return null
  }

  return {
    accessToken,
    refreshToken,
    userId,
  }
}

async function clearPairingSession(): Promise<void> {
  await chromeStorageRemove([
    PAIRING_ACCESS_TOKEN,
    PAIRING_REFRESH_TOKEN,
    PAIRING_USER_ID,
    PAIRING_POLICY_AUTONOMOUS_ENABLED,
  ])
}

async function savePairingSession(session: PairingSession): Promise<void> {
  await chromeStorageSet({
    [PAIRING_ACCESS_TOKEN]: session.accessToken,
    [PAIRING_REFRESH_TOKEN]: session.refreshToken,
    [PAIRING_USER_ID]: session.userId,
  })

  await chromeStorageRemove(PAIRING_POLICY_AUTONOMOUS_ENABLED)
}

async function authorizedRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const backendUrl = await getPairingBackendUrl()
  const session = await readPairingSession()
  if (!session) {
    throw new Error(t('settings.pairingSessionMissing'))
  }

  const sendRequest = async (accessToken: string): Promise<Response> => {
    const headers = new Headers(init.headers ?? undefined)
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bearer ${accessToken}`)

    if (init.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    return fetchWithTimeout(
      joinBackendUrl(backendUrl, path),
      {
        ...init,
        headers,
      },
      PAIRING_REQUEST_TIMEOUT_MS,
    )
  }

  let response: Response
  try {
    response = await sendRequest(session.accessToken)
  } catch {
    throw new Error(t('settings.agentBackendUnreachable'))
  }

  if (response.status !== 401) {
    return response
  }

  const refreshUrl = joinBackendUrl(backendUrl, '/auth/refresh')
  let refreshResponse: Response
  try {
    refreshResponse = await fetchWithTimeout(
      refreshUrl,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
      PAIRING_REQUEST_TIMEOUT_MS,
    )
  } catch {
    throw new Error(t('settings.agentBackendUnreachable'))
  }

  const refreshPayload = await readResponsePayload(refreshResponse)
  if (!refreshResponse.ok) {
    if (refreshResponse.status === 401) {
      await clearPairingSession()
      throw new Error(t('settings.pairingSessionExpired'))
    }

    throw new Error(formatBackendError(refreshPayload))
  }

  const nextAccessToken = readString((refreshPayload as { accessToken?: unknown } | null)?.accessToken)
  if (!nextAccessToken) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  await chromeStorageSet({
    [PAIRING_ACCESS_TOKEN]: nextAccessToken,
  })

  response = await sendRequest(nextAccessToken)
  if (response.status === 401) {
    await clearPairingSession()
    throw new Error(t('settings.pairingSessionExpired'))
  }

  return response
}

async function requestMetaMaskPersonalSign(
  tabId: number,
  accountAddress: string,
  message: string,
): Promise<string> {
  const results = await chrome.scripting.executeScript<[string, string], MetaMaskRequestResult<string>>({
    target: { tabId },
    world: 'MAIN',
    args: [accountAddress, message],
    func: (async (address: string, signMessage: string): Promise<MetaMaskRequestResult<string>> => {
      try {
        const ethereum = (window as typeof window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum
        if (!ethereum) {
          return { error: { message: 'MetaMask is not installed or not active on this page.' } }
        }

        const signature = await ethereum.request({
          method: 'personal_sign',
          params: [signMessage, address],
        })

        return { result: signature }
      } catch (error: any) {
        return {
          error: {
            code: typeof error?.code === 'number' ? error.code : undefined,
            message: typeof error?.message === 'string' && error.message.trim()
              ? error.message
              : 'MetaMask request failed.',
          },
        }
      }
    }) as unknown as (address: string, signMessage: string) => MetaMaskRequestResult<string>,
  })

  const result = results[0]?.result
  if (!result) {
    throw new Error('No response from the page.')
  }

  if ('error' in result) {
    if (result.error.code === 4001) {
      throw new Error(t('settings.pairingSignatureRejected'))
    }

    throw new Error(getMetaMaskFriendlyError(result.error))
  }

  return result.result
}

function normalizeMetaMaskAccount(address: string): string {
  const trimmed = address.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error(t('settings.pairingNoConnectedAccount'))
  }

  return trimmed.toLowerCase()
}

async function getActiveWebTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    throw new Error(t('send.enterWebPageFirst'))
  }

  return tab.id
}

function formatMetaMaskPairingError(error: MetaMaskErrorInfo, phase: 'pair' | 'sign'): string {
  if (error.code === 4001) {
    return phase === 'sign'
      ? t('settings.pairingSignatureRejected')
      : t('settings.pairingMetaMaskRejected')
  }

  return getMetaMaskFriendlyError(error)
}

export async function getNonce(address: string): Promise<{ nonce: string; message: string }> {
  const backendUrl = await getPairingBackendUrl()
  const normalizedAddress = normalizeMetaMaskAccount(address)

  let response: Response
  try {
    response = await fetchWithTimeout(
      joinBackendUrl(backendUrl, '/auth/nonce'),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ address: normalizedAddress }),
      },
      PAIRING_REQUEST_TIMEOUT_MS,
    )
  } catch {
    throw new Error(t('settings.agentBackendUnreachable'))
  }

  const payload = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(formatBackendError(payload))
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  const nonce = readString((payload as { nonce?: unknown }).nonce)
  const message = readString((payload as { message?: unknown }).message)

  if (!nonce || !message) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  return { nonce, message }
}

export async function pairWithSignature(): Promise<boolean> {
  const tabId = await getActiveWebTabId()
  const accountResult = await requestMetaMaskAccounts(tabId)

  if ('error' in accountResult) {
    throw new Error(formatMetaMaskPairingError(accountResult.error, 'pair'))
  }

  const firstAccount = accountResult.accounts[0]
  if (!firstAccount) {
    throw new Error(t('settings.pairingNoConnectedAccount'))
  }

  const walletAddress = normalizeMetaMaskAccount(firstAccount)
  const { message } = await getNonce(walletAddress)
  const signature = await requestMetaMaskPersonalSign(tabId, walletAddress, message)
  const backendUrl = await getPairingBackendUrl()

  let response: Response
  try {
    response = await fetchWithTimeout(
      joinBackendUrl(backendUrl, '/auth/verify'),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ address: walletAddress, signature }),
      },
      PAIRING_REQUEST_TIMEOUT_MS,
    )
  } catch {
    throw new Error(t('settings.agentBackendUnreachable'))
  }

  const payload = await readResponsePayload(response)
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new Error(t('settings.pairingSignatureRejected'))
    }

    throw new Error(formatBackendError(payload))
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(t('settings.agentBackendUnexpected'))
  }

  const accessToken = readString((payload as { accessToken?: unknown }).accessToken)
  const refreshToken = readString((payload as { refreshToken?: unknown }).refreshToken)
  const userId = readString((payload as { userId?: unknown }).userId)
  const walletReady = readBoolean((payload as { walletReady?: unknown }).walletReady)

  if (!accessToken || !refreshToken || !userId || walletReady == null) {
    throw new Error(t('settings.agentBackendMalformed'))
  }

  await savePairingSession({
    accessToken,
    refreshToken,
    userId,
  })

  return walletReady
}

export async function getMe(): Promise<PairingProfile> {
  const response = await authorizedRequest('/me')
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw new Error(formatBackendError(payload))
  }

  return parseProfile(payload)
}

export async function provisionAgent(): Promise<PairingProfile> {
  const response = await authorizedRequest('/agent/provision', {
    method: 'POST',
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw new Error(formatBackendError(payload))
  }

  return parseProfile(payload)
}

export async function userTip(recipient: string, amount: string): Promise<UserAgentTipResult> {
  const response = await authorizedRequest('/me/tip', {
    method: 'POST',
    body: JSON.stringify({
      recipient: recipient.trim().toLowerCase(),
      amount: amount.trim(),
    }),
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload, true)
  }

  if (isInsufficientFundsError(payload, extractResponseMessage(payload))) {
    throw await createUserAgentError(response.status, payload, true)
  }

  return parseUserAgentTipResult(payload)
}

export async function getPolicy(): Promise<UserAgentPolicy> {
  const response = await authorizedRequest('/me/policy')
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }

  return parseUserAgentPolicy(payload)
}

export async function updatePolicy(patch: Partial<Pick<PairingPolicy, 'weeklyBudget' | 'perTipCap' | 'autonomousEnabled'>>): Promise<UserAgentPolicy> {
  const response = await authorizedRequest('/me/policy', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }

  return getPolicy()
}

export async function addAllowlist(recipient: string, label?: string): Promise<void> {
  const normalizedLabel = label?.trim()
  const response = await authorizedRequest('/me/allowlist', {
    method: 'POST',
    body: JSON.stringify({
      recipient: recipient.trim().toLowerCase(),
      ...(normalizedLabel ? { label: normalizedLabel } : {}),
    }),
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }
}

export async function removeAllowlist(recipient: string): Promise<void> {
  const response = await authorizedRequest('/me/allowlist', {
    method: 'DELETE',
    body: JSON.stringify({ recipient: recipient.trim().toLowerCase() }),
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }
}

export async function getLedger(): Promise<UserAgentLedgerEntry[]> {
  const response = await authorizedRequest('/me/ledger')
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }

  return parseLedger(payload).slice(0, 20)
}

export async function getSchedules(): Promise<UserAgentSchedule[]> {
  const response = await authorizedRequest('/me/schedule')
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }

  return parseSchedules(payload)
}

export async function createSchedule(input: UserAgentScheduleInput): Promise<UserAgentSchedule> {
  const response = await authorizedRequest('/me/schedule', {
    method: 'POST',
    body: JSON.stringify({
      recipient: input.recipient.trim().toLowerCase(),
      amount: input.amount.trim(),
      label: input.label?.trim() || undefined,
      intervalHours: input.intervalHours,
      firstRunAt: input.firstRunAt,
      enabled: input.enabled ?? true,
    }),
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload, true)
  }

  return parseSchedulePayload(payload)
}

export async function updateSchedule(
  scheduleId: string,
  patch: Partial<UserAgentScheduleInput>,
): Promise<UserAgentSchedule> {
  const response = await authorizedRequest(`/me/schedule/${encodeURIComponent(scheduleId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...patch,
      ...(patch.recipient !== undefined ? { recipient: patch.recipient.trim().toLowerCase() } : {}),
      ...(patch.amount !== undefined ? { amount: patch.amount.trim() } : {}),
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
    }),
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload, true)
  }

  return parseSchedulePayload(payload)
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const response = await authorizedRequest(`/me/schedule/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
  })
  const payload = await readResponsePayload(response)

  if (!response.ok) {
    throw await createUserAgentError(response.status, payload)
  }
}

export async function isPaired(): Promise<boolean> {
  return (await readPairingSession()) !== null
}

export async function unpair(): Promise<void> {
  await clearPairingSession()
}

export async function getPairedPolicyAutonomousEnabled(): Promise<boolean | null> {
  const stored = await chromeStorageGet(PAIRING_POLICY_AUTONOMOUS_ENABLED)
  return readBoolean(stored[PAIRING_POLICY_AUTONOMOUS_ENABLED])
}

export async function setPairedPolicyAutonomousEnabled(enabled: boolean): Promise<boolean> {
  const session = await readPairingSession()
  if (!session) {
    throw new Error(t('settings.pairingSessionMissing'))
  }

  await chromeStorageSet({
    [PAIRING_POLICY_AUTONOMOUS_ENABLED]: enabled,
  })

  return enabled
}

export async function clearPairedPolicyAutonomousEnabled(): Promise<void> {
  await chromeStorageRemove(PAIRING_POLICY_AUTONOMOUS_ENABLED)
}
