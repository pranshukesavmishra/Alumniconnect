# Who can do what: super admins, admins and event roles

JEC Alumni Connect will be run by changing committees. Access is therefore layered so that a person gets exactly the access
they need, can be changed later, and nobody can lock the association out.

| Who | What they can do | Who can make them |
|---|---|---|
| **Owner** (super admin) | Everything, forever. Makes admins and chooses their roles. **Owners are permanent**: nobody can remove, demote, un-verify, restrict or delete an owner, not even the owner themself. There is no "transfer ownership" and no "make another owner" in the app. | Set once in the database (see "Adding an owner") |
| **Full admin** | Everything an admin can do, including permissions added in future. Cannot make or remove admins. | An owner |
| **Role admin** (Treasurer, Event manager, Moderator, Department head, ...) | Only what the role allows (see "Roles"), for everyone or for one department or batch. | An owner |
| **Moderator** (site role) | Reports, hiding content, slow mode, city meetups, across the community. | An admin with a moderation permission, or an owner |
| **Treasurer / Content manager / Check-in volunteer** (event roles) | Money / messages and programme / scanning tickets, **for one event only**. | An admin with the "Event teams" permission, or an owner |

Admins that existed before limited admins were introduced are **full admins**: nothing changed for them.

The database enforces all of this (every admin function and every row-level policy asks "does this person hold permission X?").
The screens only hide what you cannot use. Anyone who opens a screen they have no permission for sees "Ask a super admin to give you access".

## Permissions an admin can be given

