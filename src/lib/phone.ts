// Phone numbers for members anywhere in the world. Stored as E.164 ("+919876543210"); older rows hold a bare
// 10-digit Indian number or "+91 98765 43210", and both still parse. No library: a small table of dial code and
// national-number length per country is enough to pick the country and catch typos.

export interface Country {
  /** ISO 3166-1 alpha-2 */
  iso: string
  /** calling code without "+" (NANP islands carry their area code, e.g. Jamaica "1876") */
  dial: string
  /** national number length, digits, without the trunk "0" */
  min: number
  max: number
  /** the national number must start like this (also tells apart countries that share a dial code) */
  lead?: RegExp
  /** a leading 0 belongs to the number (Italy) */
  keepZero?: boolean
}

// For a shared dial code, the countries with a `lead` come before the default one.
const c = (iso: string, dial: string, min: number, max: number, extra: Partial<Country> = {}): Country => ({ iso, dial, min, max, ...extra })

const CA_AREA = /^(204|226|236|249|250|257|263|289|306|343|354|365|367|368|382|403|416|418|431|437|438|450|468|474|506|514|519|548|579|581|584|587|604|613|639|647|672|683|705|709|742|753|778|780|782|807|819|825|867|873|902|905)/

export const COUNTRIES: readonly Country[] = [
  c('AF', '93', 9, 9), c('AL', '355', 8, 9), c('DZ', '213', 8, 9), c('AS', '1684', 7, 7), c('AD', '376', 6, 9), c('AO', '244', 9, 9),
  c('AI', '1264', 7, 7), c('AG', '1268', 7, 7), c('AR', '54', 10, 11), c('AM', '374', 8, 8), c('AW', '297', 7, 7), c('AU', '61', 9, 9),
  c('AT', '43', 7, 13), c('AZ', '994', 9, 9), c('BS', '1242', 7, 7), c('BH', '973', 8, 8), c('BD', '880', 10, 10), c('BB', '1246', 7, 7),
  c('BY', '375', 9, 9), c('BE', '32', 8, 9), c('BZ', '501', 7, 7), c('BJ', '229', 8, 10), c('BM', '1441', 7, 7), c('BT', '975', 8, 8),
  c('BO', '591', 8, 8), c('BA', '387', 8, 8), c('BW', '267', 7, 8), c('BR', '55', 10, 11), c('IO', '246', 7, 7), c('VG', '1284', 7, 7),
  c('BN', '673', 7, 7), c('BG', '359', 8, 9), c('BF', '226', 8, 8), c('BI', '257', 8, 8), c('KH', '855', 8, 9), c('CM', '237', 9, 9),
  c('CA', '1', 10, 10, { lead: CA_AREA }), c('CV', '238', 7, 7), c('KY', '1345', 7, 7), c('CF', '236', 8, 8), c('TD', '235', 8, 8),
  c('CL', '56', 9, 9), c('CN', '86', 11, 11), c('CO', '57', 10, 10), c('KM', '269', 7, 7), c('CG', '242', 9, 9), c('CD', '243', 9, 9),
  c('CK', '682', 5, 5), c('CR', '506', 8, 8), c('CI', '225', 8, 10), c('HR', '385', 8, 9), c('CU', '53', 8, 8), c('CW', '599', 7, 8),
  c('CY', '357', 8, 8), c('CZ', '420', 9, 9), c('DK', '45', 8, 8), c('DJ', '253', 8, 8), c('DM', '1767', 7, 7), c('DO', '1809', 7, 7),
  c('EC', '593', 9, 9), c('EG', '20', 10, 10), c('SV', '503', 8, 8), c('GQ', '240', 9, 9), c('ER', '291', 7, 7), c('EE', '372', 7, 8),
  c('SZ', '268', 8, 8), c('ET', '251', 9, 9), c('FK', '500', 5, 5), c('FO', '298', 6, 6), c('FJ', '679', 7, 7), c('FI', '358', 6, 11),
  c('FR', '33', 9, 9), c('GF', '594', 9, 9), c('PF', '689', 8, 8), c('GA', '241', 7, 8), c('GM', '220', 7, 7), c('GE', '995', 9, 9),
  c('DE', '49', 7, 13), c('GH', '233', 9, 9), c('GI', '350', 8, 8), c('GR', '30', 10, 10), c('GL', '299', 6, 6), c('GD', '1473', 7, 7),
  c('GP', '590', 9, 9), c('GU', '1671', 7, 7), c('GT', '502', 8, 8), c('GN', '224', 9, 9),
  c('GW', '245', 7, 9), c('GY', '592', 7, 7), c('HT', '509', 8, 8), c('HN', '504', 8, 8), c('HK', '852', 8, 8), c('HU', '36', 8, 9),
  c('IS', '354', 7, 7), c('IN', '91', 10, 10, { lead: /^[6-9]/ }), c('ID', '62', 8, 12), c('IR', '98', 10, 10), c('IQ', '964', 10, 10),
  c('IE', '353', 7, 11), c('IL', '972', 8, 9), c('IT', '39', 6, 11, { keepZero: true }),
  c('JM', '1876', 7, 7), c('JP', '81', 9, 10), c('JO', '962', 8, 9),
  c('KZ', '7', 10, 10, { lead: /^[67]/ }), c('KE', '254', 9, 9), c('KI', '686', 5, 8), c('XK', '383', 8, 9), c('KW', '965', 8, 8),
  c('KG', '996', 9, 9), c('LA', '856', 8, 10), c('LV', '371', 8, 8), c('LB', '961', 7, 8), c('LS', '266', 8, 8), c('LR', '231', 7, 9),
  c('LY', '218', 9, 10), c('LI', '423', 7, 9), c('LT', '370', 8, 8), c('LU', '352', 6, 11), c('MO', '853', 8, 8), c('MG', '261', 9, 10),
  c('MW', '265', 7, 9), c('MY', '60', 9, 10), c('MV', '960', 7, 7), c('ML', '223', 8, 8), c('MT', '356', 8, 8), c('MH', '692', 7, 7),
  c('MQ', '596', 9, 9), c('MR', '222', 8, 8), c('MU', '230', 7, 8), c('YT', '262', 9, 9, { lead: /^(269|639)/ }), c('MX', '52', 10, 10),
  c('FM', '691', 7, 7), c('MD', '373', 8, 8), c('MC', '377', 8, 9), c('MN', '976', 8, 8), c('ME', '382', 8, 9), c('MS', '1664', 7, 7),
  c('MA', '212', 9, 9), c('MZ', '258', 8, 9), c('MM', '95', 8, 10), c('NA', '264', 7, 9), c('NR', '674', 4, 7), c('NP', '977', 8, 10),
  c('NL', '31', 9, 9), c('NC', '687', 6, 6), c('NZ', '64', 8, 10), c('NI', '505', 8, 8), c('NE', '227', 8, 8), c('NG', '234', 8, 10),
  c('NU', '683', 4, 4), c('NF', '672', 5, 6), c('KP', '850', 8, 10), c('MK', '389', 8, 8), c('MP', '1670', 7, 7), c('NO', '47', 8, 8),
  c('OM', '968', 8, 8), c('PK', '92', 10, 10), c('PW', '680', 7, 7), c('PS', '970', 9, 9), c('PA', '507', 7, 8), c('PG', '675', 7, 8),
  c('PY', '595', 9, 9), c('PE', '51', 8, 9), c('PH', '63', 10, 10), c('PL', '48', 9, 9), c('PT', '351', 9, 9), c('PR', '1787', 7, 7),
  c('QA', '974', 8, 8), c('RE', '262', 9, 9, { lead: /^(262|692|693)/ }), c('RO', '40', 9, 9), c('RU', '7', 10, 10), c('RW', '250', 9, 9),
  c('WS', '685', 5, 7), c('SM', '378', 6, 10), c('ST', '239', 7, 7), c('SA', '966', 9, 9), c('SN', '221', 9, 9), c('RS', '381', 8, 9),
  c('SC', '248', 7, 7), c('SL', '232', 8, 8), c('SG', '65', 8, 8), c('SX', '1721', 7, 7), c('SK', '421', 9, 9), c('SI', '386', 8, 8),
  c('SB', '677', 5, 7), c('SO', '252', 7, 9), c('ZA', '27', 9, 9), c('KR', '82', 9, 10), c('SS', '211', 9, 9), c('ES', '34', 9, 9),
  c('LK', '94', 9, 9), c('SH', '290', 4, 4), c('KN', '1869', 7, 7), c('LC', '1758', 7, 7), c('PM', '508', 6, 6), c('VC', '1784', 7, 7),
  c('SD', '249', 9, 9), c('SR', '597', 6, 7), c('SE', '46', 7, 9), c('CH', '41', 9, 9), c('SY', '963', 8, 9), c('TW', '886', 8, 9),
  c('TJ', '992', 9, 9), c('TZ', '255', 9, 9), c('TH', '66', 8, 9), c('TL', '670', 7, 8), c('TG', '228', 8, 8), c('TK', '690', 4, 4),
  c('TO', '676', 5, 7), c('TT', '1868', 7, 7), c('TN', '216', 8, 8), c('TR', '90', 10, 10), c('TM', '993', 8, 8), c('TC', '1649', 7, 7),
  c('TV', '688', 5, 6), c('UG', '256', 9, 9), c('UA', '380', 9, 9), c('AE', '971', 8, 9), c('GB', '44', 10, 10), c('US', '1', 10, 10, { lead: /^[2-9]/ }),
  c('UY', '598', 8, 8), c('VI', '1340', 7, 7), c('UZ', '998', 9, 9), c('VU', '678', 5, 7), c('VE', '58', 10, 10), c('VN', '84', 9, 10),
  c('WF', '681', 6, 6), c('YE', '967', 7, 9), c('ZM', '260', 9, 9), c('ZW', '263', 7, 9),
]

