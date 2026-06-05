const GEMINI_API_KEY_STORAGE_KEY = 'arccopilot:gemini-api-key'

export type Pattern = {
  kind: string
  [key: string]: unknown
}

export interface GogoContext {
  walletAddress: string
  balance: string
  recentTransfers: Array<{ from: string; to: string; amount: string; timestamp: string }>
  addressBook: Record<string, { label?: string; tag?: string }>
  whales: string[]
  patterns: Pattern[]
}

export interface GogoAction {
  type: 'send' | 'view_address' | 'track_whale' | 'none'
  params: Record<string, any>
}

export interface GogoResponse {
  reply: string
  action: GogoAction
}

export interface Message {
  role: 'user' | 'model'
  content: string
  action?: GogoAction
}

const SYSTEM_PROMPT = `You are Gogo, an AI assistant inside ArcCopilot - a Chrome extension wallet for Arc Network testnet. Your job is to help users with USDC transactions, address management, and onchain insights.

Always respond in JSON format:
{
  "reply": "human readable response",
  "action": {
    "type": "send | view_address | track_whale | none",
    "params": {} // type-specific
  }
}

Action params:
- send: { recipient: "0x..." or label match, amount: "5.00" }
- view_address: { address: "0x..." }
- track_whale: { address: "0x..." }
- none: no params

Keep replies concise (max 2 sentences). Be friendly, use the user's language (Turkish or English based on input). If user requests an action that needs clarification, ask before proposing the action.`

export async function getApiKey(): Promise<string | null> {
  const res = await chrome.storage.local.get(GEMINI_API_KEY_STORAGE_KEY)
  return res[GEMINI_API_KEY_STORAGE_KEY] || null
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [GEMINI_API_KEY_STORAGE_KEY]: key })
}

export async function clearApiKey(): Promise<void> {
  await chrome.storage.local.remove(GEMINI_API_KEY_STORAGE_KEY)
}

export async function askGogo(
  userMessage: string,
  context: GogoContext,
  history: Message[]
): Promise<GogoResponse> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('NO_API_KEY')

  const modelName = 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`

  const prompt = `${SYSTEM_PROMPT}\n\nContext:\n${JSON.stringify(context)}\n\nHistory:\n${history
    .map((m) => `${m.role === 'user' ? 'User' : 'Gogo'}: ${m.content}`)
    .join('\n')}\n\nUser: ${userMessage}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: 'application/json',
        },
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('[GogoAI] API error:', res.status, errorText)
      if (res.status === 403) throw new Error('Invalid API key. Update in Settings.')
      if (res.status === 400) throw new Error('Bad request. Model may be deprecated.')
      if (res.status === 429) throw new Error('Free tier limit reached. Try in a minute.')
      throw new Error(`API error ${res.status}`)
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('PARSE_ERROR')

    try {
      return JSON.parse(text) as GogoResponse
    } catch {
      // Fallback if AI didn't return valid JSON even with response_mime_type
      throw new Error('PARSE_ERROR')
    }
  } catch (err: any) {
    console.error('[GogoAI] Caught:', err)
    if (err instanceof Error) throw err
    throw new Error(String(err))
  }
}