| Key | What it covers |
|---|---|
| `members_view` | Search and open members, details (including phone), notes, timeline, "view as member", saved views |
| `members_edit` | Change a member's profile and phone number, write private notes |
| `members_verify` | Approve or reject members, one by one or in bulk |
| `members_import` | Add a member, import members from a spreadsheet |
| `members_merge` | Find duplicate members and merge them |
| `members_export` | Download member lists, with or without phone and e-mail |
| `events_create` | Create and delete events |
| `events_edit` | Change event details, publish or hide an event, programme, questions, photos |
| `events_settings` | Per-event settings such as the Drive archive |
| `events_tickets` | Ticket types, prices, day passes |
| `events_team` | Give or remove treasurer, content manager and check-in roles |
| `events_registrations` | See and edit registrations, waiting list, capacity, attendance report, export registrations |
| `events_checkin` | Scan tickets and use day-of tools |
| `money_payments` | Approve or reject payments, record cash and bank payments, see payment proofs |
| `money_refunds` | Record refunds and give discounts |
| `money_finance` | The finance ledger and reconciliation report |
| `money_exports` | Download registration, payment and ledger lists |
| `messages_announcements` | Post announcements on an event page |
| `messages_send` | Send, schedule, cancel and approve messages to registrants |
| `moderation_reports` | Read member reports and dismiss them |
| `moderation_hide` | Hide or restore posts, comments, chat messages, jobs, help requests and listings |
| `moderation_slowmode` | Slow mode in a group |
| `moderation_meetups` | Hide, close or restore city meetups |
| `community_circles` | Approve circles, manage groups and channels |
| `community_spotlight` | Choose the members in the spotlight |
| `community_batches` | Set batch sizes |
| `photos_moderate` | Event photos: approve, hide, delete and reorder them, choose whether member photos show at once or need approval, open a best-photo vote, download an event photo ZIP (logged). Also lets the person hide and dismiss reports about photos |
| `gallery_manage` | The college gallery: add photos (from an event's photos or by upload), edit, feature, pair "Then & Now", remove, manage albums and filter chips, approve or decline member suggestions |
| `funds_manage` | Fund appeals: create, edit, publish, pause, feature; items, milestones, updates to donors, the "where the money went" expense log, and the fund settings (UPI id, receipt footer, tax text, foreign-donor notice) |
| `funds_verify` | Verify or reject donations (bulk, bank-statement matching), record cash, cheque and bank gifts, record refunds. Also sees the names of anonymous donors |
| `funds_reports` | Fund totals by appeal, batch, department, month and donor, sponsorship reports, and CSV downloads (logged in the activity log) |
| `sponsors_manage` | Sponsor packages, the sponsor pipeline (lead, contacted, proposal sent, committed, paid, delivered), contact details of sponsors, the sponsor wall, proposals, agreements and invoices. Verifying a sponsor's payment needs `funds_verify` |
| `analytics` | Growth and activity numbers |
| `audit` | Read and download the activity log |
| `health` | Backups, errors, storage, site health |
| `admins` | See the list of admins and owners (changing it is for super admins only) |

## Roles (templates) and scope

When you make an admin you pick a **role**. A role is a ready-made set of the permissions above with a one-line explanation. You can still tick extra or fewer permissions (*Customise permissions*), or pick **Custom**.

| Role | What it is for | Permissions | Scope |
|---|---|---|---|
| Full admin | Everything an admin can do, including future permissions | all | everyone |
| Treasurer | Payments, refunds, finance ledger, money exports (and funds, once the Give Back module is installed) | `money_*`, `funds_*` | everyone |
| Event manager | Runs events end to end | `events_*`, `photos_moderate` | everyone |
| Registration desk | Works the door | `events_checkin`, `events_registrations` | everyone |
| Communications officer | Announcements and messages to registrants | `messages_*` | everyone |
| Moderator | Reports, hiding content, slow mode, meetups | `moderation_*` | everyone |
| Community manager | Circles, groups, spotlight, batch sizes | `community_*` | everyone |
| Photographer / gallery curator | Event photos and the college gallery | `photos_moderate`, `gallery_manage` | everyone |
| Funds and sponsorship manager | Fundraising and sponsors (hidden until the Give Back module adds `funds_*` / `sponsors_*` permissions) | `funds_*`, `sponsors_*` | everyone |
| Membership officer | The member list | `members_view/edit/verify/import/export` | everyone |
| Auditor / viewer | Read-only insight | `analytics`, `audit`, `health` | everyone |
| Department head | Sees and verifies only the members of one department; runs that department's groups and announcements | `members_view`, `members_verify` | **one department** (a branch name) |
| Batch representative | Sees only the members of one batch year; runs that batch's groups | `members_view` | **one batch year** |

The roles live in the table `admin_role_templates` (a family such as `money_*` expands to every matching permission, so a role grows when a permission is added). The "Registration desk" role has no read-only registrations permission to use: it holds `events_registrations`, which also allows editing registrations.

**Scope is enforced by the database.** An admin whose scope is a department or a batch only ever sees or changes members inside it: the member list and ids, search, a member's timeline, "view as member", a member's e-mail, verifying (one by one or in bulk: one outsider in a bulk selection refuses the whole selection), the "needs your attention" counts, and the members' private details (phone) and notes. Whole-list tools (export, import, merge, duplicates, saved views) are for admins of everyone. Registrations and payments are not part of a scoped member role. A department head or batch rep also administers the groups whose department or batch matches their scope.

Notes on how the pieces fit:
- Seeing a member's phone number needs `members_view`; changing it needs `members_edit` (and the member editor itself opens from the members list, so give both together).
- The event roles (treasurer etc.) keep working next to permissions: a person can be a limited admin and also a treasurer of one event.
- `events_team` (and the moderation permissions, which let someone give the Moderator role) are powerful: an event role such as treasurer carries more than a limited admin's own list. Nobody can give a role to themselves except a super admin, but be careful whom you trust with these.
- What other admins can see of the admin list: names and the Super badge. Only super admins see each person's permission list, who granted it, when, and the note.

## Everyday tasks (owners)

Open **Organise → Roles → Admins and owners**.

- **Make an admin**: *Make admin* → find the member (they must have signed in once) → pick a **role** (each card explains it) → if the role is for one department or batch, choose which → optionally *Customise permissions* → *Review* → confirm. They get a notification.
- **Change someone's role**: *Change role* on their row. It applies on their very next screen.
- **Remove admin access**: *Remove admin access* → confirm. They lose every admin screen at once and are told.
- Owners show as **Owner · permanent** with a lock and have no buttons. Every change is written to the activity log (**Organise → Activity log → Roles**) with who did it, to whom, the role, the scope and the permissions before and after.

## The owner lock

The owner accounts are the profiles that are super admins, listed in `public.protected_owners` (filled by a migration from the profiles that were super admins at the time, never from e-mail addresses in code). The database enforces, for every role including the database owner:

- an owner's `is_super_admin` / `is_admin` can never be set to false, and their verification can never leave `verified` (so they cannot be rejected, un-verified or restricted);
- an owner's profile can never be deleted, so deleting the user in the Supabase dashboard (or any account-deletion flow) fails;
- an owner's `admin_grants` row cannot be inserted, changed or deleted (owners always hold every permission);
- `protected_owners` cannot be updated, deleted or truncated, and is invisible to the app;
- `admin_set_admin`, `admin_set_member`, `admin_bulk_set_verification`, `admin_update_member` (by anyone but the owner themself) and `admin_merge_members` refuse an owner with the message "Ownership is locked".

The older "at least one super admin" rule remains as a second safeguard. The functions `admin_set_super_admin` and `admin_transfer_ownership` no longer exist.

## Adding an owner

Owners are never made from the app. A person who has signed in once is made an owner by someone with access to the Supabase **SQL Editor** (replace the e-mail):

```sql
begin;
update public.profiles
   set is_admin = true, is_super_admin = true, verification = 'verified'
 where id = (select id from auth.users where email = 'new-owner@example.com');
insert into public.protected_owners (user_id)
  select id from auth.users where email = 'new-owner@example.com';
commit;

-- check who the owners are
select p.full_name, u.email from public.protected_owners o
  join public.profiles p on p.id = o.user_id join auth.users u on u.id = o.user_id;
```

From that moment they are permanent too.

## Removing an owner (emergency only)

> **WARNING. DO NOT DO THIS CASUALLY.** An owner is permanent on purpose. This is the break-glass procedure for the rare case that an owner account is compromised or an owner truly must go (for example someone who has left under dispute). It needs the `postgres` role in the Supabase SQL Editor, it switches off the protection for everyone while it runs, and nothing in the app records it. Do it with a second committee member watching, write down who, why and when, and finish **every** step, including the last one that puts the lock back. Never leave the triggers dropped.

Run these steps in one SQL Editor session, in order. Replace `<OWNER-ID>` with the owner's id (`select id from auth.users where email = '...'`). Do **not** do this for the only owner without first adding another owner (the old "at least one super admin" rule will refuse otherwise).

```sql
begin;

-- STEP 1: take the locks off (drops the five triggers that protect owners)
drop trigger protected_owners_no_change   on public.protected_owners;
drop trigger protected_owners_no_truncate on public.protected_owners;
drop trigger profiles_00_protect_owner    on public.profiles;
drop trigger admin_grants_protect_owner   on public.admin_grants;

-- STEP 2: take the person off the list of permanent owners
delete from public.protected_owners where user_id = '<OWNER-ID>';

-- STEP 3: do what is needed. Pick ONE:
--   (a) demote but keep as a member:
update public.profiles set is_super_admin = false, is_admin = false where id = '<OWNER-ID>';
--   (b) or delete the account completely (this deletes their profile and everything of theirs):
-- delete from auth.users where id = '<OWNER-ID>';

-- STEP 4: put every lock back (recreates the triggers; safe to run again)
select public._restore_owner_locks();

-- STEP 5: confirm four lock triggers exist and the right owners remain
select tgname from pg_trigger where tgname in
  ('protected_owners_no_change','protected_owners_no_truncate','profiles_00_protect_owner','admin_grants_protect_owner');
select p.full_name from public.protected_owners o join public.profiles p on p.id = o.user_id;

commit;
```

If anything errors, the `begin`/`commit` makes the whole thing roll back and nothing changes. Keep the record of who ran it, when and why.

## If no owner can sign in (recovery)

Owners cannot be removed, so this happens only when they lose their sign-in (e-mail account lost). Do not remove them: have them recover the e-mail account, or add a **new** owner with the snippet under "Adding an owner" and, if the old account must go, follow "Removing an owner (emergency only)".

To see who holds which permissions: `select p.full_name, g.template_key, g.scope_kind, g.scope_value, g.permissions from public.admin_grants g join public.profiles p on p.id = g.user_id;` (an admin with no row there is a full admin).

## For developers

- `public._admin_can('<permission>')` is the single check (true for super admins, true for admins without a limited grant, true when the key is in `admin_grants.permissions`). A trailing `*` asks about a family (`'events_*'`).
- `public.admin_permission_catalog()` is the only list of valid keys; `src/lib/adminAccess.ts` mirrors it for the UI (an end-to-end test compares them).
- Event-scoped checks are `public.has_event_cap(cap, event)`: "has the admin permission for this capability, or holds the matching event role".
- `profiles.is_super_admin` and `public.admin_grants` are never writable from the client; only `admin_set_admin(user, enabled, permissions, note, template, scope_kind, scope_value)` (SECURITY DEFINER, owners only) changes the grants. Nothing in the app changes `is_super_admin`.
- Scope helpers: `_scope_is_all()`, `_scope_ok(branch, grad_year)`, `_scope_ok_member(id)`, `_require_scope(id)`, `_require_scope_all()`. Any new member-facing admin function must call one of them (and refuse owners if it writes to a profile).
- Tests: `supabase/tests/99_safety_matrix.sql` calls every admin function as one limited admin per permission; `supabase/tests/99_super_admin.sql` proves the owner lock; `supabase/tests/99_roles_scope.sql` covers templates and scope; `e2e/verify/admin-super.spec.ts` drives the screens.
