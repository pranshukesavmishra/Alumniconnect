import { describe, expect, it } from 'vitest'
import { asText, neutralise, safe } from './export'

describe('spreadsheet safety', () => {
  const evil = ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1', '=cmd|\' /C calc\'!A0']

  it('safe() and neutralise() both defuse every formula starter', () => {
    for (const v of evil) {
      expect(safe(v).startsWith("'")).toBe(true)
      expect(String(neutralise(v)).startsWith("'")).toBe(true)
    }
  })

  it('neutralise() leaves plain text, numbers, negative amounts and asText cells alone', () => {
    for (const v of ['Asha Rao', '', '12.50', '-100.00', 'a=b', "'=already", asText('+91 98765 43210'), asText('930000000001'), 5, null, true]) {
      expect(neutralise(v)).toBe(v)
    }
  })

  it('a hostile value cannot sneak through asText', () => {
    expect(asText('1","=EVIL')).toBe('="1,=EVIL"')
    expect(neutralise('="1"&EVIL()')).toBe('\'="1"&EVIL()')
    expect(neutralise('=1+1')).toBe("'=1+1")
  })
})
