import { debugWarn } from '@/lib/debug'

export const EXTERNAL_REQUEST_TIMEOUT_MS = 10_000

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer != null) {
    clearTimeout(timer)
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = EXTERNAL_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const { signal } = init
  let timer: ReturnType<typeof setTimeout> | null = null
  let detachAbortListener: (() => void) | null = null

  if (signal?.aborted) {
    controller.abort()
  } else if (signal) {
    const handleAbort = () => controller.abort()
    signal.addEventListener('abort', handleAbort, { once: true })
    detachAbortListener = () => signal.removeEventListener('abort', handleAbort)
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs)
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimer(timer)
    detachAbortListener?.()
  }
}

async function settleChromeStorage<T>(
  fallback: T,
  timeoutMs: number,
  label: string,
  callback: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      clearTimer(timer)
      resolve(value)
    }

    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          debugWarn(`[ArcCopilot] ${label} timed out after ${timeoutMs}ms`)
          finish(fallback)
        }, timeoutMs)
      : null

    try {
      callback(finish)
    } catch (error) {
      debugWarn(`[ArcCopilot] ${label} failed:`, error)
      finish(fallback)
    }
  })
}

export async function chromeStorageGet<T extends Record<string, unknown> = Record<string, unknown>>(
  keys: string | string[],
  fallback: T = {} as T,
  timeoutMs: number = EXTERNAL_REQUEST_TIMEOUT_MS,
  label = 'chrome.storage.get',
): Promise<T> {
  if (!canUseChromeStorage()) return fallback

  return settleChromeStorage(fallback, timeoutMs, label, (resolve) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime?.lastError) {
        debugWarn(`[ArcCopilot] ${label} failed:`, chrome.runtime.lastError.message)
        resolve(fallback)
        return
      }

      resolve(result as T)
    })
  })
}

export async function chromeStorageSet(
  items: Record<string, unknown>,
  timeoutMs: number = EXTERNAL_REQUEST_TIMEOUT_MS,
  label = 'chrome.storage.set',
): Promise<void> {
  if (!canUseChromeStorage()) return

  await settleChromeStorage<void>(undefined, timeoutMs, label, (resolve) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime?.lastError) {
        debugWarn(`[ArcCopilot] ${label} failed:`, chrome.runtime.lastError.message)
      }
      resolve(undefined)
    })
  })
}

export async function chromeStorageRemove(
  keys: string | string[],
  timeoutMs: number = EXTERNAL_REQUEST_TIMEOUT_MS,
  label = 'chrome.storage.remove',
): Promise<void> {
  if (!canUseChromeStorage()) return

  await settleChromeStorage<void>(undefined, timeoutMs, label, (resolve) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime?.lastError) {
        debugWarn(`[ArcCopilot] ${label} failed:`, chrome.runtime.lastError.message)
      }
      resolve(undefined)
    })
  })
}
