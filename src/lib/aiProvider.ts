import { chromeStorageGet, chromeStorageRemove, chromeStorageSet, fetchWithTimeout } from '@/lib/external'
import { formatText, t } from '@/lib/i18n'
import {
  AI_PROVIDER_STORAGE_KEY,
  ANTHROPIC_API_KEY_STORAGE_KEY,
  GEMINI_API_KEY_STORAGE_KEY,
  OPENAI_API_KEY_STORAGE_KEY,
} from '@/lib/storageKeys'

export type AIProvider = 'gemini' | 'openai' | 'anthropic'

export type AIMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type GenerateTextOptions = {
  systemPrompt?: string
  history?: AIMessage[]
  temperature?: number
  topP?: number
  responseFormat?: 'text' | 'json'
  image?: {
    base64: string
    mimeType: string
  }
  maxTokens?: number
  timeoutMs?: number
}

type ProviderConfig = {
  label: string
  model: string
  keyStorageKey: string
  keyUrl: string
}

export const DEFAULT_AI_PROVIDER: AIProvider = 'gemini'

export const AI_PROVIDER_CONFIG: Record<AIProvider, ProviderConfig> = {
  gemini: {
    label: 'Gemini',
    model: 'gemini-2.5-flash',
    keyStorageKey: GEMINI_API_KEY_STORAGE_KEY,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-4.1-mini',
    keyStorageKey: OPENAI_API_KEY_STORAGE_KEY,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic',
    model: 'claude-haiku-4-5-20251001',
    keyStorageKey: ANTHROPIC_API_KEY_STORAGE_KEY,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
}

export const AI_PROVIDERS = Object.keys(AI_PROVIDER_CONFIG) as AIProvider[]

function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === 'string' && AI_PROVIDERS.includes(value as AIProvider)
}

export async function getSelectedAIProvider(): Promise<AIProvider> {
  const stored = await chromeStorageGet(AI_PROVIDER_STORAGE_KEY)
  const raw = stored[AI_PROVIDER_STORAGE_KEY]
  if (isAIProvider(raw)) return raw

  if (Object.prototype.hasOwnProperty.call(stored, AI_PROVIDER_STORAGE_KEY)) {
    await chromeStorageRemove(AI_PROVIDER_STORAGE_KEY)
  }
  return DEFAULT_AI_PROVIDER
}

export async function setSelectedAIProvider(provider: AIProvider): Promise<void> {
  await chromeStorageSet({ [AI_PROVIDER_STORAGE_KEY]: provider })
}

export async function getProviderApiKey(provider: AIProvider): Promise<string | null> {
  const storageKey = AI_PROVIDER_CONFIG[provider].keyStorageKey
  const stored = await chromeStorageGet(storageKey)
  const raw = stored[storageKey]
  const key = typeof raw === 'string' ? raw.trim() : ''

  if (!key && Object.prototype.hasOwnProperty.call(stored, storageKey)) {
    await chromeStorageRemove(storageKey)
  }
  return key || null
}

export async function getAllProviderApiKeys(): Promise<Record<AIProvider, string | null>> {
  const storageKeys = AI_PROVIDERS.map((provider) => AI_PROVIDER_CONFIG[provider].keyStorageKey)
  const stored = await chromeStorageGet(storageKeys)

  return AI_PROVIDERS.reduce<Record<AIProvider, string | null>>((keys, provider) => {
    const raw = stored[AI_PROVIDER_CONFIG[provider].keyStorageKey]
    keys[provider] = typeof raw === 'string' && raw.trim() ? raw.trim() : null
    return keys
  }, { gemini: null, openai: null, anthropic: null })
}

export async function getActiveAIProviderKey(): Promise<string | null> {
  return getProviderApiKey(await getSelectedAIProvider())
}

export async function setProviderApiKey(provider: AIProvider, key: string): Promise<void> {
  const normalized = key.trim()
  if (!normalized) {
    await clearProviderApiKey(provider)
    return
  }
  await chromeStorageSet({ [AI_PROVIDER_CONFIG[provider].keyStorageKey]: normalized })
}

export async function clearProviderApiKey(provider: AIProvider): Promise<void> {
  await chromeStorageRemove(AI_PROVIDER_CONFIG[provider].keyStorageKey)
}

