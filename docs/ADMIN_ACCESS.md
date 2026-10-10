# Who can do what: super admins, admins and event roles

JEC Alumni Connect will be run by changing committees. Access is therefore layered so that a person gets exactly the access
they need, can be changed later, and nobody can lock the association out.

| Who | What they can do | Who can make them |
|---|---|---|
| **Super admin** (owner) | Everything. Also: make and remove admins, choose what each admin may do, make other super admins, hand over ownership. | Another super admin, or the one-time SQL snippet below |
| **Full admin** | Everything an admin can do, including permissions added in future. Cannot make or remove admins or super admins. | A super admin |
| **Limited admin** | Only the permissions a super admin ticked for them (list below). | A super admin |
| **Moderator** (site role) | Reports, hiding content, slow mode, city meetups, across the community. | An admin with a moderation permission, or a super admin |
| **Treasurer / Content manager / Check-in volunteer** (event roles) | Money / messages and programme / scanning tickets, **for one event only**. | An admin with the "Event teams" permission, or a super admin |

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

Ready-made sets when you make an admin: **Full admin**, **Finance & events**, **Content & community**, **Moderation only**,
**Members & verification**, **Photos & gallery**, **Funds & treasury** (all four fund permissions), or **Custom** (tick exactly what you want). The "Review" step lists what they will and will not be able to do.

Notes on how the pieces fit:
- Seeing a member's phone number needs `members_view`; changing it needs `members_edit` (and the member editor itself opens from the members list, so give both together).
- The event roles (treasurer etc.) keep working next to permissions: a person can be a limited admin and also a treasurer of one event.
- `events_team` (and the moderation permissions, which let someone give the Moderator role) are powerful: an event role such as treasurer carries more than a limited admin's own list. Nobody can give a role to themselves except a super admin, but be careful whom you trust with these.
- What other admins can see of the admin list: names and the Super badge. Only super admins see each person's permission list, who granted it, when, and the note.

## Everyday tasks (super admins)

Open **Organise → Roles → Admins and owners**.

- **Make an admin**: *Make admin* → find the member (they must have signed in once) → pick a preset or Custom → *Review* → confirm. They get a notification.
- **Change what an admin may do**: *Edit permissions* on their row. The change applies on their very next screen.
- **Remove admin access**: *Remove admin access* → confirm. They lose every admin screen at once and are told.
- **Make another super admin**: *Make super admin* → type the phrase shown → confirm.
- **Remove someone's super admin status**: *Remove super admin status*. They stay a full admin. You cannot remove the last super admin.
- Every one of these is written to the activity log (**Organise → Activity log → Roles**) with who did it, to whom, and the permissions before and after.

## Handing over to a new committee

1. The incoming person signs in once. Check they appear under **Organise → Members**.
2. **Admins and owners → Transfer ownership**. Choose them.
3. Choose **Add them as an owner** while you work together, or **Hand over and step down** when you are leaving. Stepping down keeps you a *full admin*.
4. Type `TRANSFER OWNERSHIP` and confirm. They are told straight away.
5. As the new owner, remove the old committee's admin access (*Remove admin access*), and make the new committee's admins with the presets above.
6. Keep **two** super admins at all times. The app refuses to remove the last one.

## If no super admin can sign in (recovery)

The app cannot lock you out: a super admin cannot be removed while they are the last one. If both owners lose their accounts
anyway, anyone with access to the Supabase project can restore access from the **SQL Editor**. Replace the placeholder with the
email the person signs in with (it must belong to somebody who has signed in to the app at least once):

```sql
-- make this person a super admin
update public.profiles
   set is_admin = true, is_super_admin = true, verification = 'verified'
 where id = (select id from auth.users where email = 'new-owner@example.com');

-- check who the super admins are
select p.full_name, u.email
  from public.profiles p join auth.users u on u.id = p.id
 where p.is_super_admin;
```

To see who holds which permissions: `select p.full_name, g.permissions from public.admin_grants g join public.profiles p on p.id = g.user_id;`
(an admin with no row there is a full admin).

The SQL Editor runs as the database owner, so these statements are the one way around the screens; they are not written to the
activity log by the app, so note in your committee records that you ran them.

## For developers

- `public._admin_can('<permission>')` is the single check (true for super admins, true for admins without a limited grant, true when the key is in `admin_grants.permissions`). A trailing `*` asks about a family (`'events_*'`).
- `public.admin_permission_catalog()` is the only list of valid keys; `src/lib/adminAccess.ts` mirrors it for the UI (an end-to-end test compares them).
- Event-scoped checks are `public.has_event_cap(cap, event)`: "has the admin permission for this capability, or holds the matching event role".
- `profiles.is_super_admin` and `public.admin_grants` are never writable from the client; only `admin_set_admin`, `admin_set_super_admin` and `admin_transfer_ownership` (SECURITY DEFINER, super admins only) change them.
- Tests: `supabase/tests/99_safety_matrix.sql` calls every admin function as one limited admin per permission; `supabase/tests/99_super_admin.sql` covers the super-admin rules; `e2e/verify/admin-super.spec.ts` drives the screens.
