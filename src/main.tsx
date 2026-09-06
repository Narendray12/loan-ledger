import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './App'

registerSW({ immediate: true })

if (import.meta.env.DEV && new URLSearchParams(location.search).get('seed') === '1') {
  void import('./lib/devSeed').then((m) => m.devSeed())
}

// Ask the browser not to evict our IndexedDB (drafts and queued changes) under storage pressure.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
