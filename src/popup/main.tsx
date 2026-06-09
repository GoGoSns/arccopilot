import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import '@/styles/globals.css'
import { ADDRESS_BOOK_STORAGE_KEY, useStore, type AddressMemory } from '@/lib/store'

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
        if (memories && typeof memories === 'object') {
          mergeAddressMemories(memories as Record<string, AddressMemory>)
        }
      })
    }

    hydrate()

    const onStorageChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      const change = changes[ADDRESS_BOOK_STORAGE_KEY]
      if (change?.newValue && typeof change.newValue === 'object') {
        mergeAddressMemories(change.newValue as Record<string, AddressMemory>)
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
