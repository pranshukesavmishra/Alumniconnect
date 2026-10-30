// Run: deno test --node-modules-dir=none --allow-env --allow-read supabase/functions/linkedin-enrich/index.test.ts
// The handler and the People Data Labs adapter with a fake network: no real provider calls, no credits used.
import { makeHandler, type Deps, type Quota } from './handler.ts'
import { mapPdlPerson, pdlProvider, titleCase, type EnrichProvider } from './provider.ts'
import { findJec, normaliseLinkedInUrl } from './rules.ts'

function eq(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`)
}

const PDL_PERSON = {
  full_name: 'asha rao',
  linkedin_url: 'linkedin.com/in/asha-rao',
  job_title: 'senior manager',
  job_company_name: 'larsen & toubro',
  location_locality: 'pune',
  location_country: 'india',
  skills: ['project management', 'automotive', 'project management'],
  experience: [
    { company: { name: 'tata motors' }, title: { name: 'engineer' }, start_date: '2008-07', end_date: '2014-05', is_primary: false },
    { company: { name: 'larsen & toubro' }, title: { name: 'senior manager' }, start_date: '2014-06', end_date: null, is_primary: true },
  ],
  education: [
    { school: { name: 'iim indore' }, degrees: ['mba'], majors: [], start_date: '2016', end_date: '2018' },
    { school: { name: 'jabalpur engineering college' }, degrees: ['bachelor of engineering'], majors: ['mechanical engineering'], start_date: '2004', end_date: '2008' },
  ],
}

/** A fake fetch for api.peopledatalabs.com: records the requests, answers from `reply`. */
function fakePdl(reply: { status: number; body?: unknown }) {
  const seen: { url: string; key: string | null }[] = []
  const f = ((input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    seen.push({ url, key: new Headers(init?.headers).get('X-Api-Key') })
    if (!url.startsWith('https://api.peopledatalabs.com/v5/person/enrich?')) throw new Error(`unexpected request ${url}`)
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }))
  }) as typeof fetch
  return { f, seen }
}

interface World {
  deps: Deps
  takes: string[]
  hints: unknown[]
  logs: Record<string, unknown>[]
}
function world(opts: { provider?: EnrichProvider | null; quota?: Quota; email?: string | null } = {}): World {
  const takes: string[] = []
  const hints: unknown[] = []
  const logs: Record<string, unknown>[] = []
  return {
    takes,
    hints,
    logs,
    deps: {
      currentUser: (a) => Promise.resolve(a ? { id: 'user-1', email: opts.email === undefined ? 'Asha.Rao@Example.com' : opts.email } : null),
      provider: () => (opts.provider === undefined ? pdlProvider('k-123', normaliseLinkedInUrl, fakePdl({ status: 200, body: { status: 200, likelihood: 8, data: PDL_PERSON } }).f) : opts.provider),
      take: (u) => {
        takes.push(u)
        return Promise.resolve(opts.quota ?? { ok: true })
      },
      recordHint: (_u, h) => {
        hints.push(h)
        return Promise.resolve('open')
      },
      log: (l) => logs.push(l),
    },
  }
}
const call = (w: World, body: unknown, auth = 'Bearer t') =>
  makeHandler(w.deps)(new Request('http://fn/linkedin-enrich', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

Deno.test('PDL adapter: e-mail look-up sends the key header and min_likelihood, maps and title-cases the answer', async () => {
  const net = fakePdl({ status: 200, body: { status: 200, likelihood: 8, data: PDL_PERSON } })
  const p = await pdlProvider('k-123', normaliseLinkedInUrl, net.f).lookup({ email: 'asha@example.com' })
  const url = new URL(net.seen[0]!.url)
  eq(net.seen[0]!.key, 'k-123', 'api key header')
  eq([url.searchParams.get('email'), url.searchParams.get('min_likelihood'), url.searchParams.get('profile')], ['asha@example.com', '6', null], 'params')
  eq([p!.current_title, p!.current_company, p!.city, p!.country], ['Senior Manager', 'Larsen & Toubro', 'Pune', 'India'], 'current role')
  eq(p!.experiences.map((e) => [e.title, e.company, e.start_year, e.end_year, e.is_current]), [['Senior Manager', 'Larsen & Toubro', 2014, null, true], ['Engineer', 'Tata Motors', 2008, 2014, false]], 'experiences newest first')
  eq(p!.skills, ['Project Management', 'Automotive'], 'skills')
  eq(p!.linkedin_url, 'https://www.linkedin.com/in/asha-rao', 'link normalised')
  eq(p!.headline, 'Senior Manager at Larsen & Toubro', 'headline from facts')
})

Deno.test('PDL adapter: profile look-up, 404 is "no match" (no credit), errors are typed', async () => {
  const net = fakePdl({ status: 404, body: { status: 404, error: { type: 'not_found' } } })
  eq(await pdlProvider('k', normaliseLinkedInUrl, net.f).lookup({ profileUrl: 'https://www.linkedin.com/in/x-y' }), null, 'no match')
  eq(new URL(net.seen[0]!.url).searchParams.get('profile'), 'https://www.linkedin.com/in/x-y', 'profile param')
  for (const [status, code] of [[401, 'enrich_not_configured'], [402, 'enrich_out_of_credits'], [429, 'enrich_busy'], [500, 'enrich_unavailable']] as const) {
    let got = ''
    try {
      await pdlProvider('k', normaliseLinkedInUrl, fakePdl({ status, body: {} }).f).lookup({ email: 'a@b.co' })
    } catch (e) {
      got = (e as { code: string }).code
    }
    eq(got, code, `status ${status}`)
  }
})

Deno.test('handler: e-mail look-up with consent fills from LinkedIn, sets batch/branch from JEC and records a hint', async () => {
  const w = world()
  const res = await call(w, { mode: 'email', consent: true })
  eq(res.status, 200, 'status')
  const out = await res.json()
  eq([out.profile.grad_year, out.profile.branch], [2008, 'B.E. in Mechanical Engineering'], 'batch and branch from JEC')
  eq(out.jec.kind, 'jec', 'jec match')
  eq(out.jec.hint, 'open', 'hint recorded for admins (not auto-verified)')
  eq(w.hints.length, 1, 'one hint')
  eq(w.takes, ['user-1'], 'quota taken')
  eq(JSON.stringify(w.logs).includes('asha'), false, 'no personal data in logs')
})

Deno.test('handler: consent is required, status is free, links must be LinkedIn profiles', async () => {
  const w = world()
  eq((await call(w, { mode: 'email' })).status, 400, 'no consent')
  const st = await call(w, { mode: 'status' })
  eq(await st.json(), { available: true }, 'status')
  const bad = await call(w, { mode: 'url', consent: true, url: 'https://evil.example/in/asha' })
  eq([bad.status, (await bad.json()).error], [400, 'bad_url'], 'other host')
  eq(w.takes.length, 0, 'no quota used for any of these')
  eq((await call(w, { mode: 'status' }, '')).status, 401, 'signed out')
})

Deno.test('handler: no provider configured -> 503, the app hides the option', async () => {
  const w = world({ provider: null })
  eq(await (await call(w, { mode: 'status' })).json(), { available: false }, 'status says off')
  const r = await call(w, { mode: 'email', consent: true })
  eq([r.status, (await r.json()).error], [503, 'enrich_not_configured'], 'look-up refused')
})

Deno.test('handler: no match -> 404 no_match; per-member limit -> 429', async () => {
  const none = world({ provider: { name: 'fake', lookup: () => Promise.resolve(null) } })
  const r = await call(none, { mode: 'url', consent: true, url: 'linkedin.com/in/someone-else' })
  eq([r.status, (await r.json()).error], [404, 'no_match'], 'no match')
  const limited = await call(world({ quota: { ok: false, reason: 'user_limit' } }), { mode: 'email', consent: true })
  eq(limited.status, 429, 'limit')
})

Deno.test('LinkedIn link normalisation and JEC detection', () => {
  eq(normaliseLinkedInUrl('linkedin.com/in/Asha-Rao/'), 'https://www.linkedin.com/in/asha-rao', 'bare')
  eq(normaliseLinkedInUrl('https://in.linkedin.com/in/asha-rao?trk=share'), 'https://www.linkedin.com/in/asha-rao', 'country host + query')
  eq(normaliseLinkedInUrl('https://www.linkedin.com.evil.com/in/asha'), null, 'look-alike host')
  eq(normaliseLinkedInUrl('https://www.linkedin.com/company/tata'), null, 'not a profile')
  eq(findJec([{ school: 'Govt. Engineering College, Jabalpur', degree: 'B.E.', field: 'Civil', start_year: 1990, end_year: 1994 }])?.branch, 'B.E. in Civil Engineering', 'GEC Jabalpur')
  eq(findJec([{ school: 'JEC Jabalpur', degree: null, field: 'Electronics and Telecommunication', start_year: null, end_year: 2005 }])?.kind, 'jec', 'JEC Jabalpur')
  eq(findJec([{ school: 'Rani Durgavati Vishwavidyalaya', degree: 'Bachelor of Engineering', field: 'Mechanical', start_year: 2000, end_year: 2004 }]), null, 'a university alone is not JEC')
  eq(findJec([{ school: 'Rani Durgavati Vishwavidyalaya', degree: 'MA', field: 'History', start_year: null, end_year: null }]), null, 'university without engineering')
  eq(findJec([{ school: 'Jabalpur Public School', degree: null, field: null, start_year: null, end_year: null }]), null, 'other Jabalpur school')
  eq(titleCase('L&T'), 'L&T', 'keeps capitals')
  eq(mapPdlPerson({ experience: [{ title: { name: '' }, company: { name: 'x' } }] }, normaliseLinkedInUrl).experiences, [], 'empty title dropped')
})
