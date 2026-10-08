# Two-week plan: everything from the product plan (Launch, V2, V3)

Started 8 Oct 2026. The quality rules apply to every item, every day:
- Database rules are covered by tests.
- Every flow has an end-to-end test in a phone-sized browser.
- An independent review runs after each block, and every finding is fixed before moving on.
- No screen should feel slow: content is cached, main screens are prefetched, and skeletons replace spinners.

## Already done (Days 1–2)

**Alumni Meet module**
- Registration with family members and server-side fees
- UPI payment with UTR, plus treasurer verification and bank-statement matching
- E-ticket with QR code, and gate check-in
- Exports and event settings, with team roles

**Profiles and directory**
- Sign-in with Google, LinkedIn or an email code
- Onboarding, professional profiles, LinkedIn import (PDF and data export)
- Directory open to verified members only

**Admin, data and quality**
- Admin console: members, registration editing, activity log
- Photos: compressed copies in the app; originals in the committee's Google Drive
- Backups: nightly CSVs to Drive, and an encrypted database backup outside Drive (restore rehearsed)
- Two independent reviews (database security, frontend code); all 34 findings fixed and regression-tested

## Days 3–4: launch the Meet registration

- UX/speed review fixes (in progress)
- Committee details entered (fees, UPI, dates), go-live checklist, and a 5-person dry run
- Android app: wrap the same code with Capacitor, then start Google Play **closed testing now**. Google requires 14 days with 12 testers before a new app can go public; starting now puts it live around 24 Oct.

## Days 5–8: the community app (product plan "Launch" scope)

| Module | Contents |
|---|---|
| M5 Feed | Posts (text, photos, links), likes, comments, audience (all JEC / batch / circle), report |
| M6 Batch groups | Automatic batch and year groups; batch admins; pinned posts |
| M7 Messages | 1:1 chat, message requests, daily limits, "who can message me" |
| M8 Connections | Connect and follow, "people you may know" |
| M9 Notifications | In-app inbox, push notifications (Firebase), weekly email digest |
| M17 Circles and channels | Interest circles, broadcast channels (JEC Official, Placements) |
| M18 Invite and grow | Invite link and QR, WhatsApp share, batch progress bars, badges, leaderboards |
| M19 Engagement | Birthdays, badges, JECian of the Week |

## Days 9–11: V2

- Jobs and referrals
- Mentorship and office hours
- Events and reunions (the Meet module generalised)
- College news and Proud JECians
- Analytics for the alumni cell
- Ask JEC Q&A
- Blood and help network
- Alumni business directory
- Trip plans, group chats, message search
- Hindi
- Map view

## Days 12–13: V3

- Stories
- Fitness challenges and streaks
- Quizzes and throwbacks
- Give-back pages (if the committee approves)
- Smarter feed ranking

## Day 14: final pass

- Full independent security, code and UX review of everything
- Performance pass on a low-cost Android phone over 4G
- Committee presentation build

## What only the committee can provide (blocking go-live, not development)

1. Final event details, fees and the association's UPI ID.
2. The free accounts in docs/SETUP.md, created with an association email.
3. The Google Play developer account (₹2,100 one-time) and 12 testers for the closed test.
