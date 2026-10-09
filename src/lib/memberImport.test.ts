import { describe, expect, it } from 'vitest'
import { IMPORT_TEMPLATE, mapColumns, normaliseBranch, normalisePhone, normaliseType, normaliseYear, parseMemberCsv } from './memberImport'

describe('member CSV import', () => {
  it('recognises columns whatever the spreadsheet calls them', () => {
    const { columns, unknown } = mapColumns(['Name', 'E-mail ID', 'Mobile No.', 'Batch', 'Dept', 'Current City', 'Designation', 'Organisation', 'Roll no'])
    expect(columns).toMatchObject({ full_name: 'Name', email: 'E-mail ID', phone: 'Mobile No.', grad_year: 'Batch', branch: 'Dept', city: 'Current City', current_title: 'Designation', current_company: 'Organisation' })
    expect(unknown).toEqual(['Roll no'])
  })

  it('reads the template', () => {
    const p = parseMemberCsv(IMPORT_TEMPLATE)
    expect(p.error).toBeNull()
    expect(p.rows).toEqual([
      { line: 1, full_name: 'Asha Rao', email: 'asha.rao@example.com', phone: '+91 98765 43210', member_type: 'alumnus', branch: 'Computer Science & Engineering', grad_year: '2005', join_year: '2001', city: 'Pune', current_title: 'Engineering Manager', current_company: 'Acme Ltd' },
    ])
  })

  it('normalises values the way the app stores them', () => {
    const p = parseMemberCsv('﻿Name,Email,Phone,Type,Branch,Batch\n"  Ravi   Kumar ",RAVI@X.COM,(+91) 98765-43210,Alumni,CSE,Batch of 1998\nSita,s@x.com,,Staff,mech,2001-2005\n\n')
    expect(p.rows).toHaveLength(2)
    expect(p.rows[0]).toMatchObject({ full_name: 'Ravi Kumar', email: 'ravi@x.com', phone: '+91 98765 43210', member_type: 'alumnus', branch: 'Computer Science & Engineering', grad_year: '1998' })
    expect(p.rows[1]).toMatchObject({ line: 2, member_type: 'faculty', branch: 'Mechanical Engineering', grad_year: '2005' })
  })

  it('leaves unknown values for the server to flag', () => {
    expect(normaliseType('guest')).toBe('guest')
    expect(normaliseYear('05')).toBe('05')
    expect(normaliseBranch('Aeronautics')).toBe('Aeronautics')
    expect(normaliseBranch('information technology')).toBe('Information Technology')
    expect(normalisePhone("'9876543210")).toBe('9876543210')
  })

  it('refuses files it cannot use', () => {
    expect(parseMemberCsv('').error).toMatch(/no rows/)
    expect(parseMemberCsv('Name,City\nAsha,Pune').error).toMatch(/Email/)
    const many = 'Name,Email\n' + Array.from({ length: 2001 }, (_, i) => `P${i},p${i}@x.com`).join('\n')
    expect(parseMemberCsv(many).error).toMatch(/2000/)
  })
})
