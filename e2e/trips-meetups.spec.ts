import { expect, test, type Browser, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

// Trips, city meetups and opt-in alerts. The city is Reykjavik: nobody else uses it in the dev database.
const run = Date.now().toString(36).slice(-5)
const year = 1995 + ((Date.now() + 11) % 20)
const REYK = { latitude: 64.1466, longitude: -21.9426 }
const MUMBAI = { latitude: 19.076, longitude: 72.8777 }

const ist = (plusDays = 0) => {
  const d = new Date(Date.now() + plusDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const CITY = () => sql(`select id from geo_cities where search_key like 'reykjav%' order by population desc limit 1`)

async function member(browser: Browser, key: string, name: string, batch: number, geo?: { latitude: number; longitude: number }) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}),
  })
  const page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept(d.defaultValue() || 'Spam test'))
  const email = `${key}.${run}@example.com`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, String(batch))
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  const id = sql(`select id from auth.users where email = '${email}'`)
  return { ctx, page, id, name }
}

function cleanReykjavik() {
  const c = CITY()
  sql(`delete from member_trips where city_id = ${c}; delete from groups where id in (select group_id from city_meetups where city_id = ${c});
       delete from member_locations where city_id = ${c}; update profiles set city = null where lower(city) like 'reykjav%'`)
}

async function addTrip(page: Page, from: string, to: string, visibility: 'My batch only' | 'Everyone at JEC') {
  await page.goto('/trips')
  await page.getByRole('button', { name: 'Add a trip' }).click()
  const sheet = page.getByRole('dialog', { name: 'Add a trip' })
  await sheet.getByRole('combobox', { name: 'Search a city' }).fill('reykjav')
  await sheet.getByRole('option', { name: /Reykjav/ }).click()
  await expect(sheet.getByTestId('trip-city')).toContainText('Reykjav')
  await sheet.getByLabel('From', { exact: true }).fill(from)
  await sheet.getByLabel('To', { exact: true }).fill(to)
  await sheet.getByText(visibility, { exact: true }).click()
  await sheet.getByRole('button', { name: 'Save trip' }).click()
}

