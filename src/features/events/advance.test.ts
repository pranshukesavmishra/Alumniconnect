import { describe, expect, it } from 'vitest'
import { e164OrNull } from '../quickprofile/mapping'
import { advanceFromCsv, parseAdvanceAmount, toAdvancePayload } from '../admin/advanceImport'
import { advBranch, advEmail, advMatch, advName, advNameFirstLast, advPhone, amountDue } from './advance'
import vectors from './advanceVectors.json'

// The SAME vectors are checked against the database functions in supabase/tests/99_advance_credits.sql.
describe('advance normalisation mirrors the database', () => {
  it.each(vectors.phone)('phone %j -> %j', (raw, want) => expect(advPhone(raw)).toBe(want))
  it.each(vectors.email)('email %j -> %j', (raw, want) => expect(advEmail(raw)).toBe(want))
  it.each(vectors.name)('name %j -> %j', (raw, want) => expect(advName(raw)).toBe(want))
  it.each(vectors.name_first_last)('first+last %j -> %j', (raw, want) => expect(advNameFirstLast(raw)).toBe(want))
  it.each(vectors.branch)('branch %j -> %j', (raw, want) => expect(advBranch(raw)).toBe(want))

  it('agrees with the app phone parser (src/lib/phone.ts) wherever that one accepts the number', () => {
    for (const [raw, want] of vectors.phone) {
      const app = e164OrNull(raw)
      if (app && want) expect(app).toBe(want)
    }
  })

  it('every app branch has a non-empty key and different branches stay different', () => {
    const keys = ['B.E. in Electronics & Telecommunications', 'B.E. in Computer Science & Engineering', 'B.E. in Mechanical Engineering',
      'B.E. in Information Technology', 'B.E. in Electrical Engineering', 'B.E. in Civil Engineering', 'B.E. Industrial & Production Engineering', 'MCA'].map(advBranch)
    expect(keys.every((k) => k !== '')).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('advMatch', () => {
  const credit = { full_name: 'Dr. Naman K. Pathak', grad_year: 2009, branch: 'Electronics and Telecommunication Engineering', phone: '+919000000099', email: 'naman.p@example.com' }
  const person = { phones: ['+91 90000 00003'], emails: ['other@example.com'], name: 'Naman Kumar Pathak', year: 2009, branch: 'B.E. in Electronics & Telecommunications' }
  it('matches by name + batch + branch (first and last name)', () => expect(advMatch(credit, person)).toBe('name'))
  it('not when the batch differs', () => expect(advMatch(credit, { ...person, year: 2010 })).toBeNull())
  it('not when the branch differs', () => expect(advMatch(credit, { ...person, branch: 'B.E. in Civil Engineering' })).toBeNull())
  it('phone wins', () => expect(advMatch(credit, { ...person, phones: ['09000000099'] })).toBe('phone'))
  it('email with spaces and capitals', () => expect(advMatch(credit, { ...person, year: 1999, emails: [' Naman.P @Example.com'] })).toBe('email'))
})

describe('amountDue', () => {
  it('total less the advance and other payments, never negative', () => {
    expect(amountDue(200000, [{ amount_paise: 50000, status: 'verified' }])).toBe(150000)
    expect(amountDue(200000, [{ amount_paise: 50000, status: 'verified' }, { amount_paise: 150000, status: 'submitted' }])).toBe(0)
    expect(amountDue(200000, [{ amount_paise: 50000, status: 'verified' }, { amount_paise: 150000, status: 'rejected' }])).toBe(150000)
    expect(amountDue(30000, [{ amount_paise: 50000, status: 'verified' }])).toBe(0)
  })
})

describe('advance list import', () => {
  it('reads the organisers sheet columns', () => {
    const csv = [
      'Timestamp,Name,JEC Graduation Year,Branch,Contact Number,Email Id,Advance amount,Note',
      '1/1/2026,Test Person One,2008,B.E. in Electronics & Telecommunications,98765 00001,One@Example.com,,cash to treasurer',
      '1/1/2026,Test Person Two,2009,CSE,,two@example.com,Paid,',
      '1/1/2026,Test Person Three,2010,IT,+91 98765 00003,,Rs. 1000/-,',
      '1/1/2026,Not Paid,2010,IT,+91 98765 00004,,No,',
      '1/1/2026,No Key,,,,,500,',
    ].join('\n')
    const p = advanceFromCsv(csv)
    expect(p.error).toBeNull()
    expect(p.rows.map((r) => [r.full_name, r.grad_year, r.phone, r.email, r.amount_paise, r.problem])).toEqual([
      ['Test Person One', 2008, '+919876500001', 'one@example.com', 50000, ''],
      ['Test Person Two', 2009, null, 'two@example.com', 50000, ''],
      ['Test Person Three', 2010, '+919876500003', null, 100000, ''],
      ['Not Paid', 2010, '+919876500004', null, null, 'no_amount'],
      ['No Key', null, null, null, 50000, 'no_key'],
    ])
    expect(p.rows[0]!.note).toBe('cash to treasurer')
    expect(p.rows[1]!.branch).toBe('B.E. in Computer Science & Engineering')
    expect(toAdvancePayload(p.rows)).toHaveLength(3)
  })
  it('needs a name column', () => expect(advanceFromCsv('Phone,Amount\n9876500001,500').error).toBe('no_name'))
  it('amounts', () => {
    expect(parseAdvanceAmount('')).toBe(50000)
    expect(parseAdvanceAmount('Paid')).toBe(50000)
    expect(parseAdvanceAmount('₹1,000')).toBe(100000)
    expect(parseAdvanceAmount('500', 30000)).toBe(50000)
    expect(parseAdvanceAmount('', 30000)).toBe(30000)
    expect(parseAdvanceAmount('unpaid')).toBeNull()
    expect(parseAdvanceAmount('0')).toBeNull()
  })
})
