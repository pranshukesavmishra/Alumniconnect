-- The merge preview crashed with a raw "malformed array literal" error exactly when it had to refuse (the profile to remove is an admin, or is you):
-- adding a message to a text[] with || reads the message as an array. array_append adds it as one message.
create or replace function public.admin_merge_preview(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fk record;
  n bigint;
  v_moves jsonb := '{}'::jsonb;
  v_blocks text[] := '{}';
  v_side jsonb;
begin
  perform public._require_admin();
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'Choose two different members.'; end if;
  for fk in
    select c.conrelid::regclass::text as tbl, (select cl.relname::text from pg_class cl where cl.oid = c.conrelid) as name, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and not (c.conrelid = 'public.profiles'::regclass and a.attname = 'id')
       and not (c.conrelid = 'public.profile_private'::regclass and a.attname = 'id')
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using p_drop;
    if n > 0 then v_moves := v_moves || jsonb_build_object(fk.name, coalesce((v_moves ->> fk.name)::bigint, 0) + n); end if;
  end loop;
  select coalesce(array_agg('Both are registered for “' || e.title || '”. Cancel or remove one registration first.'), '{}') into v_blocks
    from public.event_registrations k join public.event_registrations d on d.event_id = k.event_id and d.user_id = p_drop
    join public.events e on e.id = k.event_id
   where k.user_id = p_keep;
  if (select is_admin from public.profiles where id = p_drop) then
    v_blocks := array_append(v_blocks, 'The profile being removed is an admin. Remove their admin access first.');
  end if;
  if p_drop = auth.uid() then v_blocks := array_append(v_blocks, 'You cannot merge away your own account.'); end if;

  select jsonb_object_agg(case when p.id = p_keep then 'keep' else 'drop' end,
           jsonb_build_object('id', p.id, 'full_name', p.full_name, 'branch', p.branch, 'grad_year', p.grad_year, 'city', p.city,
             'current_company', p.current_company, 'verification', p.verification, 'is_admin', p.is_admin, 'onboarded', p.onboarded,
             'created_at', p.created_at, 'last_sign_in_at', u.last_sign_in_at, 'email', public._mask_email(u.email),
             'has_phone', pp.phone is not null))
    into v_side
    from public.profiles p join auth.users u on u.id = p.id left join public.profile_private pp on pp.id = p.id
   where p.id in (p_keep, p_drop);
  if v_side is null or not (v_side ? 'keep') or not (v_side ? 'drop') then raise exception 'One of these members no longer exists.'; end if;
  return v_side || jsonb_build_object('moves', v_moves, 'blocks', to_jsonb(v_blocks));
end;
$$;
revoke execute on function public.admin_merge_preview(uuid, uuid) from anon, public;
grant execute on function public.admin_merge_preview(uuid, uuid) to authenticated;
