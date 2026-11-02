import type { advanceEn } from './advanceEn'

// Advance paid before the app: member-facing strings, Hindi. Same keys as advanceEn.ts.
export const advanceHi = {
  'adv.paid': 'पहले से जमा अग्रिम राशि',
  'adv.toPay': 'भुगतान करना है',
  'adv.toPayAmount': '{amount} भुगतान करना है',
  'adv.note': 'ऐप पर पंजीकरण शुरू होने से पहले आपने जो अग्रिम राशि दी थी, वह हमें मिल गई है। यह आपकी कुल राशि से घटा दी गई है, इसलिए आप केवल बाकी राशि चुकाएँ।',
  'adv.coveredAll': 'आपकी अग्रिम राशि से पूरी रकम चुक गई है। अब कुछ और भुगतान नहीं करना है।',
  'adv.review': 'हो सकता है आपने ऐप शुरू होने से पहले अग्रिम राशि दी हो। आयोजक इसकी जाँच कर रहे हैं और इसे आपकी कुल राशि से घटा देंगे।',
  'adv.method': 'ऐप से पहले दी गई अग्रिम राशि',
} as const satisfies Record<keyof typeof advanceEn, string>
