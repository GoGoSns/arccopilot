import { useStore, type View } from '@/lib/store'
import { Welcome }  from '@/pages/Welcome'
import { Wallet }   from '@/pages/Wallet'
import { Send }     from '@/pages/Send'
import { Receive }  from '@/pages/Receive'
import { Discover } from '@/pages/Discover'
import { Profile }  from '@/pages/Profile'
import { Settings } from '@/pages/Settings'

export default function App() {
  const isOnboarded   = useStore((s) => s.isOnboarded)
  const currentView   = useStore((s) => s.currentView)
  const setCurrentView = useStore((s) => s.setCurrentView)

  const go = (v: View) => setCurrentView(v)

  // Force welcome if not onboarded
  const view: View = !isOnboarded ? 'welcome' : currentView === 'welcome' ? 'wallet' : currentView

  if (view === 'welcome')  return <Welcome />
  if (view === 'send')     return <Send     onBack={() => go('wallet')} />
  if (view === 'receive')  return <Receive  onBack={() => go('wallet')} />
  if (view === 'discover') return <Discover onBack={() => go('wallet')} />
  if (view === 'profile')  return <Profile  onBack={() => go('wallet')} />
  if (view === 'settings') return <Settings onBack={() => go('wallet')} />

  return (
    <Wallet
      onSend={() => go('send')}
      onReceive={() => go('receive')}
      onDiscover={() => go('discover')}
      onMenu={() => go('profile')}
    />
  )
}
