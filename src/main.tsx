import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './features/auth/AuthProvider'
import { I18nProvider } from './i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => count < 2 && !/permission|JWT|not found/i.test(String((error as Error)?.message)),
      refetchOnWindowFocus: true,
    },
  },
})

// After a new version is deployed, an open tab may ask for code files that no longer exist: reload once.
// (If it already reloaded in the last 30 s, let the error reach the error screen instead of looping.)
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('reloaded-at') ?? 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem('reloaded-at', String(Date.now()))
  } catch {
    return
  }
  e.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
