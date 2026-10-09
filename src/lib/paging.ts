import { useEffect, useState } from 'react'

/** The part of a list to show now, and how many items are still hidden. */
export function pageSlice<T>(items: readonly T[], count: number): { shown: T[]; hidden: number } {
  return { shown: items.slice(0, count), hidden: Math.max(0, items.length - count) }
}

/** Shows a long list a screenful at a time: the first `size` items, then "Show more". Resets when the filter changes. */
export function usePaged<T>(items: readonly T[], size = 100, resetKey: unknown = items.length) {
  const [count, setCount] = useState(size)
  useEffect(() => setCount(size), [resetKey, size])
  return { ...pageSlice(items, count), more: () => setCount((c) => c + size) }
}