function providerError(provider: AIProvider, status: number): Error {
  const providerName = AI_PROVIDER_CONFIG[provider].label
  if (status === 401 || status === 403) {
    return new Error(formatText('aiProvider.invalidKey', { provider: providerName }))
  }
  if (status === 429) {
    return new Error(formatText('aiProvider.rateLimit', { provider: providerName }))
  }
  if (status === 400) {
    return new Error(formatText('aiProvider.badRequest', { provider: providerName }))
  }
  return new Error(formatText('aiProvider.httpError', { provider: providerName, status }))
}

async function requestGemini(prompt: string, key: string, opts: GenerateTextOptions): Promise<string> {
  const config = AI_PROVIDER_CONFIG.gemini
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = (opts.history ?? []).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }))
  const parts: Array<Record<string, unknown>> = []
  if (opts.image) {
    parts.push({ inline_data: { mime_type: opts.image.mimeType, data: opts.image.base64 } })
  }
  parts.push({ text: prompt })
  contents.push({ role: 'user', parts })

  const body = {
    ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
    contents,
    generationConfig: {
      ...(opts.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.topP != null ? { topP: opts.topP } : {}),
      ...(opts.maxTokens != null ? { maxOutputTokens: opts.maxTokens } : {}),
    },
  }

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
    },
    opts.timeoutMs,
  )
  if (!response.ok) throw providerError('gemini', response.status)

  let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  try {
    data = await response.json() as typeof data
  } catch {
    throw new Error(formatText('aiProvider.invalidResponse', { provider: config.label }))
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw new Error(t('aiProvider.emptyResponse'))
  return text
}

async function requestOpenAI(prompt: string, key: string, opts: GenerateTextOptions): Promise<string> {
  const config = AI_PROVIDER_CONFIG.openai
  const messages: Array<Record<string, unknown>> = []
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt })
  messages.push(...(opts.history ?? []).map((message) => ({ role: message.role, content: message.content })))

  const content = opts.image
    ? [
        { type: 'image_url', image_url: { url: `data:${opts.image.mimeType};base64,${opts.image.base64}` } },
        { type: 'text', text: prompt },
      ]
    : prompt
  messages.push({ role: 'user', content })

  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      store: false,
      ...(opts.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.topP != null ? { top_p: opts.topP } : {}),
      ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    }),
  }, opts.timeoutMs)
  if (!response.ok) throw providerError('openai', response.status)

  let data: { choices?: Array<{ message?: { content?: string } }> }
  try {
    data = await response.json() as typeof data
  } catch {
    throw new Error(formatText('aiProvider.invalidResponse', { provider: config.label }))
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error(t('aiProvider.emptyResponse'))
  return text
}

async function requestAnthropic(prompt: string, key: string, opts: GenerateTextOptions): Promise<string> {
  const config = AI_PROVIDER_CONFIG.anthropic
  const messages: Array<Record<string, unknown>> = (opts.history ?? []).map((message) => ({
    role: message.role,
    content: message.content,
  }))
  const content = opts.image
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: opts.image.mimeType, data: opts.image.base64 },
        },
        { type: 'text', text: prompt },
      ]
    : prompt
  messages.push({ role: 'user', content })

  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: opts.maxTokens ?? 2048,
      messages,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.topP != null ? { top_p: opts.topP } : {}),
    }),
  }, opts.timeoutMs)
  if (!response.ok) throw providerError('anthropic', response.status)

  let data: { content?: Array<{ type?: string; text?: string }> }
  try {
    data = await response.json() as typeof data
  } catch {
    throw new Error(formatText('aiProvider.invalidResponse', { provider: config.label }))
  }
  const text = data.content
    ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new Error(t('aiProvider.emptyResponse'))
  return text
}

export async function generateText(prompt: string, opts: GenerateTextOptions = {}): Promise<string> {
  const provider = await getSelectedAIProvider()
  const key = await getProviderApiKey(provider)
  if (!key) throw new Error('NO_API_KEY')

  try {
    if (provider === 'gemini') return await requestGemini(prompt, key, opts)
    if (provider === 'openai') return await requestOpenAI(prompt, key, opts)
    return await requestAnthropic(prompt, key, opts)
  } catch (error) {
    const isNetworkFailure = error instanceof TypeError
      || (error instanceof DOMException && error.name === 'AbortError')
    if (!isNetworkFailure) throw error
    if (provider === 'anthropic') {
      throw new Error(t('aiProvider.anthropicBrowserError'))
    }
    throw new Error(formatText('aiProvider.networkError', { provider: AI_PROVIDER_CONFIG[provider].label }))
  }
}
