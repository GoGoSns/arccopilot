import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  BLOCKSCOUT_BASE,
  USDC_CONTRACT,
} from '@/lib/constants'

export const arcTestnet = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
    public:  { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: BLOCKSCOUT_BASE },
  },
  contracts: {
    usdc: USDC_CONTRACT,
  },
  testnet: true,
} as const

export const USDC_ADDRESS = arcTestnet.contracts.usdc
export const EXPLORER_URL = arcTestnet.blockExplorers.default.url
export const FAUCET_URL = 'https://faucet.circle.com'
