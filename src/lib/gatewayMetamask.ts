import {
  type Abi,
  type Address,
  type Chain,
  type Hex,
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  maxUint256,
  pad,
  parseUnits,
  zeroAddress,
} from 'viem'
import { CHAIN_CONFIGS, GATEWAY_DOMAINS } from '@circle-fin/x402-batching/client'
import { debugLog } from '@/lib/debug'
import { fetchWithTimeout } from '@/lib/external'
import { formatText, t } from '@/lib/i18n'
import {
  ensureMetaMaskAccounts,
  getMetaMaskFriendlyError,
  type MetaMaskErrorInfo,
} from '@/lib/metamask'
import { normalizeCreatorHandle } from '@/lib/creatorRegistry'
import { useStore } from '@/lib/store'

const GATEWAY_API_TESTNET = 'https://gateway-api-testnet.circle.com/v1'
const GATEWAY_REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_GATEWAY_MAX_FEE_USDC = '0.01'
const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as Address
const GATEWAY_MINTER_ADDRESS = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as Address
const ARC_TESTNET_CHAIN = CHAIN_CONFIGS.arcTestnet.chain
const ARC_TESTNET_USDC = CHAIN_CONFIGS.arcTestnet.usdc as Address

const TESTNET_DOMAIN_TO_CHAIN: Record<number, keyof typeof CHAIN_CONFIGS> = {
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

const GATEWAY_WALLET_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'depositFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'totalBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'availableBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawingBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawableBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawalDelay',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawalBlock',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'initiateWithdrawal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
] as const satisfies Abi

const GATEWAY_MINTER_ABI = [
  {
    name: 'gatewayMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attestationPayload', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const satisfies Abi

type MetaMaskRequestPayload = {
  method: string
  params?: unknown[] | Record<string, unknown>
}

type MetaMaskRequestResult<T> =
  | { result: T }
  | { error: MetaMaskErrorInfo }

type GatewayBalanceEntry = {
  total: bigint
  available: bigint
  withdrawing: bigint
  withdrawable: bigint
  formattedTotal: string
  formattedAvailable: string
  formattedWithdrawing: string
  formattedWithdrawable: string
}

export type GatewayBalanceSnapshot = {
  wallet: {
    balance: bigint
    formattedBalance: string
  }
  gateway: GatewayBalanceEntry
}

export type GatewayDepositResult = {
  approvalTxHash?: Hex
  depositTxHash: Hex
  amount: bigint
  formattedAmount: string
  depositor: Address
}

export type GatewayWithdrawResult = {
  mintTxHash: Hex
  amount: bigint
  formattedAmount: string
  sourceChain: string
  destinationChain: string
  recipient: Address
  destinationDomain: number
  destinationExplorerUrl: string
}

export type GatewayBatchTipRecipientInput = {
  handle: string
  address: string
  amount: string | number
}

export type GatewayBatchTipRecipientResult = {
  handle: string
  address: string
  amount: string
  txHash?: Hex
  explorerUrl?: string
  error?: string
}

export type GatewayBatchTipResult = {
  recipients: GatewayBatchTipRecipientResult[]
  totalRequestedAmount: string
  totalSentAmount: string
  paidCount: number
  failedCount: number
  availableBalance: string
}

type GatewayWalletClient = {
  signTypedData: (parameters: GatewaySignTypedDataParameters) => Promise<Hex>
  writeContract: (parameters: Record<string, unknown>) => Promise<Hex>
}

type GatewayPublicClient = {
  readContract: (parameters: Record<string, unknown>) => Promise<unknown>
  waitForTransactionReceipt: (parameters: Record<string, unknown>) => Promise<unknown>
}

type GatewaySignTypedDataParameters = Omit<Parameters<ReturnType<typeof createWalletClient>['signTypedData']>[0], 'account'> & {
  account?: Address
}

export type BatchEvmSigner = {
  address: Address
  signTypedData: (parameters: Omit<GatewaySignTypedDataParameters, 'account'>) => Promise<Hex>
}

function canUseChrome(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs?.query) && Boolean(chrome.scripting?.executeScript)
}

function normalizeUsdcAmountInput(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : value.trim()
  const withoutCurrency = raw.replace(/\s*USDC$/i, '').trim()
  if (/^\d+,\d{1,6}$/.test(withoutCurrency) && !withoutCurrency.includes('.')) {
    return withoutCurrency.replace(',', '.')
  }
  return withoutCurrency
}

function isValidAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

function toBytes32Address(address: Address): Hex {
  return pad(address.toLowerCase() as Hex, { size: 32 })
}

function randomHex32(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

async function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetchWithTimeout(input, init ?? {}, GATEWAY_REQUEST_TIMEOUT_MS)
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'))) {
      throw new Error(t('gogo.gatewayRequestTimedOut'))
    }
    throw error
  }
}