export const DEFAULT_ISO = 'IN'
const byIso = new Map(COUNTRIES.map((x) => [x.iso, x]))
export const countryByIso = (iso: string | null | undefined): Country => byIso.get(iso ?? '') ?? byIso.get(DEFAULT_ISO)!

/** Regional-indicator flag emoji for a country code. */
export const flagEmoji = (iso: string): string => String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0)))

export interface ParsedPhone {
  country: Country
  /** national significant number, digits only, no trunk 0 */
  national: string
}

/** Strip a trunk "0" in front of the national number, unless the country keeps it. */
export function cleanNational(country: Country, digits: string): string {
  return country.keepZero ? digits : digits.replace(/^0+/, '')
}

/** The E.164 form: "+" + dial code + national digits. Empty when there is no national number. */
export const toE164 = (country: Country, national: string): string => (national ? `+${country.dial}${national}` : '')

const bySharedDial = (dial: string, national: string): Country => {
  const same = COUNTRIES.filter((x) => x.dial === dial)
  return same.find((x) => x.lead && x.lead.test(national)) ?? same[same.length - 1]!
}

const dialLengths = [4, 3, 2, 1]

/**
 * Reads whatever is stored or pasted: "+919876543210", "+91 98765 43210", "00447700900123", "9876543210",
 * "09876543210", "919876543210". Returns null when no country can be worked out.
 */
