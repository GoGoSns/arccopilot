import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@/styles/globals.css'
import { useStore } from '@/lib/store'

function Root() {
  const updateStreak = useStore((s) => s.updateStreak)
  
  useEffect(() => {
    updateStreak()
  }, [updateStreak])

  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