function getChainConfigForDomain(destinationDomain: number): (typeof CHAIN_CONFIGS)[keyof typeof CHAIN_CONFIGS] {
  const chainName = TESTNET_DOMAIN_TO_CHAIN[destinationDomain]
  if (!chainName) {
    throw new Error(`Unsupported destination chain domain: ${destinationDomain}`)
  }

  const chainConfig = CHAIN_CONFIGS[chainName]
  if (!chainConfig) {
    throw new Error(`Unsupported destination chain: ${chainName}`)
  }

  return chainConfig
}

function getRpcUrl(chain: Chain): string {
  return chain.rpcUrls.default.http[0] ?? chain.rpcUrls.public?.http[0] ?? ARC_TESTNET_CHAIN.rpcUrls.default.http[0]
}

function getExplorerUrl(chain: Chain): string {
  return chain.blockExplorers?.default?.url ?? ARC_TESTNET_CHAIN.blockExplorers!.default.url
}

async function getActiveWebTabId(): Promise<number> {
  if (!canUseChrome()) {
    throw new Error('Chrome scripting is unavailable.')
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    throw new Error('Please open a regular web page first.')
  }

  return tab.id
}

async function requestFromActiveTab<T>(tabId: number, payload: MetaMaskRequestPayload): Promise<T> {
  const results = await (chrome.scripting.executeScript as any)({
    target: { tabId },
    world: 'MAIN',
    args: [payload],
    func: async (request: MetaMaskRequestPayload): Promise<MetaMaskRequestResult<T>> => {
      try {
        const ethereum = (window as typeof window & { ethereum?: { request: (args: MetaMaskRequestPayload) => Promise<T> } }).ethereum
        if (!ethereum) {
          return {
            error: {
              message: 'MetaMask is not installed or not active on this page.',
            },
          }
        }

        const result = await ethereum.request(request)
        return { result }
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
  }) as Array<{ result?: MetaMaskRequestResult<T> }>

  const result = results[0]?.result
  if (!result) {
    throw new Error('No response from the active page.')
  }

  if ('error' in result) {
    const error = Object.assign(new Error(getMetaMaskFriendlyError(result.error)), {
      code: result.error.code,
    })
    throw error
  }

  return result.result
}

function createActiveTabEthereumProvider(tabId: number) {
  return {
    request: async <T>(payload: MetaMaskRequestPayload): Promise<T> => requestFromActiveTab<T>(tabId, payload),
  }
}

function createGatewayWalletClient(tabId: number, account: Address, chain: Chain = ARC_TESTNET_CHAIN): GatewayWalletClient {
  return createWalletClient({
    account,
    chain,
    transport: custom(createActiveTabEthereumProvider(tabId) as any),
  }) as unknown as GatewayWalletClient
}

function createGatewayPublicClient(chain: Chain = ARC_TESTNET_CHAIN): GatewayPublicClient {
  return createPublicClient({
    chain,
    transport: http(getRpcUrl(chain)),
  }) as unknown as GatewayPublicClient
}

function createBatchEvmSigner(walletClient: GatewayWalletClient, address: Address): BatchEvmSigner {
  return {
    address,
    signTypedData: (parameters) => walletClient.signTypedData({
      ...parameters,
      account: address,
    }),
  }
}

async function getConnectedGatewayContext(chain: Chain = ARC_TESTNET_CHAIN): Promise<{
  tabId: number
  account: Address
  walletClient: GatewayWalletClient
  publicClient: GatewayPublicClient
}> {
  const tabId = await getActiveWebTabId()
  const accountResult = await ensureMetaMaskAccounts(tabId)

  if ('error' in accountResult) {
    throw new Error(getMetaMaskFriendlyError(accountResult.error))
  }

  const firstAccount = accountResult.accounts[0]
  if (!firstAccount) {
    throw new Error('No connected MetaMask account was returned.')
  }

  const account = getAddress(firstAccount)
  useStore.getState().setWalletAddress(account)

  return {
    tabId,
    account,
    walletClient: createGatewayWalletClient(tabId, account, chain),
    publicClient: createGatewayPublicClient(chain),
  }
}

async function ensureChain(tabId: number, chain: Chain): Promise<void> {
  const chainId = `0x${chain.id.toString(16)}`
  const chainParams = {
    chainId,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [getRpcUrl(chain)],
    blockExplorerUrls: [getExplorerUrl(chain)],
  }

  try {
    await requestFromActiveTab<void>(tabId, {
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    })
  } catch (error: any) {
    const code = typeof error?.code === 'number' ? error.code : undefined
    if (code !== 4902) {
      throw error
    }

    await requestFromActiveTab<void>(tabId, {
      method: 'wallet_addEthereumChain',
      params: [chainParams],
    })
  }
}

async function readGatewayBalance(account: Address): Promise<GatewayBalanceEntry> {
  const response = await gatewayFetch(`${GATEWAY_API_TESTNET}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: [{ depositor: account, domain: GATEWAY_DOMAINS.arcTestnet }],
    }),
  })

  const data = await response.json() as {
    balances?: Array<{
      balance?: string
      withdrawing?: string
      withdrawable?: string
    }>
    message?: string
  }

  if (!response.ok) {
    throw new Error(`Gateway API balance fetch failed: ${data.message ?? response.statusText}`)
  }

  if (!Array.isArray(data.balances) || data.balances.length === 0) {
    throw new Error('Gateway API returned no balances for the depositor.')
  }

  const balanceData = data.balances[0]
  const available = parseUnits(balanceData.balance ?? '0', 6)
  const withdrawing = parseUnits(balanceData.withdrawing ?? '0', 6)
  const withdrawable = parseUnits(balanceData.withdrawable ?? '0', 6)
  const total = available + withdrawing

  return {
    total,
    available,
    withdrawing,
    withdrawable,
    formattedTotal: formatUnits(total, 6),
    formattedAvailable: formatUnits(available, 6),
    formattedWithdrawing: formatUnits(withdrawing, 6),
    formattedWithdrawable: formatUnits(withdrawable, 6),
  }
}

function normalizeAddressForTransfer(address: string): Address {
  if (!isValidAddress(address)) {
    throw new Error('Invalid recipient address.')
  }

  return getAddress(address)
}

function prepareBatchRecipient(input: GatewayBatchTipRecipientInput): {
  recipient?: {
    handle: string
    address: Address
    amount: string
    amountMicros: bigint
  }
  error?: string
} {
  const handle = normalizeCreatorHandle(typeof input.handle === 'string' ? input.handle : '')
  if (!handle) {
    return { error: t('settings.invalidCreatorHandle') }
  }

  const addressText = typeof input.address === 'string' ? input.address.trim() : ''
  if (!isValidAddress(addressText)) {
    return { error: t('gogo.invalidAddress') }
  }

  const amount = normalizeUsdcAmountInput(input.amount)
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return { error: t('gogo.invalidAmount') }
  }

  return {
    recipient: {
      handle,
      address: normalizeAddressForTransfer(addressText),
      amount,
      amountMicros: parseUnits(amount, 6),
    },
  }
}

function buildBurnIntent(params: {
  sourceAccount: Address
  recipient: Address
  value: bigint
  destinationChain: (typeof CHAIN_CONFIGS)[keyof typeof CHAIN_CONFIGS]
  maxFee: bigint
}): {
  maxBlockHeight: bigint
  maxFee: bigint
  spec: {
    version: number
    sourceDomain: number
    destinationDomain: number
    sourceContract: Hex
    destinationContract: Hex
    sourceToken: Hex
    destinationToken: Hex
    sourceDepositor: Hex
    destinationRecipient: Hex
    sourceSigner: Hex
    destinationCaller: Hex
    value: bigint
    salt: Hex
    hookData: Hex
  }
} {
  const sourceChainConfig = getChainConfigForDomain(GATEWAY_DOMAINS.arcTestnet)

  return {
    maxBlockHeight: maxUint256,
    maxFee: params.maxFee,
    spec: {
      version: 1,
      sourceDomain: sourceChainConfig.domain,
      destinationDomain: params.destinationChain.domain,
      sourceContract: toBytes32Address(GATEWAY_WALLET_ADDRESS),
      destinationContract: toBytes32Address(params.destinationChain.gatewayMinter),
      sourceToken: toBytes32Address(sourceChainConfig.usdc),
      destinationToken: toBytes32Address(params.destinationChain.usdc),
      sourceDepositor: toBytes32Address(params.sourceAccount),
      destinationRecipient: toBytes32Address(params.recipient),
      sourceSigner: toBytes32Address(params.sourceAccount),
      destinationCaller: toBytes32Address(zeroAddress),
      value: params.value,
      salt: randomHex32(),
      hookData: '0x',
    },
  }
}

export async function gatewayBalance(): Promise<GatewayBalanceSnapshot> {
  const { account, publicClient } = await getConnectedGatewayContext()
  const [walletBalance, gateway] = await Promise.all([
    publicClient.readContract({
      address: ARC_TESTNET_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }) as Promise<bigint>,
    readGatewayBalance(account),
  ])

  return {
    wallet: {
      balance: walletBalance,
      formattedBalance: formatUnits(walletBalance, 6),
    },
    gateway,
  }
}

export async function gatewayDeposit(amountUsdc: string | number): Promise<GatewayDepositResult> {
  const amount = normalizeUsdcAmountInput(amountUsdc)
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Invalid USDC amount.')
  }

  const depositAmount = parseUnits(amount, 6)
  const { tabId, account, walletClient, publicClient } = await getConnectedGatewayContext()
  await ensureChain(tabId, ARC_TESTNET_CHAIN)

  const balance = await publicClient.readContract({
    address: ARC_TESTNET_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  }) as bigint

  if (balance < depositAmount) {
    throw new Error(`Insufficient USDC balance. Have: ${formatUnits(balance, 6)}, Need: ${amount}`)
  }

  const allowance = await publicClient.readContract({
    address: ARC_TESTNET_USDC,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, GATEWAY_WALLET_ADDRESS],
  }) as bigint

  let approvalTxHash: Hex | undefined
  if (allowance < depositAmount) {
    approvalTxHash = await walletClient.writeContract({
      address: ARC_TESTNET_USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [GATEWAY_WALLET_ADDRESS, depositAmount],
    })

    try {
      await publicClient.waitForTransactionReceipt({ hash: approvalTxHash })
    } catch (error) {
      throw Object.assign(new Error(`Approval transaction failed: ${approvalTxHash}`), { cause: error })
    }
  }

  const depositTxHash = await walletClient.writeContract({
    address: GATEWAY_WALLET_ADDRESS,
    abi: GATEWAY_WALLET_ABI,
    functionName: 'deposit',
    args: [ARC_TESTNET_USDC, depositAmount],
    gas: 120000n,
  })

  try {
    await publicClient.waitForTransactionReceipt({ hash: depositTxHash })
  } catch (error) {
    throw Object.assign(new Error(`Deposit transaction failed: ${depositTxHash}`), { cause: error })
  }

  return {
    approvalTxHash,
    depositTxHash,
    amount: depositAmount,
    formattedAmount: amount,
    depositor: account,
  }
}

export async function gatewayWithdraw(
  recipientAddress: string,
  amountUsdc: string | number,
  destinationDomain: number = GATEWAY_DOMAINS.arcTestnet,
): Promise<GatewayWithdrawResult> {
  const recipient = normalizeAddressForTransfer(recipientAddress)
  const amount = normalizeUsdcAmountInput(amountUsdc)
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Invalid USDC amount.')
  }

  const withdrawAmount = parseUnits(amount, 6)
  const destinationChain = getChainConfigForDomain(destinationDomain)
  const { tabId, account, walletClient, publicClient } = await getConnectedGatewayContext()
  await ensureChain(tabId, ARC_TESTNET_CHAIN)

  const gateway = await readGatewayBalance(account)
  if (gateway.available < withdrawAmount) {
    throw new Error(`Insufficient available balance. Have: ${gateway.formattedAvailable}, Need: ${amount}`)
  }

  const signer = createBatchEvmSigner(walletClient, account)
  const burnIntent = buildBurnIntent({
    sourceAccount: account,
    recipient,
    value: withdrawAmount,
    destinationChain,
    maxFee: parseUnits(DEFAULT_GATEWAY_MAX_FEE_USDC, 6),
  })

  debugLog('[Gateway] Stage (a): signing BurnIntent via MetaMask EIP-712')
  let burnIntentSignature: Hex
  try {
    burnIntentSignature = await signer.signTypedData({
      domain: {
        name: 'GatewayWallet',
        version: '1',
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
        ],
        TransferSpec: [
          { name: 'version', type: 'uint32' },
          { name: 'sourceDomain', type: 'uint32' },
          { name: 'destinationDomain', type: 'uint32' },
          { name: 'sourceContract', type: 'bytes32' },
          { name: 'destinationContract', type: 'bytes32' },
          { name: 'sourceToken', type: 'bytes32' },
          { name: 'destinationToken', type: 'bytes32' },
          { name: 'sourceDepositor', type: 'bytes32' },
          { name: 'destinationRecipient', type: 'bytes32' },
          { name: 'sourceSigner', type: 'bytes32' },
          { name: 'destinationCaller', type: 'bytes32' },
          { name: 'value', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
          { name: 'hookData', type: 'bytes' },
        ],
        BurnIntent: [
          { name: 'maxBlockHeight', type: 'uint256' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'spec', type: 'TransferSpec' },
        ],
      },
      primaryType: 'BurnIntent',
      message: burnIntent,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`Gateway withdraw failed at BurnIntent signing: ${msg}`)
  }
  debugLog('[Gateway] Stage (a): BurnIntent signed OK')

  debugLog('[Gateway] Stage (b): POST /transfer to Circle Gateway API')
  const transferResponse = await gatewayFetch(`${GATEWAY_API_TESTNET}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ burnIntent, signature: burnIntentSignature }], bigintReplacer),
  })

  const rawTransferBody = await transferResponse.text()
  debugLog(`[Gateway] Stage (b): HTTP ${transferResponse.status} — ${rawTransferBody.slice(0, 300)}`)

  let transferResult: {
    success?: boolean
    error?: string
    message?: string
    attestation?: Hex
    signature?: Hex
  }
  try {
    transferResult = JSON.parse(rawTransferBody) as typeof transferResult
  } catch {
    throw new Error(`Gateway /transfer: HTTP ${transferResponse.status} — ${rawTransferBody.slice(0, 300)}`)
  }

  if (!transferResponse.ok || transferResult.success === false || transferResult.error || !transferResult.attestation || !transferResult.signature) {
    const detail = transferResult.message ?? transferResult.error ?? rawTransferBody.slice(0, 300) ?? transferResponse.statusText
    throw new Error(`Gateway /transfer: HTTP ${transferResponse.status} — ${detail}`)
  }
  debugLog('[Gateway] Stage (b): /transfer OK, got attestation')

  await ensureChain(tabId, destinationChain.chain)
  const destinationWalletClient = createGatewayWalletClient(tabId, account, destinationChain.chain)
  const destinationPublicClient = createGatewayPublicClient(destinationChain.chain)

  debugLog('[Gateway] Stage (c): calling gatewayMint on-chain')
  let mintTxHash: Hex
  try {
    mintTxHash = await destinationWalletClient.writeContract({
      address: destinationChain.gatewayMinter,
      abi: GATEWAY_MINTER_ABI,
      functionName: 'gatewayMint',
      args: [transferResult.attestation, transferResult.signature],
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`Gateway withdraw failed at gatewayMint: ${msg}`)
  }
  debugLog(`[Gateway] Stage (c): gatewayMint submitted — ${mintTxHash}`)

  try {
    await destinationPublicClient.waitForTransactionReceipt({ hash: mintTxHash })
  } catch (error) {
    throw Object.assign(new Error(`Mint transaction failed: ${mintTxHash}`), { cause: error })
  }
  debugLog(`[Gateway] Stage (c): gatewayMint confirmed — ${mintTxHash}`)

  return {
    mintTxHash,
    amount: withdrawAmount,
    formattedAmount: amount,
    sourceChain: ARC_TESTNET_CHAIN.name,
    destinationChain: destinationChain.chain.name,
    recipient,
    destinationDomain,
    destinationExplorerUrl: getExplorerUrl(destinationChain.chain),
  }
}

