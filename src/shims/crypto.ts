class BrowserRandomBytes {
  readonly length: number

  constructor(private readonly bytes: Uint8Array) {
    this.length = bytes.length
  }

  toString(encoding: string = 'utf8'): string {
    if (encoding !== 'hex') {
      throw new Error(`Unsupported encoding: ${encoding}`)
    }

    return Array.from(this.bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}

export function randomBytes(size: number): BrowserRandomBytes {
  const bytes = new Uint8Array(size)

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < size; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  return new BrowserRandomBytes(bytes)
}
