// Swaps in a clean SAMPLE reunion for filming (the real prices) and swaps the real one back:
//   node scripts/guide/event.mjs apply | undo
// apply renames the existing alumni-meet-2026 event out of the way and creates a copy with only the tickets the video shows:
//   Alumnus 26 Dec only 2,500 (was 3,350, Early Bird), Spouse 500, Child (9 above) 500, optional extra "Outdoor tour" 650 (27 Dec).
import { q, sql } from './lib.mjs'

const BAK = 'alumni-meet-2026-guidebak'
if (process.argv[2] === 'undo') {
  const has = sql(`select count(*) from events where slug = '${BAK}'`)
  if (has === '1') {
    sql(`delete from event_registrations where event_id = (select id from events where slug = 'alumni-meet-2026')`)
    sql(`delete from event_photos where event_id = (select id from events where slug = 'alumni-meet-2026')`)
    sql(`delete from events where slug = 'alumni-meet-2026'`)
    sql(`update events set slug = 'alumni-meet-2026' where slug = '${BAK}'`)
  }
  console.log('restored')
  process.exit(0)
}
if (sql(`select count(*) from events where slug = '${BAK}'`) === '1') {
  console.log('already applied')
  process.exit(0)
}
sql(`update events set slug = '${BAK}' where slug = 'alumni-meet-2026';
     create temp table e as select * from events where slug = '${BAK}';
     update e set id = gen_random_uuid(), slug = 'alumni-meet-2026', upi_id = 'guide.sample@okicici', upi_payee_name = 'JEC Alumni';
     insert into events select * from e;`)
const ev = sql(`select id from events where slug = 'alumni-meet-2026'`)
sql(`delete from event_ticket_types where event_id = '${ev}'`)
const t = (label, desc, price, primary, max, sort, days, list, disc, addon) =>
  sql(`insert into event_ticket_types (event_id, label, description, price_paise, is_primary, max_per_registration, sort, days, list_price_paise, discount_label, is_addon)
       values ('${ev}', ${q(label)}, ${q(desc)}, ${price}, ${primary}, ${max}, ${sort}, '${days}', ${list ?? 'null'}, ${q(disc)}, ${addon})`)
t('Alumnus · 26 Dec only', 'Main event on 26 Dec', 250000, true, 1, 0, '{1}', 335000, 'Early Bird', false)
t('Spouse · 26 Dec', 'Spouse or partner', 50000, false, 1, 1, '{1}', null, null, false)
t('Child (9 above) · 26 Dec', 'Children aged 9 and above', 50000, false, 4, 2, '{1}', null, null, false)
t('Outdoor tour', 'Bhedaghat boat ride and lunch', 65000, false, 10, 90, '{2}', null, null, true)
console.log('sample event applied', ev)