test('trips: validation, visibility (everyone / my batch), profile chip, expiry, edit and cancel', async ({ browser }) => {
  test.setTimeout(240_000)
  cleanReykjavik()
  const asha = await member(browser, 'tasha', `Asha Trip${run}`, year)
  const bala = await member(browser, 'tbala', `Bala Trip${run}`, year)
  const chetan = await member(browser, 'tchetan', `Chetan Trip${run}`, year + 3)
  const city = CITY()

  // --- validation messages, nothing saved
  await asha.page.goto('/trips')
  await asha.page.getByRole('button', { name: 'Add a trip' }).click()
  const sheet = asha.page.getByRole('dialog', { name: 'Add a trip' })
  await sheet.getByRole('button', { name: 'Save trip' }).click()
  await expect(sheet.getByText('Choose a city from the list.')).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Search a city' }).fill('reykjav')
  await sheet.getByRole('option', { name: /Reykjav/ }).click()
  await sheet.getByRole('button', { name: 'Save trip' }).click()
  await expect(sheet.getByText('Choose both dates.')).toBeVisible()
  await sheet.getByLabel('From', { exact: true }).fill(ist(12))
  await sheet.getByLabel('To', { exact: true }).fill(ist(10))
  await sheet.getByRole('button', { name: 'Save trip' }).click()
  await expect(sheet.getByText('The end date can’t be before the start date.')).toBeVisible()
  await sheet.getByLabel('From', { exact: true }).fill(ist(-3))
  await sheet.getByLabel('To', { exact: true }).fill(ist(2))
  await sheet.getByRole('button', { name: 'Save trip' }).click()
  await expect(sheet.getByText('A trip can’t be in the past.')).toBeVisible()
  await sheet.getByLabel('From', { exact: true }).fill(ist(1))
  await sheet.getByLabel('To', { exact: true }).fill(ist(120))
  await sheet.getByRole('button', { name: 'Save trip' }).click()
  await expect(sheet.getByText('A trip can be at most 90 days long.')).toBeVisible()
  expect(sql(`select count(*) from member_trips where user_id = '${asha.id}'`)).toBe('0')
  await asha.page.keyboard.press('Escape')

  // --- a batch-only trip
  await addTrip(asha.page, ist(10), ist(12), 'My batch only')
  await expect(asha.page.getByText('Trip saved')).toBeVisible()
  const row = asha.page.getByTestId('trip-row').filter({ hasText: 'Reykjav' })
  await expect(row).toContainText('My batch only')
  expect(sql(`select visibility || ',' || starts_on || ',' || ends_on from member_trips where user_id = '${asha.id}' and cancelled_at is null`)).toBe(`batch,${ist(10)},${ist(12)}`)

  // the batchmate sees it on the city page ("Visiting soon") and as a chip on Asha's profile; another batch does not
  await bala.page.goto(`/city/${city}`)
  await expect(bala.page.getByRole('region', { name: 'Visiting soon' }).getByTestId('city-trip').filter({ hasText: asha.name })).toBeVisible()
  await bala.page.goto(`/people/${asha.id}`)
  await expect(bala.page.getByTestId('trip-chips')).toContainText('Visiting Reykjav')
  await chetan.page.goto(`/city/${city}`)
  await expect(chetan.page.getByRole('region', { name: 'Visiting soon' })).toContainText('No trips planned here yet.')
  await chetan.page.goto(`/people/${asha.id}`)
  await expect(chetan.page.getByRole('heading', { name: asha.name }).last()).toBeVisible()
  await expect(chetan.page.getByTestId('trip-chips')).toHaveCount(0)

  // --- the Nearby city search shows "Visiting soon" too
  await bala.page.goto(`/nearby?city=${city}&name=Reykjav%C3%ADk`)
  await expect(bala.page.getByRole('region', { name: 'Visiting soon' }).getByText(asha.name)).toBeVisible()

  // --- edit: open it to everyone; now the other batch sees it
  await row.getByRole('button', { name: /Edit trip/ }).click()
  const edit = asha.page.getByRole('dialog', { name: 'Edit trip' })
  await edit.getByText('Everyone at JEC', { exact: true }).click()
  await edit.getByLabel('To', { exact: true }).fill(ist(13))
  await edit.getByRole('button', { name: 'Save trip' }).click()
  await expect(row).toContainText('Everyone at JEC')
  await expect(row).toContainText(new RegExp(`– ${Number(ist(13).slice(8))} `))
  await chetan.page.goto(`/city/${city}`)
  await expect(chetan.page.getByRole('region', { name: 'Visiting soon' }).getByText(asha.name)).toBeVisible()
  await chetan.page.goto(`/people/${asha.id}`)
  await expect(chetan.page.getByTestId('trip-chips')).toContainText('Visiting Reykjav')

  // --- expired trips disappear by date alone (no clean-up job)
  sql(`insert into member_trips (user_id, city_id, starts_on, ends_on, visibility) values ('${asha.id}', ${city}, current_date - 20, current_date - 15, 'everyone')`)
  await asha.page.goto('/trips')
  await expect(asha.page.getByTestId('trip-row')).toHaveCount(1)
  await chetan.page.goto(`/city/${city}`)
  await expect(chetan.page.getByTestId('city-trip')).toHaveCount(1)

  // --- cancel: gone for everyone, kept in the database as cancelled
  await asha.page.goto('/trips')
  await asha.page.getByRole('button', { name: /Cancel trip/ }).click()
  await expect(asha.page.getByText('Trip cancelled')).toBeVisible()
  await expect(asha.page.getByText('No upcoming trips')).toBeVisible()
  expect(sql(`select count(*) from member_trips where user_id = '${asha.id}' and cancelled_at is not null`)).toBe('1')
  await chetan.page.goto(`/city/${city}`)
  await expect(chetan.page.getByTestId('city-trip')).toHaveCount(0)

  for (const m of [asha, bala, chetan]) await m.ctx.close()
})