export function parsePhone(raw: string | null | undefined): ParsedPhone | null {
  if (!raw) return null
  const s = raw.trim()
  let digits = s.replace(/\D/g, '')
  if (!digits) return null
  let international = s.startsWith('+')
  if (!international && digits.startsWith('00') && digits.length > 6) {
    international = true
    digits = digits.slice(2)
  }
  if (international) {
    for (const len of dialLengths) {
      const dial = digits.slice(0, len)
      if (dial.length === len && COUNTRIES.some((x) => x.dial === dial)) {
        const rest = digits.slice(len)
        const country = bySharedDial(dial, rest.replace(/^0+/, ''))
        return { country, national: cleanNational(country, rest) }
      }
    }
    return null
  }
  const india = countryByIso('IN')
  const looksIndian = (n: string) => n.length === 10 && india.lead!.test(n)
  if (looksIndian(digits)) return { country: india, national: digits }
  if (digits.length === 11 && digits.startsWith('0') && looksIndian(digits.slice(1))) return { country: india, national: digits.slice(1) }
  if (digits.length === 12 && digits.startsWith('91') && looksIndian(digits.slice(2))) return { country: india, national: digits.slice(2) }
  return null
}

export type NationalProblem = 'empty' | 'short' | 'long' | 'start'

/** What is wrong with a national number for this country, if anything. */
export function checkNational(country: Country, national: string): NationalProblem | null {
  if (!national) return 'empty'
  if (!/^\d+$/.test(national) || national.length < country.min) return 'short'
  if (national.length > country.max) return 'long'
  if (country.iso === 'IN' && country.lead && !country.lead.test(national)) return 'start'
  return null
}

