-- Explicit table privileges, so access never depends on Supabase's "auto-expose new tables" default.
-- Row-level security still decides WHICH rows; these grants decide WHAT operations are possible at all.
-- service_role (server-side only) keeps its default full access.

revoke all on all tables in schema public from anon, authenticated;

-- members and profiles
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, headline, member_type, branch, join_year, grad_year,
              current_title, current_company, city, country, about, linkedin_url, website_url,
              skills, help_tags, interests, onboarded)
  on public.profiles to authenticated;
grant select on public.profile_private to authenticated;
grant update (phone, whatsapp_same_as_phone) on public.profile_private to authenticated;
grant select, insert, update, delete on public.experiences, public.educations to authenticated;

-- events (public pages are readable without signing in)
grant select on public.events, public.event_ticket_types to anon, authenticated;
grant insert, update, delete on public.events, public.event_ticket_types to authenticated;  -- RLS: admins only
grant select, insert, update, delete on public.event_staff to authenticated;                 -- RLS: admins only
grant select, insert, update, delete on public.event_settings to authenticated;              -- RLS: admins only
grant select on public.event_registrations, public.event_registration_items, public.event_payments to authenticated;
grant select, insert, delete on public.event_photos to authenticated;
grant update (caption) on public.event_photos to authenticated;
