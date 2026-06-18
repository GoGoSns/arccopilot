import {
  CHAIN_CONFIGS,
  GATEWAY_DOMAINS,
  GatewayClient,
  type DepositResult,
  type GatewayBalance,
  type SupportedChainName,
  type WithdrawResult,
} from '@circle-fin/x402-batching/client'
import { debugWarn } from '@/lib/debug'
import { useStore } from '@/lib/store'

const ARC_TESTNET_CHAIN: SupportedChainName = 'arcTestnet'
const DEFAULT_GATEWAY_MAX_FEE_USDC = '0.01'

const TESTNET_DOMAIN_TO_CHAIN: Record<number, SupportedChainName> = {
  [GATEWAY_DOMAINS.arcTestnet]: 'arcTestnet',
  [GATEWAY_DOMAINS.baseSepolia]: 'baseSepolia',
  [GATEWAY_DOMAINS.sepolia]: 'sepolia',
  [GATEWAY_DOMAINS.arbitrumSepolia]: 'arbitrumSepolia',
  [GATEWAY_DOMAINS.optimismSepolia]: 'optimismSepolia',
  [GATEWAY_DOMAINS.avalancheFuji]: 'avalancheFuji',
  [GATEWAY_DOMAINS.polygonAmoy]: 'polygonAmoy',
  [GATEWAY_DOMAINS.hyperEvmTestnet]: 'hyperEvmTestnet',
  [GATEWAY_DOMAINS.seiAtlantic]: 'seiAtlantic',
  [GATEWAY_DOMAINS.sonicTestnet]: 'sonicTestnet',
  [GATEWAY_DOMAINS.unichainSepolia]: 'unichainSepolia',
  [GATEWAY_DOMAINS.worldChainSepolia]: 'worldChainSepolia',
}

const GATEWAY_CHAIN_LABELS: Record<SupportedChainName, string> = {
  arcTestnet: 'Arc Testnet',
  baseSepolia: 'Base Sepolia',
  sepolia: 'Ethereum Sepolia',
  arbitrumSepolia: 'Arbitrum Sepolia',
  optimismSepolia: 'Optimism Sepolia',
  avalancheFuji: 'Avalanche Fuji',
  polygonAmoy: 'Polygon Amoy',
  hyperEvmTestnet: 'HyperEVM Testnet',
  seiAtlantic: 'Sei Atlantic',
  sonicTestnet: 'Sonic Testnet',
  unichainSepolia: 'Unichain Sepolia',
  worldChainSepolia: 'World Chain Sepolia',
  arbitrum: 'Arbitrum',
  avalanche: 'Avalanche',
  base: 'Base',
  mainnet: 'Ethereum Mainnet',
  hyperEvm: 'HyperEVM',
  optimism: 'Optimism',
  polygon: 'Polygon',
  sei: 'Sei',
  sonic: 'Sonic',
  unichain: 'Unichain',
  worldChain: 'World Chain',
}

const GATEWAY_DESTINATION_PATTERNS: Array<{ pattern: RegExp; domain: number }> = [
  { pattern: /\barc\s*testnet\b/, domain: GATEWAY_DOMAINS.arcTestnet },
  { pattern: /\bbase\s*sepolia\b/, domain: GATEWAY_DOMAINS.baseSepolia },
  { pattern: /\bethereum\s*sepolia\b|\bsepolia\b/, domain: GATEWAY_DOMAINS.sepolia },
  { pattern: /\barbitrum\s*sepolia\b/, domain: GATEWAY_DOMAINS.arbitrumSepolia },
  { pattern: /\boptimism\s*sepolia\b/, domain: GATEWAY_DOMAINS.optimismSepolia },
  { pattern: /\bavalanche\s*fuji\b/, domain: GATEWAY_DOMAINS.avalancheFuji },
  { pattern: /\bpolygon\s*amoy\b/, domain: GATEWAY_DOMAINS.polygonAmoy },
  { pattern: /\bhyper\s*evm\s*testnet\b|\bhyperevm\s*testnet\b/, domain: GATEWAY_DOMAINS.hyperEvmTestnet },
  { pattern: /\bsei\s*atlantic\b/, domain: GATEWAY_DOMAINS.seiAtlantic },
  { pattern: /\bsonic\s*testnet\b/, domain: GATEWAY_DOMAINS.sonicTestnet },
  { pattern: /\bunichain\s*sepolia\b/, domain: GATEWAY_DOMAINS.unichainSepolia },
  { pattern: /\bworld\s*chain\s*sepolia\b|\bworldchain\s*sepolia\b/, domain: GATEWAY_DOMAINS.worldChainSepolia },
]

function canUseChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isSensitivePath(path: string[]): boolean {
  return path.some((segment) => /private|secret|mnemonic|seed|wallet/i.test(segment))
}

function isPrivateKeyString(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim())
}

function parseLocalStorageValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function normalizeUsdcAmountInput(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : value.trim()
  const withoutCurrency = raw.replace(/\s*USDC$/i, '').trim()
  if (/^\d+,\d{1,6}$/.test(withoutCurrency) && !withoutCurrency.includes('.')) {
    return withoutCurrency.replace(',', '.')
  }
  return withoutCurrency
}

