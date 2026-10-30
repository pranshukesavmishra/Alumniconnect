import { lazy as reactLazy, type ComponentType } from 'react'

/*
 * React.lazy that also tells the shell when a screen's code is being fetched, so a thin progress bar can show at the
 * top while the previous screen stays visible (navigations run in a transition). App.tsx imports `lazy` from here.
 */

let pending = 0
const subs = new Set<() => void>()
// notify outside React's render phase (the factory runs while React renders the lazy component)
const emit = () => queueMicrotask(() => subs.forEach((f) => f()))

export function subscribeRouteLoading(cb: () => void) {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

export const routeLoading = () => pending > 0

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazy<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return reactLazy(() => {
    pending++
    emit()
    return factory().finally(() => {
      pending = Math.max(0, pending - 1)
      emit()
    })
  })
}
