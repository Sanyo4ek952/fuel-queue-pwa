import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import '@/app/styles/globals.css'

let recoveryScreenShown = false

function isAssetLoadError(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  return (
    message.includes('ChunkLoadError') ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('/assets/')
  )
}

async function clearServiceWorkerCaches() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
  }
}

function showAppRecoveryScreen() {
  if (recoveryScreenShown) {
    return
  }

  recoveryScreenShown = true
  const root = document.getElementById('root')

  if (!root) {
    return
  }

  root.innerHTML = `
    <main style="min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f8fafc; color: #0f172a; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <section style="width: min(100%, 420px); border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; padding: 24px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);">
        <h1 style="margin: 0 0 8px; font-size: 20px; line-height: 1.3;">Не удалось загрузить обновление приложения</h1>
        <p style="margin: 0 0 18px; color: #475569; font-size: 14px; line-height: 1.5;">Очистим старый service worker и кеш приложения, затем загрузим свежую версию. Офлайн-операции не удаляются.</p>
        <button type="button" id="app-recovery-refresh" style="width: 100%; min-height: 40px; border: 0; border-radius: 8px; background: #0f172a; color: #ffffff; font-size: 14px; font-weight: 600; cursor: pointer;">Обновить приложение</button>
      </section>
    </main>
  `

  document.getElementById('app-recovery-refresh')?.addEventListener('click', async () => {
    await clearServiceWorkerCaches()
    window.location.reload()
  })
}

window.addEventListener(
  'error',
  (event) => {
    if (event.target instanceof HTMLScriptElement && event.target.src.includes('/assets/')) {
      showAppRecoveryScreen()
      return
    }

    if (event.error && isAssetLoadError(event.error)) {
      showAppRecoveryScreen()
    }
  },
  true,
)

window.addEventListener('unhandledrejection', (event) => {
  if (isAssetLoadError(event.reason)) {
    showAppRecoveryScreen()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
