// Seeds the SAMPLE data the guide video films, into the local dev stack (never resets anything). Names are invented, emails are example.com.
//   node scripts/guide/seed.mjs            others + optional 27 Dec tour + UPI id (undo with: node scripts/guide/seed.mjs undo)
//   node scripts/guide/seed.mjs after      once the on-camera member exists: verified, connected, chats, photos consent
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { GUIDE, q, sql, sleep } from './lib.mjs'

const API = 'http://127.0.0.1:54321'
const SERVICE = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' }).match(/SERVICE_ROLE_KEY="([^"]+)"/)[1]
const B = { CSE: 'B.E. in Computer Science & Engineering', ME: 'B.E. in Mechanical Engineering', ETC: 'B.E. in Electronics & Telecommunications', IT: 'B.E. in Information Technology', EE: 'B.E. in Electrical Engineering', CIVIL: 'B.E. in Civil Engineering' }
const PEOPLE = [
  { key: 'priya', name: 'Priya Sharma', br: B.CSE, y: 2005, city: 'Bengaluru', title: 'Engineering Director', co: 'Orbit Cloud' },
  { key: 'kavita', name: 'Kavita Dubey', br: B.ETC, y: 2008, city: 'Pune', title: 'Founder', co: 'Pixelwave Studio' },
  { key: 'shreya', name: 'Shreya Mishra', br: B.IT, y: 2008, city: 'Pune', title: 'Engineering Manager', co: 'Cobalt Systems' },
  { key: 'ankit', name: 'Ankit Jain', br: B.ETC, y: 2010, city: 'Dubai', title: 'Network Architect', co: 'Gulfline Telecom' },
  { key: 'meera', name: 'Meera Iyer', br: B.CSE, y: 2008, city: 'Singapore', title: 'Senior Data Scientist', co: 'Meridian AI' },
  { key: 'vikram', name: 'Vikram Singh', br: B.EE, y: 2006, city: 'Mumbai', title: 'Staff Engineer', co: 'Helios Energy' },
  { key: 'sandeep', name: 'Sandeep Patel', br: B.CIVIL, y: 2003, city: 'Jabalpur', title: 'Executive Engineer', co: 'Public Works Department' },
  { key: 'neha', name: 'Neha Agrawal', br: B.IT, y: 2012, city: 'Pune', title: 'Product Manager', co: 'Lumen Fintech' },
  { key: 'amit', name: 'Amit Verma', br: B.ME, y: 2008, city: 'Pune', title: 'Plant Head', co: 'Kinetic Auto Components' },
]
const mail = (k) => `guide.${k}@example.com`

if (process.argv[2] === 'undo') {
  const ev = sql(`select id from events where slug = 'alumni-meet-2026'`)
  sql(`delete from event_ticket_types where event_id = '${ev}' and label = 'Outdoor tour (Bhedaghat)'`)
  const orig = process.env.ORIG_UPI
  if (orig) sql(`update events set upi_id = ${q(orig)} where id = '${ev}'`)
  console.log('tour removed')
  process.exit(0)
}

async function uploadAvatar(id, key) {
  const path = `${id}/avatar.png`
  const r = await fetch(`${API}/storage/v1/object/avatars/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: readFileSync(`${GUIDE}/assets/avatars/${key}.png`) })
  if (!r.ok) throw new Error(`avatar ${key}: ${await r.text()}`)
  return `${API}/storage/v1/object/public/avatars/${path}`
}

const as = (uid, query) => {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' })
  return execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `set local role authenticated; select set_config('request.jwt.claims', ${q(claims)}, true); ${query}`], { encoding: 'utf8' }).trim()
}

if (process.argv[2] === 'after') {
  const me = sql(`select id from auth.users where email = 'rohan.mehta@example.com'`)
  sql(`update profiles set verification = 'verified' where id = '${me}'`)
  const id = (k) => sql(`select id from auth.users where email = '${mail(k)}'`)
  // connections: the on-camera member is already connected to two batchmates
  for (const k of ['kavita', 'amit']) {
    as(me, `select request_connection('${id(k)}')`)
    as(id(k), `select respond_connection('${me}', true)`)
  }
  const chat = as(me, `select (start_dm('${id('kavita')}')).id`).split('\n').pop()
  const say = (uid, body) => as(uid, `select send_message('${chat}', ${q(body)})`)
  say(id('kavita'), 'Rohan! Are you coming for the reunion on 26 Dec?')
  say(me, 'Of course, registering today. Batch of 2008 table?')
  say(id('kavita'), 'Yes! Shreya and Amit are in too. Chai at the old canteen first.')
  sql(`update messages set created_at = now() - interval '35 minutes' where body like 'Rohan! Are you%'; update messages set created_at = now() - interval '28 minutes' where body like 'Of course%'; update messages set created_at = now() - interval '12 minutes' where body like 'Yes! Shreya%'`)
  sql(`update chats c set last_message_at = (select max(created_at) from messages m where m.chat_id = c.id), last_message = (select body from messages m where m.chat_id = c.id order by created_at desc limit 1) where id = '${chat}'`)
  console.log('after ok, chat', chat)
  process.exit(0)
}

for (const p of PEOPLE) {
  const email = mail(p.key)
  const old = sql(`select id from auth.users where email = '${email}'`)
  const uid = old || sql(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', now(), '{}'::jsonb, now(), now()) returning id`).split('\n')[0]
  const av = await uploadAvatar(uid, p.key)
  sql(`update profiles set onboarded = true, member_type = 'alumnus', full_name = ${q(p.name)}, branch = ${q(p.br)}, join_year = ${p.y - 4}, grad_year = ${p.y}, city = ${q(p.city)}, country = 'India',
       current_title = ${q(p.title)}, current_company = ${q(p.co)}, headline = ${q(`${p.title} at ${p.co}`)}, avatar_url = ${q(av)}, verification = 'verified', language = 'en' where id = '${uid}'`)
  sql(`update profile_private set phone = '+91 98765 4${String(1000 + PEOPLE.indexOf(p) * 7).slice(-4)}0' where id = '${uid}'`)
}

