# JEC Alumni Connect

The home of Jabalpur Engineering College alumni: verified profiles, a searchable directory, batch communities and
interest circles, chat (direct and group, with full history for late joiners), a jobs board, "Ask JEC" help network,
mentorship, and the **Alumni Connect Grand Reunion 2026** (26–27 Dec, batches 2003–2012: registration, UPI payment, QR tickets, check-in, photos, programme and
announcements). Built to run on free tiers and last for years.

**Stack:** React 19 + Vite + TypeScript (installable PWA) · Supabase (Postgres with row-level security, Auth, Storage,
Edge Functions, Realtime) · Cloudflare Pages · Google Drive for original photos · nightly encrypted backups.

## Start here

| I want to… | Read |
|---|---|
| Put the app live (accounts, keys, hosting) | [docs/SETUP.md](docs/SETUP.md) |
| Understand how backups work and restore one | [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) |
| Ship it as an Android app | [docs/ANDROID.md](docs/ANDROID.md) |
| See the plan and roadmap | [docs/PLAN.md](docs/PLAN.md), [docs/ROADMAP_2_WEEKS.md](docs/ROADMAP_2_WEEKS.md) |
| Know how LinkedIn import works | [docs/LINKEDIN_PDF.md](docs/LINKEDIN_PDF.md) |

## Develop

```bash
npm install
scripts/dev-stack.sh        # Docker + local Supabase + Edge Functions (first run downloads images)
npm run dev                 # http://localhost:5173
scripts/test-all.sh         # every check: types, lint, unit, build, database, edge functions, browser journeys
```

Everything that matters is tested against the real stack: `supabase/tests/*.sql` (rules, permissions, limits),
`supabase/functions/**/*.test.ts` (Deno), `e2e/` (phone-sized browser journeys with real sign-in, payments, chat,
push, offline ticket). `e2e/verify/` holds the independent verification suites kept as regression tests.

Layout: `src/features/<area>` (screens + data hooks), `src/components/ui` (design system), `src/lib` (pure helpers),
`supabase/migrations` (the schema, in order), `supabase/functions` (server code), `scripts/` (dev and CI tooling).

## Safety rules the code follows

* Every table has row-level security and **explicit grants only** (nothing is reachable by default); a test enforces it.
* Members' phone/email are never readable by other members; admins' lookups are logged; every admin action is audited.
* Money is stored in paise (integers). Payments are verified by a treasurer; nothing is auto-trusted.
* The Google Drive owner's address is never sent to the app; secrets live only in function secrets / CI secrets.