export type PhoneProblem = { kind: 'empty' } | { kind: 'format' } | { kind: NationalProblem; country: Country }

/** null when the value is a good number (E.164 or a legacy Indian format). */
export function phoneProblem(raw: string | null | undefined): PhoneProblem | null {
  if (!raw || !raw.trim()) return { kind: 'empty' }
  const p = parsePhone(raw)
  if (!p) return { kind: 'format' }
  const bad = checkNational(p.country, p.national)
  return bad ? { kind: bad, country: p.country } : null
}

export const isValidPhone = (raw: string | null | undefined): boolean => phoneProblem(raw) === null

/** What to save: E.164 when the number is good, otherwise the text as typed (so nothing is lost). Empty stays empty. */
export function normalizePhone(raw: string | null | undefined): string {
  const t = (raw ?? '').trim()
  if (!t) return ''
  const p = parsePhone(t)
  return p && checkNational(p.country, p.national) === null ? toE164(p.country, p.national) : t
}

function group(national: string, iso: string): string {
  if (iso === 'IN') return national.replace(/^(\d{5})(\d+)$/, '$1 $2')
  if (iso === 'US' || iso === 'CA') return national.replace(/^(\d{3})(\d{3})(\d+)$/, '$1 $2 $3')
  const size = national.length <= 7 ? 3 : 4
  return national.match(new RegExp(`\\d{1,${size}}`, 'g'))?.join(' ') ?? national
}

/** For screens: "+91 98765 43210", "+44 7700 900123". Unreadable values are shown as they are. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const p = parsePhone(raw)
  return p ? `+${p.country.dial} ${group(p.national, p.country.iso)}` : raw.trim()
}

/** For tel: links. */
export function telHref(raw: string): string {
  const p = parsePhone(raw)
  return p ? `tel:${toE164(p.country, p.national)}` : `tel:${raw.replace(/[^\d+]/g, '')}`
}

/** For wa.me: digits with the country code, no "+". An unreadable bare 10-digit number is taken as Indian. */
export function whatsappDigits(raw: string): string {
  const p = parsePhone(raw)
  if (p) return `${p.country.dial}${p.national}`
  const d = raw.replace(/\D/g, '')
  return d.length === 10 ? `91${d}` : d
}

/** Digits only, for matching a typed search against stored numbers whatever their layout. */
export const phoneDigits = (raw: string | null | undefined): string => (raw ?? '').replace(/\D/g, '')

/** Does the search text match this number, ignoring spaces and "+"? Also finds a national number inside an E.164 one. */
export function phoneMatches(stored: string | null | undefined, query: string): boolean {
  if (!/^[\d\s+()\-.]+$/.test(query.trim())) return false
  const q = phoneDigits(query)
  return q.length >= 3 && phoneDigits(stored).includes(q)
}

const KEY = 'jec.phone.country'
export function rememberedIso(): string {
  try {
    const v = localStorage.getItem(KEY)
    if (v && byIso.has(v)) return v
  } catch {
    /* storage blocked: use the default */
  }
  return DEFAULT_ISO
}
export function rememberIso(iso: string): void {
  try {
    localStorage.setItem(KEY, iso)
  } catch {
    /* storage blocked: nothing to remember with */
  }
}
