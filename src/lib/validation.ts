const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
const USDC_DECIMALS = 6
const AMOUNT_REGEX = /^\d+(?:\.\d{1,6})?$/

export interface AmountValidationResult {
  valid: boolean
  overBalance: boolean
  amountMicros: bigint | null
}

function toUsdcMicros(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const text = typeof value === 'number' ? String(value) : value.trim()
  if (!text || !AMOUNT_REGEX.test(text)) return null

  const [wholePart, fractionPart = ''] = text.split('.')
  const whole = wholePart.length > 0 ? BigInt(wholePart) : 0n
  const fraction = fractionPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)
  return whole * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction || '0')
}

export function isValidAddress(addr: unknown): boolean {
  return typeof addr === 'string' && ADDRESS_REGEX.test(addr.trim())
}

export function isValidAmount(amount: unknown, balance?: unknown): AmountValidationResult {
  const amountMicros = toUsdcMicros(amount)
  const valid = amountMicros != null && amountMicros > 0n

  if (!valid) {
    return {
      valid: false,
      overBalance: false,
      amountMicros: null,
    }
  }

  const balanceMicros = toUsdcMicros(balance)
  return {
    valid: true,
    overBalance: balanceMicros != null ? amountMicros > balanceMicros : false,
    amountMicros,
  }
}
