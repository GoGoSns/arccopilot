import { generateText, getActiveAIProviderKey } from '@/lib/aiProvider'
import { debugWarn } from '@/lib/debug'
import { isValidAddress } from '@/lib/validation'

export type ImageReadSource = 'qr' | 'vision' | 'none'

export interface ResizedImage {
  base64: string
  imageData: ImageData
  mimeType: string
}

export interface ReadAddressFromImageResult {
  source: ImageReadSource
  raw: string | null
  address: string | null
  qrDecoderLoadFailed?: boolean
}

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function extractJsonPayload(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  return isValidAddress(candidate) ? candidate.toLowerCase() : null
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('IMAGE_LOAD_FAILED'))
    }

    image.decoding = 'async'
    image.src = url
  })
}

export async function resizeImage(blob: Blob, maxDim = 1024): Promise<ResizedImage> {
  const image = await loadImageFromBlob(blob)

  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) {
    throw new Error('IMAGE_DIMENSIONS_UNAVAILABLE')
  }

  const scale = Math.min(1, maxDim / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('CANVAS_CONTEXT_UNAVAILABLE')
  }

  context.imageSmoothingEnabled = true
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const imageData = context.getImageData(0, 0, targetWidth, targetHeight)
  const mimeType = SUPPORTED_MIME_TYPES.has(blob.type) ? blob.type : 'image/png'
  const dataUrl = canvas.toDataURL(mimeType)
  const base64 = dataUrl.split(',')[1] ?? ''

  return {
    base64,
    imageData,
    mimeType,
  }
}

type DecodeQrResult = {
  text: string | null
  loadFailed: boolean
}

async function decodeQr(imageData: ImageData): Promise<DecodeQrResult> {
  let jsQR: typeof import('jsqr').default

  try {
    const module = await import('jsqr')
    jsQR = module.default
  } catch (error) {
    debugWarn('[imageReader] jsQR load failed:', error)
    return {
      text: null,
      loadFailed: true,
    }
  }

  try {
    const result = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    })
    return {
      text: result?.data?.trim() || null,
      loadFailed: false,
    }
  } catch (error) {
    debugWarn('[imageReader] QR decode failed:', error)
    return {
      text: null,
      loadFailed: false,
    }
  }
}

export async function extractAddressWithVision(base64: string, mimeType: string): Promise<string | null> {
  const apiKey = await getActiveAIProviderKey()
  if (!apiKey) return null

  const prompt = 'Extract any Ethereum-style address (0x + 40 hex chars) visible in this image. Respond ONLY with JSON: {"address": "0x..."} or {"address": null}. No other text.'

  try {
    const text = await generateText(prompt, {
      image: { base64, mimeType },
      responseFormat: 'json',
      temperature: 0,
      topP: 0.95,
    })
    if (!text) return null

    const payload = extractJsonPayload(text)
    const parsed = safeParseJson(payload)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const address = normalizeAddress((parsed as { address?: unknown }).address as string | null | undefined)
    return address
  } catch (error) {
    debugWarn('[imageReader] AI vision decode failed:', error)
    return null
  }
}

export async function readAddressFromImage(blob: Blob): Promise<ReadAddressFromImageResult> {
  try {
    const resized = await resizeImage(blob, 1024)
    const { text: qrText, loadFailed: qrDecoderLoadFailed } = await decodeQr(resized.imageData)

    if (qrText) {
      const candidate = qrText.match(ADDRESS_RE)?.[0] ?? null
      if (candidate) {
        const address = normalizeAddress(candidate)
        if (address) {
          return {
            source: 'qr',
            raw: qrText,
            address,
            qrDecoderLoadFailed,
          }
        }
      }
    }

    const apiKey = await getActiveAIProviderKey()
    if (apiKey) {
      const visionAddress = await extractAddressWithVision(resized.base64, resized.mimeType)
      if (visionAddress) {
        return {
          source: 'vision',
          raw: visionAddress,
          address: visionAddress,
          qrDecoderLoadFailed,
        }
      }

      return {
        source: qrText ? 'qr' : 'vision',
        raw: qrText ?? null,
        address: null,
        qrDecoderLoadFailed,
      }
    }

    return {
      source: qrText ? 'qr' : 'none',
      raw: qrText ?? null,
      address: null,
      qrDecoderLoadFailed,
    }
  } catch (error) {
    debugWarn('[imageReader] readAddressFromImage failed:', error)
    return {
      source: 'none',
      raw: null,
      address: null,
      qrDecoderLoadFailed: false,
    }
  }
}
