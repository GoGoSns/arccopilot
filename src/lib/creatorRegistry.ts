import { chromeStorageGet, chromeStorageSet } from '@/lib/external'
import { t } from '@/lib/i18n'
import { CREATORS } from '@/lib/storageKeys'
import { isValidAddress } from '@/lib/validation'

export interface CreatorEntry {
  handle: string
  address: string
}

type CreatorRegistryRecord = Record<string, string>

const CREATOR_HANDLE_REGEX = /^[a-z0-9_]{1,15}$/

const DEFAULT_CREATORS: CreatorRegistryRecord = {
  arcbuilder: '0x7b4a6f1d9c2e8a4f0d7c1b3e5a9d2c6f8a1b0c7d',
  leptonlabs: '0x4a1fc9d8b2e7a5c0d3f6b8a1e4c7d9b2f0a6c5d8',
  circleforge: '0xb7c4e8f0a1d5c6b79f8b2ce5a7d4f1b0c3e6a9d2',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canonicalizeRegistry(registry: CreatorRegistryRecord): CreatorRegistryRecord {
  return Object.fromEntries(
    Object.entries(registry).sort(([a], [b]) => a.localeCompare(b)),
  )
}

function serializeRawRegistry(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
}

function serializeRegistry(registry: CreatorRegistryRecord): string {
  return JSON.stringify(canonicalizeRegistry(registry))
}

function normalizeCreatorRegistry(raw: unknown): CreatorRegistryRecord | null {
  if (!isPlainObject(raw)) return null

  const normalized: CreatorRegistryRecord = {}

  for (const [handleValue, addressValue] of Object.entries(raw)) {
    const handle = normalizeCreatorHandle(handleValue)
    const address = typeof addressValue === 'string' ? addressValue.trim().toLowerCase() : ''

    if (!handle || !CREATOR_HANDLE_REGEX.test(handle)) continue
    if (!isValidAddress(address)) continue

    normalized[handle] = address
  }

  return canonicalizeRegistry(normalized)
}

async function readRegistry(): Promise<CreatorRegistryRecord> {
  const stored = await chromeStorageGet(CREATORS)
  const hasKey = Object.prototype.hasOwnProperty.call(stored, CREATORS)

  if (!hasKey) {
    const defaults = canonicalizeRegistry(DEFAULT_CREATORS)
    await chromeStorageSet({ [CREATORS]: defaults })
    return defaults
  }

  const normalized = normalizeCreatorRegistry(stored[CREATORS])
  if (normalized == null) {
    const fallback = canonicalizeRegistry(DEFAULT_CREATORS)
    if (serializeRawRegistry(stored[CREATORS]) !== serializeRegistry(fallback)) {
      await chromeStorageSet({ [CREATORS]: fallback })
    }
    return fallback
  }

  if (serializeRawRegistry(stored[CREATORS]) !== serializeRegistry(normalized)) {
    await chromeStorageSet({ [CREATORS]: normalized })
  }

  return normalized
}

export function normalizeCreatorHandle(handle: string): string {
  return handle
    .trim()
    .replace(/^@+/, '')
    .replace(/[’'].*$/, '')
    .replace(/[.,!?]+$/, '')
    .toLowerCase()
}

export function isValidCreatorHandle(handle: string): boolean {
  return CREATOR_HANDLE_REGEX.test(normalizeCreatorHandle(handle))
}

export async function listCreators(): Promise<CreatorEntry[]> {
  const registry = await readRegistry()

  return Object.entries(registry)
    .map(([handle, address]) => ({
      handle,
      address,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle))
}

export async function getCreatorWallet(handle: string): Promise<string | null> {
  const normalizedHandle = normalizeCreatorHandle(handle)
  if (!isValidCreatorHandle(normalizedHandle)) return null

  const registry = await readRegistry()
  return registry[normalizedHandle] ?? null
}

export async function registerCreator(handle: string, address: string): Promise<void> {
  const normalizedHandle = normalizeCreatorHandle(handle)
  if (!normalizedHandle || !CREATOR_HANDLE_REGEX.test(normalizedHandle)) {
    throw new Error(t('settings.invalidCreatorHandle'))
  }

  const normalizedAddress = address.trim().toLowerCase()
  if (!isValidAddress(normalizedAddress)) {
    throw new Error(t('settings.creatorInvalidAddress'))
  }

  const registry = await readRegistry()
  const next = canonicalizeRegistry({
    ...registry,
    [normalizedHandle]: normalizedAddress,
  })

  if (serializeRegistry(registry) === serializeRegistry(next)) return

  await chromeStorageSet({ [CREATORS]: next })
}

export async function removeCreator(handle: string): Promise<void> {
  const normalizedHandle = normalizeCreatorHandle(handle)
  if (!normalizedHandle) return

  const registry = await readRegistry()
  if (!Object.prototype.hasOwnProperty.call(registry, normalizedHandle)) return

  const { [normalizedHandle]: _removed, ...rest } = registry
  const next = canonicalizeRegistry(rest)

  if (serializeRegistry(registry) === serializeRegistry(next)) return

  await chromeStorageSet({ [CREATORS]: next })
}
