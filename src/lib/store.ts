import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type View = 'welcome' | 'wallet' | 'send' | 'receive' | 'discover' | 'profile' | 'settings' | 'address-book' | 'address-detail'

export interface AddressMemory {
  address: string         // lowercase
  label?: string          // "Osman Abi"
  note?: string           // serbest notlar
  tag?: 'friend' | 'work' | 'warning' | 'self' | 'other'
  createdAt: number
  lastUsedAt: number
}

export interface UserProfile {
  displayName?: string
  bio?: string
}

interface AppState {
  isOnboarded: boolean
  currentView: View
  previousView: View | null
  walletAddress: string | null
  usdcBalance: string
  selectedAddress: string | null // For address-detail view
  
  // Profile & Gamification
  profile: UserProfile
  xp: number
  streak: number
  lastLoginDate: string | null // YYYY-MM-DD
  accountCreatedAt: number

  addressMemories: Record<string, AddressMemory>

  setIsOnboarded: (v: boolean) => void
  setCurrentView: (view: View) => void
  goBack: () => void
  setWalletAddress: (address: string | null) => void
  setBalance: (balance: string) => void
  setSelectedAddress: (address: string | null) => void
  
  setProfile: (profile: Partial<UserProfile>) => void
  addXP: (amount: number) => void
  updateStreak: () => void

  addAddressMemory: (address: string, data: Partial<AddressMemory>) => void
  updateAddressMemory: (address: string, data: Partial<AddressMemory>) => void
  removeAddressMemory: (address: string) => void
  getAddressMemory: (address: string) => AddressMemory | null
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      isOnboarded: false,
      currentView: 'welcome',
      previousView: null,
      walletAddress: null,
      usdcBalance: '0.00',
      selectedAddress: null,
      addressMemories: {},
      
      profile: {},
      xp: 0,
      streak: 0,
      lastLoginDate: null,
      accountCreatedAt: Date.now(),

      setIsOnboarded:   (v) => set({ isOnboarded: v }),
      setCurrentView:   (view) => {
        const current = get().currentView
        if (current === view) return
        
        console.log('[Nav] previous:', current, 'next:', view)
        set({ previousView: current, currentView: view })
      },

      goBack: () => {
        const { previousView, currentView } = get()
        const target = previousView || 'wallet'
        
        console.log('[Nav] goBack from:', currentView, 'to:', target)
        
        set({ currentView: target, previousView: target === 'wallet' ? null : 'wallet' })
      },

      setWalletAddress: (address) => {
        const isNew = !get().walletAddress && address
        set({ walletAddress: address })
        if (isNew) set({ accountCreatedAt: Date.now() })
      },
      setBalance:       (balance) => set({ usdcBalance: balance }),
      setSelectedAddress: (address) => set({ selectedAddress: address }),

      setProfile: (data) => set((s) => ({ profile: { ...s.profile, ...data } })),
      
      addXP: (amount) => set((s) => ({ xp: s.xp + amount })),
      
      updateStreak: () => {
        const now = new Date()
        const today = now.toISOString().split('T')[0]
        const { lastLoginDate, streak } = get()
        
        if (lastLoginDate === today) return
        
        const yesterdayDate = new Date(now)
        yesterdayDate.setDate(now.getDate() - 1)
        const yesterday = yesterdayDate.toISOString().split('T')[0]
        
        if (lastLoginDate === yesterday) {
          set({ streak: streak + 1, lastLoginDate: today })
          get().addXP(5) // Daily bonus
        } else {
          set({ streak: 1, lastLoginDate: today })
          get().addXP(5) // Daily bonus
        }
      },

      addAddressMemory: (address, data) => {
        const addr = address.toLowerCase()
        const now = Date.now()
        const newMemory: AddressMemory = {
          address: addr,
          createdAt: now,
          lastUsedAt: now,
          ...data
        }
        set((s) => ({
          addressMemories: {
            ...s.addressMemories,
            [addr]: newMemory
          }
        }))
      },

      updateAddressMemory: (address, data) => {
        const addr = address.toLowerCase()
        set((s) => {
          const existing = s.addressMemories[addr]
          if (!existing) return s
          return {
            addressMemories: {
              ...s.addressMemories,
              [addr]: { ...existing, ...data }
            }
          }
        })
      },

      removeAddressMemory: (address) => {
        const addr = address.toLowerCase()
        set((s) => {
          const { [addr]: _, ...rest } = s.addressMemories
          return { addressMemories: rest }
        })
      },

      getAddressMemory: (address) => {
        return get().addressMemories[address.toLowerCase()] || null
      },
    }),
    { name: 'arccopilot:state' }
  )
)
