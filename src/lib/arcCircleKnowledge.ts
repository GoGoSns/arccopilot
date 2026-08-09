export type ArcCircleKnowledgeLocale = 'en' | 'tr'

type KnowledgeSource = {
  label: string
  url: string
}

type KnowledgeSection = {
  id: string
  title: string
  summary: string
  bullets: string[]
  sources: KnowledgeSource[]
}

export const ARC_CIRCLE_KNOWLEDGE_UPDATED_AT = '2026-07-30'

const SOURCES = {
  arcLlms: {
    label: 'Arc docs llms.txt',
    url: 'https://docs.arc.io/llms.txt',
  },
  circleLlms: {
    label: 'Circle developer docs llms.txt',
    url: 'https://developers.circle.com/llms.txt',
  },
  usdcAddresses: {
    label: 'Circle USDC contract addresses',
    url: 'https://developers.circle.com/stablecoins/usdc-contract-addresses',
  },
  walletChains: {
    label: 'Circle supported blockchains',
    url: 'https://developers.circle.com/wallets/supported-blockchains',
  },
} satisfies Record<string, KnowledgeSource>

export const ARC_CIRCLE_KNOWLEDGE_SECTIONS: KnowledgeSection[] = [
  {
    id: 'arc-core',
    title: 'Arc core',
    summary: 'Arc is Circle-aligned programmable money infrastructure: an EVM-compatible L1 with USDC-native gas, fast deterministic finality, and a testnet-first developer surface.',
    bullets: [
      'Arc is designed for programmable money and agent/payment applications.',
      'Arc Testnet chain id is 5042002; hex chain id is 0x4CEF52.',
      'RPC: https://rpc.testnet.arc.network; explorer: https://testnet.arcscan.app.',
      'Arc Testnet is the safe default. Do not assume Arc mainnet is available for production writes until official docs confirm it.',
      'Arc native gas is USDC-denominated. Treat gas/accounting separately from ERC-20 USDC token math.',
    ],
    sources: [SOURCES.arcLlms],
  },
  {
    id: 'usdc-rules',
    title: 'USDC rules',
    summary: 'USDC is the unit of account for Regent. Token transfers must use exact chain IDs, canonical contracts, and 6-decimal token math.',
    bullets: [
      'ERC-20 USDC token amounts use 6 decimals. Never parse USDC token transfers with 18 decimals.',
      'Arc Testnet ERC-20 USDC: 0x3600000000000000000000000000000000000000.',
      'Arc native gas uses USDC-denominated gas accounting; do not confuse native gas decimals with ERC-20 USDC decimals.',
      'Never use bridged or lookalike USDC unless the user explicitly chooses it and the contract is verified.',
      'Before any mainnet write, require explicit user confirmation with chain, amount, recipient, and asset.',
    ],
    sources: [SOURCES.arcLlms, SOURCES.usdcAddresses],
  },
  {
    id: 'circle-stack',
    title: 'Circle stack',
    summary: 'Circle gives Regent the money movement rails: wallets, USDC, Gateway, CCTP/Bridge, App Kit, x402 nanopayments, and smart contract tooling.',
    bullets: [
      'Wallets: choose developer-controlled, user-controlled, or modular/passkey wallets based on custody and UX.',
      'Gateway: unified USDC balance for instant chain-abstracted settlement and x402-style paid services.',
      'CCTP V2 / Bridge: canonical USDC movement across supported chains.',
      'App Kit can unify send, swap, bridge, and balance flows as the product grows.',
      'Smart Contract Platform can help deploy/import/monitor contracts, but contract writes must remain policy-bound.',
    ],
    sources: [SOURCES.circleLlms, SOURCES.walletChains],
  },
  {
    id: 'gateway',
    title: 'Gateway and x402',
    summary: 'Gateway lets Regent keep a unified USDC spend surface while preserving explicit approval for paid actions.',
    bullets: [
      'Gateway testnet REST base: https://gateway-api-testnet.circle.com/v1/.',
      'Gateway mainnet REST base: https://gateway-api.circle.com/v1/.',
      'Arc Testnet Gateway domain is 26.',
      'EVM Gateway Wallet mainnet: 0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE.',
      'EVM Gateway Wallet testnet: 0x0077777d7EBA4688BDeF3E311b846F25870A19B9.',
      'x402 paid resources must show exact price and seller before signature. No hidden approval.',
    ],
    sources: [SOURCES.circleLlms],
  },
  {
    id: 'network-map',
    title: 'Network map',
    summary: 'Regent should know both testnet and mainnet surfaces, but default to testnet while the product is being built and judged.',
    bullets: [
      'Primary working network: Arc Testnet, chain id 5042002.',
      'Common mainnet USDC references include Ethereum, Base, Arbitrum, Polygon PoS, Avalanche, and Optimism canonical USDC contracts.',
      'Common testnet USDC references include Arc Testnet, Sepolia, Base Sepolia, Arbitrum Sepolia, Fuji, Amoy, and OP Sepolia.',
      'Solana USDC is mint-address based, not EVM address based.',
      'Every network entry must be verified against official docs before being used for funds.',
    ],
    sources: [SOURCES.usdcAddresses, SOURCES.walletChains],
  },
  {
    id: 'assistant-policy',
    title: 'Assistant safety policy',
    summary: 'The product thesis is autonomy without bypass: signals become suggestions, suggestions become policy-checked actions, and money movement needs proof.',
    bullets: [
      'Read-only intelligence can be proactive; money movement must stay behind policy and explicit approval.',
      'No mainnet writes unless the user explicitly asks for mainnet and confirms terms.',
      'Never store or reveal API keys, entity secrets, bearer tokens, private keys, or cron secrets.',
      'For token/meme radar, do not call something tradable without contract, explorer, liquidity, holder, and permission evidence.',
      'For suspicious contracts, explain risk instead of giving buy recommendations.',
    ],
    sources: [SOURCES.arcLlms, SOURCES.circleLlms],
  },
]

