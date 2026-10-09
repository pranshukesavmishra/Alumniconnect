-- Local development / staging sample data. NEVER run against production: the real event is created by
-- admins in the app (Event settings) once the committee confirms the details. Payment details are
-- deliberately fake so nobody can pay a real account from a test build. Prices are placeholders for the
-- admins to set in Event settings → Fees.
insert into public.events (slug, title, tagline, description, venue, venue_map_url, starts_at, ends_at,
                           registration_closes_at, eligible_from_year, eligible_to_year, upi_id, upi_payee_name,
                           payment_note, contact_phone, contact_email, is_published, ask_reunion_questions)
values (
  'alumni-meet-2026',
  'Alumni Connect Grand Reunion 2026',
  'Batches 2003–2012 · A Decade of JECians',
  'A Decade of JECians comes home. All branches (B.E., M.E. & MCA) of the batches 2003 to 2012 meet again in Jabalpur.' || E'\n\n'
  || '26 December 2026: the main event, for alumni only.' || E'\n'
  || '27 December 2026: an optional outdoor event for alumni and their families.' || E'\n\n'
  || 'Register once, choose your days and bring your family on the 27th. Join an organising team, perform on stage, '
  || 'support the Reunion Fund for a better reunion and continuous support to the college and students, or sponsor the event. '
  || 'We can help with accommodation and local travel (vendor details and deal prices; the cost is paid by you).',
  'Jabalpur Engineering College campus, Gokalpur, Jabalpur',
  'https://maps.google.com/?q=Jabalpur+Engineering+College',
  '2026-12-26 10:00+05:30',
  '2026-12-27 18:00+05:30',
  '2026-12-10 23:59+05:30',
  2003, 2012,
  'sample.do-not-pay@upi',
  'SAMPLE - DO NOT PAY',
  'Pay the exact amount shown. Keep the 12-digit UPI reference (UTR) from your payment app.',
  '+91 90000 00000',
  'alumni@example.com',
  true,
  true
)
on conflict (slug) do nothing;

-- Days are ticket types: one main ticket per alumnus (26 only / 27 only / both); family tickets are for the 27th.
insert into public.event_ticket_types (event_id, label, description, price_paise, is_primary, max_per_registration, sort, days)
select e.id, t.label, t.description, t.price_paise, t.is_primary, t.max_per_registration, t.sort, t.days
from public.events e
cross join (values
  ('26 Dec only · main event', 'Main event for alumni only', 200000, true, 1, 1, '{1}'::smallint[]),
  ('27 Dec only · outdoor event', 'Optional outdoor event for alumni and family', 150000, true, 1, 2, '{2}'::smallint[]),
  ('Both days · 26 & 27 Dec', 'Main event on 26 Dec and the outdoor event with family on 27 Dec', 300000, true, 1, 3, null),
  ('Family adult · 27 Dec', 'Spouse, parent or another adult in your family, for the outdoor event', 100000, false, 4, 4, '{2}'::smallint[]),
  ('Child 5–12 years · 27 Dec', 'For the outdoor event', 50000, false, 4, 5, '{2}'::smallint[]),
  ('Child under 5 · 27 Dec', 'For the outdoor event', 0, false, 4, 6, '{2}'::smallint[])
) as t(label, description, price_paise, is_primary, max_per_registration, sort, days)
where e.slug = 'alumni-meet-2026'
  and not exists (select 1 from public.event_ticket_types x where x.event_id = e.id);
