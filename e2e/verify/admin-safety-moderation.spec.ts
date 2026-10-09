// Moderation, end to end: every reportable thing can be hidden, restored or dismissed from the Reports screen by a moderator, and the
// community sees the effect; slow mode works in any group; city meetups can be hidden / restored; organisers and admins can remove a person.
import { expect, test, type Page } from '@playwright/test'
import { sql } from '../helpers'
import { auditCount, loginPage, makeUser, ts, type TestUser } from './admin-lib'

test.describe.configure({ mode: 'serial' })
const tag = `sm${ts}`.slice(0, 9)

let mod: TestUser, author: TestUser, rep1: TestUser, viewer: TestUser, boss: TestUser, plain: TestUser
const id = (q: string) => sql(q).split('\n')[0]!

test.beforeAll(async () => {
  mod = await makeUser(`${tag}mod`, { name: `Moddy ${tag}` })
  author = await makeUser(`${tag}au`, { name: `Author ${tag}` })
  rep1 = await makeUser(`${tag}r1`, { name: `Reporter ${tag}` })
  viewer = await makeUser(`${tag}vw`, { name: `Viewer ${tag}` })
  boss = await makeUser(`${tag}boss`, { admin: true, name: `Boss ${tag}` })
  plain = await makeUser(`${tag}pl`, { name: `Plain ${tag}` })
  sql(`insert into site_roles (user_id, role) values ('${mod.id}', 'moderator')`)
})

const card = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text })

interface Kind {
  type: 'post' | 'comment' | 'job' | 'business' | 'help'
  table: string
  hiddenCol: string
  make: (text: string) => string
  /** how another member would look the thing up: must be empty while hidden */
  visible: (u: TestUser, rowId: string) => Promise<number>
}
const rows = (table: string) => async (u: TestUser, rowId: string) => ((await u.db.from(table).select('id').eq('id', rowId)).data ?? []).length

const KINDS: Kind[] = [
  { type: 'post', table: 'posts', hiddenCol: 'is_hidden', make: (t) => id(`insert into posts (author_id, body) values ('${author.id}', '${t}') returning id`), visible: rows('posts') },
  {
    type: 'comment', table: 'comments', hiddenCol: 'is_hidden',
    make: (t) => {
      const p = id(`insert into posts (author_id, body) values ('${author.id}', 'Parent post ${tag}') returning id`)
      return id(`insert into comments (post_id, author_id, body) values ('${p}', '${author.id}', '${t}') returning id`)
    },
    visible: rows('comments'),
  },
  { type: 'job', table: 'jobs', hiddenCol: 'is_hidden', make: (t) => id(`insert into jobs (posted_by, title, company, description, apply_url) values ('${author.id}', '${t}', 'Acme', 'A job description for moderation tests', 'https://example.com/apply') returning id`), visible: rows('jobs') },
  { type: 'business', table: 'businesses', hiddenCol: 'is_hidden', make: (t) => id(`insert into businesses (owner_id, name, category, city, description, website_url) values ('${author.id}', '${t}', 'Consulting', 'Pune', 'A business used in moderation tests', 'https://example.com') returning id`), visible: rows('businesses') },
  { type: 'help', table: 'help_requests', hiddenCol: 'is_hidden', make: (t) => id(`insert into help_requests (author_id, tag, title) values ('${author.id}', 'career', '${t}') returning id`), visible: rows('help_requests') },
]

