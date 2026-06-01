/**
 * ArcCopilot service worker — handles messages from content scripts.
 */

const PENDING_KEY = 'arccopilot:pending_send'

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
    return true // keep channel open for async response
  }
})

async function handleOpenSend(recipient: string): Promise<void> {
  const payload: PendingSend = { recipient: recipient.toLowerCase(), ts: Date.now() }
  await chrome.storage.local.set({ [PENDING_KEY]: payload })

  // chrome.action.openPopup() requires Chrome 127+ and a user-gesture context.
  // When triggered by a content-script click the gesture usually propagates.
  try {
    await (chrome.action as any).openPopup()
  } catch (err) {
    // Graceful degradation — the popup will still pre-fill if the user opens it manually.
    console.warn('[ArcCopilot SW] openPopup unavailable:', err)
  }
}

export {}