export async function gatewayBatchTip(recipients: GatewayBatchTipRecipientInput[]): Promise<GatewayBatchTipResult> {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error(t('gogo.gatewayBatchEmpty'))
  }

  const indexedResults: Array<GatewayBatchTipRecipientResult & { index: number }> = []
  const validRecipients: Array<{
    index: number
    handle: string
    address: Address
    amount: string
    amountMicros: bigint
  }> = []

  let requestedMicros = 0n

  for (const [index, input] of recipients.entries()) {
    const prepared = prepareBatchRecipient(input)
    if (!prepared.recipient) {
      indexedResults.push({
        index,
        handle: normalizeCreatorHandle(typeof input.handle === 'string' ? input.handle : '') || (typeof input.handle === 'string' ? input.handle.trim() : ''),
        address: typeof input.address === 'string' ? input.address.trim() : '',
        amount: normalizeUsdcAmountInput(input.amount),
        error: prepared.error ?? t('gogo.couldNotSendViaGateway'),
      })
      continue
    }

    validRecipients.push({
      index,
      ...prepared.recipient,
    })
    requestedMicros += prepared.recipient.amountMicros
  }

  if (validRecipients.length === 0) {
    return {
      recipients: indexedResults
        .sort((left, right) => left.index - right.index)
        .map(({ index: _index, ...recipient }) => recipient),
      totalRequestedAmount: '0',
      totalSentAmount: '0',
      paidCount: 0,
      failedCount: indexedResults.length,
      availableBalance: '0',
    }
  }

  const balanceSnapshot = await gatewayBalance()
  const availableMicros = balanceSnapshot.gateway.available
  const availableBalance = balanceSnapshot.gateway.formattedAvailable

  if (requestedMicros > availableMicros) {
    const insufficientError = formatText('gogo.gatewayInsufficientBalance', {
      current: availableBalance,
      needed: formatUnits(requestedMicros, 6),
    })

    return {
      recipients: [
        ...indexedResults,
        ...validRecipients.map((recipient) => ({
          index: recipient.index,
          handle: recipient.handle,
          address: recipient.address,
          amount: recipient.amount,
          error: insufficientError,
        })),
      ]
        .sort((left, right) => left.index - right.index)
        .map(({ index: _index, ...recipient }) => recipient),
      totalRequestedAmount: formatUnits(requestedMicros, 6),
      totalSentAmount: '0',
      paidCount: 0,
      failedCount: validRecipients.length + indexedResults.length,
      availableBalance,
    }
  }

  let sentMicros = 0n

  for (const recipient of validRecipients) {
    try {
      const result = await gatewayWithdraw(recipient.address, recipient.amount, GATEWAY_DOMAINS.arcTestnet)
      indexedResults.push({
        index: recipient.index,
        handle: recipient.handle,
        address: recipient.address,
        amount: recipient.amount,
        txHash: result.mintTxHash,
        explorerUrl: result.destinationExplorerUrl,
      })
      sentMicros += result.amount
    } catch (error) {
      const message = error instanceof Error ? error.message : t('gogo.couldNotSendViaGateway')
      indexedResults.push({
        index: recipient.index,
        handle: recipient.handle,
        address: recipient.address,
        amount: recipient.amount,
        error: message,
      })
    }
  }

  const paidCount = indexedResults.filter((recipient) => Boolean(recipient.txHash)).length
  const failedCount = indexedResults.length - paidCount

  return {
    recipients: indexedResults
      .sort((left, right) => left.index - right.index)
      .map(({ index: _index, ...recipient }) => recipient),
    totalRequestedAmount: formatUnits(requestedMicros, 6),
    totalSentAmount: formatUnits(sentMicros, 6),
    paidCount,
    failedCount,
    availableBalance,
  }
}
