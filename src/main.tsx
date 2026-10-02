import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { startAutoSync } from './lib/offlineQueue'
import { pwaManager } from './pwa/pwaManager'

// Offline queue: flush on reconnect + periodic fallback poll. See
// src/lib/offlineQueue.ts for the full design.
startAutoSync()

// PWA: must run before React renders so the beforeinstallprompt event is never missed.
pwaManager.init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
