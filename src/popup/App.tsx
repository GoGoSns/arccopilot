import { useEffect } from 'react'
import { useStore, type View } from '@/lib/store'
import { PENDING_SEND_STORAGE_KEY } from '@/lib/storageKeys'
import { Welcome } from '@/pages/Welcome'
import { Wallet } from '@/pages/Wallet'
import { Send } from '@/pages/Send'
import { Receive } from '@/pages/Receive'
import { Discover } from '@/pages/Discover'
import { Profile } from '@/pages/Profile'
import { Settings } from '@/pages/Settings'
import { AddressBook } from '@/pages/AddressBook'
import { AddressDetail } from '@/pages/AddressDetail'

export default function App() {
  const isOnboarded = useStore((s) => s.isOnboarded)
  const currentView = useStore((s) => s.currentView)
  const previousView = useStore((s) => s.previousView)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const goBack = useStore((s) => s.goBack)

  const go = (v: View) => setCurrentView(v)

  useEffect(() => {
    chrome.storage.local.get(PENDING_SEND_STORAGE_KEY, (result) => {
      const pending = result[PENDING_SEND_STORAGE_KEY]
      if (pending && Date.now() - pending.ts < 5_000) {
        go('send')
      }
    })
  }, [])

  const view: View = !isOnboarded ? 'welcome' : currentView === 'welcome' ? 'wallet' : currentView

  if (view === 'welcome') return <Welcome />
  if (view === 'send') return <Send onBack={goBack} />
  if (view === 'receive') return <Receive onBack={goBack} />
  if (view === 'discover') return <Discover onBack={goBack} />
  if (view === 'profile') return <Profile onBack={goBack} />
  if (view === 'settings') return <Settings onBack={goBack} />
  if (view === 'address-book') return <AddressBook onBack={goBack} />
  if (view === 'address-detail') return <AddressDetail onBack={goBack} />

  return (
    <Wallet
      onSend={() => go('send')}
      onReceive={() => go('receive')}
      onDiscover={() => go('discover')}
      onMenu={() => go('settings')}
    />
  )
}
