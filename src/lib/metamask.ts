export type MetaMaskErrorInfo = {
  code?: number
  message: string
}

export type MetaMaskAccountResult =
  | { accounts: string[] }
  | { error: MetaMaskErrorInfo }

const META_MASK_REJECTED_MESSAGE = 'MetaMask connection was rejected.'
const META_MASK_PERMISSION_MESSAGE = 'MetaMask permission needed. Please connect your wallet to ArcCopilot and try again.'

function normalizeMetaMaskError(error: unknown): MetaMaskErrorInfo {
  if (error && typeof error === 'object') {
    const source = error as { code?: unknown; message?: unknown }
    return {
      code: typeof source.code === 'number' ? source.code : undefined,
      message: typeof source.message === 'string' && source.message.trim()
        ? source.message
        : 'MetaMask request failed.',
    }
  }

  return {
    message: typeof error === 'string' && error.trim() ? error : 'MetaMask request failed.',
  }
}

function isRejectedError(error: MetaMaskErrorInfo): boolean {
  const message = error.message.toLowerCase()
  return error.code === 4001 || message.includes('user rejected') || message.includes('rejected the request')
}

function isUnauthorizedError(error: MetaMaskErrorInfo): boolean {
  const message = error.message.toLowerCase()
  return error.code === 4100 || message.includes('not been authorized') || message.includes('unauthorized')
}

export function getMetaMaskFriendlyError(error: unknown): string {
  const normalized = normalizeMetaMaskError(error)

  if (isRejectedError(normalized)) {
    return META_MASK_REJECTED_MESSAGE
  }

  if (isUnauthorizedError(normalized)) {
    return META_MASK_PERMISSION_MESSAGE
  }

  return normalized.message
}

async function runMetaMaskAccountRequest(tabId: number, method: 'eth_accounts' | 'eth_requestAccounts'): Promise<MetaMaskAccountResult> {
  const results = await chrome.scripting.executeScript<[string], MetaMaskAccountResult>({
    target: { tabId },
    world: 'MAIN',
    args: [method],
    func: async (requestMethod: string): Promise<MetaMaskAccountResult> => {
      try {
        const ethereum = (window as any).ethereum
        if (!ethereum) {
          return { error: { message: 'MetaMask is not installed or not active on this page.' } }
        }

        const accounts: string[] = await ethereum.request({ method: requestMethod })
        return { accounts }
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
    },
  })

  return results[0]?.result ?? { error: { message: 'No response from the page.' } }
}

export async function probeMetaMaskAccounts(tabId: number): Promise<MetaMaskAccountResult> {
  return runMetaMaskAccountRequest(tabId, 'eth_accounts')
}

export async function requestMetaMaskAccounts(tabId: number): Promise<MetaMaskAccountResult> {
  return runMetaMaskAccountRequest(tabId, 'eth_requestAccounts')
}

export async function ensureMetaMaskAccounts(tabId: number): Promise<MetaMaskAccountResult> {
  const probe = await probeMetaMaskAccounts(tabId)
  if ('error' in probe) return probe
  if (probe.accounts.length > 0) return probe
  return requestMetaMaskAccounts(tabId)
}

export function isMetaMaskUnauthorizedResult(result: MetaMaskAccountResult): boolean {
  return 'error' in result && normalizeMetaMaskError(result.error).code === 4100
}

export function isMetaMaskRejectedResult(result: MetaMaskAccountResult): boolean {
  return 'error' in result && normalizeMetaMaskError(result.error).code === 4001
}

