-- Local development / staging sample data. NEVER run against production: the real event is created by
-- admins in the app (Event settings) once the committee confirms the details. Payment details are
-- deliberately fake so nobody can pay a real account from a test build.
insert into public.events (slug, title, tagline, description, venue, venue_map_url, starts_at, ends_at,
                           registration_closes_at, eligible_from_year, eligible_to_year, upi_id, upi_payee_name,
                           payment_note, contact_phone, contact_email, is_published)
values (
  'alumni-meet-2026',
  'JEC Alumni Meet 2026',
  'Batches 2001–2010 · Back where it all began',
  'Ten batches, one campus, one evening to remember. Meet your batchmates, faculty and friends from 2001 to 2010 at Jabalpur Engineering College. '
  || 'Sample text: the committee will replace this with the final programme.',
  'Jabalpur Engineering College campus, Gokalpur, Jabalpur',
  'https://maps.google.com/?q=Jabalpur+Engineering+College',
  '2026-12-26 10:00+05:30',
  '2026-12-27 18:00+05:30',
  '2026-12-10 23:59+05:30',
  2001, 2010,
  'sample.do-not-pay@upi',
  'SAMPLE - DO NOT PAY',
  'Pay the exact amount shown. Keep the 12-digit UPI reference (UTR) from your payment app.',
  '+91 90000 00000',
  'alumni@example.com',
  true
)
on conflict (slug) do nothing;

insert into public.event_ticket_types (event_id, label, description, price_paise, is_primary, max_per_registration, sort)
select e.id, t.label, t.description, t.price_paise, t.is_primary, t.max_per_registration, t.sort
from public.events e
cross join (values
  ('Alumnus / Alumna', 'Includes meals on both days, kit and gala dinner', 250000, true, 1, 1),
  ('Spouse', 'Meals and gala dinner', 150000, false, 1, 2),
  ('Child (5–12 years)', 'Meals', 50000, false, 4, 3),
  ('Child (under 5)', 'Free', 0, false, 4, 4)
) as t(label, description, price_paise, is_primary, max_per_registration, sort)
where e.slug = 'alumni-meet-2026'
  and not exists (select 1 from public.event_ticket_types x where x.event_id = e.id);
