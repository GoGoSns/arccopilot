export const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public:  { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  contracts: {
    usdc: '0x3600000000000000000000000000000000000000' as `0x${string}`,
  },
  testnet: true,
} as const

export const USDC_ADDRESS = arcTestnet.contracts.usdc
export const EXPLORER_URL = arcTestnet.blockExplorers.default.url
export const FAUCET_URL = 'https://faucet.circle.com'
