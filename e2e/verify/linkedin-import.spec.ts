// End-to-end verification of "Import from LinkedIn" (Profile PDF + data-export ZIP) against the real local stack:
// browser UI -> client parser -> save_my_linkedin_import RPC -> Postgres rows.
//
//   PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --config e2e/verify/playwright.linkedin.config.ts
//
// Fixtures in ./linkedin-fixtures are SYNTHETIC look-alikes (fake people) built by make_fixtures.py.
// Set LINKEDIN_SAMPLES=/dir/with/real/pdfs to also round-trip real LinkedIn exports (never committed: real people).
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { onboard, signInWithEmail, sql } from '../helpers'
import { itemsToLines, parseLinkedInPdfLines } from '../../src/lib/linkedin/profilePdf'

const FX = join(import.meta.dirname, 'linkedin-fixtures')
const run = Date.now().toString(36)
const shots = 'test-results/linkedin/screens'

/**
 * KNOWN BUG (critical): pdfjs-dist 6.x "modern" build calls Map.prototype.getOrInsertComputed, which browsers only
 * shipped very recently (missing in Chromium 141 and older Safari/Android WebViews), so the PDF reader dies with
 * "this[#methodPromises].getOrInsertComputed is not a function". The legacy build includes the polyfill.
 * Tests that exercise the rest of the flow install the same polyfill so they can verify everything behind it;
 * the 'without polyfill' test below documents the bug and is marked test.fail until profilePdf.ts uses the legacy build.
 */
async function polyfillUpsert(page: Page) {
  await page.addInitScript(() => {
    for (const C of [Map, WeakMap] as unknown as {
      prototype: Record<string, unknown>
    }[]) {
      if (!C.prototype.getOrInsertComputed) {
        Object.defineProperty(C.prototype, 'getOrInsertComputed', {
          configurable: true,
          writable: true,
          value(this: Map<unknown, unknown>, key: unknown, fn: (k: unknown) => unknown) {
            if (!this.has(key)) this.set(key, fn(key))
            return this.get(key)
          },
        })
      }
      if (!C.prototype.getOrInsert) {
        Object.defineProperty(C.prototype, 'getOrInsert', {
          configurable: true,
          writable: true,
          value(this: Map<unknown, unknown>, key: unknown, v: unknown) {
            if (!this.has(key)) this.set(key, v)
            return this.get(key)
          },
        })
      }
    }
  })
}

async function newMember(page: Page, tag: string) {
  const email = `li-${tag}-${run}@test.local`
  await page.goto('/signin')
  await signInWithEmail(page, email)
  await onboard(page, `LI ${tag} ${run}`, '2012')
  await expect(page).not.toHaveURL(/welcome/)
  const uid = sql(`select id from auth.users where email = '${email}'`)
  expect(uid).toMatch(/^[0-9a-f-]{36}$/)
  return uid
}

async function pick(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.locator('input[type=file]').setInputFiles(file)
}

const rows = (query: string) => JSON.parse(sql(`select coalesce(json_agg(t), '[]') from (${query}) t`)) as Record<string, unknown>[]
const exps = (uid: string, source = 'linkedin') =>
  rows(
    `select title, company, location, start_date::text, end_date::text, is_current, description from experiences where profile_id = '${uid}' and source = '${source}' order by title, company, start_date`,
  )
const edus = (uid: string) =>
  rows(
    `select school, degree, field, start_year, end_year from educations where profile_id = '${uid}' and source = 'linkedin' order by school, degree nulls last`,
  )
const prof = (uid: string) =>
  rows(`select headline, city, about, skills, linkedin_url, current_title, current_company from profiles where id = '${uid}'`)[0]!

async function saveImport(page: Page, overwrite = false) {
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
  if (overwrite) await page.getByRole('checkbox', { name: /Replace my existing headline/ }).check()
  await page.getByRole('button', { name: 'Save to my profile' }).click()
  await expect(page.getByText('Profile updated from LinkedIn')).toBeVisible()
  await expect(page).toHaveURL(/\/me$/)
}

test('PDF import works in a browser without Map.prototype.getOrInsertComputed (e.g. Chromium 141)', async ({ page }) => {
  await newMember(page, 'nopoly')
  await page.goto('/me/import')
  await pick(page, join(FX, 'linkedin-jec-v1.pdf'))
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
})