// a clean official story and two member stories for the Home row
const suresh = sql(`select id from auth.users where email = 'guide.priya@example.com'`)
sql(`delete from stories where owner_id in (select id from auth.users where email like 'guide.%@example.com')`)
const story = (email, text, bg, official = false) => sql(`insert into stories (owner_id, is_official, kind, audience, text_body, bg_key) select id, ${official}, 'text', 'all', ${q(text)}, '${bg}' from auth.users where email = '${email}'`)
story('guide.priya@example.com', 'Landing in Jabalpur on the 25th. Who is up for chai?', 'teal')
story('guide.kavita@example.com', 'Batch of 2008 table is booked. See you all!', 'amber')
story('guide.sandeep@example.com', 'Campus looks beautiful this winter.', 'forest')
void suresh

// the optional 27 Dec tour and a UPI id that reads well on screen
const ev = sql(`select id from events where slug = 'alumni-meet-2026'`)

// sample reunion photos (generated illustrations) from the sample members
sql(`delete from event_photos where event_id = '${ev}' and uploaded_by in (select id from auth.users where email like 'guide.%@example.com')`)
const caps = ['Main building at golden hour', 'Walking back at sunset', 'Batch of 2008 together again', 'Gala dinner under the lights', 'Boat ride at Bhedaghat', 'Reunion lunch on the lawn', 'Old gate, new memories', 'The whole gang']
const who = ['priya', 'kavita', 'shreya', 'amit', 'sandeep', 'neha', 'meera', 'vikram']
const put = async (path, file) => {
  const r = await fetch(`${API}/storage/v1/object/event-photos/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: readFileSync(file) })
  if (!r.ok) throw new Error(await r.text())
}
for (let i = 0; i < 8; i++) {
  const up = sql(`select id from auth.users where email = '${mail(who[i])}'`)
  const id = sql(`select gen_random_uuid()`)
  const path = `${up}/${ev}/${id}.jpg`, thumb = `${up}/${ev}/${id}_t.jpg`
  await put(path, `${GUIDE}/assets/photos/p${i + 1}.jpg`)
  await put(thumb, `${GUIDE}/assets/photos/t_p${i + 1}.jpg`)
  sql(`insert into event_photos (id, event_id, uploaded_by, storage_path, thumb_path, width, height, caption, kind, source, status, sort_order, media_kind, content_hash, created_at)
       values ('${id}', '${ev}', '${up}', '${path}', '${thumb}', 1600, 1067, ${q(caps[i])}, 'event', 'member', 'approved', ${i}, 'photo', '${createHash('sha256').update('guide-' + i).digest('hex')}', now() - interval '${i * 40 + 10} minutes')`)
}
console.log('ORIG_UPI=' + sql(`select coalesce(upi_id, '') from events where id = '${ev}'`))
sql(`update events set upi_id = 'jecalumni@okicici', upi_payee_name = 'JEC Alumni Association' where id = '${ev}'`)
sql(`delete from event_ticket_types where event_id = '${ev}' and label = 'Outdoor tour (Bhedaghat)'`)
sql(`insert into event_ticket_types (event_id, label, description, price_paise, is_primary, is_addon, max_per_registration, sort, days) values ('${ev}', 'Outdoor tour', 'Bhedaghat boat ride and lunch', 65000, false, true, 10, 90, '{2}')`)
sql(`update event_ticket_types set label = 'Outdoor tour (Bhedaghat)' where event_id = '${ev}' and label = 'Outdoor tour'`)
await sleep(100)
console.log('seed ok')
