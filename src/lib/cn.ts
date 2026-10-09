import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Join class names; later Tailwind utilities win over earlier conflicting ones (so `px-0` really overrides `px-5`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
