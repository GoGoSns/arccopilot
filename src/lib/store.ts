import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WalletState {
  address: string | null
  balance: string
  isConnected: boolean
}

interface UserState {
  handle: string | null
  level: number
  streak: number
  xConnected: boolean
}

interface SettingsState {
  theme: 'dark' | 'light'
  notifications: boolean
  currency: 'USD' | 'EUR'
}

interface AppState {
  wallet: WalletState
  user: UserState
  settings: SettingsState
  onboarded: boolean
  currentPage: string

  setWallet: (wallet: Partial<WalletState>) => void
  setUser:   (user: Partial<UserState>) => void
  setSettings: (settings: Partial<SettingsState>) => void
  setOnboarded: (v: boolean) => void
  setCurrentPage: (page: string) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      wallet: { address: null, balance: '0', isConnected: false },
      user:   { handle: null, level: 1, streak: 0, xConnected: false },
      settings: { theme: 'dark', notifications: true, currency: 'USD' },
      onboarded: false,
      currentPage: 'welcome',

      setWallet:      (w) => set((s) => ({ wallet:   { ...s.wallet,   ...w } })),
      setUser:        (u) => set((s) => ({ user:     { ...s.user,     ...u } })),
      setSettings:    (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setOnboarded:   (v) => set({ onboarded: v }),
      setCurrentPage: (page) => set({ currentPage: page }),
    }),
    { name: 'arccopilot' }
  )
)
