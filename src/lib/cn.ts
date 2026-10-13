import clsx, { type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// teach tailwind-merge the design-system type scale (text-h1, text-caption …) so it is not mistaken for a text colour
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-xl', 'display', 'h1', 'h2', 'h3', 'title', 'body-lg', 'body', 'caption', 'eyebrow', 'stat'] }],
      shadow: [{ shadow: ['e1', 'e2', 'e3', 'e4', 'e5', 'card', 'pop'] }],
    },
  },
})

/** Join class names; later Tailwind utilities win over earlier conflicting ones (so `px-0` really overrides `px-5`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
