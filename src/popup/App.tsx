import { useState } from 'react'
import { useStore } from '@/lib/store'
import { Welcome }  from '@/pages/Welcome'
import { Wallet }   from '@/pages/Wallet'
import { Send }     from '@/pages/Send'
import { Receive }  from '@/pages/Receive'
import { Discover } from '@/pages/Discover'
import { Profile }  from '@/pages/Profile'
import { Settings } from '@/pages/Settings'

type Page = 'welcome' | 'wallet' | 'send' | 'receive' | 'discover' | 'profile' | 'settings'

export default function App() {
  const onboarded = useStore((s) => s.onboarded)
  const [page, setPage] = useState<Page>(onboarded ? 'wallet' : 'welcome')

  const go = (p: Page) => setPage(p)

  if (page === 'welcome')  return <Welcome  onComplete={() => go('wallet')} />
  if (page === 'send')     return <Send     onBack={() => go('wallet')} />
  if (page === 'receive')  return <Receive  onBack={() => go('wallet')} />
  if (page === 'discover') return <Discover onBack={() => go('wallet')} />
  if (page === 'profile')  return <Profile  onBack={() => go('wallet')} />
  if (page === 'settings') return <Settings onBack={() => go('wallet')} />

  return (
    <Wallet
      onSend={() => go('send')}
      onReceive={() => go('receive')}
      onDiscover={() => go('discover')}
      onMenu={() => go('profile')}
      onSettings={() => go('settings')}
    />
  )
}
