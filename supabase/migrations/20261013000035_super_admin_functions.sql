-- Super admin only: give, change and remove admin access, make owners, hand over ownership, list who holds what.
-- Every one of these is audited, tells the person concerned with a notification, and is idempotent (doing it twice changes nothing
-- and logs nothing the second time).

-- ------------------------------------------------------------------ validate and tidy a permission list
create or replace function public._clean_permissions(p_perms text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bad text;
  v_clean text[];
begin
  select string_agg(distinct k, ', ') into v_bad
    from unnest(coalesce(p_perms, '{}')) k where k not in (select c.key from public._permission_catalog() c);
  if v_bad is not null then raise exception 'Unknown permission: %', left(v_bad, 80); end if;
  select coalesce(array_agg(distinct k order by k), '{}') into v_clean from unnest(coalesce(p_perms, '{}')) k;
  return v_clean;
end;
$$;
revoke execute on function public._clean_permissions(text[]) from public, anon, authenticated;

-- ------------------------------------------------------------------ make / change / remove an admin
-- p_permissions null = a FULL admin (everything, including permissions added in future); a list = a limited admin with exactly those.
create or replace function public.admin_set_admin(p_user uuid, p_enabled boolean, p_permissions text[] default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.profiles;
  g public.admin_grants;
  v_had_grant boolean;
  v_perms text[];
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_body text;
  v_changed boolean := false;
  v_action text;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Only a super admin can do this' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Choose whether to give or remove admin access.'; end if;
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  if t.is_super_admin then
    raise exception 'That person is a super admin (all access). Remove their super admin status first if you want to limit them.';
  end if;
  select * into g from public.admin_grants where user_id = p_user;
  v_had_grant := found;

  if p_enabled then
    if p_permissions is not null then
      v_perms := public._clean_permissions(p_permissions);
      if cardinality(v_perms) = 0 then raise exception 'Choose at least one thing this admin may do, or give full admin access.'; end if;
    end if;
    if not t.is_admin then
      update public.profiles set is_admin = true where id = p_user;
      v_changed := true;
      v_action := 'admin_granted';
    end if;
    if v_perms is null then
      if v_had_grant then delete from public.admin_grants where user_id = p_user; v_changed := true; end if;
    elsif not v_had_grant then
      insert into public.admin_grants (user_id, permissions, note, granted_by) values (p_user, v_perms, v_note, auth.uid());
      v_changed := true;
    elsif g.permissions is distinct from v_perms or g.note is distinct from v_note then
      update public.admin_grants set permissions = v_perms, note = v_note, granted_by = auth.uid(), updated_at = now() where user_id = p_user;
      v_changed := true;
    end if;
    if t.is_admin and v_perms is not null and not v_had_grant then
      -- a full admin was limited
      v_action := 'admin_permissions_changed';
    elsif t.is_admin and v_changed then
      v_action := 'admin_permissions_changed';
    end if;
    if v_changed then
      perform public._audit(v_action, 'profiles', p_user, jsonb_build_object('name', t.full_name, 'full', v_perms is null,
        'permissions', to_jsonb(v_perms), 'was_admin', t.is_admin, 'was_full', t.is_admin and not v_had_grant,
        'was_permissions', case when v_had_grant then to_jsonb(g.permissions) end, 'note', v_note));
      v_body := case when v_action = 'admin_granted'
                     then 'You now have admin access' || case when v_perms is null then ' (full admin).' else format(' (%s permissions).', cardinality(v_perms)) end
                     else 'Your admin permissions were changed' || case when v_perms is null then ': you are now a full admin.' else format(': %s permissions.', cardinality(v_perms)) end end;
      perform public._notify(p_user, 'admin_access', auth.uid(), null, v_body);
    end if;
  else
    if p_user = auth.uid() then raise exception 'You cannot remove your own admin access.'; end if;
    if t.is_admin then
      update public.profiles set is_admin = false where id = p_user;   -- the grants row goes with it
      v_changed := true;
      perform public._audit('admin_removed', 'profiles', p_user, jsonb_build_object('name', t.full_name,
        'was_full', not v_had_grant, 'was_permissions', case when v_had_grant then to_jsonb(g.permissions) end, 'note', v_note));
      perform public._notify(p_user, 'admin_access', auth.uid(), null, 'Your admin access was removed.');
    end if;
  end if;

  return jsonb_build_object('changed', v_changed, 'is_admin', p_enabled, 'full', p_enabled and v_perms is null, 'permissions', to_jsonb(v_perms));
end;
$$;

-- ------------------------------------------------------------------ make / remove a super admin (owner)
create or replace function public.admin_set_super_admin(p_user uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.profiles;
  v_changed boolean := false;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Only a super admin can do this' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Choose whether to give or remove super admin status.'; end if;
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception 'That member no longer exists.'; end if;

  if p_enabled then
    if not t.is_super_admin then
      update public.profiles set is_admin = true, is_super_admin = true where id = p_user;
      delete from public.admin_grants where user_id = p_user;
      v_changed := true;
      perform public._audit('super_admin_granted', 'profiles', p_user, jsonb_build_object('name', t.full_name, 'was_admin', t.is_admin));
      perform public._notify(p_user, 'admin_access', auth.uid(), null, 'You are now a super admin (all access).');
    end if;
  elsif t.is_super_admin then
    if not exists (select 1 from public.profiles p where p.is_super_admin and p.id <> p_user) then
      raise exception 'There must always be at least one super admin. Make someone else a super admin first.' using errcode = 'P0001';
    end if;
    -- they stay a full admin; remove that separately if wanted
    update public.profiles set is_super_admin = false where id = p_user;
    v_changed := true;
    perform public._audit('super_admin_removed', 'profiles', p_user, jsonb_build_object('name', t.full_name, 'self', p_user = auth.uid()));
    perform public._notify(p_user, 'admin_access', auth.uid(), null, 'You are no longer a super admin. You are still a full admin.');
  end if;
  return jsonb_build_object('changed', v_changed, 'is_super', p_enabled);
end;
$$;

-- ------------------------------------------------------------------ hand over ownership
-- Makes p_to_user a super admin and, if p_step_down, removes the caller's own super status in the same transaction
-- (the caller stays a full admin). Refuses unless someone else holds super status once it is done.
create or replace function public.admin_transfer_ownership(p_to_user uuid, p_step_down boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.profiles;
  me public.profiles;
  v_changed boolean := false;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Only a super admin can do this' using errcode = '42501';
  end if;
  if p_to_user = auth.uid() then raise exception 'Choose another person: you already own this.'; end if;
  select * into t from public.profiles where id = p_to_user for update;
  if not found then raise exception 'That member no longer exists.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;

  if not t.is_super_admin then
    update public.profiles set is_admin = true, is_super_admin = true where id = p_to_user;
    delete from public.admin_grants where user_id = p_to_user;
    v_changed := true;
    perform public._notify(p_to_user, 'admin_access', auth.uid(), null,
      case when coalesce(p_step_down, false) then 'Ownership was transferred to you: you are now a super admin.' else 'You are now a super admin (all access).' end);
  end if;
  if coalesce(p_step_down, false) then
    -- the target is a super admin now, so the "at least one super admin" rule is met
    update public.profiles set is_super_admin = false where id = auth.uid();
    v_changed := true;
  end if;
  if v_changed then
    perform public._audit('ownership_transferred', 'profiles', p_to_user,
      jsonb_build_object('name', t.full_name, 'step_down', coalesce(p_step_down, false), 'from', me.full_name, 'was_super', t.is_super_admin));
  end if;
  return jsonb_build_object('changed', v_changed, 'to', p_to_user, 'stepped_down', coalesce(p_step_down, false));
end;
$$;

-- ------------------------------------------------------------------ who holds access
-- Super admins see every permission, who granted it and the note. Other admins who may see the admin list ('admins') get names,
-- the Super badge and whether each person is a full or limited admin: not the permission lists of other people (their own, yes).
create or replace function public.admin_list_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_super boolean := public.is_super_admin();
begin
  if auth.uid() is null or not public._admin_can('admins') then
    raise exception 'You do not have permission to see this. Ask a super admin.' using errcode = '42501';
  end if;
  return jsonb_build_object('viewer_is_super', v_super, 'admins', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'grad_year', p.grad_year, 'branch', p.branch,
        'is_super', p.is_super_admin, 'full', p.is_super_admin or g.user_id is null,
        'permission_count', case when p.is_super_admin or g.user_id is null then (select count(*) from public._permission_catalog())
                                 else cardinality(g.permissions) end,
        'permissions', case when v_super or p.id = auth.uid()
                            then (case when p.is_super_admin or g.user_id is null then (select jsonb_agg(c.key order by c.sort) from public._permission_catalog() c)
                                       else to_jsonb(g.permissions) end) end,
        'note', case when v_super then g.note end,
        'granted_at', case when v_super then coalesce(g.granted_at, h.at) end,
        'granted_by', case when v_super then coalesce(gb.full_name, hb.full_name) end)
      order by p.is_super_admin desc, p.full_name), '[]'::jsonb)
    from public.profiles p
    left join public.admin_grants g on g.user_id = p.id
    left join public.profiles gb on gb.id = g.granted_by
    left join lateral (select a.actor, a.created_at as at from public.admin_audit a
                        where a.target_id = p.id and a.action in ('admin_granted', 'super_admin_granted', 'ownership_transferred', 'admin_permissions_changed')
                        order by a.id desc limit 1) h on true
    left join public.profiles hb on hb.id = h.actor
   where p.is_admin));
end;
$$;

revoke execute on function public.admin_set_admin(uuid, boolean, text[], text) from anon, public;
revoke execute on function public.admin_set_super_admin(uuid, boolean) from anon, public;
revoke execute on function public.admin_transfer_ownership(uuid, boolean) from anon, public;
revoke execute on function public.admin_list_admins() from anon, public;
grant execute on function public.admin_set_admin(uuid, boolean, text[], text) to authenticated;
grant execute on function public.admin_set_super_admin(uuid, boolean) to authenticated;
grant execute on function public.admin_transfer_ownership(uuid, boolean) to authenticated;
grant execute on function public.admin_list_admins() to authenticated;