for (const k of KINDS) {
  test(`reports: a ${k.type} is hidden from members by a moderator, then restored; both are audited`, async ({ page }) => {
    const text = `Bad ${k.type} ${tag}`
    const target = k.make(text)
    sql(`insert into reports (reporter, target_type, target_id, reason) values ('${rep1.id}', '${k.type}', '${target}', 'rule-break ${tag}')`)
    expect(await k.visible(viewer, target)).toBe(1)

    await loginPage(page, mod, '/admin/reports')
    const c = card(page, text)
    await expect(c).toContainText('1 report')
    await expect(c).toContainText(`rule-break ${tag}`)
    await expect(c).toContainText(`Author ${tag}`)
    page.once('dialog', (d) => d.dismiss())
    await c.getByRole('button', { name: 'Hide' }).click()
    expect(sql(`select ${k.hiddenCol} from ${k.table} where id = '${target}'`)).toBe('f')

    page.once('dialog', (d) => d.accept())
    await c.getByRole('button', { name: 'Hide' }).click()
    await expect(c).toHaveCount(0)
    expect(sql(`select ${k.hiddenCol} from ${k.table} where id = '${target}'`)).toBe('t')
    expect(sql(`select status || ':' || (handled_by = '${mod.id}') from reports where target_id = '${target}'`)).toBe('actioned:true')
    expect(auditCount(`action = 'hide_${k.type}' and target_id = '${target}' and actor = '${mod.id}'`)).toBe(1)
    expect(await k.visible(viewer, target), 'members no longer see it').toBe(0)

    // Actioned tab: it shows as removed and can be restored
    await page.getByRole('tab', { name: 'Actioned' }).click()
    const done = card(page, text)
    await expect(done).toContainText('Removed')
    page.once('dialog', (d) => d.accept())
    await done.getByRole('button', { name: 'Restore' }).click()
    await expect(done.getByRole('button', { name: 'Restore' })).toHaveCount(0)
    expect(sql(`select ${k.hiddenCol} from ${k.table} where id = '${target}'`)).toBe('f')
    expect(auditCount(`action = 'restore_${k.type}' and target_id = '${target}' and actor = '${mod.id}'`)).toBe(1)
    expect(await k.visible(viewer, target), 'members see it again').toBe(1)
  })
}

test('reports: dismiss leaves the content alone and closes the report; a chat message is removed for everyone', async ({ page }) => {
  const text = `Fine post ${tag}`
  const post = id(`insert into posts (author_id, body) values ('${author.id}', '${text}') returning id`)
  sql(`insert into reports (reporter, target_type, target_id, reason) values ('${rep1.id}', 'post', '${post}', 'mistaken ${tag}')`)
  // a direct message between two members, reported by the recipient
  const chat = id(`insert into chats (kind, dm_a, dm_b) values ('dm', least('${author.id}'::uuid, '${viewer.id}'::uuid), greatest('${author.id}'::uuid, '${viewer.id}'::uuid)) returning id`)
  const msgText = `Rude message ${tag}`
  const msg = id(`insert into messages (chat_id, sender_id, body) values ('${chat}', '${author.id}', '${msgText}') returning id`)
  sql(`insert into reports (reporter, target_type, target_id, reason, snapshot) values ('${viewer.id}', 'message', '${msg}', 'abuse ${tag}', '${msgText}')`)

  await loginPage(page, mod, '/admin/reports')
  await card(page, text).getByRole('button', { name: 'Dismiss' }).click()
  await expect(card(page, text)).toHaveCount(0)
  expect(sql(`select status from reports where target_id = '${post}'`)).toBe('dismissed')
  expect(sql(`select is_hidden from posts where id = '${post}'`)).toBe('f')
  expect(auditCount(`action = 'dismiss_reports' and target_id = '${post}' and actor = '${mod.id}'`)).toBe(1)
  await page.getByRole('tab', { name: 'Dismissed' }).click()
  await expect(card(page, text)).toBeVisible()
  await page.getByRole('tab', { name: 'Open' }).click()

  const c = card(page, msgText)
  await expect(c).toContainText('Chat message')
  page.once('dialog', (d) => d.accept())
  await c.getByRole('button', { name: 'Remove message' }).click()
  await expect(c).toHaveCount(0)
  expect(sql(`select (body is null) || ':' || (deleted_at is not null) from messages where id = '${msg}'`)).toBe('true:true')
  expect(sql(`select status from reports where target_id = '${msg}'`)).toBe('actioned')
  expect(auditCount(`action = 'remove_message' and target_id = '${msg}' and actor = '${mod.id}'`)).toBe(1)
  // the recipient no longer sees the words
  const seen = await viewer.db.from('messages').select('body').eq('id', msg)
  expect(JSON.stringify(seen.data)).not.toContain(msgText)
  // the reported-profile row (no hide button) can only be dismissed
  sql(`insert into reports (reporter, target_type, target_id, reason) values ('${rep1.id}', 'profile', '${plain.id}', 'fake ${tag}')`)
  await page.reload()
  const pc = card(page, `Plain ${tag}`)
  await expect(pc.getByRole('button', { name: 'Hide' })).toHaveCount(0)
  await pc.getByRole('button', { name: 'Dismiss' }).click()
  await expect(pc).toHaveCount(0)
})

