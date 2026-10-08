# JEC Alumni Connect: build plan

Built from the summary of **JEC Alumni Connect Plan v1.1** (25-page PDF) and the
15-slide committee deck. Neither the PDF nor the deck is in this repo yet.
Items marked **[check PDF]** need to be compared with the PDF before work starts.

## 1. Goals

- A new member finishes signing up in **under 3 minutes** and messages a batchmate within **5 minutes**.
- **₹0 running cost.** The only expense is the one-time ₹2,100 Google Play fee, ideally sponsored by an alumnus.
- The app never opens empty: launch batch by batch.

## 2. Stack (all free tier)

| Concern | Choice |
|---|---|
| Backend, database, auth, storage, realtime | Supabase (Postgres + Row Level Security) |
| Sign-in | Google sign-in + email OTP (no paid SMS) |
| Web app | PWA on free hosting (iPhone users install it from the browser) |
| Android | Play Store app wrapping the same PWA (Trusted Web Activity), so there is one codebase **[check PDF]** |
| Push notifications | Firebase Cloud Messaging |
| Domain | College subdomain if the committee approves; otherwise the free host's domain |

Suggested frontend: Next.js (or Vite + React) with TypeScript and Tailwind, built as a PWA. **[check PDF]**

Rules for staying on free plans:
- Compress and resize photos on the device before upload.
- Paginate every list and never load whole tables.
- Use realtime only for chat and notifications.
- Keep a usage dashboard and move to a paid plan only when the free limits are actually reached.

## 3. Modules

Core features (M1–M16, numbering **[check PDF]**):
- Auth and onboarding (Google / email OTP, interest picker, batch and branch)
- Verification: three ways (e.g. college records, a vouch from a verified member, admin review) **[check PDF]**
- Profiles and an alumni directory with search and filters
- Batch groups that every member joins automatically
- 1:1 messaging
- Notifications (in-app and push)
- Block and report, spam limits, admin and moderation tools
- After launch: jobs, mentorship, events

New in v1.1:
- **M17 Interest circles and channels.** Circles are groups where anyone can post; channels are broadcast-only (e.g. "JEC Official", "Placement Updates"). Later: trip plans people can join, and fitness challenges with streaks and leaderboards.
- **M18 Invite and grow.** A personal invite link and QR code, one-tap WhatsApp sharing and group invites. An invite from a verified member speeds up verification. Includes batch progress ("CSE 2016: 38% on board"), the Connector and Batch Champion badges, and leaderboards. **The app never messages invitees itself**; reminders go only to the person who invited them.
- **M19 Engagement.** At launch: birthday wishes, badges and "JECian of the Week". Later: stories, an "Ask JEC" Q&A forum, a city-wise blood donation and help network, a directory of alumni-run businesses, and quizzes and throwback posts.

## 4. Release scope

- **First launch:** auth, verification, profiles, directory, batch groups, messaging, notifications, M17 circles and channels, M18 invites and badges, M19 birthdays, badges and spotlight, block and report.
- **V2:** jobs, mentorship, events, Ask JEC, help network, trip plans.
- **V3:** stories, fitness challenges, business directory, quizzes and throwbacks.

## 5. Timeline: about 14 weeks to public launch **[check PDF for exact phases]**

| Weeks | Work |
|---|---|
| 1–3 | UI/UX: design system, Figma prototype, test with 5 alumni and 5 students. **No feature code until this is signed off.** In parallel: repo, CI, Supabase project and schema draft. |
| 4–5 | Auth, onboarding, profiles, verification, RLS policies |
| 6–7 | Directory, batch groups, 1:1 messaging |
| 8–9 | Circles and channels (M17), notifications and push |
| 10–11 | Invites, QR codes, badges, progress bars and leaderboards (M18), plus birthdays and spotlight (M19) |
| 12 | Moderation, block and report, admin panel, privacy screens (DPDP Act) |
| 13 | Closed beta with one or two batches; fixes; Play Store submission |
| 14 | Public launch, batch by batch |

## 6. Design gate (Section 05)

- One design lead approves every UI change.
- Every screen must pass the pre-release checklist before it ships. **[copy the checklist from the PDF]**
- Use the plan's colours and fonts as design tokens. **[copy from the PDF]**

## 7. Data model (first pass) **[check PDF]**

`profiles`, `batches`, `verifications`, `interests`, `profile_interests`,
`groups` (type: batch | circle | channel), `group_members`, `posts`,
`conversations`, `messages`, `invites`, `badges`, `user_badges`,
`notifications`, `reports`, `blocks`, `push_tokens`.

## 8. Waiting on the alumni committee

1. A free college subdomain for the web address?
2. Will an alumnus sponsor the ₹2,100 Play Store fee?
3. Can verified members see the names of batchmates who haven't joined yet, from college records? This is a privacy decision. It affects how the invite feature is built and is needed by week 10.
4. The remaining asks from the deck's decisions slide (8 in total). **[list them from the deck]**
5. Later, not blocking: should the group become a registered society or trust before accepting donations?

## 9. Immediate next steps in this repo

1. Add the v1.1 PDF to `docs/`.
2. Confirm the stack choices above.
3. Scaffold the PWA, CI, the Supabase project and migrations for the core tables.
4. Set up design tokens and a component library once the design is signed off.
