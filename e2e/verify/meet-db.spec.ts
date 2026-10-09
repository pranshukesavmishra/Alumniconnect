// Alumni Meet: server-side rules, run as real members / staff against the local Supabase database.
// Each test builds its own isolated event (never touches the seeded alumni-meet-2026 event).
import { expect, test } from '@playwright/test'
import { as, createEvent, createMember, errAs, newUtr, q, regRow, register, sql, stamp, tryAs, type TestEvent } from './meet-lib'

const S = stamp()
const mail = (x: string) => `meet-${S}-${x}@test.local`

function submitUtr(uid: string, regId: string, utr: string) {
  return as(uid, `select row_to_json(p) from submit_upi_payment('${regId}', ${q(utr)}, 'Payer', null) p`).split('\n').pop()!
}
function payment(regId: string) {
  return sql(`select id || '|' || amount_paise || '|' || status || '|' || coalesce(utr,'') from event_payments where registration_id = '${regId}' order by created_at desc limit 1`).split('|')
}
function review(uid: string, paymentId: string, approve: boolean, note: string | null = null) {
  return tryAs(uid, `select status from review_payment('${paymentId}', ${approve}, ${q(note)})`)
}
function makeManager(ev: TestEvent, tag: string) {
  const id = createMember({ email: mail(tag), name: `Manager ${tag}` })
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${id}', 'manager')`)
  return id
}
function makeVolunteer(ev: TestEvent, tag: string) {
  const id = createMember({ email: mail(tag), name: `Volunteer ${tag}` })
  sql(`insert into event_staff (event_id, user_id, role) values ('${ev.id}', '${id}', 'checkin')`)
  return id
}