test('slow mode: a moderator sets it on any group (even one they are not in), members feel it, and it is audited', async ({ page }) => {
  const g = id(`insert into groups (kind, slug, name, is_approved) values ('circle', 'slow-${tag}', 'Slow ${tag}', true) returning id`)
  sql(`insert into group_members (group_id, user_id) values ('${g}', '${author.id}'), ('${g}', '${viewer.id}')`)
  const chat = id(`select id from chats where group_id = '${g}'`)
  expect(sql(`select count(*) from group_members where group_id = '${g}' and user_id = '${mod.id}'`)).toBe('0')

  await loginPage(page, mod, '/admin/reports')
  await page.getByLabel('Group or channel').selectOption(g)
  await page.getByRole('button', { name: '30 s' }).click()
  await expect(page.getByText('Slow mode: 30 seconds')).toBeVisible()
  expect(sql(`select slow_mode_seconds from groups where id = '${g}'`)).toBe('30')
  expect(auditCount(`action = 'slow_mode' and target_id = '${g}' and actor = '${mod.id}'`)).toBe(1)

  const first = await viewer.db.rpc('send_message', { p_chat: chat, p_body: `one ${tag}` })
  expect(first.error).toBeNull()
  const second = await viewer.db.rpc('send_message', { p_chat: chat, p_body: `two ${tag}` })
  expect(second.error?.message ?? '').toMatch(/slow mode|wait/i)
  expect(sql(`select count(*) from messages where chat_id = '${chat}' and sender_id = '${viewer.id}'`)).toBe('1')

  await page.getByRole('button', { name: 'Off' }).click()
  await expect(page.getByText('Slow mode off')).toBeVisible()
  expect(sql(`select slow_mode_seconds from groups where id = '${g}'`)).toBe('0')
  expect((await viewer.db.rpc('send_message', { p_chat: chat, p_body: `three ${tag}` })).error).toBeNull()
  // a plain member cannot, even directly
  expect((await plain.db.rpc('admin_set_slow_mode', { p_group: g, p_seconds: 600 })).error?.code).toBe('42501')
  expect((await plain.db.from('groups').update({ slow_mode_seconds: 600 }).eq('id', g)).error ?? null).toBeDefined()
  expect(sql(`select slow_mode_seconds from groups where id = '${g}'`)).toBe('0')
})

