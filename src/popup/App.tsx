import { useEffect } from 'react'
import { useStore, type View } from '@/lib/store'
import { Welcome }  from '@/pages/Welcome'
import { Wallet }   from '@/pages/Wallet'
import { Send }     from '@/pages/Send'
import { Receive }  from '@/pages/Receive'
import { Discover } from '@/pages/Discover'
import { Profile }  from '@/pages/Profile'
import { Settings } from '@/pages/Settings'
import { AddressBook } from '@/pages/AddressBook'
import { AddressDetail } from '@/pages/AddressDetail'

export default function App() {
  const isOnboarded   = useStore((s) => s.isOnboarded)
  const currentView   = useStore((s) => s.currentView)
  const previousView  = useStore((s) => s.previousView)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const goBack         = useStore((s) => s.goBack)

  const go = (v: View) => setCurrentView(v)

  // Check for pending tip-button send (set by service worker after content-script click)
  useEffect(() => {
    chrome.storage.local.get('arccopilot:pending_send', (result) => {
      const pending = result['arccopilot:pending_send']
      if (pending && Date.now() - pending.ts < 5_000) {
        go('send')
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Force welcome if not onboarded
  const view: View = !isOnboarded ? 'welcome' : currentView === 'welcome' ? 'wallet' : currentView

  if (view === 'welcome')        return <Welcome />
  if (view === 'send')           return <Send           onBack={goBack} />
  if (view === 'receive')        return <Receive        onBack={goBack} />
  if (view === 'discover')       return <Discover       onBack={goBack} />
  if (view === 'profile')        return <Profile        onBack={goBack} />
  if (view === 'settings')       return <Settings       onBack={goBack} />
  if (view === 'address-book')   return <AddressBook    onBack={goBack} />
  if (view === 'address-detail') return <AddressDetail  onBack={goBack} />

  return (
    <Wallet
      onSend={() => go('send')}
      onReceive={() => go('receive')}
      onDiscover={() => go('discover')}
      onMenu={() => go('profile')}
    />
  )
}