test.describe('registration rules', () => {
  test('server prices tickets in paise and counts heads (spouse, kids, infant)', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('price'), name: 'Price Check' })
    const r = register(u, ev, [[ev.primary, 1], [ev.spouse, 1], [ev.child, 2], [ev.infant, 1]], {
      guests: [
        { name: 'Spouse A', relation: 'Spouse', ticket_type_id: ev.spouse },
        { name: 'Kid 1', relation: 'Child (5–12)', ticket_type_id: ev.child },
        { name: 'Kid 2', relation: 'Child (5–12)', ticket_type_id: ev.child },
        { name: 'Baby', relation: 'Child (under 5)', ticket_type_id: ev.infant },
      ],
      food_pref: 'jain',
      tshirt_size: 'XXL',
    })
    expect(r.amount_paise).toBe(250050 + 150000 + 2 * 50000 + 0)
    expect(r.headcount).toBe(5)
    expect(r.status).toBe('pending_payment')
    expect(r.code).toMatch(/^JEC-[2-9A-HJKMNP-Z]{6}$/)
    expect(sql(`select string_agg(label || ':' || unit_price_paise || 'x' || quantity, ',' order by label) from event_registration_items where registration_id = '${r.id}'`)).toBe(
      'Alumnus:250050x1,Child (5–12):50000x2,Child (under 5):0x1,Spouse:150000x1',
    )
    expect(sql(`select food_pref || tshirt_size || jsonb_array_length(guests) from event_registrations where id = '${r.id}'`)).toBe('jainXXL4')
  })

  test('rejects invalid ticket selections, missing terms, bad phone, bad sizes, anonymous callers', () => {
    const ev = createEvent()
    const other = createEvent()
    const u = createMember({ email: mail('invalid'), name: 'Invalid Picks' })
    const call = (list: [string, number][], extra: Record<string, unknown> = {}) =>
      errAs(u, `select upsert_registration('${ev.id}', ${q(JSON.stringify({ full_name: 'X', phone: '+91 98765 43210', accept_terms: true, ...extra }))}::jsonb, ${q(JSON.stringify(list.map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity }))))}::jsonb)`)
    expect(call([[ev.child, 1]])).toContain('Choose exactly one main (alumnus) ticket')
    expect(call([[ev.primary, 2]])).toContain('at most 1')
    expect(call([[ev.primary, 1], [ev.child, 5]])).toContain('at most 4')
    expect(call([[ev.primary, 1], [ev.child, -1]])).toMatch(/at most|not valid/)
    expect(call([[ev.primary, 1], [other.spouse, 1]])).toContain('Unknown ticket type')
    expect(call([[ev.primary, 1], [ev.primary, 1]])).toContain('Ticket selection is not valid')
    expect(call([[ev.primary, 1]], { accept_terms: false })).toContain('Please accept the terms')
    expect(call([[ev.primary, 1]], { phone: '12345' })).toContain('valid mobile number')
    expect(call([[ev.primary, 1]], { tshirt_size: 'XXXXL' })).toMatch(/check constraint|tshirt/)
    expect(call([[ev.primary, 1]], { food_pref: 'vegan' })).toMatch(/check constraint|food/)
    expect(call([[ev.primary, 1]], { full_name: '  ' })).toContain('full name')
    // not signed in: the function is not even executable
    expect(errAs(null, `select upsert_registration('${ev.id}', '{}'::jsonb, '[]'::jsonb)`)).toContain('permission denied')
    // nothing was written
    expect(sql(`select count(*) from event_registrations where user_id = '${u}'`)).toBe('0')
  })

  test('unpublished or closed events refuse new registrations; a paid member can still update preferences after close', () => {
    const draft = createEvent({ published: false })
    const u = createMember({ email: mail('closed'), name: 'Closed Event' })
    expect(errAs(u, `select upsert_registration('${draft.id}', ${q(JSON.stringify({ full_name: 'X', phone: '+91 98765 43210', accept_terms: true }))}::jsonb, ${q(JSON.stringify([{ ticket_type_id: draft.primary, quantity: 1 }]))}::jsonb)`)).toContain('not open for registration')

    const ev = createEvent()
    const r = register(u, ev, [[ev.primary, 1]])
    submitUtr(u, r.id, newUtr())
    sql(`update events set registration_closes_at = now() - interval '1 minute' where id = '${ev.id}'`)
    const again = register(u, ev, [[ev.primary, 1]], { food_pref: 'non_veg', tshirt_size: 'S' })
    expect(again.status).toBe('under_review')
    expect(sql(`select food_pref || tshirt_size from event_registrations where id = '${r.id}'`)).toBe('non_vegS')
    // ...but cannot add people after paying
    expect(errAs(u, `select upsert_registration('${ev.id}', ${q(JSON.stringify({ full_name: 'X', phone: '+91 98765 43210', accept_terms: true }))}::jsonb, ${q(JSON.stringify([{ ticket_type_id: ev.primary, quantity: 1 }, { ticket_type_id: ev.spouse, quantity: 1 }]))}::jsonb)`)).toContain('tickets can no longer be changed')

    const late = createMember({ email: mail('late'), name: 'Late Comer' })
    expect(errAs(late, `select upsert_registration('${ev.id}', ${q(JSON.stringify({ full_name: 'X', phone: '+91 98765 43210', accept_terms: true }))}::jsonb, ${q(JSON.stringify([{ ticket_type_id: ev.primary, quantity: 1 }]))}::jsonb)`)).toContain('has closed')
  })

  test('edit before payment re-prices; name is frozen once paid', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('edit'), name: 'Editor' })
    const r1 = register(u, ev, [[ev.primary, 1], [ev.spouse, 1]], { full_name: 'Name One' })
    expect(r1.amount_paise).toBe(400050)
    const r2 = register(u, ev, [[ev.primary, 1], [ev.child, 3]], { full_name: 'Name Two', photo_consent: false })
    expect(r2.id).toBe(r1.id)
    expect(r2.code).toBe(r1.code)
    expect(r2.amount_paise).toBe(250050 + 150000)
    expect(r2.headcount).toBe(4)
    expect(r2.photo_consent).toBe(false)
    expect(sql(`select count(*) from event_registration_items where registration_id = '${r1.id}'`)).toBe('2')
    submitUtr(u, r1.id, newUtr())
    register(u, ev, [[ev.primary, 1], [ev.child, 3]], { full_name: 'Someone Else' })
    expect(sql(`select full_name from event_registrations where id = '${r1.id}'`)).toBe('Name Two')
  })

  test('cancel and re-register keeps the same code and starts a fresh unpaid registration', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('cancel'), name: 'Canceller' })
    const r = register(u, ev, [[ev.primary, 1], [ev.spouse, 1]])
    as(u, `select cancel_my_registration('${r.id}')`)
    expect(regRow(r.id).status).toBe('cancelled')
    expect(errAs(u, `select cancel_my_registration('${r.id}')`)).toContain('Only unpaid registrations')
    const again = register(u, ev, [[ev.primary, 1]])
    expect(again.id).toBe(r.id)
    expect(again.code).toBe(r.code)
    expect(again.status).toBe('pending_payment')
    expect(again.amount_paise).toBe(250050)
    // once a payment is submitted, the member can no longer cancel by themselves
    submitUtr(u, r.id, newUtr())
    expect(errAs(u, `select cancel_my_registration('${r.id}')`)).toContain('Only unpaid registrations')
    // another member cannot cancel my registration
    const intruder = createMember({ email: mail('intruder'), name: 'Intruder' })
    expect(errAs(intruder, `select cancel_my_registration('${r.id}')`)).toContain('Only unpaid registrations')
  })

  test('capacity: unpaid registrations do not hold places; paying when full is refused', () => {
    const ev = createEvent({ capacity: 3 })
    const a = createMember({ email: mail('capa'), name: 'Cap A' })
    const b = createMember({ email: mail('capb'), name: 'Cap B' })
    const c = createMember({ email: mail('capc'), name: 'Cap C' })
    const ra = register(a, ev, [[ev.primary, 1], [ev.spouse, 1]])
    const rb = register(b, ev, [[ev.primary, 1], [ev.spouse, 1]])
    submitUtr(a, ra.id, newUtr()) // 2 of 3 taken
    expect(errAs(b, `select submit_upi_payment('${rb.id}', '${newUtr()}', null, null)`)).toContain('event is full')
    expect(regRow(rb.id).status).toBe('pending_payment')
    const rb2 = register(b, ev, [[ev.primary, 1]]) // reduce to 1 person: fits exactly
    submitUtr(b, rb2.id, newUtr())
    expect(errAs(c, `select upsert_registration('${ev.id}', ${q(JSON.stringify({ full_name: 'C', phone: '+91 98765 43210', accept_terms: true }))}::jsonb, ${q(JSON.stringify([{ ticket_type_id: ev.primary, quantity: 1 }]))}::jsonb)`)).toContain('event is full')
    // a rejected payment frees the places again
    const mgr = makeManager(ev, 'capmgr')
    const [pid] = payment(ra.id)
    expect(review(mgr, pid!, false, 'Not in statement').ok).toBe(true)
    expect(regRow(ra.id).status).toBe('pending_payment')
    register(c, ev, [[ev.primary, 1]])
    // offline payments respect capacity too
    const rc = sql(`select id from event_registrations where event_id = '${ev.id}' and user_id = '${c}'`)
    as(mgr, `select status from record_offline_payment('${rc}', 'cash', 250050, 'desk')`)
    expect(regRow(rc).status).toBe('confirmed')
    expect(sql(`select coalesce(sum(headcount),0) from event_registrations where event_id = '${ev.id}' and status in ('under_review','confirmed')`)).toBe('2')
  })

  // BUG: guests are free-form JSON and are never checked against the tickets bought, so a member can
  // (via the public RPC) list 15 guests on a 1-person ticket. They then appear on the attendee/badge
  // export and on the gate screen ("With: …") although only 1 person was paid for.
  test('guest list must match the ticket quantities', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('guests'), name: 'Guest Smuggler' })
    const guests = Array.from({ length: 10 }, (_, i) => ({ name: `Extra ${i}`, relation: 'Spouse' }))
    const r = tryAs(u, `select upsert_registration('${ev.id}', ${q(JSON.stringify({ full_name: 'G', phone: '+91 98765 43210', accept_terms: true, guests }))}::jsonb, ${q(JSON.stringify([{ ticket_type_id: ev.primary, quantity: 1 }]))}::jsonb)`)
    expect(r.ok, 'server accepted 10 guests on a single alumnus ticket').toBe(false)
  })
})

