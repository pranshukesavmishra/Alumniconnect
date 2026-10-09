import { expect, test, type Browser, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

// Opt-in city sharing and Nearby JECians. Mocked browser coordinates: Reykjavik, a city nobody else uses in the dev database.
const run = Date.now().toString(36).slice(-5)
const year = 1995 + ((Date.now() + 7) % 20)
const REYK = { latitude: 64.1466, longitude: -21.9426 }
const REYK_FAR = { latitude: 64.2, longitude: -21.88 } // same city, about 6 km away

async function member(browser: Browser, key: string, name: string, batch: number, opts: { geo?: { latitude: number; longitude: number }; deny?: boolean } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...(opts.geo ? { geolocation: opts.geo, permissions: ['geolocation'] } : {}),
  })
  const page = await ctx.newPage()
  if (opts.deny) {
    // what the browser does when the member taps "Block" on the location prompt
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)
    })
  }
  page.on('dialog', (d) => void d.accept())
  const email = `${key}.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, String(batch))
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  const id = sql(`select id from auth.users where email = '${email}'`)
  return { ctx, page, id, email, name }
}

const uid = (m: { id: string }) => m.id
const loc = (m: { id: string }) => sql(`select coalesce(lat::text,'') || ',' || coalesce(lng::text,'') || ',' || coalesce(city,'') from member_locations where user_id = '${uid(m)}'`)
const sharing = (m: { id: string }) => sql(`select coalesce((select sharing::text from location_prefs where user_id = '${uid(m)}'), 'none')`)

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
}

test('opt in, batchmates first, filters, city search, profile fallback, message, map cluster, hindi, turn off', async ({ browser }) => {
  test.setTimeout(240_000)
  // a clean slate for the test city
  sql(`delete from member_locations where city like 'Reykjav%'; update profiles set city = null where lower(city) like 'reykjav%'`)

  const asha = await member(browser, 'asha', `Asha Loc${run}`, year, { geo: REYK })
  const bala = await member(browser, 'bala', `Bala Loc${run}`, year, { geo: REYK_FAR })
  const chetan = await member(browser, 'chetan', `Chetan Loc${run}`, year + 3, { geo: REYK })
  const divya = await member(browser, 'divya', `Divya Loc${run}`, year + 1, { deny: true })
  sql(`update profiles set city = 'Reykjavík', country = 'Iceland' where id = '${divya.id}'`)

  // --- nothing is stored or shared until the member opts in
  expect(sharing(asha)).toBe('none')
  expect(loc(asha)).toBe('')

  // --- Asha: the gentle Home card, then opts in
  await asha.page.goto('/')
  const card = asha.page.getByRole('region', { name: 'Find JECians near you' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Only your city is shown')
  await expect(card).toContainText('about 5 km')
  await expect(card).toContainText('Turn it off any time')
  await card.getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(card).toHaveCount(0)
  // the database holds the ROUNDED point (0.05 degree grid) and the city, nothing finer
  await expect.poll(() => loc(asha)).toBe('64.15,-21.95,Reykjavík')
  expect(sharing(asha)).toBe('true')
  expect(sql(`select city from profiles where id = '${asha.id}'`)).toBe('Pune') // profile city untouched unless ticked

  // --- Bala: from the profile page, also updating the profile city
  await bala.page.goto('/me')
  const settings = bala.page.getByLabel('Share my city').last()
  await expect(settings.getByTestId('loc-status')).toContainText('Off')
  await bala.page.getByLabel('Also update the city on my profile').check()
  await bala.page.getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(bala.page.getByTestId('loc-status')).toContainText('Reykjav')
  await expect.poll(() => sql(`select city || ',' || country from profiles where id = '${bala.id}'`)).toBe('Reykjavík,Iceland')

  // --- Chetan: sees the invitation on Nearby, can still search a city, then opts in from there
  await chetan.page.goto('/nearby')
  await expect(chetan.page.getByText('Turn on city sharing to see who’s near you')).toBeVisible()
  await chetan.page.getByRole('region', { name: 'Find JECians near you' }).getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(chetan.page.getByTestId('nearby-origin')).toContainText('Reykjav')
  await expect.poll(() => loc(chetan)).toBe('64.15,-21.95,Reykjavík')

  // --- Divya denies: a clear message and nothing is stored or turned on
  await divya.page.goto('/')
  await divya.page.getByRole('region', { name: 'Find JECians near you' }).getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(divya.page.getByText(/Location is blocked for this site/)).toBeVisible()
  expect(sharing(divya)).not.toBe('true')
  expect(loc(divya)).toBe('')
  // "No thanks" hides the card for good, also after a reload
  await divya.page.getByRole('button', { name: 'No thanks' }).first().click()
  await expect(divya.page.getByRole('region', { name: 'Find JECians near you' })).toHaveCount(0)
  await divya.page.reload()
  await expect(divya.page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(divya.page.getByRole('region', { name: 'Find JECians near you' })).toHaveCount(0)

  // --- Asha's Nearby: batchmates first, distance never finer than the grid
  await asha.page.goto('/nearby')
  await expect(asha.page.getByTestId('nearby-origin')).toContainText('JECians near you (Reykjav')
  const batchSection = asha.page.getByRole('region', { name: 'Your batchmates' })
  const othersSection = asha.page.getByRole('region', { name: 'Other JECians' })
  await expect(batchSection.getByText(bala.name)).toBeVisible()
  await expect(batchSection.getByText(chetan.name)).toHaveCount(0)
  await expect(othersSection.getByText(chetan.name)).toBeVisible()
  await expect(batchSection.getByTestId('nearby-row').filter({ hasText: bala.name })).toContainText('In Reykjav')
  await expect(asha.page.getByText('Exact positions are never shown')).toBeVisible()
  await expect(asha.page.getByTestId('nearby-row').filter({ hasText: asha.name })).toHaveCount(0) // not listed to themselves
  await noHorizontalScroll(asha.page)
  await asha.page.screenshot({ path: 'test-results/nearby-390-list.png' })

  // --- filters
  await asha.page.getByLabel('Show', { exact: true }).selectOption('batch')
  await expect(asha.page.getByText(bala.name)).toBeVisible()
  await expect(asha.page.getByText(chetan.name)).toHaveCount(0)
  await asha.page.getByLabel('Show', { exact: true }).selectOption('range')
  await asha.page.getByLabel('From batch').selectOption(String(year + 2))
  await asha.page.getByLabel('To batch').selectOption(String(year + 4))
  await expect(asha.page.getByText(chetan.name)).toBeVisible()
  await expect(asha.page.getByText(bala.name)).toHaveCount(0)
  await asha.page.getByLabel('Show', { exact: true }).selectOption('all')
  await asha.page.getByLabel('Role or company').fill(`Chetan Loc${run}`)
  await expect(asha.page.getByText(bala.name)).toHaveCount(0)
  await expect(asha.page.getByText(chetan.name)).toBeVisible()
  await asha.page.getByLabel('Role or company').fill('')
  await expect(asha.page.getByText(bala.name)).toBeVisible()

  // --- map view: one cluster for Reykjavik with the right count (Bala and Chetan share; Divya lives there per her profile), no per-person pins
  await asha.page.getByRole('button', { name: 'Map' }).click()
  await expect(asha.page.getByTestId('nearby-map')).toBeVisible()
  await expect(asha.page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  await expect(asha.page.locator('.nearby-pin')).toHaveCount(1)
  await expect(asha.page.locator('.nearby-pin')).toHaveText('3')
  const chip = asha.page.getByRole('button', { name: /^Reykjav.* 3$/ })
  await chip.click()
  const mapList = asha.page.getByRole('region', { name: /People in Reykjav/ })
  await expect(mapList.getByText(bala.name)).toBeVisible()
  await expect(mapList.getByText(chetan.name)).toBeVisible()
  await expect(mapList.getByText(divya.name)).toBeVisible()
  await asha.page.screenshot({ path: 'test-results/nearby-390-map.png' })
  await asha.page.getByRole('button', { name: 'List', exact: true }).click()

  // --- city search: "who is in Reykjavik?" from a member who is somewhere else entirely
  await divya.page.goto('/nearby')
  await divya.page.getByRole('combobox', { name: 'Search a city' }).fill('reykjav')
  await divya.page.getByRole('option', { name: /Reykjav.*Iceland/ }).click()
  await expect(divya.page.getByTestId('nearby-origin')).toContainText('JECians in and around Reykjav')
  await expect(divya.page.getByText(asha.name)).toBeVisible()
  await expect(divya.page.getByText(bala.name)).toBeVisible()
  await expect(divya.page.getByText(chetan.name)).toBeVisible()
  await expect(divya.page.getByTestId('nearby-row').filter({ hasText: asha.name })).toContainText('In Reykjav')
  await noHorizontalScroll(divya.page)

  // --- Asha searches the same city: Divya lives there per her profile but does not share: labelled, no distance
  await asha.page.getByRole('combobox', { name: 'Search a city' }).fill('reykjav')
  await asha.page.getByRole('option', { name: /Reykjav.*Iceland/ }).click()
  const fallback = asha.page.getByTestId('nearby-row').filter({ hasText: divya.name })
  await expect(fallback).toContainText('Lives in Reykjavík (from profile)')
  await expect(fallback).not.toContainText('km')

  // --- open a profile from a result
  await asha.page.getByRole('link', { name: new RegExp(bala.name) }).click()
  await expect(asha.page).toHaveURL(new RegExp(`/people/${bala.id}`))
  await asha.page.goBack()

  // --- start a message from a result (existing DM rules)
  await asha.page.getByRole('button', { name: `Message ${chetan.name}` }).click()
  await expect(asha.page).toHaveURL(/\/chat\//)
  expect(Number(sql(`select count(*) from chats where dm_a in ('${asha.id}','${chetan.id}') and dm_b in ('${asha.id}','${chetan.id}')`))).toBe(1)

  // --- Hindi
  sql(`update profiles set language = 'hi' where id = '${asha.id}'`)
  await asha.page.goto('/nearby')
  await expect(asha.page.getByRole('heading', { name: 'आस-पास के JEC साथी' })).toBeVisible()
  sql(`update profiles set language = 'en' where id = '${asha.id}'`)

  // --- the app refreshes a shared city at most every 12 hours, when it opens
  sql(`update member_locations set updated_at = now() - interval '13 hours' where user_id = '${asha.id}'; update location_prefs set last_set_at = now() - interval '13 hours' where user_id = '${asha.id}'`)
  await asha.page.goto('/')
  await expect.poll(() => Number(sql(`select extract(epoch from now() - updated_at) from member_locations where user_id = '${asha.id}'`))).toBeLessThan(120)
  const stamp = sql(`select updated_at from member_locations where user_id = '${asha.id}'`)
  await asha.page.reload()
  await asha.page.waitForTimeout(1500)
  expect(sql(`select updated_at from member_locations where user_id = '${asha.id}'`)).toBe(stamp) // opened again within 12 h: no new fix

  // --- turning it off deletes the location and removes Asha from everyone's results
  await asha.page.goto('/me')
  await asha.page.getByRole('button', { name: 'Turn off and delete' }).click()
  await expect(asha.page.getByText('City sharing is off and your location was deleted.')).toBeVisible()
  expect(loc(asha)).toBe('')
  expect(sharing(asha)).toBe('false')
  expect(sql(`select string_agg(action, ',' order by id) from location_consent_log where user_id = '${asha.id}'`)).toBe('opt_in,opt_out')
  await bala.page.goto('/nearby')
  await expect(bala.page.getByText(chetan.name)).toBeVisible()
  await expect(bala.page.getByText(asha.name)).toHaveCount(0)

  // --- the data download includes the shared location
  await bala.page.goto('/me')
  const [dl] = await Promise.all([bala.page.waitForEvent('download'), bala.page.getByRole('button', { name: 'Download my data' }).click()])
  const text = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8')
  expect(JSON.parse(text).shared_location.city).toMatch(/Reykjav/)

  for (const m of [asha, bala, chetan, divya]) await m.ctx.close()
})

test('insecure or unsupported contexts explain themselves', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true })
  })
  page.on('dialog', (d) => void d.accept())
  const email = `nogeo.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, `Nogeo Loc${run}`, String(year))
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  await page.goto('/')
  await page.getByRole('region', { name: 'Find JECians near you' }).getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(page.getByText('This browser can’t share your location.')).toBeVisible()
  expect(sql(`select coalesce((select sharing::text from location_prefs where user_id = (select id from auth.users where email = '${email}')), 'none')`)).not.toBe('true')
  await ctx.close()
})
