import { formatText, t } from '@/lib/i18n'
import { isValidAddress } from '@/lib/validation'

const USDC_DECIMALS = 6
const MICRO_UNITS_PER_USDC = 10n ** BigInt(USDC_DECIMALS)

export interface NanoTipRecipientInput {
  address: string
  amount: string | number
}

export interface PreparedNanoTipRecipient {
  address: string
  amount: string
}

export interface PreparedNanoTipBatch {
  recipients: PreparedNanoTipRecipient[]
  totalAmountUsdc: string
  preparedAt: number
}

// Circle Gateway / x402 reference notes from circlefin/arc-nanopayments:
// - Buyer-side batching uses `@circle-fin/x402-batching/client` via `GatewayClient`
//   and pays with `gateway.pay(url, { method, body })`.
// - Seller-side verification uses `@circle-fin/x402-batching/server`
//   via `BatchFacilitatorClient.verify(...)` and `.settle(...)`.
// - Arc testnet values observed in the reference:
//   network: `eip155:5042002`
//   USDC: `0x3600000000000000000000000000000000000000`
//   Gateway Wallet / verifying contract: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
// TODO: replace the sequential prepared-send scaffold below with a real
// Circle Gateway batch call while preserving this interface.

function normalizeAmountText(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : value.trim()
  return text.replace(',', '.').trim()
}

function parseAmountToMicros(value: string | number): bigint | null {
  const text = normalizeAmountText(value)
  if (!text || !/^\d+(?:\.\d{1,6})?$/.test(text)) return null

  const [wholePart, fractionPart = ''] = text.split('.')
  const whole = BigInt(wholePart)
  const fraction = fractionPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)
  return (whole * MICRO_UNITS_PER_USDC) + BigInt(fraction || '0')
}

function formatMicros(amountMicros: bigint): string {
  const whole = amountMicros / MICRO_UNITS_PER_USDC
  const fraction = amountMicros % MICRO_UNITS_PER_USDC

  if (fraction === 0n) {
    return whole.toString()
  }

  const fractionText = fraction.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fractionText}`
}

export async function prepareBatchNanoTip(recipients: NanoTipRecipientInput[]): Promise<PreparedNanoTipBatch> {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error(t('nanopay.batchEmpty'))
  }

  const preparedRecipients: PreparedNanoTipRecipient[] = []
  let totalMicros = 0n

  for (const [index, recipient] of recipients.entries()) {
    const address = typeof recipient?.address === 'string' ? recipient.address.trim().toLowerCase() : ''
    if (!isValidAddress(address)) {
      throw new Error(formatText('nanopay.batchInvalidRecipient', {
        index: String(index + 1),
      }))
    }

    const amountMicros = parseAmountToMicros(recipient?.amount ?? '')
    if (amountMicros == null || amountMicros <= 0n) {
      throw new Error(formatText('nanopay.batchInvalidAmount', {
        index: String(index + 1),
      }))
    }

    preparedRecipients.push({
      address,
      amount: formatMicros(amountMicros),
    })
    totalMicros += amountMicros
  }

  return {
    recipients: preparedRecipients,
    totalAmountUsdc: formatMicros(totalMicros),
    preparedAt: Date.now(),
  }
}