test.describe('with Map.prototype.getOrInsertComputed polyfilled', () => {
  test.beforeEach(async ({ page }) => polyfillUpsert(page))

  test('PDF: import, review, save, re-import without duplicates, keep manual entries, overwrite basics', async ({ page }) => {
    const uid = await newMember(page, 'pdf')

    // a manual experience added through the normal editor must survive every import
    await page.goto('/me/edit')
    await page
      .locator('section')
      .filter({ has: page.getByText('Experience', { exact: true }) })
      .getByRole('button', { name: 'Add', exact: true })
      .click()
    await page.getByRole('textbox', { name: 'Role', exact: true }).fill('Alumni Mentor')
    await page.getByRole('textbox', { name: 'Company', exact: true }).fill('JEC Alumni Cell')
    await page.getByRole('button', { name: 'Add experience' }).click()
    await expect(page.getByText('JEC Alumni Cell · Current')).toBeVisible()
    expect(exps(uid, 'manual')).toHaveLength(1)

    // 1st import (Hindi company name, multi-role company, "Present", education without dates)
    await page.goto('/me/import')
    await expect(page.getByRole('heading', { name: 'Import from LinkedIn' })).toBeVisible()
    await pick(page, join(FX, 'linkedin-jec-v1.pdf'))
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
    await expect(page.getByText('Experience (3 of 3)')).toBeVisible()
    await expect(page.getByText('Tata Motors · 2022–Present')).toBeVisible()
    await expect(page.getByText('भारतीय रेल (Indian Railways) · 2011–2011')).toBeVisible()
    await expect(page.getByText('Bachelor of Engineering - BE, Computer Science · 2008–2012')).toBeVisible()
    await expect(page.getByText('Kendriya Vidyalaya No. 1, Jabalpur')).toBeVisible()
    await page.screenshot({ path: `${shots}/pdf-review.png`, fullPage: true })
    await saveImport(page)

    const v1Exps = [
      {
        title: 'Engineer',
        company: 'Tata Motors',
        location: null,
        start_date: '2018-09-01',
        end_date: '2022-02-01',
        is_current: false,
        description: 'Worked on body control modules.',
      },
      {
        title: 'Senior Engineer',
        company: 'Tata Motors',
        location: 'Pune, Maharashtra, India',
        start_date: '2022-03-01',
        end_date: null,
        is_current: true,
        description: 'Leading the powertrain software team.\n- Shipped 3 vehicle programmes',
      },
      {
        title: 'Summer Intern',
        company: 'भारतीय रेल (Indian Railways)',
        location: 'Jabalpur',
        start_date: '2011-05-01',
        end_date: '2011-07-01',
        is_current: false,
        description: null,
      },
    ]
    const v1Edus = [
      {
        school: 'Jabalpur Engineering College',
        degree: 'Bachelor of Engineering - BE',
        field: 'Computer Science',
        start_year: 2008,
        end_year: 2012,
      },
      {
        school: 'Kendriya Vidyalaya No. 1, Jabalpur',
        degree: null,
        field: null,
        start_year: null,
        end_year: null,
      },
    ]
    expect(exps(uid)).toEqual(v1Exps)
    expect(edus(uid)).toEqual(v1Edus)
    expect(prof(uid)).toEqual({
      headline: 'Senior Engineer at Tata Motors | JEC CSE 2012',
      city: 'Pune', // set during onboarding; only empty fields are filled unless "Replace" is ticked
      about:
        'Automotive engineer from Jabalpur Engineering College. I build vehicle software and mentor juniors.\n\nHappy to help JECians with referrals.',
      skills: ['Automotive Engineering', 'Python (Programming Language)', 'CATIA'],
      linkedin_url: 'https://www.linkedin.com/in/rahul-sharma-jec',
      current_title: 'Senior Engineer',
      current_company: 'Tata Motors',
    })
    expect(exps(uid, 'manual')).toHaveLength(1)
    await expect(page.getByText('Senior Engineer').first()).toBeVisible()
    await page.screenshot({ path: `${shots}/pdf-profile.png`, fullPage: true })

    // 2nd import of the same file: replaced, never duplicated
    await page.goto('/me/import')
    await pick(page, join(FX, 'linkedin-jec-v1.pdf'))
    await saveImport(page)
    expect(exps(uid)).toEqual(v1Exps)
    expect(edus(uid)).toEqual(v1Edus)
    expect(exps(uid, 'manual')).toHaveLength(1)

    // 3rd import: member changed jobs; untick one role and one skill, tick "Replace"
    await page.goto('/me/import')
    await pick(page, join(FX, 'linkedin-jec-v2.pdf'))
    await expect(page.getByText('Experience (4 of 4)')).toBeVisible()
    await page.getByRole('checkbox', { name: /Summer Intern/ }).uncheck()
    await expect(page.getByText('Experience (3 of 4)')).toBeVisible()
    await page.getByRole('button', { name: 'Remove Python (Programming Language)' }).click()
    await saveImport(page, true)
    expect(exps(uid).map((e) => `${e.title} @ ${e.company} ${e.is_current ? 'now' : e.end_date}`)).toEqual([
      'Engineer @ Tata Motors 2022-02-01',
      'Lead Engineer @ Ola Electric now',
      'Senior Engineer @ Tata Motors 2024-12-01',
    ])
    expect(prof(uid)).toMatchObject({
      headline: 'Lead Engineer at Ola Electric | JEC CSE 2012',
      city: 'Bengaluru',
      skills: ['Automotive Engineering', 'Electric Vehicles'],
      current_title: 'Lead Engineer',
      current_company: 'Ola Electric',
    })
    expect(edus(uid)).toEqual(v1Edus)
    expect(exps(uid, 'manual')).toHaveLength(1)
  })

  test('ZIP: LinkedIn data export (Profile/Positions/Education/Skills.csv) lands in the database', async ({ page }) => {
    const uid = await newMember(page, 'zip')
    // Column names and formats of LinkedIn's "Get a copy of your data" CSVs.
    const zip = new JSZip()
    zip.file(
      'Profile.csv',
      'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\n' +
        'Priya,Verma,,,"Mar 4, 1990","Senior Data Scientist at Flipkart","I work on ranking, search and ""ML at scale"".\nJEC 2012 alumna.",Software Development,,"Bengaluru, Karnataka, India",,,\n',
    )
    zip.file(
      'Positions.csv',
      'Company Name,Title,Description,Location,Started On,Finished On\n' +
        'Flipkart,Senior Data Scientist,"Search ranking, recommendations\n- Led a team of 4","Bengaluru, Karnataka, India",Jan 2021,\n' +
        'Flipkart,Data Scientist,,"Bengaluru, Karnataka, India",Jul 2018,Dec 2020\n' +
        'Infosys,Systems Engineer,,Mysore,Aug 2012,Jun 2018\n',
    )
    zip.file(
      'Education.csv',
      'School Name,Start Date,End Date,Notes,Degree Name,Activities\n' +
        'Jabalpur Engineering College,2008,2012,,Bachelor of Engineering (B.E.),"NSS, Robotics club"\n' +
        'Kendriya Vidyalaya,,,,,\n',
    )
    zip.file('Skills.csv', 'Name\nMachine Learning\nPython\nSQL\n')
    zip.file(
      'Connections.csv',
      'Notes:\n"When exporting your connection data, you may notice..."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n',
    )
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    await page.goto('/me/import')
    await page.getByRole('tab', { name: 'Data export (most complete)' }).click()
    await pick(page, {
      name: 'Basic_LinkedInDataExport_10-08-2026.zip',
      mimeType: 'application/zip',
      buffer,
    })
    await expect(page.getByText('Experience (3 of 3)')).toBeVisible()
    await expect(page.getByText('Flipkart · 2021–Present')).toBeVisible()
    await page.screenshot({ path: `${shots}/zip-review.png`, fullPage: true })
    await saveImport(page)

    expect(exps(uid)).toEqual([
      {
        title: 'Data Scientist',
        company: 'Flipkart',
        location: 'Bengaluru, Karnataka, India',
        start_date: '2018-07-01',
        end_date: '2020-12-01',
        is_current: false,
        description: null,
      },
      {
        title: 'Senior Data Scientist',
        company: 'Flipkart',
        location: 'Bengaluru, Karnataka, India',
        start_date: '2021-01-01',
        end_date: null,
        is_current: true,
        description: 'Search ranking, recommendations\n- Led a team of 4',
      },
      {
        title: 'Systems Engineer',
        company: 'Infosys',
        location: 'Mysore',
        start_date: '2012-08-01',
        end_date: '2018-06-01',
        is_current: false,
        description: null,
      },
    ])
    expect(edus(uid)).toEqual([
      {
        school: 'Jabalpur Engineering College',
        degree: 'Bachelor of Engineering (B.E.)',
        field: null,
        start_year: 2008,
        end_year: 2012,
      },
      {
        school: 'Kendriya Vidyalaya',
        degree: null,
        field: null,
        start_year: null,
        end_year: null,
      },
    ])
    expect(prof(uid)).toMatchObject({
      headline: 'Senior Data Scientist at Flipkart',
      city: 'Pune', // onboarding value kept
      about: 'I work on ranking, search and "ML at scale".\nJEC 2012 alumna.',
      skills: ['Machine Learning', 'Python', 'SQL'],
      current_title: 'Senior Data Scientist',
      current_company: 'Flipkart',
    })
  })

  test('Errors are friendly and the page never crashes', async ({ page }) => {
    const uid = await newMember(page, 'err')
    const danger = (text: string | RegExp) => expect(page.getByText(text)).toBeVisible()
    await page.goto('/me/import')

    await pick(page, join(FX, 'linkedin-not-a-profile.pdf'))
    await danger('This doesn’t look like a LinkedIn profile PDF. On LinkedIn (desktop), open your profile and use More → Save to PDF.')
    await pick(page, join(FX, 'linkedin-scanned.pdf'))
    await danger('This doesn’t look like a LinkedIn profile PDF. On LinkedIn (desktop), open your profile and use More → Save to PDF.')
    await pick(page, {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('this is not a pdf at all'),
    })
    await danger('We couldn’t open this PDF. Please choose the file from LinkedIn’s “Save to PDF”.')
    await pick(page, {
      name: 'huge.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(21 * 1024 * 1024, 32),
    })
    await danger('That file is too large (max 20 MB).')
    await page.screenshot({ path: `${shots}/err-pdf.png`, fullPage: true })

    await page.getByRole('tab', { name: 'Data export (most complete)' }).click()
    await pick(page, {
      name: 'export.zip',
      mimeType: 'application/zip',
      buffer: readFileSync(join(FX, 'linkedin-jec-v1.pdf')),
    })
    await danger('This doesn’t look like a LinkedIn data file. Please choose the .zip file LinkedIn emailed you.')
    const other = new JSZip()
    other.file('Messages.csv', 'CONVERSATION ID,FROM,TO\n1,a,b\n')
    await pick(page, {
      name: 'export.zip',
      mimeType: 'application/zip',
      buffer: await other.generateAsync({ type: 'nodebuffer' }),
    })
    await danger(
      'We couldn’t find profile data in this file. When requesting your data on LinkedIn, include Profile, Positions, Education and Skills.',
    )
    const empty = new JSZip()
    empty.file('Profile.csv', 'First Name,Last Name,Headline\n')
    await pick(page, {
      name: 'export.zip',
      mimeType: 'application/zip',
      buffer: await empty.generateAsync({ type: 'nodebuffer' }),
    })
    await danger('We couldn’t find profile details in this file. Please check it’s the right file, or add details manually.')

    // A very long (30-page) LinkedIn-style PDF: reader stops at 20 pages; the review shows; saving > 60 roles is refused
    // by the RPC with a visible error and nothing is written.
    await page.getByRole('tab', { name: 'Profile PDF (fastest)' }).click()
    await pick(page, join(FX, 'linkedin-long.pdf'))
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Save to my profile' }).click()
    await expect(page.getByText('Import is not valid')).toBeVisible()
    expect(exps(uid)).toHaveLength(0)
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
  })

  test('save_my_linkedin_import is atomic and refuses anonymous callers', async ({ page, request }) => {
    const uid = await newMember(page, 'rpc')
    const asUser = (call: string) =>
      sql(
        `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); ${call}; commit;`,
      )
    asUser(`select public.save_my_linkedin_import('{"headline":"Before"}', '[{"title":"T1","company":"C1"}]', '[{"school":"S1"}]')`)
    expect(exps(uid).map((e) => e.title)).toEqual(['T1'])
    // second call fails halfway (education year violates a CHECK) -> profile/experience changes must roll back too
    expect(() =>
      asUser(
        `select public.save_my_linkedin_import('{"headline":"After"}', '[{"title":"T2","company":"C2"}]', '[{"school":"S2","start_year":1900}]')`,
      ),
    ).toThrow()
    expect(exps(uid).map((e) => e.title)).toEqual(['T1'])
    expect(edus(uid).map((e) => e.school)).toEqual(['S1'])
    expect(prof(uid).headline).toBe('Before')
    // javascript: / non-LinkedIn URLs are never stored
    asUser(`select public.save_my_linkedin_import('{"linkedin_url":"javascript:alert(1)//www.linkedin.com/in/x"}', '[]', '[]')`)
    expect(prof(uid).linkedin_url).toBeNull()

    const env = readFileSync('.env.local', 'utf8')
    const url = env.match(/VITE_SUPABASE_URL=(.*)/)![1]!.trim()
    const anon = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)![1]!.trim()
    const res = await request.post(`${url}/rest/v1/rpc/save_my_linkedin_import`, {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
      },
      data: { p_profile: {}, p_experiences: [], p_educations: [] },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})

// ---------------------------------------------------------------- real LinkedIn exports (local only)
const samplesDir = process.env.LINKEDIN_SAMPLES
const samples = (d: string): string[] =>
  readdirSync(d).flatMap((f) =>
    statSync(join(d, f)).isDirectory() ? samples(join(d, f)) : f.toLowerCase().endsWith('.pdf') ? [join(d, f)] : [],
  )
const pickedSamples = samplesDir
  ? process.env.LINKEDIN_SAMPLE_FILTER
    ? samples(samplesDir).filter((f) => f.includes(process.env.LINKEDIN_SAMPLE_FILTER!))
    : samples(samplesDir)
  : []

test.describe('real LinkedIn PDFs: what the browser saves equals what the parser read', () => {
  test.skip(!samplesDir, 'set LINKEDIN_SAMPLES to a folder of real LinkedIn "Save to PDF" files')
  test('round trip every sample through the UI into the database', async ({ page }) => {
    await polyfillUpsert(page)
    test.setTimeout(30_000 + pickedSamples.length * 15_000)
    const uid = await newMember(page, 'real')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    for (const file of pickedSamples) {
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(readFileSync(file)),
      }).promise
      const pages = []
      for (let p = 1; p <= Math.min(doc.numPages, 20); p++) pages.push((await (await doc.getPage(p)).getTextContent()).items as never[])
      const { main, sidebar } = itemsToLines(pages)
      const want = parseLinkedInPdfLines(main, sidebar)

      await page.goto('/me/import')
      await pick(page, file)
      await saveImport(page, true)
      const sortE = (a: Record<string, unknown>[]) => a.map((e) => JSON.stringify(e)).sort()
      expect(sortE(exps(uid)), file).toEqual(
        sortE(
          want.experiences.map((e) => ({
            title: e.title,
            company: e.company,
            location: e.location,
            start_date: e.start_date,
            end_date: e.end_date,
            is_current: e.is_current,
            description: e.description,
          })),
        ),
      )
      expect(sortE(edus(uid)), file).toEqual(
        sortE(
          want.educations.map((e) => ({
            school: e.school,
            degree: e.degree,
            field: e.field,
            start_year: e.start_year,
            end_year: e.end_year,
          })),
        ),
      )
      const p = prof(uid)
      expect(p.headline, file).toBe(want.headline ?? p.headline)
      expect(p.skills, file).toEqual(want.skills ?? p.skills)
      expect(p.linkedin_url, file).toBe(want.linkedin_url ?? p.linkedin_url)
      const cur = want.experiences.find((e) => e.is_current)
      if (cur) expect([p.current_title, p.current_company], file).toEqual([cur.title.slice(0, 120), cur.company.slice(0, 120)])
    }
  })
})