test.describe('payments', () => {
  test('UTR validation, normalisation, amount = due, duplicate and reuse blocking', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('utr'), name: 'Utr Member' })
    const v = createMember({ email: mail('utr2'), name: 'Utr Other' })
    const r = register(u, ev, [[ev.primary, 1]])
    const rv = register(v, ev, [[ev.primary, 1]])
    for (const bad of ['', '12345678901', '1234567890123', '12345678901a', 'UTR123456789', '1234-5678-9012']) {
      expect(errAs(u, `select submit_upi_payment('${r.id}', ${q(bad)}, null, null)`)).toContain('must be 12 digits')
    }
    const utr = newUtr()
    const spaced = `${utr.slice(0, 4)} ${utr.slice(4, 8)} ${utr.slice(8)}`
    const p = JSON.parse(submitUtr(u, r.id, spaced)) as { utr: string; amount_paise: number; status: string; method: string }
    expect(p).toMatchObject({ utr, amount_paise: 250050, status: 'submitted', method: 'upi' })
    expect(regRow(r.id).status).toBe('under_review')
    expect(errAs(u, `select submit_upi_payment('${r.id}', '${newUtr()}', null, null)`)).toContain('already submitted')
    expect(errAs(v, `select submit_upi_payment('${rv.id}', '${utr}', null, null)`)).toContain('already been used')
    // someone else's registration
    expect(errAs(v, `select submit_upi_payment('${r.id}', '${newUtr()}', null, null)`)).toContain('Registration not found')
    // proof path must be inside my own folder
    expect(errAs(v, `select submit_upi_payment('${rv.id}', '${newUtr()}', null, '${u}/x.jpg')`)).toContain('Invalid screenshot')

    // after a rejection: the same member may resubmit that UTR, nobody else may
    const mgr = makeManager(ev, 'utrmgr')
    const [pid] = payment(r.id)
    expect(review(mgr, pid!, false, '').err).toContain('give a reason')
    expect(review(mgr, pid!, false, 'UTR not in statement').ok).toBe(true)
    expect(regRow(r.id)).toMatchObject({ status: 'pending_payment', admin_note: 'UTR not in statement' })
    expect(errAs(v, `select submit_upi_payment('${rv.id}', '${utr}', null, null)`)).toContain('already been used')
    submitUtr(u, r.id, utr)
    expect(regRow(r.id).status).toBe('under_review')
  })

  test('only managers review; approve confirms and verifies the member; double review blocked', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('rev'), name: 'Review Me' })
    const mgr = makeManager(ev, 'revmgr')
    const vol = makeVolunteer(ev, 'revvol')
    const stranger = createMember({ email: mail('revstr'), name: 'Stranger' })
    const otherMgr = makeManager(createEvent(), 'revothermgr') // manager of a different event
    const r = register(u, ev, [[ev.primary, 1], [ev.spouse, 1]])
    submitUtr(u, r.id, newUtr())
    const [pid] = payment(r.id)
    expect(sql(`select verification from profiles where id = '${u}'`)).toBe('pending')
    for (const who of [u, vol, stranger, otherMgr]) expect(review(who, pid!, true).err).toContain('Only event managers')
    expect(review(mgr, pid!, true).ok).toBe(true)
    expect(regRow(r.id).status).toBe('confirmed')
    expect(sql(`select status || '|' || (reviewed_by = '${mgr}') from event_payments where id = '${pid}'`)).toBe('verified|true')
    expect(sql(`select verification from profiles where id = '${u}'`)).toBe('verified')
    expect(review(mgr, pid!, false, 'oops').err).toContain('already been reviewed')
    // the audit log has the verification
    expect(sql(`select count(*) from admin_audit where action = 'verify_payment' and target_id = '${r.id}'`)).toBe('1')
    // members only ever see their own payments; volunteers see none
    expect(as(stranger, `select count(*) from event_payments where registration_id = '${r.id}'`).split('\n').pop()).toBe('0')
    expect(as(vol, `select count(*) from event_payments where registration_id = '${r.id}'`).split('\n').pop()).toBe('0')
    expect(as(u, `select count(*) from event_payments where registration_id = '${r.id}'`).split('\n').pop()).toBe('1')
  })

  test('cash / bank / waiver at the desk, partial amounts, limits', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('cash'), name: 'Cash Payer' })
    const mgr = makeManager(ev, 'cashmgr')
    const vol = makeVolunteer(ev, 'cashvol')
    const r = register(u, ev, [[ev.primary, 1], [ev.spouse, 1]]) // 4000.50
    expect(errAs(vol, `select record_offline_payment('${r.id}', 'cash', 1000, null)`)).toContain('Only event managers')
    expect(errAs(mgr, `select record_offline_payment('${r.id}', 'cheque', 1000, null)`)).toContain('must be cash')
    expect(errAs(mgr, `select record_offline_payment('${r.id}', 'cash', 400051, null)`)).toContain('Amount must be between')
    expect(errAs(mgr, `select record_offline_payment('${r.id}', 'cash', 0, null)`)).toContain('Amount must be between')
    as(mgr, `select record_offline_payment('${r.id}', 'cash', 100000, 'part at desk')`)
    expect(regRow(r.id).status).toBe('pending_payment')
    // the member now owes exactly the balance by UPI
    const p = JSON.parse(submitUtr(u, r.id, newUtr())) as { amount_paise: number }
    expect(p.amount_paise).toBe(300050)
    // treasurer rejects it, then waives the rest
    const [pid] = payment(r.id)
    review(mgr, pid!, false, 'not received')
    expect(errAs(mgr, `select record_offline_payment('${r.id}', 'waiver', null, '  ')`)).toContain('who approved the waiver')
    as(mgr, `select record_offline_payment('${r.id}', 'waiver', null, 'Approved by president')`)
    expect(regRow(r.id).status).toBe('confirmed')
    expect(sql(`select string_agg(method || ':' || amount_paise || ':' || status, ',' order by created_at) from event_payments where registration_id = '${r.id}'`)).toBe(
      'cash:100000:verified,upi:300050:rejected,waiver:300050:verified',
    )
    expect(errAs(mgr, `select record_offline_payment('${r.id}', 'cash', 100, null)`)).toContain('Nothing is due')
  })

  test('fee change after payment: extra ticket -> balance due -> paid -> confirmed', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('fee'), name: 'Fee Change' })
    const mgr = makeManager(ev, 'feemgr')
    const r = register(u, ev, [[ev.primary, 1]])
    submitUtr(u, r.id, newUtr())
    review(mgr, payment(r.id)[0]!, true)
    expect(regRow(r.id).status).toBe('confirmed')
    expect(errAs(mgr, `select admin_update_registration('${r.id}', null, ${q(JSON.stringify([{ ticket_type_id: ev.primary, quantity: 1 }, { ticket_type_id: ev.spouse, quantity: 1 }]))}::jsonb, '  ')`)).toContain('reason')
    as(mgr, `select admin_update_registration('${r.id}', null, ${q(JSON.stringify([{ ticket_type_id: ev.primary, quantity: 1 }, { ticket_type_id: ev.spouse, quantity: 1 }]))}::jsonb, 'spouse also coming')`)
    expect(regRow(r.id)).toMatchObject({ status: 'pending_payment', amount_paise: 400050, headcount: 2 })
    const p = JSON.parse(submitUtr(u, r.id, newUtr())) as { amount_paise: number }
    expect(p.amount_paise).toBe(150000)
    review(mgr, payment(r.id)[0]!, true)
    expect(regRow(r.id).status).toBe('confirmed')
    // a ticket-price change by the admin does not alter existing registrations
    sql(`update event_ticket_types set price_paise = 300000 where id = '${ev.primary}'`)
    expect(regRow(r.id).amount_paise).toBe(400050)
  })

  // BUG: when an organiser cancels a PAID registration (e.g. refunded outside the app), the verified payment
  // still counts. If the member then registers again, upsert_registration puts it back to "pending_payment",
  // but submit_upi_payment says "Payment already submitted, please wait for verification" and the desk says
  // "Nothing is due" – the member is stuck, and the refunded money is still reported as collected.
  test('re-registering after an organiser cancelled a paid registration leaves a consistent state', () => {
    const ev = createEvent()
    const u = createMember({ email: mail('refund'), name: 'Refunded' })
    const mgr = makeManager(ev, 'refundmgr')
    const r = register(u, ev, [[ev.primary, 1]])
    submitUtr(u, r.id, newUtr())
    review(mgr, payment(r.id)[0]!, true)
    as(mgr, `select admin_set_registration_status('${r.id}', true, 'Refunded by bank transfer')`)
    const again = register(u, ev, [[ev.primary, 1]])
    // Either it is still paid (confirmed) or the member can pay again – never "pending" with no way to pay.
    const pay = tryAs(u, `select submit_upi_payment('${r.id}', '${newUtr()}', null, null)`)
    expect(again.status === 'confirmed' || pay.ok, `status=${again.status}; pay error=${pay.err.split('\n')[0]}`).toBe(true)
  })
})

