import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useLang } from '.'
import { translateAdmin } from './adminTranslate'

const ATTRS = ['aria-label', 'placeholder', 'title', 'alt']
const SKIP = 'script, style, textarea, input, [data-no-translate], [contenteditable="true"], .font-mono'

/**
 * On admin screens in Hindi: swaps English text, labels and placeholders for Hindi as they appear (and back again when the
 * language is switched). Also covers the browser's confirm / prompt boxes. It only reads and rewrites text, never structure.
 */
export function AdminTranslator() {
  const { lang } = useLang()
  const { pathname } = useLocation()
  const active = lang === 'hi' && pathname.startsWith('/admin')

  useEffect(() => {
    if (!active) return
    const textOrig = new WeakMap<Text, { en: string; hi: string }>()
    const attrOrig = new WeakMap<Element, Record<string, { en: string; hi: string }>>()
    let busy = false

    const doText = (n: Text) => {
      if (n.parentElement?.closest(SKIP)) return
      const cur = n.nodeValue ?? ''
      const prev = textOrig.get(n)
      if (prev && prev.hi === cur) return
      const hi = translateAdmin(cur)
      if (hi !== cur) {
        textOrig.set(n, { en: cur, hi })
        n.nodeValue = hi
      }
    }
    const doAttrs = (el: Element) => {
      if (el.closest('[data-no-translate]')) return
      for (const a of ATTRS) {
        const cur = el.getAttribute(a)
        if (!cur) continue
        const rec = attrOrig.get(el) ?? {}
        if (rec[a]?.hi === cur) continue
        const hi = translateAdmin(cur)
        if (hi !== cur) {
          rec[a] = { en: cur, hi }
          attrOrig.set(el, rec)
          el.setAttribute(a, hi)
        }
      }
    }
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return doText(root as Text)
      if (root.nodeType !== Node.ELEMENT_NODE) return
      const el = root as Element
      doAttrs(el)
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === Node.TEXT_NODE ? doText(n as Text) : doAttrs(n as Element)
    }
    const run = (fn: () => void) => {
      if (busy) return
      busy = true
      try {
        fn()
      } finally {
        busy = false
        obs.takeRecords()
      }
    }
    const obs = new MutationObserver((records) => {
      run(() => {
        for (const r of records) {
          if (r.type === 'childList') r.addedNodes.forEach(walk)
          else if (r.type === 'characterData') doText(r.target as Text)
          else if (r.type === 'attributes') doAttrs(r.target as Element)
        }
      })
    })
    run(() => walk(document.body))
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })

    const confirmEn = window.confirm
    const promptEn = window.prompt
    const lines = (m?: string) => (m === undefined ? m : m.split('\n').map((l) => translateAdmin(l)).join('\n'))
    window.confirm = (m?: string) => confirmEn.call(window, lines(m))
    window.prompt = (m?: string, d?: string) => promptEn.call(window, lines(m), d)

    return () => {
      obs.disconnect()
      window.confirm = confirmEn
      window.prompt = promptEn
      // back to English
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) {
          const rec = textOrig.get(n as Text)
          if (rec && (n as Text).nodeValue === rec.hi) (n as Text).nodeValue = rec.en
        } else {
          const rec = attrOrig.get(n as Element)
          if (rec) for (const [a, v] of Object.entries(rec)) if ((n as Element).getAttribute(a) === v.hi) (n as Element).setAttribute(a, v.en)
        }
      }
    }
  }, [active])

  return null
}
