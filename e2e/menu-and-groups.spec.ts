import { expect, test, type Browser, type Page } from '@playwright/test'
import { onboard, signInWithEmail, sql } from './helpers'

const run = Date.now().toString(36).slice(-5)
const year = String(1995 + ((Date.now() + 11) % 26))

async function member(browser: Browser, email: string, name: string, size = { width: 412, height: 915 }, opts: { mobile?: boolean } = { mobile: true }) {
  const ctx = await browser.newContext({ viewport: size, isMobile: !!opts.mobile, hasTouch: !!opts.mobile })
  const page = await ctx.newPage()
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, name, year)
  sql(`update profiles set verification = 'verified' where id = (select id from auth.users where email = '${email}')`)
  await page.reload()
  return { ctx, page, email }
}

const uid = (email: string) => sql(`select id from auth.users where email = '${email}'`)
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test('desktop sidebar: grouped sections, jump box, collapse, and Organise only for staff', async ({ browser }) => {
  const a = await member(browser, `nav.${run}@example.com`, `Navi ${run}`, { width: 1280, height: 800 }, { mobile: false })
  const side = a.page.getByTestId('sidebar-menu')
  await expect(side).toBeVisible()
  for (const name of ['Community', 'Events & memories', 'Opportunities', 'Me']) await expect(side.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(side.getByRole('heading', { name: 'Organise' })).toHaveCount(0)
  for (const name of ['Home', 'Groups', 'Find JECians', 'Nearby JECians', 'Chat', 'Meet 2026', 'Jobs', 'Mentorship', 'Businesses', 'Ask JEC', 'My profile']) {
    await expect(side.getByRole('link', { name })).toBeVisible()
  }
  await expect(side.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await expect(a.page.getByTestId('sidebar-user')).toContainText(`Navi ${run}`)

  // jump box
  await side.getByLabel('Search the menu').fill('jobs')
  await expect(side.getByRole('link', { name: 'Jobs' })).toBeVisible()
  await expect(side.getByRole('link', { name: 'Groups' })).toHaveCount(0)
  await side.getByLabel('Search the menu').press('Enter')
  await expect(a.page).toHaveURL(/\/jobs$/)
  await expect(side.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')
  await side.getByLabel('Search the menu').fill('zzzzzz')
  await expect(side.getByText('Nothing matches')).toBeVisible()
  await side.getByLabel('Search the menu').fill('')

  // collapsible, and remembered
  await side.getByRole('button', { name: 'Community', exact: true }).click()
  await expect(side.getByRole('link', { name: 'Groups' })).toHaveCount(0)
  await a.page.reload()
  await expect(side.getByRole('link', { name: 'Groups' })).toHaveCount(0)
  await side.getByRole('button', { name: 'Community', exact: true }).click()
  await expect(side.getByRole('link', { name: 'Groups' })).toBeVisible()

  // a limited admin sees only the Organise areas the permissions allow
  const id = uid(a.email)
  sql(`update profiles set is_admin = true where id = '${id}'`)
  sql(`insert into admin_grants (user_id, permissions) values ('${id}', array['analytics']) on conflict (user_id) do update set permissions = excluded.permissions`)
  await a.page.reload()
  await expect(side.getByRole('heading', { name: 'Organise' })).toBeVisible()
  await expect(side.getByRole('link', { name: 'Analytics' })).toBeVisible()
  await expect(side.getByRole('link', { name: 'Members' })).toHaveCount(0)
  await expect(side.getByRole('link', { name: 'Health' })).toHaveCount(0)
  await side.getByRole('link', { name: 'Analytics' }).click()
  await expect(a.page).toHaveURL(/\/admin\/analytics$/)
  // a full admin sees the rest
  sql(`delete from admin_grants where user_id = '${id}'`)
  await a.page.reload()
  await expect(side.getByRole('link', { name: 'Members' })).toBeVisible()
  await expect(side.getByRole('link', { name: 'Health' })).toBeVisible()
  await a.ctx.close()
})

test('phone: bottom bar of five, Menu sheet opens, searches, navigates, closes with Esc and Back; no sideways scroll', async ({ browser }) => {
  const a = await member(browser, `nav2.${run}@example.com`, `Navtwo ${run}`)
  const bar = a.page.getByRole('navigation', { name: 'Main' })
  for (const name of ['Home', 'Groups', 'Meet 2026', 'Chat']) await expect(bar.getByRole('link', { name })).toBeVisible()
  const menuBtn = bar.getByRole('button', { name: 'Menu' })
  await expect(menuBtn).toBeVisible()
  await expect(bar.getByRole('listitem')).toHaveCount(5)

  await menuBtn.click()
  const sheet = a.page.getByRole('dialog', { name: 'Menu' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByLabel('Search the menu')).toBeFocused()
  for (const name of ['Community', 'Events & memories', 'Opportunities', 'Me']) await expect(sheet.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Organise' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(await noHScroll(a.page)).toBe(true)
  // big touch targets
  const box = await sheet.getByRole('link', { name: 'Groups' }).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)

  // focus stays in the sheet
  for (let i = 0; i < 12; i++) await a.page.keyboard.press('Tab')
  expect(await a.page.evaluate(() => !!document.activeElement?.closest('[data-testid="menu-sheet"]'))).toBe(true)

  // search and go
  await sheet.getByLabel('Search the menu').fill('photos')
  await expect(sheet.getByRole('link', { name: 'Reunion photos' })).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'Jobs' })).toHaveCount(0)
  await sheet.getByRole('link', { name: 'Reunion photos' }).click()
  await expect(a.page).toHaveURL(/\/meet\/photos$/)
  await expect(a.page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)

  // Esc closes and gives focus back to the Menu button
  await menuBtn.click()
  await expect(sheet).toBeVisible()
  await a.page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(menuBtn).toBeFocused()

  // the phone's Back closes the sheet and stays on the page
  await menuBtn.click()
  await expect(sheet).toBeVisible()
  await a.page.goBack()
  await expect(sheet).toHaveCount(0)
  await expect(a.page).toHaveURL(/\/meet\/photos$/)

  // everything the Me page used to hold is reachable from the menu: Language goes to the Me page section
  await menuBtn.click()
  await sheet.getByLabel('Search the menu').fill('language')
  await sheet.getByRole('link', { name: 'Language' }).click()
  await expect(a.page).toHaveURL(/\/me#language$/)
  await expect(a.page.getByRole('group', { name: 'भाषा / Language' })).toBeVisible()

  // Home has quick actions; the lighter Me page keeps profile, completeness and settings
  await a.page.goto('/')
  const quick = a.page.getByRole('region', { name: 'Quick actions' })
  await expect(quick.getByRole('link', { name: 'Groups' })).toBeVisible()
  await expect(quick.getByRole('link', { name: 'Jobs' })).toBeVisible()
  await a.page.goto('/me')
  await expect(a.page.getByRole('link', { name: 'Edit profile' })).toBeVisible()
  await expect(a.page.getByTestId('me-completeness')).toBeVisible()

  // 360 and 412 wide: no sideways scrolling anywhere
  for (const width of [360, 412]) {
    await a.page.setViewportSize({ width, height: 800 })
    for (const path of ['/', '/groups', '/me', '/meet']) {
      await a.page.goto(path)
      await expect(a.page.getByRole('navigation', { name: 'Main' })).toBeVisible()
      expect(await noHScroll(a.page), `${path} at ${width}`).toBe(true)
    }
    await a.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Menu' }).click()
    await expect(a.page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
    expect(await noHScroll(a.page), `menu at ${width}`).toBe(true)
    await a.page.keyboard.press('Escape')
  }
  await a.ctx.close()
})

test('department groups: new member lands in Official, department and batch groups; moves with the branch; HOD posts in Official', async ({ browser }) => {
  const boss = await member(browser, `gboss.${run}@example.com`, `Gboss ${run}`)
  const mem = await member(browser, `gmem.${run}@example.com`, `Gmem ${run}`)
  const hod = await member(browser, `ghod.${run}@example.com`, `Ghod ${run}`)
  sql(`update profiles set is_admin = true where id = '${uid(boss.email)}'`)
  sql(`update profiles set member_type = 'faculty' where id = '${uid(hod.email)}'`)

  // a new member is in all of them without doing anything
  const memId = uid(mem.email)
  const names = () => sql(`select string_agg(g.name, '|' order by g.name) from group_members m join groups g on g.id = m.group_id where m.user_id = '${memId}'`)
  expect(names()).toContain('JEC Alumni Connect · Official')
  expect(names()).toContain('Computer Science & Engineering Department')
  expect(names()).toContain(`JEC ${year}`)
  expect(names()).toContain(`B.E. in Computer Science & Engineering ${year}`)
  await mem.page.goto('/groups')
  for (const section of ['Official', 'My department', 'My batch', 'My department + batch']) await expect(mem.page.locator(`[data-section="${section}"]`)).toBeVisible()
  await expect(mem.page.locator('[data-section="Official"]')).toContainText('JEC Alumni Connect · Official')
  await expect(mem.page.locator('[data-section="My department"]')).toContainText('Computer Science & Engineering Department')
  await expect(mem.page.locator('[data-section="My department + batch"]')).toContainText(`Computer Science & Engineering ${year}`)

  // the branch changes: the department moves, the batch group follows, Official stays
  sql(`update profiles set branch = 'Mechatronics' where id = '${memId}'`)
  await mem.page.reload()
  await expect(mem.page.locator('[data-section="My department"]')).toContainText('Mechatronics Department')
  await expect(mem.page.locator('[data-section="My department"]')).not.toContainText('Computer Science')
  expect(names()).not.toContain('Computer Science & Engineering Department')
  expect(names()).toContain('Mechatronics Department')
  expect(names()).toContain(`Mechatronics ${year}`)
  expect(names()).toContain('JEC Alumni Connect · Official')

  // the admin names the head of department as a group admin of Official from the Community screen
  await boss.page.goto('/admin/community')
  const card = boss.page.locator('[data-group="jec-alumni-connect-official"]')
  await expect(card).toContainText('Only staff post')
  await card.getByRole('button', { name: 'Manage' }).click()
  await card.getByRole('button', { name: 'Add a group admin' }).click()
  await card.getByLabel('Search members by name').fill(`Ghod ${run}`)
  await card.getByRole('button', { name: `Make admin: Ghod ${run}` }).click()
  await expect(boss.page.getByText('Group admin added')).toBeVisible()
  const official = sql(`select id from groups where kind = 'official'`)
  expect(sql(`select role from group_members where group_id = '${official}' and user_id = '${uid(hod.email)}'`)).toBe('admin')
  expect(sql(`select count(*) from notifications where user_id = '${uid(hod.email)}' and kind = 'group_admin'`)).toBe('1')
  expect(Number(sql(`select count(*) from admin_audit where action = 'group_admin_added' and target_id = '${official}'`))).toBeGreaterThanOrEqual(1)

  // the HOD posts in the staff-only Official chat and pins it; the member can read but not post
  const chat = sql(`select id from chats where group_id = '${official}'`)
  await hod.page.goto(`/chat/${chat}`)
  await hod.page.reload()
  await hod.page.getByLabel('Message', { exact: true }).fill(`Welcome from the HOD ${run}`)
  await hod.page.getByRole('button', { name: 'Send' }).click()
  await expect(hod.page.getByText(`Welcome from the HOD ${run}`)).toBeVisible()
  await hod.page.getByText(`Welcome from the HOD ${run}`).first().click({ button: 'right' })
  await hod.page.getByRole('dialog', { name: 'Message options' }).getByRole('button', { name: 'Pin to top' }).click()
  await expect(hod.page.getByRole('button', { name: 'Go to pinned message' })).toContainText(`Welcome from the HOD ${run}`)
  expect(sql(`select count(*) from messages where chat_id = '${chat}' and body = 'Welcome from the HOD ${run}'`)).toBe('1')

  await mem.page.goto(`/chat/${chat}`)
  await expect(mem.page.getByText(`Welcome from the HOD ${run}`).first()).toBeVisible()
  await expect(mem.page.getByLabel('Message', { exact: true })).toHaveCount(0)
  await expect(mem.page.getByText(/Only staff can post here/)).toBeVisible()

  // the admin opens the group to everyone: the member can write
  await card.getByLabel('Who can post').selectOption('everyone')
  await card.getByRole('button', { name: 'Save group' }).click()
  await expect(boss.page.getByText('Group saved')).toBeVisible()
  expect(sql(`select post_mode from groups where id = '${official}'`)).toBe('everyone')
  await mem.page.reload()
  await mem.page.getByLabel('Message', { exact: true }).fill(`Thanks ${run}`)
  await mem.page.getByRole('button', { name: 'Send' }).click()
  await expect(mem.page.getByText(`Thanks ${run}`)).toBeVisible()
  sql(`update groups set post_mode = 'staff_only' where id = '${official}'`) // leave the shared group as we found it
  for (const p of [boss, mem, hod]) await p.ctx.close()
})
