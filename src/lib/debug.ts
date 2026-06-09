const DEBUG = false

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args)
}

export function debugWarn(...args: unknown[]): void {
  if (DEBUG) console.warn(...args)
}
