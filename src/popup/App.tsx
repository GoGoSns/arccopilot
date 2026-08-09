import { lazy, Suspense, useEffect } from 'react'
import { useStore, type View } from '@/lib/store'
import { PENDING_SEND_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY } from '@/lib/storageKeys'
import { Welcome } from '@/pages/Welcome'
import { useLocale } from '@/lib/i18n'
import { chromeStorageGet, chromeStorageRemove } from '@/lib/external'

const Wallet = lazy(() => import('@/pages/Wallet').then((module) => ({ default: module.Wallet })))
const Send = lazy(() => import('@/pages/Send').then((module) => ({ default: module.Send })))
const Receive = lazy(() => import('@/pages/Receive').then((module) => ({ default: module.Receive })))
const Discover = lazy(() => import('@/pages/Discover').then((module) => ({ default: module.Discover })))
const Activity = lazy(() => import('@/pages/Activity').then((module) => ({ default: module.Activity })))
const Profile = lazy(() => import('@/pages/Profile').then((module) => ({ default: module.Profile })))
const Settings = lazy(() => import('@/pages/Settings').then((module) => ({ default: module.Settings })))
const AddressBook = lazy(() => import('@/pages/AddressBook').then((module) => ({ default: module.AddressBook })))
const AddressDetail = lazy(() => import('@/pages/AddressDetail').then((module) => ({ default: module.AddressDetail })))
const DailyBrief = lazy(() => import('@/pages/DailyBrief').then((module) => ({ default: module.DailyBrief })))
const Calendar = lazy(() => import('@/pages/Calendar').then((module) => ({ default: module.Calendar })))
const GogoAI = lazy(() => import('@/pages/GogoAI').then((module) => ({ default: module.GogoAI })))
const ArcRadar = lazy(() => import('@/pages/ArcRadar').then((module) => ({ default: module.ArcRadar })))
const DeFiRadar = lazy(() => import('@/pages/DeFiRadar').then((module) => ({ default: module.DeFiRadar })))
const ArcBridge = lazy(() => import('@/pages/ArcBridge').then((module) => ({ default: module.ArcBridge })))
const ArcSwapPreflight = lazy(() => import('@/pages/ArcSwapPreflight').then((module) => ({ default: module.ArcSwapPreflight })))
const PolicyCenter = lazy(() => import('@/pages/PolicyCenter').then((module) => ({ default: module.PolicyCenter })))
const Tools = lazy(() => import('@/pages/Tools').then((module) => ({ default: module.Tools })))

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
  'calendar',
  'gogo-ai',
  'activity',
  'arc-radar',
  'defi-radar',
  'arc-bridge',
  'arc-swap',
  'policy-center',
  'tools',
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

function RouteLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-arc-bg px-4 text-center text-xs text-arc-text-dim">
      Loading ArcCopilot...
    </div>
  )
}

export default function App() {
  useLocale()
  const isOnboarded = useStore((s) => s.isOnboarded)
  const currentView = useStore((s) => s.currentView)
  const setCurrentView = useStore((s) => s.setCurrentView)
  const goBack = useStore((s) => s.goBack)

  const go = (v: View) => setCurrentView(v)

  useEffect(() => {
    void chromeStorageGet([PENDING_SEND_STORAGE_KEY, PENDING_VIEW_STORAGE_KEY]).then((result) => {
      const hasPendingView = Object.prototype.hasOwnProperty.call(result, PENDING_VIEW_STORAGE_KEY)
      const hasPendingSend = Object.prototype.hasOwnProperty.call(result, PENDING_SEND_STORAGE_KEY)
      const pendingView = result[PENDING_VIEW_STORAGE_KEY]
      if (isView(pendingView) && isOnboarded) {
        go(pendingView)
        void chromeStorageRemove(PENDING_VIEW_STORAGE_KEY)
        return
      } else if (hasPendingView && pendingView != null && !isView(pendingView)) {
        void chromeStorageRemove(PENDING_VIEW_STORAGE_KEY)
      }

      const pending = result[PENDING_SEND_STORAGE_KEY]
      if (isPendingSend(pending) && Date.now() - pending.ts < 5_000) {
        go('send')
      } else if (hasPendingSend) {
        void chromeStorageRemove(PENDING_SEND_STORAGE_KEY)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const view: View = !isOnboarded ? 'welcome' : currentView === 'welcome' ? 'wallet' : currentView

  if (view === 'welcome') return <Welcome />

  let content = null

  if (view === 'send') content = <Send onBack={goBack} />
  else if (view === 'receive') content = <Receive onBack={goBack} />
  else if (view === 'discover') content = <Discover onBack={goBack} />
  else if (view === 'profile') content = <Profile onBack={goBack} />
  else if (view === 'settings') content = <Settings onBack={goBack} />
  else if (view === 'address-book') content = <AddressBook onBack={goBack} />
  else if (view === 'address-detail') content = <AddressDetail onBack={goBack} />
  else if (view === 'daily-brief') content = <DailyBrief onBack={goBack} />
  else if (view === 'calendar') content = <Calendar onBack={goBack} />
  else if (view === 'gogo-ai') content = <GogoAI onBack={goBack} />
  else if (view === 'activity') content = <Activity onBack={goBack} />
  else if (view === 'arc-radar') content = <ArcRadar onBack={goBack} onOpenGogo={() => go('gogo-ai')} onOpenCalendar={() => go('calendar')} />
  else if (view === 'defi-radar') content = <DeFiRadar onBack={goBack} onOpenGogo={() => go('gogo-ai')} />
  else if (view === 'arc-bridge') content = <ArcBridge onBack={goBack} onOpenGogo={() => go('gogo-ai')} />
  else if (view === 'arc-swap') content = <ArcSwapPreflight onBack={goBack} onOpenGogo={() => go('gogo-ai')} />
  else if (view === 'policy-center') content = <PolicyCenter onBack={goBack} />
  if (view === 'tools') {
    content = (
      <Tools
        onBack={goBack}
        onOpenGogo={() => go('gogo-ai')}
        onOpenDefiRadar={() => go('defi-radar')}
        onOpenRadar={() => go('arc-radar')}
        onOpenBridge={() => go('arc-bridge')}
        onOpenSwap={() => go('arc-swap')}
        onOpenPolicyCenter={() => go('policy-center')}
        onOpenCalendar={() => go('calendar')}
        onOpenAddressBook={() => go('address-book')}
        onOpenBrief={() => go('daily-brief')}
        onOpenSettings={() => go('settings')}
      />
    )
  }

  if (!content) {
    content = (
    <Wallet
      onSend={() => go('send')}
      onReceive={() => go('receive')}
      onOpenBrief={() => go('daily-brief')}
      onOpenActivity={() => go('activity')}
      onMenu={() => go('settings')}
      onOpenCalendar={() => go('calendar')}
      onOpenGogo={() => go('gogo-ai')}
      onOpenTools={() => go('tools')}
    />
    )
  }

  return (
    <Suspense fallback={<RouteLoading />}>
      {content}
    </Suspense>
  )
}
