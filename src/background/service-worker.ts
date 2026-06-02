/**
 * ArcCopilot service worker â€” handles messages from content scripts.
 */

import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'

interface PendingSend {
  recipient: string
  ts: number
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OPEN_SEND' && typeof message.recipient === 'string') {
    handleOpenSend(message.recipient)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[ArcCopilot SW] handleOpenSend error:', err)
        sendResponse({ ok: false })
      })
    return true
  }
})

async function handleOpenSend(recipient: string): Promise<void> {
  const payload: PendingSend = { recipient: recipient.toLowerCase(), ts: Date.now() }
  await chrome.storage.local.set({ [PENDING_SEND_STORAGE_KEY]: payload })

  try {
    if (typeof chrome.action?.openPopup !== 'function') {
      console.warn('[ArcCopilot SW] openPopup unavailable')
      return
    }

    await chrome.action.openPopup()
  } catch (err) {
    console.warn('[ArcCopilot SW] openPopup unavailable:', err)
  }
}

export {}
