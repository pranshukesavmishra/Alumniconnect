import type { designEn } from './designEn'

// Design system 2.0 strings (Hindi). Same keys as designEn.ts.
export const designHi = {
  'ds.theme.title': 'रूप-रंग',
  'ds.theme.system': 'सिस्टम',
  'ds.theme.light': 'लाइट',
  'ds.theme.dark': 'डार्क',
  'ds.theme.hint': 'सिस्टम चुनने पर ऐप आपके फ़ोन की लाइट या डार्क सेटिंग के अनुसार चलेगा।',

  'ds.countdown.days': 'दिन',
  'ds.countdown.hours': 'घंटे',
  'ds.countdown.minutes': 'मिनट',
  'ds.countdown.seconds': 'सेकंड',
  'ds.countdown.aria': '{days} दिन, {hours} घंटे और {minutes} मिनट बाकी',
} satisfies Record<keyof typeof designEn, string>
