// The app updates itself: when a new version is published, the open app notices within a minute (and whenever it is reopened
// or comes back to the front), installs it and reloads once. Nobody has to hard-refresh or clear anything.
import { registerSW } from 'virtual:pwa-register'

const CHECK_EVERY_MS = 60_000

function typingNow(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function startAutoUpdate() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || import.meta.env.DEV) return

  let reloading = false
  const reload = () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  }
  // a new version is ready: reload now, unless the member is typing (then at the next quiet moment: leaving the field, or returning to the app)
  let pending = false
  const applyWhenQuiet = () => {
    if (!pending) return
    if (typingNow()) return
    reload()
  }
  document.addEventListener('focusout', () => setTimeout(applyWhenQuiet, 400))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyWhenQuiet()
  })

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true
      void updateSW(false).then(applyWhenQuiet)
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => void reg.update().catch(() => undefined)
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('online', check)
    },
  })
  // a different version took control of this tab (another tab updated it): follow it
  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    pending = true
    applyWhenQuiet()
  })
}
