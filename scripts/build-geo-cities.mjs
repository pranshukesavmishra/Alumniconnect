#!/usr/bin/env node
// Builds the bundled city table used for "Share my city" (server-side reverse geocoding, no outside service).
//
// Source: GeoNames (https://www.geonames.org, CC BY 4.0) via the npm package all-the-cities@3.1.0 (cities.pbf,
// GeoNames cities with population >= 1000) and country names from countries-list@3.4.1 (MIT).
//
//   npm pack all-the-cities@3.1.0 countries-list@3.4.1   # in an empty folder, then untar both
//   node scripts/build-geo-cities.mjs <all-the-cities/cities.pbf> <countries-list/countries.csv> > cities.sql
//
// Kept: every Indian place with population >= 15,000, places in the rest of the world with population >= 100,000,
// and every national capital (city sections such as "Karol Bagh" are left out so they don't replace the city's name). South Asian names lose their transliteration marks (Thāne -> Thane) because that is
// how members write them. Output is one compact `$geo$` text block per table, parsed by the migration.
import { readFileSync } from 'node:fs'

const [pbfPath, countriesPath] = process.argv.slice(2)
if (!pbfPath || !countriesPath) {
  console.error('usage: node scripts/build-geo-cities.mjs <cities.pbf> <countries.csv>')
  process.exit(1)
}

// --- minimal protobuf reader for all-the-cities' record format
const buf = readFileSync(pbfPath)
let pos = 0
const varint = () => {
  let result = 0
  let mul = 1
  let b
  do {
    b = buf[pos++]
    result += (b & 0x7f) * mul
    mul *= 128
  } while (b & 0x80)
  return result
}
const svarint = () => {
  const n = varint()
  return n % 2 === 1 ? (n + 1) / -2 : n / 2
}
const str = () => {
  const len = varint()
  const s = buf.toString('utf8', pos, pos + len)
  pos += len
  return s
}
const cities = []
let lastLat = 0
let lastLon = 0
while (pos < buf.length) {
  const end = varint() + pos
  const c = { pop: 0, adm: '', fc: '' }
  while (pos < end) {
    const key = varint()
    const tag = key >> 3
    const type = key & 7
    if (tag === 1) c.id = svarint()
    else if (tag === 2) c.name = str()
    else if (tag === 3) c.cc = str()
    else if (tag === 7) c.fc = str()
    else if (tag === 8) c.adm = str()
    else if (tag === 9) c.pop = varint()
    else if (tag === 10) c.lng = (lastLon += svarint()) / 1e5
    else if (tag === 11) c.lat = (lastLat += svarint()) / 1e5
    else if (type === 2) str()
    else if (type === 0) varint()
    else throw new Error(`unexpected wire type ${type}`)
  }
  cities.push(c)
}

// GeoNames admin1 codes for India -> state / union territory
const IN_STATES = {
  '01': 'Andaman and Nicobar Islands', '02': 'Andhra Pradesh', '03': 'Assam', '05': 'Chandigarh', '06': 'Dadra and Nagar Haveli',
  '07': 'Delhi', '09': 'Gujarat', '10': 'Haryana', '11': 'Himachal Pradesh', '12': 'Jammu and Kashmir', '13': 'Kerala',
  '14': 'Lakshadweep', '16': 'Maharashtra', '17': 'Manipur', '18': 'Meghalaya', '19': 'Karnataka', '20': 'Nagaland', '21': 'Odisha',
  '22': 'Puducherry', '23': 'Punjab', '24': 'Rajasthan', '25': 'Tamil Nadu', '26': 'Tripura', '28': 'West Bengal', '29': 'Sikkim',
  '30': 'Arunachal Pradesh', '31': 'Mizoram', '32': 'Daman and Diu', '33': 'Goa', '34': 'Bihar', '35': 'Madhya Pradesh',
  '36': 'Uttar Pradesh', '37': 'Chhattisgarh', '38': 'Jharkhand', '39': 'Uttarakhand', '40': 'Telangana', '41': 'Ladakh',
}
// Known population errors in the source (district totals recorded on a small town) that would pull nearby points away
const POP_FIX = { 1261162: 30000 /* Nowrangapur */, 1270926: 20000 /* Gorakhpur, Haryana */, 1254745: 100000 /* Theni */, 1262111: 100000 /* Najafgarh (a part of Delhi) */ }
const SOUTH_ASIA = new Set(['IN', 'PK', 'BD', 'NP', 'LK', 'BT'])
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ʼ|’/g, "'")
const clean = (s) => s.replace(/[|\n\r\t]/g, ' ').trim()

const kept = []
for (const c of cities) {
  if (/^PPL[QHW]$/.test(c.fc)) continue // abandoned, historical, destroyed
  const pop = POP_FIX[c.id] ?? c.pop
  // sections of a city (Karol Bagh, Rohini...) would replace the city's name; keep only the really big ones (Navi Mumbai)
  if (c.fc === 'PPLX' && pop < 2_000_000) continue
  if (!((c.cc === 'IN' && pop >= 15000) || pop >= 100000 || c.fc === 'PPLC')) continue
  const name = clean(SOUTH_ASIA.has(c.cc) ? fold(c.name) : c.name)
  const region = c.cc === 'IN' ? (IN_STATES[c.adm] ?? '') : c.cc === 'US' && /^[A-Z]{2}$/.test(c.adm) ? c.adm : ''
  const key = fold(name).toLowerCase()
  kept.push([c.id, name, key === name.toLowerCase() ? '' : key, region, c.cc, pop, c.lat.toFixed(3).replace(/\.?0+$/, ''), c.lng.toFixed(3).replace(/\.?0+$/, '')].join('|'))
}

// countries.csv: "Code","Name",...
const countries = readFileSync(countriesPath, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => l.match(/^"([A-Z]{2})","([^"]+)"/))
  .filter(Boolean)
  .map((m) => `${m[1]}|${clean(m[2])}`)
const used = new Set(kept.map((k) => k.split('|')[4]))
const missing = [...used].filter((cc) => !countries.some((c) => c.startsWith(cc + '|')))
if (missing.length) console.error('countries without a name (code shown instead):', missing.join(' '))

process.stdout.write(`-- generated by scripts/build-geo-cities.mjs: ${kept.length} places, ${countries.length} countries\n`)
process.stdout.write(`insert into public.geo_countries (code, name)\nselect split_part(l, '|', 1), split_part(l, '|', 2)\n  from string_to_table($geo$${countries.join('\n')}$geo$, E'\\n') l;\n\n`)
process.stdout.write(
  'insert into public.geo_cities (id, name, search_key, region, country_code, population, lat, lng)\n' +
    "select split_part(l, '|', 1)::int, split_part(l, '|', 2), coalesce(nullif(split_part(l, '|', 3), ''), lower(split_part(l, '|', 2))),\n" +
    "       nullif(split_part(l, '|', 4), ''), split_part(l, '|', 5), split_part(l, '|', 6)::int,\n" +
    "       split_part(l, '|', 7)::double precision, split_part(l, '|', 8)::double precision\n" +
    `  from string_to_table($geo$${kept.join('\n')}$geo$, E'\\n') l;\n`,
)