test('meetups: start, validation, join, history for late joiners, leave, nobody auto-added, admin hide and restore', async ({ browser }) => {
  test.setTimeout(240_000)
  cleanReykjavik()
  const asha = await member(browser, 'masha', `Asha Meet${run}`, year)
  const bala = await member(browser, 'mbala', `Bala Meet${run}`, year)
  const chetan = await member(browser, 'mchetan', `Chetan Meet${run}`, year + 3)
  const admin = await member(browser, 'madmin', `Admin Meet${run}`, year + 5)
  sql(`update profiles set is_admin = true where id = '${admin.id}'`)
  const city = CITY()
  const meetupName = `Chai at the harbour ${run}`

  // --- start one (name checked first)
  await asha.page.goto(`/city/${city}`)
  await expect(asha.page.getByText('No meetups here yet')).toBeVisible()
  await asha.page.getByRole('button', { name: 'Start a meetup chat' }).click()
  const form = asha.page.getByRole('dialog', { name: 'Start a meetup chat' })
  await form.getByLabel('Meetup name').fill('Hi')
  await form.getByRole('button', { name: 'Start meetup' }).click()
  await expect(form.getByText('Give the meetup a name of 3 to 80 characters.')).toBeVisible()
  await form.getByLabel('Meetup name').fill(meetupName)
  await form.getByLabel('When').fill('Saturday 5 pm')
  await form.getByLabel('Where').fill('Old harbour')
  await form.getByLabel('About').fill('Informal catch-up for JECians visiting or living here.')
  await form.getByRole('button', { name: 'Start meetup' }).click()
  await expect(asha.page.getByText('Meetup started')).toBeVisible()
  const card = (p: Page) => p.getByTestId('meetup-card').filter({ hasText: meetupName })
  await expect(card(asha.page)).toContainText('1 member')
  await expect(card(asha.page)).toContainText('Saturday 5 pm · Old harbour')
  await expect(card(asha.page).getByRole('button', { name: 'Open chat' })).toBeVisible()
  const group = sql(`select group_id from city_meetups where city_id = ${city} and creator_id = '${asha.id}' and status = 'active'`)
  const chat = sql(`select id from chats where group_id = '${group}'`)
  expect(sql(`select kind || ',' || member_count from groups where id = '${group}'`)).toBe('meetup,1')
  await asha.page.screenshot({ path: 'test-results/city-390.png' })

  // one active meetup per city per creator
  await asha.page.getByRole('button', { name: 'Start a meetup chat' }).click()
  const again = asha.page.getByRole('dialog', { name: 'Start a meetup chat' })
  await again.getByLabel('Meetup name').fill('A second meetup')
  await again.getByRole('button', { name: 'Start meetup' }).click()
  await expect(again.getByText(/already have an active meetup in this city/)).toBeVisible()
  await asha.page.keyboard.press('Escape')

  // --- a message before anyone joins; Bala joins late and still reads it
  sql(`insert into messages (chat_id, sender_id, kind, body) values ('${chat}', '${asha.id}', 'text', 'See you on Saturday ${run}')`)
  await bala.page.goto(`/city/${city}`)
  await expect(card(bala.page)).toContainText('Started by')
  expect(sql(`select count(*) from group_members where group_id = '${group}' and user_id = '${bala.id}'`)).toBe('0') // nobody is added automatically
  await card(bala.page).getByRole('button', { name: 'Join', exact: true }).click()
  await expect(bala.page.getByText('You joined the meetup')).toBeVisible()
  await expect(card(bala.page)).toContainText('2 members')
  expect(sql(`select count(*) from group_members where group_id = '${group}' and user_id = '${bala.id}'`)).toBe('1')
  await card(bala.page).getByRole('button', { name: 'Open chat' }).click()
  await expect(bala.page).toHaveURL(new RegExp(`/chat/${chat}`))
  await expect(bala.page.getByText(`See you on Saturday ${run}`)).toBeVisible()

  // --- Chetan never joined: still sees "Join", not a member
  await chetan.page.goto(`/city/${city}`)
  await expect(card(chetan.page).getByRole('button', { name: 'Join', exact: true })).toBeVisible()
  expect(sql(`select count(*) from group_members where group_id = '${group}' and user_id = '${chetan.id}'`)).toBe('0')
  await chetan.page.goto(`/chat/${chat}`)
  await expect(chetan.page.getByText(`See you on Saturday ${run}`)).toHaveCount(0)

  // --- leave and rejoin; the organiser has no "Leave", only "Close meetup"
  await bala.page.goto(`/city/${city}`)
  await card(bala.page).getByRole('button', { name: 'Leave', exact: true }).click()
  await expect(bala.page.getByText('You left the meetup')).toBeVisible()
  await expect(card(bala.page).getByRole('button', { name: 'Join', exact: true })).toBeVisible()
  expect(sql(`select count(*) from group_members where group_id = '${group}' and user_id = '${bala.id}'`)).toBe('0')
  await card(bala.page).getByRole('button', { name: 'Join', exact: true }).click()
  await expect(card(bala.page)).toContainText('2 members')
  await expect(card(asha.page).getByRole('button', { name: 'Leave', exact: true })).toHaveCount(0)
  await expect(card(asha.page).getByRole('button', { name: 'Close meetup' })).toBeVisible()

  // --- admin hides it (reason recorded, audited): members no longer see it or its chat; restoring brings it back
  await admin.page.goto(`/city/${city}`)
  await card(admin.page).getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(card(admin.page)).toContainText('Hidden')
  expect(sql(`select status || ',' || coalesce(status_reason, '') from city_meetups where group_id = '${group}'`)).toBe('hidden,Spam test')
  expect(sql(`select count(*) from admin_audit where action = 'meetup_hidden' and target_id = '${group}'`)).toBe('1')
  await chetan.page.goto(`/city/${city}`)
  await expect(chetan.page.getByText('No meetups here yet')).toBeVisible()
  await bala.page.goto(`/city/${city}`)
  await expect(bala.page.getByText('No meetups here yet')).toBeVisible()
  await bala.page.goto(`/chat/${chat}`)
  await expect(bala.page.getByText(`See you on Saturday ${run}`)).toHaveCount(0)
  await admin.page.getByRole('button', { name: 'Restore' }).click()
  await expect(card(admin.page)).not.toContainText('Hidden')
  expect(sql(`select status from city_meetups where group_id = '${group}'`)).toBe('active')
  await bala.page.goto(`/city/${city}`)
  await expect(card(bala.page)).toBeVisible()

  // --- the organiser closes it: read-only history, no more joining
  await asha.page.goto(`/city/${city}`)
  await card(asha.page).getByRole('button', { name: 'Close meetup' }).click()
  await expect(asha.page.getByText('Meetup closed')).toBeVisible()
  expect(sql(`select status from city_meetups where group_id = '${group}'`)).toBe('closed')
  await chetan.page.goto(`/city/${city}`)
  await expect(chetan.page.getByText('No meetups here yet')).toBeVisible()

  for (const m of [asha, bala, chetan, admin]) await m.ctx.close()
})