test('city meetups: a moderator hides one (members lose it and its chat), restores it; the organiser closes; an organiser or admin removes a person for good', async ({ page, browser }) => {
  const city = Number(sql(`select id from geo_cities order by id desc limit 1`))
  const org = await makeUser(`${tag}org`, { name: `Organiser ${tag}` })
  const guest = await makeUser(`${tag}gu`, { name: `Guest ${tag}` })
  const started = await org.db.rpc('start_meetup', { p_city_id: city, p_name: `Meetup ${tag}`, p_when: 'Sat 5pm', p_place: 'Cafe', p_description: 'Catch-up' })
  expect(started.error).toBeNull()
  const g = started.data as string
  const chat = id(`select id from chats where group_id = '${g}'`)
  expect((await guest.db.rpc('join_meetup', { p_group: g })).error).toBeNull()
  expect((await org.db.rpc('send_message', { p_chat: chat, p_body: `Hello from organiser ${tag}` })).error).toBeNull()
  const guestMsg = await guest.db.rpc('send_message', { p_chat: chat, p_body: `Guest says hi ${tag}` })
  expect(guestMsg.error).toBeNull()

  // moderator hides it with a reason from the city page
  await loginPage(page, mod, `/city/${city}`)
  const mc = page.getByTestId('meetup-card').filter({ hasText: `Meetup ${tag}` })
  await expect(mc).toBeVisible()
  page.once('dialog', (d) => d.accept(`Spam ${tag}`))
  await mc.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(mc).toContainText('Hidden')
  expect(sql(`select status || ':' || status_reason from city_meetups where group_id = '${g}'`)).toBe(`hidden:Spam ${tag}`)
  expect(sql(`select is_approved from groups where id = '${g}'`)).toBe('f')
  expect(auditCount(`action = 'meetup_hidden' and target_id = '${g}' and actor = '${mod.id}'`)).toBe(1)
  expect(((await viewer.db.rpc('city_meetups', { p_city_id: city })).data as { group_id: string }[]).some((m) => m.group_id === g)).toBe(false)
  expect(((await guest.db.from('messages').select('id').eq('chat_id', chat)).data ?? []).length, 'members cannot read a hidden meetup chat').toBe(0)
  // the moderator still sees it, with a Restore button
  await mc.getByRole('button', { name: 'Restore' }).click()
  await expect(mc).not.toContainText('Hidden')
  expect(sql(`select status from city_meetups where group_id = '${g}'`)).toBe('active')
  expect(sql(`select is_approved from groups where id = '${g}'`)).toBe('t')
  expect(auditCount(`action = 'meetup_restored' and target_id = '${g}' and actor = '${mod.id}'`)).toBe(1)
  expect(((await viewer.db.rpc('city_meetups', { p_city_id: city })).data as { group_id: string }[]).some((m) => m.group_id === g)).toBe(true)

  // a moderator can close it too (RPC), an unrelated member cannot hide or close
  expect((await plain.db.rpc('admin_set_meetup', { p_group: g, p_status: 'hidden', p_reason: 'x' })).error?.code).toBe('42501')
  expect((await plain.db.rpc('close_meetup', { p_group: g })).error?.code).toBe('42501')
  expect((await mod.db.rpc('admin_set_meetup', { p_group: g, p_status: 'closed', p_reason: 'done' })).error).toBeNull()
  expect(sql(`select status from city_meetups where group_id = '${g}'`)).toBe('closed')
  expect(auditCount(`action = 'meetup_closed' and target_id = '${g}'`)).toBe(1)
  expect((await guest.db.rpc('send_message', { p_chat: chat, p_body: 'after close' })).error, 'a closed meetup is read-only').not.toBeNull()
  expect((await mod.db.rpc('admin_set_meetup', { p_group: g, p_status: 'active', p_reason: null })).error).toBeNull()

  // remove a person: through the chat, as the site admin (right click / long press on their message)
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
  const ap = await ctx.newPage()
  await loginPage(ap, boss, `/chat/${chat}`)
  const bubble = ap.getByText(`Guest says hi ${tag}`).first()
  await expect(bubble).toBeVisible()
  await bubble.dispatchEvent('contextmenu', { button: 2, clientX: 100, clientY: 400, bubbles: true, cancelable: true })
  ap.once('dialog', (d) => d.accept())
  await ap.getByRole('button', { name: 'Remove from meetup' }).click()
  await expect(ap.getByText('Removed from the meetup')).toBeVisible()
  expect(sql(`select count(*) from group_members where group_id = '${g}' and user_id = '${guest.id}'`)).toBe('0')
  expect(sql(`select count(*) from meetup_bans where group_id = '${g}' and user_id = '${guest.id}' and banned_by = '${boss.id}'`)).toBe('1')
  expect(auditCount(`action = 'meetup_member_removed' and target_id = '${g}' and details->>'user' = '${guest.id}'`)).toBe(1)
  // they cannot come back, cannot read the chat, and the organiser cannot be removed
  expect((await guest.db.rpc('join_meetup', { p_group: g })).error).not.toBeNull()
  expect(((await guest.db.from('messages').select('id').eq('chat_id', chat)).data ?? []).length).toBe(0)
  expect((await boss.db.rpc('remove_meetup_member', { p_group: g, p_user: org.id })).error?.message ?? '').toContain('organiser')
  // a moderator is not allowed to remove people (only the organiser or an admin)
  expect((await mod.db.rpc('remove_meetup_member', { p_group: g, p_user: viewer.id })).error?.code).toBe('42501')
  await ctx.close()
})
