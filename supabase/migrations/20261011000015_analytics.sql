-- Admin analytics: one function returns everything the dashboard shows (counts only, never personal data).

create or replace function public.admin_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  out jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can view analytics' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'generated_at', now(),
    'members', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'onboarded', (select count(*) from public.profiles where onboarded),
      'verified', (select count(*) from public.profiles where verification = 'verified'),
      'pending', (select count(*) from public.profiles where onboarded and verification = 'pending'),
      'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
      'new_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
      'with_photo', (select count(*) from public.profiles where avatar_url is not null),
      'with_linkedin', (select count(*) from public.profiles where linkedin_url is not null),
      'offering_help', (select count(*) from public.profiles where cardinality(help_tags) > 0)
    ),
    -- sign-ups per day for the last 30 days (Indian time), zero-filled
    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'count', coalesce(c.n, 0)) order by d), '[]'::jsonb)
        from generate_series(today - 29, today, interval '1 day') d
        left join (select (created_at at time zone 'Asia/Kolkata')::date as day, count(*) n from public.profiles
                    where created_at > now() - interval '31 days' group by 1) c on c.day = d::date),
    'by_batch', (
      select coalesce(jsonb_agg(x order by (x ->> 'year')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('year', grad_year, 'members', count(*), 'verified', count(*) filter (where verification = 'verified')) as x
          from public.profiles where grad_year is not null group by grad_year order by count(*) desc limit 40) t),
    'by_branch', (
      select coalesce(jsonb_agg(x order by (x ->> 'members')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('branch', branch, 'members', count(*)) as x
          from public.profiles where branch is not null group by branch) t),
    'engagement_7d', jsonb_build_object(
      'posts', (select count(*) from public.posts where created_at > now() - interval '7 days'),
      'comments', (select count(*) from public.comments where created_at > now() - interval '7 days'),
      'messages', (select count(*) from public.messages where created_at > now() - interval '7 days' and kind <> 'system'),
      'active_members', (select count(*) from (
          select author_id from public.posts where created_at > now() - interval '7 days'
          union select author_id from public.comments where created_at > now() - interval '7 days'
          union select sender_id from public.messages where created_at > now() - interval '7 days' and sender_id is not null
          union select user_id from public.post_likes where created_at > now() - interval '7 days') a),
      'new_connections', (select count(*) from public.connections where status = 'accepted' and accepted_at > now() - interval '7 days'),
      'jobs_posted', (select count(*) from public.jobs where created_at > now() - interval '7 days'),
      'help_asked', (select count(*) from public.help_requests where created_at > now() - interval '7 days')),
    'content', jsonb_build_object(
      'open_jobs', (select count(*) from public.jobs where not is_hidden and not is_closed and expires_at > now()),
      'open_help_requests', (select count(*) from public.help_requests where not is_resolved and not is_hidden),
      'open_reports', (select count(*) from public.reports where status = 'open'),
      'push_devices', (select count(*) from public.push_subscriptions)),
    'invites', jsonb_build_object(
      'joined_via_invite', (select count(*) from public.profiles where invited_by is not null),
      'top_inviters', (
        select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select jsonb_build_object('name', i.full_name, 'joined', count(*)) as x
            from public.profiles p join public.profiles i on i.id = p.invited_by group by i.id, i.full_name order by count(*) desc limit 5) t))
  ) into out;
  return out;
end;
$$;
revoke execute on function public.admin_analytics() from anon, public;
grant execute on function public.admin_analytics() to authenticated;