test('alerts: off by default, batchmate arrival, scope, one a week, trip alert, turning off removes unread, nothing names a position', async ({ browser }) => {
  test.setTimeout(300_000)
  cleanReykjavik()
  const asha = await member(browser, 'aasha', `Asha Alert${run}`, year, MUMBAI)
  const bala = await member(browser, 'abala', `Bala Alert${run}`, year, REYK)
  const chetan = await member(browser, 'achetan', `Chetan Alert${run}`, year + 3, REYK)
  const kinds = `('nearby_batchmate', 'nearby_trip')`
  const count = (who: { id: string }, kind: string, unreadOnly = false) =>
    Number(sql(`select count(*) from notifications where user_id = '${who.id}' and kind = '${kind}' ${unreadOnly ? 'and read_at is null' : ''}`))

  // Bala shares from Reykjavik and turns on both alerts (my batch only is the default)
  await bala.page.goto('/me')
  const settings = bala.page.getByRole('group', { name: 'Alerts (all off by default)' })
  await expect(settings.getByRole('checkbox', { name: 'Tell me when a batchmate is in my city' })).not.toBeChecked()
  await expect(settings.getByRole('checkbox', { name: 'Tell me when a JECian plans a trip to my city' })).not.toBeChecked()
  expect(sql(`select coalesce((select alert_batchmate::text || alert_trip::text from location_prefs where user_id = '${bala.id}'), 'none')`)).toBe('none')
  await bala.page.getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(bala.page.getByTestId('loc-status')).toContainText('Reykjav')
  await settings.getByRole('checkbox', { name: 'Tell me when a batchmate is in my city' }).check()
  await expect(bala.page.getByText('Alert settings saved')).toBeVisible()
  await settings.getByRole('checkbox', { name: 'Tell me when a JECian plans a trip to my city' }).check()
  await expect.poll(() => sql(`select alert_batchmate::text || ',' || alert_batchmate_scope || ',' || alert_trip::text from location_prefs where user_id = '${bala.id}'`)).toBe('true,batch,true')

  // Chetan (another batch) lives in Reykjavik per his profile, does not share, and listens to batchmates only (default scope)
  sql(`update profiles set city = 'Reykjavík', country = 'Iceland' where id = '${chetan.id}'`)
  await chetan.page.goto('/me')
  await chetan.page.getByRole('group', { name: 'Alerts (all off by default)' }).getByRole('checkbox', { name: 'Tell me when a batchmate is in my city' }).check()
  await expect(chetan.page.getByText('Alert settings saved')).toBeVisible()

  // Asha opts in from Mumbai, then lands in Reykjavik and updates her city
  await asha.page.goto('/me')
  await asha.page.getByRole('button', { name: 'Turn on city sharing' }).click()
  await expect(asha.page.getByTestId('loc-status')).toContainText('Mumbai')
  expect(count(bala, 'nearby_batchmate')).toBe(0) // the first fix is not a move
  await asha.ctx.setGeolocation(REYK)
  sql(`update location_prefs set last_set_at = now() - interval '1 hour' where user_id = '${asha.id}'`)
  await asha.page.getByRole('button', { name: 'Update my location' }).click()
  await expect(asha.page.getByTestId('loc-status')).toContainText('Reykjav')

  // Bala (same batch) hears; Chetan (another batch, batch scope) does not
  await expect.poll(() => count(bala, 'nearby_batchmate')).toBe(1)
  expect(count(chetan, 'nearby_batchmate')).toBe(0)
  expect(sql(`select body from notifications where user_id = '${bala.id}' and kind = 'nearby_batchmate'`)).toBe('Reykjavík')
  expect(sql(`select count(*) from notifications where kind in ${kinds} and body ~ '[0-9]' and user_id in ('${bala.id}', '${chetan.id}')`)).toBe('0')

  // Chetan widens his scope to everyone; Asha moves away and back (more than 10 minutes apart): Chetan hears, Bala is not told twice
  await chetan.page.reload()
  await chetan.page.getByLabel('Tell me when a batchmate is in my city: From').selectOption('everyone')
  await expect.poll(() => sql(`select alert_batchmate_scope from location_prefs where user_id = '${chetan.id}'`)).toBe('everyone')
  await asha.ctx.setGeolocation(MUMBAI)
  sql(`update location_prefs set last_set_at = now() - interval '1 hour' where user_id = '${asha.id}'`)
  await asha.page.getByRole('button', { name: 'Update my location' }).click()
  await expect(asha.page.getByTestId('loc-status')).toContainText('Mumbai')
  await asha.ctx.setGeolocation(REYK)
  sql(`update location_prefs set last_set_at = now() - interval '1 hour' where user_id = '${asha.id}'`)
  await asha.page.getByRole('button', { name: 'Update my location' }).click()
  await expect(asha.page.getByTestId('loc-status')).toContainText('Reykjav')
  await expect.poll(() => count(chetan, 'nearby_batchmate')).toBe(1)
  expect(count(bala, 'nearby_batchmate')).toBe(1)

  // Chetan opens his notifications and sees the alert, with Asha's name and the city, nothing more
  await chetan.page.goto('/notifications')
  await expect(chetan.page.getByText(`${asha.name} is now in Reykjavík`)).toBeVisible()

  // Trip alert: Asha plans a trip to Reykjavik for everyone; Bala (trip alerts on) hears, Chetan (off) does not
  await addTrip(asha.page, ist(20), ist(22), 'Everyone at JEC')
  await expect(asha.page.getByText('Trip saved')).toBeVisible()
  await expect.poll(() => count(bala, 'nearby_trip')).toBe(1)
  expect(count(chetan, 'nearby_trip')).toBe(0)
  expect(sql(`select target_id = (select id from member_trips where user_id = '${asha.id}' and cancelled_at is null) from notifications where user_id = '${bala.id}' and kind = 'nearby_trip'`)).toBe('t')

  // cancelling the trip withdraws the unread alert
  await asha.page.goto('/trips')
  await asha.page.getByRole('button', { name: /Cancel trip/ }).click()
  await expect(asha.page.getByText('Trip cancelled')).toBeVisible()
  expect(count(bala, 'nearby_trip')).toBe(0)

  // Bala turns the batchmate alert off: the unread one is removed and no new one arrives
  expect(count(bala, 'nearby_batchmate', true)).toBe(1)
  await bala.page.goto('/me')
  await bala.page.getByRole('group', { name: 'Alerts (all off by default)' }).getByRole('checkbox', { name: 'Tell me when a batchmate is in my city' }).uncheck()
  await expect.poll(() => count(bala, 'nearby_batchmate')).toBe(0)

  // when Asha turns sharing off, what is still unread about her is withdrawn (Chetan read his, so it stays)
  sql(`update notifications set read_at = null where user_id = '${chetan.id}' and kind = 'nearby_batchmate'`)
  await asha.page.goto('/me')
  await asha.page.getByRole('button', { name: 'Turn off and delete' }).click()
  await expect(asha.page.getByText('City sharing is off and your location was deleted.')).toBeVisible()
  expect(count(chetan, 'nearby_batchmate')).toBe(0)
  expect(sql(`select count(*) from member_locations where user_id = '${asha.id}'`)).toBe('0')

  for (const m of [asha, bala, chetan]) await m.ctx.close()
})