test.describe('check-in', () => {
  test('volunteer checks in confirmed tickets once; unpaid/cancelled/other-event codes are refused', () => {
    const ev = createEvent()
    const ev2 = createEvent()
    const mgr = makeManager(ev, 'cimgr')
    const vol = makeVolunteer(ev, 'civol')
    const member = createMember({ email: mail('cimember'), name: 'Not Staff' })
    const paid = createMember({ email: mail('cipaid'), name: 'Paid Guest' })
    const unpaid = createMember({ email: mail('ciunpaid'), name: 'Unpaid Guest' })
    const rp = register(paid, ev, [[ev.primary, 1], [ev.spouse, 1]])
    submitUtr(paid, rp.id, newUtr())
    review(mgr, payment(rp.id)[0]!, true)
    const ru = register(unpaid, ev, [[ev.primary, 1]])
    const ci = (who: string, code: string, undo = false) =>
      tryAs(who, `select (registration).status || '|' || already_checked_in || '|' || coalesce((registration).checked_in_at::text, '-') from check_in('${ev.id}', ${q(code)}, ${undo})`)

    expect(ci(member, rp.code).err).toContain('Only event volunteers')
    expect(ci(vol, 'JEC-ZZZZZZ').err).toContain('No ticket found')
    const first = ci(vol, `  ${rp.code.toLowerCase()} `)
    expect(first.ok).toBe(true)
    expect(first.out.split('\n').pop()).toMatch(/^confirmed\|false\|20/)
    expect(sql(`select checked_in_by from event_registrations where id = '${rp.id}'`)).toBe(vol)
    expect(ci(vol, rp.code).out.split('\n').pop()).toMatch(/^confirmed\|true\|20/)
    expect(ci(vol, ru.code).out.split('\n').pop()).toBe('pending_payment|false|-')
    expect(regRow(ru.id).checked_in_at).toBeNull()
    // a ticket of another event is not valid here
    const other = createMember({ email: mail('ciother'), name: 'Other Event' })
    const ro = register(other, ev2, [[ev2.primary, 1]])
    expect(ci(vol, ro.code).err).toContain('No ticket found')
    // cancelled registrations are never admitted
    as(mgr, `select admin_set_registration_status('${ru.id}', true, 'duplicate')`)
    expect(ci(vol, ru.code).out.split('\n').pop()).toBe('cancelled|false|-')
  })

  test('volunteers cannot see tickets bought, payments or contact details (they get the safe attendee list)', () => {
    const ev = createEvent()
    const vol = makeVolunteer(ev, 'privvol')
    const u = createMember({ email: mail('priv'), name: 'Private Person' })
    const r = register(u, ev, [[ev.primary, 1]])
    submitUtr(u, r.id, newUtr())
    expect(as(vol, `select count(*) from event_registration_items where registration_id = '${r.id}'`).split('\n').pop()).toBe('0')
    expect(as(vol, `select count(*) from event_payments where registration_id = '${r.id}'`).split('\n').pop()).toBe('0')
    // the registrations table itself is closed to them; the attendee list leaves out phone/email/notes/amount
    expect(as(vol, `select count(*) from event_registrations where id = '${r.id}'`).split('\n').pop()).toBe('0')
    expect(as(vol, `select count(*) from event_attendees('${ev.id}') where id = '${r.id}'`).split('\n').pop()).toBe('1')
    expect(as(vol, `select count(*) from event_attendees('${ev.id}') where id = '${r.id}' and phone = '' and email is null and amount_paise = 0`).split('\n').pop()).toBe('1')
    // a volunteer cannot verify payments or record cash
    expect(review(vol, payment(r.id)[0]!, true).err).toContain('Only event managers')
  })
})