function scanForPrivateKey(value: unknown, path: string[]): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = scanForPrivateKey(value[index], [...path, String(index)])
      if (found) return found
    }
    return null
  }

  if (typeof value === 'string') {
    return isSensitivePath(path) && isPrivateKeyString(value) ? value.trim() : null
  }

  if (!isObjectLike(value)) {
    return null
  }

  for (const [key, child] of Object.entries(value)) {
    const found = scanForPrivateKey(child, [...path, key])
    if (found) return found
  }

  return null
}

async function readAllChromeStorage(): Promise<Record<string, unknown>> {
  if (!canUseChromeStorage()) return {}

  return await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime?.lastError) {
        debugWarn('[Gateway] chrome.storage.local read failed:', chrome.runtime.lastError.message)
        resolve({})
        return
      }

      resolve(items as Record<string, unknown>)
    })
  })
}

function readAllLocalStorage(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {}

  const items: Record<string, unknown> = {}

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key) continue

    const raw = localStorage.getItem(key)
    if (raw == null) continue
    items[key] = parseLocalStorageValue(raw)
  }

  return items
}

function normalizeGatewayIntentText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function resolveSupportedChainName(destinationDomain: number): SupportedChainName {
  const chainName = TESTNET_DOMAIN_TO_CHAIN[destinationDomain]
  if (!chainName) {
    throw new Error(`Unsupported destination chain domain: ${destinationDomain}`)
  }

  if (!(chainName in CHAIN_CONFIGS)) {
    throw new Error(`Unsupported destination chain: ${chainName}`)
  }

  return chainName
}

export function getGatewayDestinationDomain(message: string): number {
  const lowered = normalizeGatewayIntentText(message)
  const match = GATEWAY_DESTINATION_PATTERNS.find((entry) => entry.pattern.test(lowered))
  return match?.domain ?? GATEWAY_DOMAINS.arcTestnet
}

async function resolveGatewayPrivateKey(): Promise<`0x${string}`> {
  const expectedAddress = useStore.getState().walletAddress?.trim().toLowerCase() ?? null
  const chromeItems = await readAllChromeStorage()
  const localItems = readAllLocalStorage()
  const candidates = new Set<string>()

  for (const [key, value] of Object.entries(chromeItems)) {
    const found = scanForPrivateKey(value, [key])
    if (found) candidates.add(found)
  }

  for (const [key, value] of Object.entries(localItems)) {
    const found = scanForPrivateKey(value, [key])
    if (found) candidates.add(found)
  }

  if (candidates.size === 0) {
    throw new Error('Gateway signer unavailable. No legacy private key was found in storage.')
  }

  const resolvedCandidates = [...candidates]
    .map((candidate) => {
      try {
        const account = new GatewayClient({
          chain: ARC_TESTNET_CHAIN,
          privateKey: candidate as `0x${string}`,
        })
        return {
          candidate: candidate as `0x${string}`,
          address: account.address.toLowerCase(),
        }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { candidate: `0x${string}`; address: string } => Boolean(entry))

  if (resolvedCandidates.length === 0) {
    throw new Error('Gateway signer unavailable. No valid private key was found in storage.')
  }

  if (expectedAddress) {
    const matchedCandidate = resolvedCandidates.find((entry) => entry.address === expectedAddress)
    if (matchedCandidate) {
      return matchedCandidate.candidate
    }
    throw new Error('Gateway signer unavailable. No matching legacy private key was found in storage.')
  }

  if (resolvedCandidates.length === 1) {
    return resolvedCandidates[0].candidate
  }

  throw new Error('Gateway signer unavailable. Multiple legacy private keys were found in storage.')
}

async function createGatewayClient(chain: SupportedChainName): Promise<GatewayClient> {
  const privateKey = await resolveGatewayPrivateKey()
  return new GatewayClient({
    chain,
    privateKey,
  })
}

export function getGatewayChainLabel(destinationDomain: number): string {
  const chainName = resolveSupportedChainName(destinationDomain)
  return GATEWAY_CHAIN_LABELS[chainName] ?? chainName
}

export async function getGatewayBalance(): Promise<GatewayBalance> {
  const client = await createGatewayClient(ARC_TESTNET_CHAIN)
  const balances = await client.getBalances()
  return balances.gateway
}

export async function depositToGateway(amountUsdc: string | number): Promise<DepositResult> {
  const client = await createGatewayClient(ARC_TESTNET_CHAIN)
  const amount = normalizeUsdcAmountInput(amountUsdc)

  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Invalid USDC amount.')
  }

  return await client.deposit(amount)
}

export async function withdrawViaGateway(
  recipientAddress: string,
  amountUsdc: string | number,
  destinationDomain: number,
): Promise<WithdrawResult> {
  const recipient = recipientAddress.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    throw new Error('Invalid recipient address.')
  }

  const amount = normalizeUsdcAmountInput(amountUsdc)
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Invalid USDC amount.')
  }

  const client = await createGatewayClient(ARC_TESTNET_CHAIN)
  const destinationChain = resolveSupportedChainName(destinationDomain)

  return await client.withdraw(amount, {
    chain: destinationChain,
    recipient: recipient as `0x${string}`,
    maxFee: DEFAULT_GATEWAY_MAX_FEE_USDC,
  })
}
