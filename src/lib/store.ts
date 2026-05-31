import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type View = 'welcome' | 'wallet' | 'send' | 'receive' | 'discover' | 'profile' | 'settings'

interface AppState {
  isOnboarded: boolean
  currentView: View
  walletAddress: string | null
  usdcBalance: string

  setIsOnboarded: (v: boolean) => void
  setCurrentView: (view: View) => void
  setWalletAddress: (address: string | null) => void
  setBalance: (balance: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      isOnboarded: false,
      currentView: 'welcome',
      walletAddress: null,
      usdcBalance: '0.00',

      setIsOnboarded:   (v) => set({ isOnboarded: v }),
      setCurrentView:   (view) => set({ currentView: view }),
      setWalletAddress: (address) => set({ walletAddress: address }),
      setBalance:       (balance) => set({ usdcBalance: balance }),
    }),
    { name: 'arccopilot:state' }
  )
)
