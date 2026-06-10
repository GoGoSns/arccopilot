import { useEffect } from 'react'
import { useStore, type View } from '@/lib/store'
import { PENDING_SEND_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'
import { Welcome } from '@/pages/Welcome'
import { Wallet } from '@/pages/Wallet'
import { Send } from '@/pages/Send'
import { Receive } from '@/pages/Receive'
import { Discover } from '@/pages/Discover'
import { Profile } from '@/pages/Profile'
import { Settings } from '@/pages/Settings'
import { AddressBook } from '@/pages/AddressBook'
import { AddressDetail } from '@/pages/AddressDetail'
import { DailyBrief } from '@/pages/DailyBrief'
import { GogoAI } from '@/pages/GogoAI'
import { useLocale } from '@/lib/i18n'

const VALID_VIEWS: View[] = [
  'welcome',
  'wallet',
  'send',
  'receive',
  'discover',
  'profile',
  'settings',
  'address-book',
  'address-detail',
  'daily-brief',
  'gogo-ai',
]

function isView(value: unknown): value is View {
  return typeof value === 'string' && VALID_VIEWS.includes(value as View)
}

function isPendingSend(value: unknown): value is { ts: number; recipient?: string; amount?: string } {
  if (!value || typeof value !== 'object') return false

  const pending = value as { ts?: unknown; recipient?: unknown; amount?: unknown }
  return typeof pending.ts === 'number'
    && (pending.recipient === undefined || typeof pending.recipient === 'string')
    && (pending.amount === undefined || typeof pending.amount === 'string')
}

export default function App() {
  useLocale()
  const isOnboarded = useStore((s) => s.isOnboarded)
  const currentView = useStore((s) => s.currentView)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const goBack = useStore((s) => s.goBack)

  const go = (v: View) => setCurrentView(v)

  useEffect(() => {
    chrome.storage.local.get(
      [PENDING_SEND_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY],
      (result) => {
        const pendingView = result[PENDING_VIEW_STORAGE_KEY]
        if (isView(pendingView) && isOnboarded) {
          go(pendingView)
          void chrome.storage.local.remove(PENDING_VIEW_STORAGE_KEY)
          return
        } else if (pendingView != null && !isView(pendingView)) {
          void chrome.storage.local.remove(PENDING_VIEW_STORAGE_KEY)
        }

        const pending = result[PENDING_SEND_STORAGE_KEY]
        if (isPendingSend(pending) && Date.now() - pending.ts < 5_000) {
          go('send')
        } else {
          void chrome.storage.local.remove(PENDING_SEND_STORAGE_KEY)
        }
      },
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const view: View = !isOnboarded ? 'welcome' : currentView === 'welcome' ? 'wallet' : currentView

  if (view === 'welcome') return <Welcome />
  if (view === 'send') return <Send onBack={goBack} />
  if (view === 'receive') return <Receive onBack={goBack} />
  if (view === 'discover') return <Discover onBack={goBack} />
  if (view === 'profile') return <Profile onBack={goBack} />
  if (view === 'settings') return <Settings onBack={goBack} />
  if (view === 'address-book') return <AddressBook onBack={goBack} />
  if (view === 'address-detail') return <AddressDetail onBack={goBack} />
  if (view === 'daily-brief') return <DailyBrief onBack={goBack} />
  if (view === 'gogo-ai') return <GogoAI onBack={goBack} />

  return (
    <Wallet
      onSend={() => go('send')}
      onReceive={() => go('receive')}
      onDiscover={() => go('discover')}
      onMenu={() => go('settings')}
      onOpenGogo={() => go('gogo-ai')}
    />
  )
}