export function parseArcCircleKnowledgeIntent(message: string): ArcCircleKnowledgeLocale | null {
  const normalized = message
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return null

  const hasKnowledgeKeyword = /\b(?:knowledge|docs|learn|teach|guide|bilgi|ogret|ogren|rehber|dokuman)\b/.test(normalized)
  const hasArcCircleKeyword = /\b(?:arc|circle|usdc|gateway|x402|testnet|mainnet|cctp|bridge|wallet|network|ag|aglar)\b/.test(normalized)
  const exactKnowledgeMenu = /^(?:arc circle|circle arc|arc bilgi|circle bilgi|arc rehber|circle rehber|arc docs|circle docs|usdc bilgi|gateway bilgi)$/.test(normalized)
  const asksCoreConcept = /^(?:arc testnet nedir|arc nedir|circle nedir|gateway nedir|usdc decimals|usdc decimal|mainnet testnet|testnet mainnet)$/.test(normalized)

  if (exactKnowledgeMenu || asksCoreConcept || (hasKnowledgeKeyword && hasArcCircleKeyword)) {
    return /\b(?:bilgi|ogret|ogren|rehber|nedir|ag|aglar)\b/.test(normalized) ? 'tr' : 'en'
  }

  return null
}

export function buildArcCircleKnowledgeBrief(locale: ArcCircleKnowledgeLocale): string {
  const isTr = locale === 'tr'
  const header = isTr
    ? `Arc + Circle bilgi omurgasi (${ARC_CIRCLE_KNOWLEDGE_UPDATED_AT})`
    : `Arc + Circle knowledge spine (${ARC_CIRCLE_KNOWLEDGE_UPDATED_AT})`

  const intro = isTr
    ? 'Benim guvenli varsayimim: Arc Testnet uzerinde calis, USDC token math icin 6 decimal kullan, mainnet yazma islemlerini ancak acik onayla yap.'
    : 'My safe default: build on Arc Testnet, use 6 decimals for USDC token math, and only perform mainnet writes after explicit confirmation.'

  const sectionLines = ARC_CIRCLE_KNOWLEDGE_SECTIONS.map((section) => [
    `${section.title}: ${section.summary}`,
    ...section.bullets.slice(0, 3).map((bullet) => `- ${bullet}`),
  ].join('\n'))

  const sourceLines = [
    SOURCES.arcLlms,
    SOURCES.circleLlms,
    SOURCES.usdcAddresses,
    SOURCES.walletChains,
  ].map((source) => `- ${source.label}: ${source.url}`)

  return [
    header,
    '',
    intro,
    '',
    ...sectionLines.flatMap((section) => [section, '']),
    isTr ? 'Kaynaklar:' : 'Sources:',
    ...sourceLines,
    '',
    isTr
      ? 'Sonraki adim: bunu dashboard icinde katmanli Knowledge / Network Map ekranina cevirip, token radar ve takvimle baglayabiliriz.'
      : 'Next step: turn this into a layered Knowledge / Network Map screen and connect it to token radar plus calendar.',
  ].join('\n')
}
