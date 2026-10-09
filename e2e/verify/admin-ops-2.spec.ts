// Event admin, end to end (part 2): Responses + CSV exports + custom questions, Messages (approval, rate limit), Waitlist offer expiry,
// QR check-in with a real (fake-camera) scanner, and the volunteer-limited view. Database and screen are both asserted.
import { chromium, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import QRCode from 'qrcode'
import { sql } from '../helpers'
import { auditCount, loginPage, makeEvent, makeUser, register, ts } from './admin-lib'

const phoneCtx = (browser: import('@playwright/test').Browser) => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true })
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
const tag = (s: string) => `${s}${ts}`.slice(0, 14)
const DIR = '/tmp/claude-0/x'
const phone = () => `+91 9${String(Math.floor(Math.random() * 9e4) + 1e4)} ${String(Math.floor(Math.random() * 9e4) + 1e4)}`

test('responses: counts, lists, feedback inbox and the three CSV exports match the registrations; custom questions editor', async ({ browser }) => {
  const t = tag('rs')
  const boss = await makeUser(`${t}b`, { admin: true, name: `Boss ${t}` })
  const mem = await makeUser(`${t}m`, { name: `Member ${t}` })
  const ev = makeEvent(t)
  const a = await register(await makeUser(`${t}a`, { name: `Singer ${t}` }), ev, false)
  const b = await register(await makeUser(`${t}c`, { name: `Quiet ${t}` }), ev, false)
  sql(`update event_registrations set full_name = 'Singer ${t}', phone = '${phone()}', perform_interest = true, perform_types = '{singing,poetry}', perform_group = false,
        perform_description = 'Old ghazals', perform_minutes = 5, song_requests = '{"Tum Hi Ho","Kal Ho Naa Ho"}', feedback = 'Please keep lunch on time ${t}',
        org_team_interest = true, org_teams = '{events}', fund_interest = true, fund_paise = 250000 where id = '${a.reg.id}'`)
  sql(`update event_registrations set full_name = 'Quiet ${t}', needs_accommodation = true where id = '${b.reg.id}'`)

  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, boss, `/admin/events/${ev.slug}?tab=responses`)
  const box = (name: RegExp) => page.getByRole('region', { name })
  await expect(page.getByText('2 registrations.')).toBeVisible()
  await expect(box(/^Performers/)).toContainText('1')
  await expect(box(/^Performers/)).toContainText(`Singer ${t}`)
  await expect(box(/Reunion Fund/)).toContainText('2,500')
  await expect(box(/Volunteers by team/)).toContainText(`Singer ${t}`)
  await expect(box(/Needs help with accommodation/)).toContainText(`Quiet ${t}`)
  await expect(box(/Feedback and suggestions/)).toContainText(`Please keep lunch on time ${t}`)
  await expect(box(/Feedback and suggestions/)).not.toContainText(`Quiet ${t}`)

  const csv = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()])
    const path = `${DIR}/${t}-${Math.random().toString(36).slice(2)}.csv`
    await dl.saveAs(path)
    return { name: dl.suggestedFilename(), text: (await fsp.readFile(path, 'utf8')).replace(/^﻿/, '') }
  }
  const all = await csv('All responses (CSV)')
  expect(all.name).toContain('responses')
  expect(all.text).toContain(`Singer ${t}`)
  expect(all.text).toContain(`Quiet ${t}`)
  expect(all.text.trim().split('\n').length).toBeGreaterThanOrEqual(3) // header + 2 rows
  const perf = await csv('Performers')
  expect(perf.name).toContain('performers')
  expect(perf.text.trim().split('\n')).toHaveLength(2)
  expect(perf.text).toContain('Old ghazals')
  expect(perf.text).not.toContain(`Quiet ${t}`)
  const songs = await csv('DJ song list')
  expect(songs.name).toContain('song-requests')
  expect(songs.text).toContain('Tum Hi Ho')
  expect(songs.text).toContain('Kal Ho Naa Ho')
  expect(songs.text.trim().split('\n')).toHaveLength(3) // header + 2 songs
  // the exports are in the activity log
  expect(auditCount(`actor = '${boss.id}' and details->>'event_id' = '${ev.id}' and action = 'export_event_data'`)).toBeGreaterThanOrEqual(3)

  // ---- custom questions: add (yes/no + a single-choice), edit, switch off, reorder, delete; members see only the active ones
  await page.goto(`/admin/events/${ev.slug}?tab=settings`)
  const questionsOf = async () => (await mem.db.from('event_questions').select('label, is_active').eq('event_id', ev.id).order('sort')).data ?? []
  const q1 = `Will you bring a guest ${t}?`
  const q2 = `Pick a session ${t}`
  await page.getByRole('button', { name: 'Add question' }).click()
  await page.getByLabel('Question', { exact: true }).fill(q1)
  await page.getByRole('button', { name: 'Add question' }).last().click()
  await expect(page.getByText('Question added')).toBeVisible()
  await page.getByRole('button', { name: 'Add question' }).click()
  await page.getByText('Choose one', { exact: true }).click()
  await page.getByLabel('Question', { exact: true }).fill(q2)
  await page.getByLabel('Options').fill('Morning\nMorning') // duplicates are refused with a message
  await page.getByRole('button', { name: 'Add question' }).last().click()
  await expect(page.getByText('Options must be different from each other.')).toBeVisible()
  await page.getByLabel('Options').fill('Morning\nEvening')
  await page.getByText('Members must answer this').click()
  await page.getByRole('button', { name: 'Add question' }).last().click()
  await expect.poll(async () => (await questionsOf()).map((q) => q.label)).toEqual([q1, q2])
  expect(sql(`select kind || ':' || required || ':' || array_to_string(options, ',') from event_questions where event_id = '${ev.id}' and label = '${q2}'`)).toBe('single:true:Morning,Evening')
  // edit
  await page.getByRole('button', { name: `Edit “${q1}”` }).click()
  await page.getByLabel('Question', { exact: true }).fill(`${q1} (edited)`)
  await page.getByRole('button', { name: 'Save question' }).click()
  await expect(page.getByText('Question saved')).toBeVisible()
  expect(sql(`select count(*) from event_questions where event_id = '${ev.id}' and label = '${q1} (edited)'`)).toBe('1')
  // switch off, then on again
  await page.getByRole('button', { name: `Switch off “${q2}”` }).click()
  await expect.poll(() => sql(`select is_active from event_questions where event_id = '${ev.id}' and label = '${q2}'`)).toBe('f')
  await expect(page.getByText('Switched off')).toBeVisible()
  await page.getByRole('button', { name: `Switch on “${q2}”` }).click()
  await expect.poll(() => sql(`select is_active from event_questions where event_id = '${ev.id}' and label = '${q2}'`)).toBe('t')
  // reorder
  await page.getByRole('button', { name: `Move “${q2}” up` }).click()
  await expect.poll(() => sql(`select string_agg(label, '|' order by sort) from event_questions where event_id = '${ev.id}'`)).toBe(`${q2}|${q1} (edited)`)
  // delete
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: `Delete “${q2}”` }).click()
  await expect(page.getByText('Question deleted')).toBeVisible()
  expect(sql(`select count(*) from event_questions where event_id = '${ev.id}'`)).toBe('1')
  expect(auditCount(`actor = '${boss.id}' and target_table = 'event_questions' and details::text like '%${ev.id}%'`)).toBeGreaterThanOrEqual(5)
  // a member cannot change questions
  expect((await mem.db.from('event_questions').delete().eq('event_id', ev.id).select()).data ?? []).toHaveLength(0)
  expect(sql(`select count(*) from event_questions where event_id = '${ev.id}'`)).toBe('1')
  await noSideScroll(page)
  await ctx.close()
})