test.describe('public stats', () => {
  test('event_public_stats counts confirmed registrations only, by batch, without names (anon allowed)', () => {
    const ev = createEvent()
    const mgr = makeManager(ev, 'statmgr')
    const mk = (tag: string, year: number, heads: [string, number][], pay: 'none' | 'submitted' | 'verified') => {
      const u = createMember({ email: mail(tag), name: tag, year })
      const r = register(u, ev, heads, { grad_year: String(year) })
      if (pay !== 'none') submitUtr(u, r.id, newUtr())
      if (pay === 'verified') review(mgr, payment(r.id)[0]!, true)
      return r
    }
    mk('st1', 2003, [[ev.primary, 1], [ev.spouse, 1]], 'verified')
    mk('st2', 2003, [[ev.primary, 1]], 'verified')
    mk('st3', 2007, [[ev.primary, 1], [ev.child, 2]], 'verified')
    mk('st4', 2007, [[ev.primary, 1]], 'submitted')
    mk('st5', 2009, [[ev.primary, 1]], 'none')
    const stats = JSON.parse(as(null, `select event_public_stats('${ev.id}')`).split('\n').pop()!)
    expect(stats).toEqual({ registered: 3, people: 6, by_year: [{ year: 2003, count: 2 }, { year: 2007, count: 1 }] })
    // unpublished event exposes nothing
    sql(`update events set is_published = false where id = '${ev.id}'`)
    expect(JSON.parse(as(null, `select event_public_stats('${ev.id}')`).split('\n').pop()!)).toEqual({ registered: 0, people: 0, by_year: [] })
  })
})
