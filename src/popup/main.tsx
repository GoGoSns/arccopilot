import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import '@/styles/globals.css'
import { useStore, type AddressMemory } from '@/lib/store'
import { ADDRESS_BOOK_STORAGE_KEY } from '@/lib/storageKeys'

function normalizeStoredAddressBook(raw: unknown): Record<string, AddressMemory> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const next: Record<string, AddressMemory> = {}
  for (const memory of Object.values(raw as Record<string, Partial<AddressMemory>>)) {
    if (!memory?.address) continue

    const address = memory.address.toLowerCase()
    next[address] = {
      address,
      createdAt: typeof memory.createdAt === 'number' ? memory.createdAt : Date.now(),
      lastUsedAt: typeof memory.lastUsedAt === 'number' ? memory.lastUsedAt : Date.now(),
      label: memory.label,
      note: memory.note,
      tag: memory.tag,
    }
  }

  return next
}

function Root() {
  const updateStreak = useStore((s) => s.updateStreak)
  const mergeAddressMemories = useStore((s) => s.mergeAddressMemories)
  
  useEffect(() => {
    updateStreak()
  }, [updateStreak])

  useEffect(() => {
    let disposed = false

    const hydrate = () => {
      chrome.storage.local.get(ADDRESS_BOOK_STORAGE_KEY, (result) => {
        if (disposed) return

        const memories = result[ADDRESS_BOOK_STORAGE_KEY]
        const normalized = normalizeStoredAddressBook(memories)
        if (Object.keys(normalized).length > 0) {
          mergeAddressMemories(normalized)
        } else if (memories != null) {
          void chrome.storage.local.remove(ADDRESS_BOOK_STORAGE_KEY)
        }
      })
    }

    hydrate()

    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      const change = changes[ADDRESS_BOOK_STORAGE_KEY]
      if (change?.newValue) {
        const normalized = normalizeStoredAddressBook(change.newValue)
        if (Object.keys(normalized).length > 0) {
          mergeAddressMemories(normalized)
        } else {
          void chrome.storage.local.remove(ADDRESS_BOOK_STORAGE_KEY)
        }
      }
    }

    chrome.storage.onChanged.addListener(onStorageChanged)

    return () => {
      disposed = true
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [mergeAddressMemories])

  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
)