test('messages: a message to more than 200 people waits for a second admin; the author cannot approve; rejecting sends nothing; 10 per hour limit', async ({ browser }) => {
  const t = tag('ms')
  const a1 = await makeUser(`${t}a`, { admin: true, name: `Admin A ${t}` })
  const a2 = await makeUser(`${t}b`, { admin: true, name: `Admin B ${t}` })
  const ev = makeEvent(t)
  const big = { segment: 'not_registered' } // every verified, eligible member who has not registered: well over 200 on the shared dev database
  const pre = await a1.db.rpc('admin_message_preview', { p_event: ev.id, p_audience: big })
  expect(pre.error).toBeNull()
  test.skip(!pre.data?.needs_approval, 'needs more than 200 members in the database')
  const notifsBefore = Number(sql(`select count(*) from notifications where created_at > now() - interval '1 hour' and body like '%Approval body ${t}%'`))

  const ctx = await phoneCtx(browser)
  const page = await ctx.newPage()
  await loginPage(page, a1, `/admin/events/${ev.slug}?tab=messages`)
  await page.getByLabel('Who should get it?').selectOption('not_registered')
  await expect(page.getByTestId('audience-preview')).toContainText(/This will reach \d+ people/)
  await expect(page.getByText(/More than 200 people/)).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill(`Approval ${t}`)
  await page.getByLabel('Message', { exact: true }).fill(`Approval body ${t}`)
  await expect(page.getByTestId('message-preview')).toContainText(`Approval ${t}`)
  page.once('dialog', (d) => { expect(d.message()).toContain('second admin must approve'); void d.accept() })
  await page.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(page.getByText('Saved. A second admin must approve it before it is sent.')).toBeVisible()
  const id = sql(`select id from event_messages where event_id = '${ev.id}' and title = 'Approval ${t}'`)
  expect(sql(`select status from event_messages where id = '${id}'`)).toBe('pending_approval')
  expect(sql(`select count(*) from notifications where created_at > now() - interval '1 hour' and body like '%Approval body ${t}%'`)).toBe(String(notifsBefore))
  expect(auditCount(`action = 'message_needs_approval' and actor = '${a1.id}' and target_id = '${id}'`)).toBe(1)
  // the author sees it waiting, with no Approve button; the database refuses too
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  expect((await a1.db.rpc('admin_review_event_message', { p_id: id, p_approve: true })).error?.message).toContain('second admin')
  // the second admin rejects it in the UI: it is never sent
  const ctx2 = await phoneCtx(browser)
  const p2 = await ctx2.newPage()
  await loginPage(p2, a2, `/admin/events/${ev.slug}?tab=messages`)
  p2.once('dialog', (d) => void d.accept())
  await p2.getByRole('button', { name: 'Reject' }).click()
  await expect(p2.getByText('Rejected', { exact: true }).first()).toBeVisible()
  expect(sql(`select status from event_messages where id = '${id}'`)).toBe('rejected')
  expect(sql(`select reviewed_by from event_messages where id = '${id}'`)).toBe(a2.id)
  expect(auditCount(`action = 'reject_event_message' and actor = '${a2.id}' and target_id = '${id}'`)).toBe(1)
  expect(sql(`select count(*) from notifications where created_at > now() - interval '1 hour' and body like '%Approval body ${t}%'`)).toBe(String(notifsBefore))
  expect((await a2.db.rpc('admin_review_event_message', { p_id: id, p_approve: true })).error?.message).toContain('already')
  await ctx2.close()

  // rate limit: small audience (nobody has registered for this event except one member), 10 an hour per sender
  const target = await makeUser(`${t}t`, { name: `Target ${t}` })
  await register(target, ev, false)
  for (let i = 1; i <= 10; i++) {
    const r = await a2.db.rpc('admin_send_event_message', { p_event: ev.id, p_kind: 'announcement', p_title: `Note ${i} ${t}`, p_body: `hello ${i} ${t}`, p_audience: { segment: 'registered' }, p_send_at: null })
    expect(r.error?.message ?? 'ok', `message ${i}`).toBe('ok')
  }
  expect(sql(`select count(*) from notifications where user_id = '${target.id}' and body like '%hello % ${t}%'`)).toBe('10')
  const ctx3 = await phoneCtx(browser)
  const p3 = await ctx3.newPage()
  await loginPage(p3, a2, `/admin/events/${ev.slug}?tab=messages`)
  await p3.getByLabel('Title', { exact: true }).fill(`Eleventh ${t}`)
  await p3.getByLabel('Message', { exact: true }).fill('one too many')
  p3.once('dialog', (d) => void d.accept())
  await p3.getByRole('button', { name: /^Send to/ }).click()
  await expect(p3.getByText(/limit/).first()).toBeVisible()
  expect(sql(`select count(*) from event_messages where event_id = '${ev.id}' and title = 'Eleventh ${t}'`)).toBe('0')
  await ctx3.close()
  await ctx.close()
})
